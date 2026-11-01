import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  loadRosterContext,
  presentShift,
  requireTeam,
  requireUser,
  shiftWindow,
  type ShiftRecord,
} from "../server/lib/roster.js";
import { checkAssignment, hasBlocking, type Violation } from "../server/lib/rules.js";
import { DATE_RE, hoursBetween, TIME_RE, zonedToUtcIso } from "../server/lib/time.js";

export default defineAction({
  description:
    "Add shifts to a team's roster in local time. An end time at or before the start means the shift ends the next day. If staffId is given the rules are checked; a person who fails a rule is not assigned and the shift is created open, listed in `unassigned` with reasons.",
  access: {
    scope: "resource",
    resource: { type: "team", idFrom: "teamId", level: "editor" },
  },
  schema: z.object({
    teamId: z.string().describe("Team id from list-teams"),
    shifts: z
      .array(
        z.object({
          date: z.string().regex(DATE_RE).describe("Start date, YYYY-MM-DD in the team's time zone"),
          start: z.string().regex(TIME_RE).describe("Start time, HH:MM 24-hour, team time zone"),
          end: z.string().regex(TIME_RE).describe("End time, HH:MM 24-hour; at or before start means next day"),
          role: z.string().trim().min(1).max(40).describe('Skill needed, e.g. "barista", "opener", "closer", "kitchen"'),
          staffId: z.string().optional().describe("Optional staff id to assign straight away"),
          note: z.string().max(200).optional().describe("Optional note shown on the shift"),
        }),
      )
      .min(1)
      .max(200)
      .describe("Shifts to create"),
  }),
  changeResource: (input) => ({ resourceType: "team", resourceId: input.teamId }),
  run: async (args, actionCtx) => {
    const ownerEmail = requireUser(actionCtx);
    return getDb().transaction(async (tx) => {
      const team = await requireTeam(tx, args.teamId, { forUpdate: true, write: true });
      const tz = team.timezone;

      const drafts = args.shifts.map((input) => {
        const { startDate, endDate } = shiftWindow(input.date, input.start, input.end);
        const startsAt = zonedToUtcIso(startDate, input.start, tz);
        const endsAt = zonedToUtcIso(endDate, input.end, tz);
        const length = hoursBetween(startsAt, endsAt);
        if (length <= 0 || length > 16) {
          fail(`Shift on ${input.date} ${input.start}–${input.end} must be between 0 and 16 hours.`, {
            errorCode: "invalid_range",
          });
        }
        return { input, startsAt, endsAt };
      });

      const from = drafts.map((d) => d.startsAt).sort()[0]!;
      const to = drafts.map((d) => d.endsAt).sort().reverse()[0]!;
      const ctx = await loadRosterContext(tx, team, from, to);
      const staffById = new Map(ctx.staff.map((p) => [p.id, p]));

      const created: ReturnType<typeof presentShift>[] = [];
      const unassigned: { shiftId: string; staffId: string; reason: string; violations?: Violation[] }[] = [];

      for (const { input, startsAt, endsAt } of drafts) {
        const record: ShiftRecord = {
          id: crypto.randomUUID(),
          role: input.role.toLowerCase(),
          startsAt,
          endsAt,
          staffId: null,
          locked: false,
          note: input.note ?? null,
        };
        if (input.staffId) {
          const person = staffById.get(input.staffId);
          if (!person) {
            unassigned.push({ shiftId: record.id, staffId: input.staffId, reason: "Staff member not found in this team." });
          } else {
            const violations = checkAssignment({
              shift: { ...record, staffId: person.id },
              staff: person,
              shifts: ctx.shifts,
              availability: ctx.availability,
              timeZone: tz,
            });
            if (hasBlocking(violations)) {
              unassigned.push({
                shiftId: record.id,
                staffId: person.id,
                reason: violations.filter((v) => v.severity !== "warn").map((v) => v.message).join(" "),
                violations,
              });
            } else {
              record.staffId = person.id;
            }
          }
        }
        await tx.insert(schema.shifts).values({
          ...record,
          teamId: team.id,
          ownerEmail,
          orgId: team.orgId,
        });
        // Later shifts in this batch are checked against this one.
        ctx.shifts.push(record);
        created.push(presentShift(record, tz));
      }

      return { teamId: team.id, created, unassigned };
    });
  },
});
