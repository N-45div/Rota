import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { loadRosterContext, presentShift, requireTeam, requireUser, teamIdForStaff, teamChange } from "../server/lib/roster.js";
import { checkAssignment, describeRule } from "../server/lib/rules.js";
import { actorFromCtx, logActivity } from "../server/lib/activity.js";
import { DATE_RE, parseHhMm, TIME_RE, todayIn, zonedToUtcIso, addDays } from "../server/lib/time.js";

export default defineAction({
  description:
    "Record when a staff member can't work: a weekly rule (dayOfWeek) or one date, optionally only between two times. Use this when someone says things like 'no weekends this month' or 'can't do Tuesday mornings'. Returns their already-assigned upcoming shifts that now clash, so you can find cover.",
  schema: z.object({
    staffId: z.string().describe("Staff id from get-roster"),
    rules: z
      .array(
        z.object({
          dayOfWeek: z.coerce.number().int().min(1).max(7).optional().describe("Weekly rule: 1 = Monday ... 7 = Sunday"),
          date: z.string().regex(DATE_RE).optional().describe("One-off date, YYYY-MM-DD, team time zone"),
          startTime: z.string().regex(TIME_RE).optional().describe("Window start HH:MM; omit both times for the whole day"),
          endTime: z.string().regex(TIME_RE).optional().describe("Window end HH:MM, after startTime"),
          validFrom: z.string().regex(DATE_RE).optional().describe("Weekly rule starts on this date"),
          validUntil: z.string().regex(DATE_RE).optional().describe("Weekly rule ends on this date"),
          note: z.string().max(200).optional().describe("What they said, in their words"),
        }),
      )
      .min(1)
      .max(50)
      .describe("Unavailability rules to add"),
  }),
  changeResource: teamChange,
  run: async (args, ctx) => {
    const ownerEmail = requireUser(ctx);
    for (const rule of args.rules) {
      if ((rule.dayOfWeek === undefined) === (rule.date === undefined)) {
        fail("Each rule needs exactly one of dayOfWeek or date.", { errorCode: "invalid_rule" });
      }
      if ((rule.startTime === undefined) !== (rule.endTime === undefined)) {
        fail("Give both startTime and endTime, or neither for the whole day.", { errorCode: "invalid_rule" });
      }
      if (rule.startTime && rule.endTime && parseHhMm(rule.endTime) <= parseHhMm(rule.startTime)) {
        fail("endTime must be after startTime.", { errorCode: "invalid_rule" });
      }
    }
    const db = getDb();
    const teamId = await teamIdForStaff(db, args.staffId);
    await assertAccess("team", teamId, "editor");
    const team = await requireTeam(db, teamId, { write: true });

    const rows = args.rules.map((rule) => ({
      id: crypto.randomUUID(),
      teamId: team.id,
      staffId: args.staffId,
      dayOfWeek: rule.dayOfWeek ?? null,
      date: rule.date ?? null,
      startTime: rule.startTime ?? null,
      endTime: rule.endTime ?? null,
      validFrom: rule.validFrom ?? null,
      validUntil: rule.validUntil ?? null,
      note: rule.note ?? null,
      ownerEmail,
      orgId: team.orgId,
    }));
    await db.insert(schema.availability).values(rows);
    const [who] = await db.select({ name: schema.staff.name }).from(schema.staff).where(eq(schema.staff.id, args.staffId)).limit(1);
    await logActivity(db, {
      teamId: team.id,
      actor: actorFromCtx(ctx),
      kind: "availability",
      text: `Noted ${who?.name ?? "someone"} can't work ${rows.map((row) => describeRule(row)).join("; ")}`,
    });

    // Upcoming shifts (next 4 weeks) this person is on that now clash.
    const today = todayIn(team.timezone);
    const from = zonedToUtcIso(today, "00:00", team.timezone);
    const to = zonedToUtcIso(addDays(today, 28), "00:00", team.timezone);
    const roster = await loadRosterContext(db, team, from, to);
    const person = roster.staff.find((p) => p.id === args.staffId);
    const conflicts = person
      ? roster.shifts
          .filter((s) => s.staffId === person.id && s.startsAt >= from && s.startsAt < to)
          .filter((s) =>
            checkAssignment({ shift: s, staff: person, shifts: roster.shifts, availability: rows, timeZone: team.timezone }).some(
              (v) => v.code === "unavailable",
            ),
          )
          .map((s) => presentShift(s, team.timezone))
      : [];

    return {
      teamId: team.id,
      added: rows.map((row) => ({ id: row.id, text: describeRule(row) })),
      conflicts,
    };
  },
});
