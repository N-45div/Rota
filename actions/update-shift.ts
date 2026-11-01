import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  loadRosterContext,
  presentShift,
  requireTeam,
  shiftWindow,
  teamIdForShift, teamChange } from "../server/lib/roster.js";
import { checkAssignment, hasBlocking } from "../server/lib/rules.js";
import { DATE_RE, hoursBetween, localParts, TIME_RE, zonedToUtcIso } from "../server/lib/time.js";

export default defineAction({
  description:
    "Change a shift's time, role, note, or lock. `locked: true` pins the shift so neither the agent nor batch drafting changes it; only unlock when the user asks. Changing time or role re-checks the assigned person and fails with rule_violation (409) if they no longer fit.",
  schema: z.object({
    shiftId: z.string().describe("Shift id from get-roster"),
    date: z.string().regex(DATE_RE).optional().describe("New start date, YYYY-MM-DD, team time zone"),
    start: z.string().regex(TIME_RE).optional().describe("New start time, HH:MM"),
    end: z.string().regex(TIME_RE).optional().describe("New end time, HH:MM; at or before start means next day"),
    role: z.string().trim().min(1).max(40).optional().describe("New required skill"),
    note: z.string().max(200).nullable().optional().describe("New note, or null to clear"),
    locked: z.boolean().optional().describe("Pin (true) or unpin (false) the shift"),
    override: z.boolean().default(false).describe("Allow overridable rules when the user asks"),
  }),
  changeResource: teamChange,
  run: async (args) => {
    const teamId = await teamIdForShift(getDb(), args.shiftId);
    await assertAccess("team", teamId, "editor");
    return getDb().transaction(async (tx) => {
      const team = await requireTeam(tx, teamId, { forUpdate: true, write: true });
      const tz = team.timezone;
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
      if (!shift || shift.status !== "scheduled") fail("Shift not found.", { errorCode: "not_found", statusCode: 404 });

      const changesShape = args.date !== undefined || args.start !== undefined || args.end !== undefined || args.role !== undefined;
      // A locked shift can still be unlocked or have its note edited.
      if (shift.locked && args.locked !== false && changesShape) {
        fail("This shift is locked by the manager. Unlock it first.", { errorCode: "shift_locked", statusCode: 409 });
      }

      const startLocal = localParts(shift.startsAt, tz);
      const endLocal = localParts(shift.endsAt, tz);
      const date = args.date ?? startLocal.date;
      const start = args.start ?? startLocal.time;
      const end = args.end ?? endLocal.time;
      const { startDate, endDate } = shiftWindow(date, start, end);
      const next = {
        ...shift,
        role: args.role?.toLowerCase() ?? shift.role,
        startsAt: zonedToUtcIso(startDate, start, tz),
        endsAt: zonedToUtcIso(endDate, end, tz),
        note: args.note === undefined ? shift.note : args.note,
        locked: args.locked ?? shift.locked,
      };
      const length = hoursBetween(next.startsAt, next.endsAt);
      if (length <= 0 || length > 16) fail("A shift must be between 0 and 16 hours.", { errorCode: "invalid_range" });

      let warnings: ReturnType<typeof checkAssignment> = [];
      if (changesShape && next.staffId) {
        const ctx = await loadRosterContext(tx, team, next.startsAt, next.endsAt);
        const person = ctx.staff.find((p) => p.id === next.staffId);
        if (person) {
          const others = ctx.shifts.filter((s) => s.id !== next.id);
          const violations = checkAssignment({
            shift: next,
            staff: person,
            shifts: [...others, next],
            availability: ctx.availability,
            timeZone: tz,
          });
          if (hasBlocking(violations, args.override)) {
            fail(violations.filter((v) => v.severity !== "warn").map((v) => v.message).join(" "), {
              errorCode: "rule_violation",
              statusCode: 409,
              details: { violations },
            });
          }
          warnings = violations;
        }
      }

      await tx
        .update(shifts)
        .set({
          role: next.role,
          startsAt: next.startsAt,
          endsAt: next.endsAt,
          note: next.note,
          locked: next.locked,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(shifts.id, shift.id));

      return { ...presentShift(next, tz), teamId: team.id, warnings };
    });
  },
});
