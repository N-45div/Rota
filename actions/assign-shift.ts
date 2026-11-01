import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { loadRosterContext, presentShift, requireTeam, teamIdForShift, teamChange } from "../server/lib/roster.js";
import { checkAssignment, hasBlocking } from "../server/lib/rules.js";

export default defineAction({
  description:
    "Put one person on a shift, or pass staffId null to make it open. Runs the rule checker: fails with rule_violation (409) listing problems such as double-booking, missing skill, unavailability, or going over max hours; fails with shift_locked (409) if the manager pinned the shift. Only pass override=true when the user explicitly says to override a rule; double-booking can never be overridden.",
  schema: z.object({
    shiftId: z.string().describe("Shift id from get-roster"),
    staffId: z.string().nullable().describe("Staff id from get-roster, or null to unassign"),
    override: z
      .boolean()
      .default(false)
      .describe("Allow overridable rules (skill, availability, max hours). Only when the user asks."),
  }),
  changeResource: teamChange,
  run: async (input) => {
    // Treat "null" and "" as unassign too; CLI flags and some callers send strings.
    const args = { ...input, staffId: input.staffId === "null" || input.staffId === "" ? null : input.staffId };
    const teamId = await teamIdForShift(getDb(), args.shiftId);
    await assertAccess("team", teamId, "editor");
    return getDb().transaction(async (tx) => {
      const team = await requireTeam(tx, teamId, { forUpdate: true, write: true });
      const { shifts } = schema;
      const [shift] = await tx
        .select({
          id: shifts.id,
          role: shifts.role,
          startsAt: shifts.startsAt,
          endsAt: shifts.endsAt,
          staffId: shifts.staffId,
          locked: shifts.locked,
          note: shifts.note,
          status: shifts.status,
        })
        .from(shifts)
        .where(and(eq(shifts.id, args.shiftId), eq(shifts.teamId, team.id)))
        .limit(1);
      if (!shift || shift.status !== "scheduled") {
        fail("Shift not found.", { errorCode: "not_found", statusCode: 404 });
      }
      if (shift.locked) {
        fail("This shift is locked by the manager. Unlock it first.", {
          errorCode: "shift_locked",
          statusCode: 409,
        });
      }

      let warnings: ReturnType<typeof checkAssignment> = [];
      let staffName: string | null = null;
      if (args.staffId) {
        const ctx = await loadRosterContext(tx, team, shift.startsAt, shift.endsAt);
        const person = ctx.staff.find((candidate) => candidate.id === args.staffId);
        if (!person) fail("Staff member not found in this team.", { errorCode: "not_found", statusCode: 404 });
        const violations = checkAssignment({
          shift: { ...shift, staffId: person.id },
          staff: person,
          shifts: ctx.shifts,
          availability: ctx.availability,
          timeZone: team.timezone,
        });
        if (hasBlocking(violations, args.override)) {
          fail(violations.filter((v) => v.severity !== "warn").map((v) => v.message).join(" "), {
            errorCode: "rule_violation",
            statusCode: 409,
            details: { violations },
          });
        }
        warnings = violations;
        staffName = person.name;
      }

      await tx
        .update(shifts)
        .set({ staffId: args.staffId, updatedAt: new Date().toISOString() })
        .where(eq(shifts.id, shift.id));

      return {
        ...presentShift({ ...shift, staffId: args.staffId }, team.timezone),
        teamId: team.id,
        staffName,
        warnings,
      };
    });
  },
});
