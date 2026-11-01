import { defineAction, fail } from "@agent-native/core/action";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { loadRosterContext, requireTeam } from "../server/lib/roster.js";
import { checkAssignment, hasBlocking, type Violation } from "../server/lib/rules.js";

export default defineAction({
  description:
    "Fill many shifts at once, e.g. when drafting a week. Each assignment is checked against the rules and against the earlier ones in the same call. Valid ones are saved; invalid or locked ones are skipped and returned in `rejected` with reasons. Never overrides rules. Read get-roster first, then propose all assignments in one call.",
  access: {
    scope: "resource",
    resource: { type: "team", idFrom: "teamId", level: "editor" },
  },
  schema: z.object({
    teamId: z.string().describe("Team id from list-teams"),
    assignments: z
      .array(
        z.object({
          shiftId: z.string().describe("Open or assigned shift id from get-roster"),
          staffId: z.string().describe("Staff id from get-roster"),
        }),
      )
      .min(1)
      .max(150)
      .describe("Shift-to-person pairs, applied in order"),
  }),
  changeResource: (input) => ({ resourceType: "team", resourceId: input.teamId }),
  run: async (args) =>
    getDb().transaction(async (tx) => {
      const team = await requireTeam(tx, args.teamId, { forUpdate: true, write: true });
      const ids = [...new Set(args.assignments.map((a) => a.shiftId))];
      const { shifts } = schema;
      const targets = await tx
        .select({ id: shifts.id, startsAt: shifts.startsAt, endsAt: shifts.endsAt })
        .from(shifts)
        .where(and(eq(shifts.teamId, team.id), eq(shifts.status, "scheduled"), inArray(shifts.id, ids)));
      if (targets.length === 0) fail("None of those shifts exist in this team.", { errorCode: "not_found", statusCode: 404 });

      const from = targets.map((s) => s.startsAt).sort()[0]!;
      const to = targets.map((s) => s.endsAt).sort().reverse()[0]!;
      const ctx = await loadRosterContext(tx, team, from, to);
      const shiftById = new Map(ctx.shifts.map((s) => [s.id, s]));
      const staffById = new Map(ctx.staff.map((p) => [p.id, p]));

      const applied: { shiftId: string; staffId: string; staffName: string; warnings: Violation[] }[] = [];
      const rejected: { shiftId: string; staffId: string; reason: string; violations?: Violation[] }[] = [];
      const now = new Date().toISOString();

      for (const { shiftId, staffId } of args.assignments) {
        const shift = shiftById.get(shiftId);
        const person = staffById.get(staffId);
        if (!shift) {
          rejected.push({ shiftId, staffId, reason: "Shift not found in this team." });
          continue;
        }
        if (!person) {
          rejected.push({ shiftId, staffId, reason: "Staff member not found in this team." });
          continue;
        }
        if (shift.locked) {
          rejected.push({ shiftId, staffId, reason: "Shift is locked by the manager." });
          continue;
        }
        if (shift.staffId === staffId) {
          applied.push({ shiftId, staffId, staffName: person.name, warnings: [] });
          continue;
        }
        const violations = checkAssignment({
          shift: { ...shift, staffId },
          staff: person,
          shifts: ctx.shifts,
          availability: ctx.availability,
          timeZone: team.timezone,
        });
        if (hasBlocking(violations)) {
          rejected.push({
            shiftId,
            staffId,
            reason: violations.filter((v) => v.severity !== "warn").map((v) => v.message).join(" "),
            violations,
          });
          continue;
        }
        // Later checks in this call see this assignment.
        shift.staffId = staffId;
        await tx.update(shifts).set({ staffId, updatedAt: now }).where(eq(shifts.id, shiftId));
        applied.push({ shiftId, staffId, staffName: person.name, warnings: violations });
      }

      return { teamId: team.id, applied, rejected };
    }),
});
