import { defineAction } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { offersForShifts } from "../server/lib/cover.js";
import { loadRosterContext, presentShift, requireTeam } from "../server/lib/roster.js";
import { checkAssignment, describeRule, round, weeklyHours, type Violation } from "../server/lib/rules.js";
import { addDays, DATE_RE, localParts, mondayOf, todayIn, weekBounds } from "../server/lib/time.js";

export default defineAction({
  description:
    "Read one team's weekly roster: staff (skills, max hours, hours this week, availability rules, notes), every shift in local time with any rule issues and Telegram cover offers, and open-shift counts. Start here before drafting or changing a week.",
  access: {
    scope: "resource",
    resource: { type: "team", idFrom: "teamId", level: "viewer" },
  },
  schema: z.object({
    teamId: z.string().describe("Team id from list-teams"),
    weekStart: z
      .string()
      .regex(DATE_RE)
      .optional()
      .describe("Any date in the week, YYYY-MM-DD in the team's time zone; defaults to this week. Weeks run Monday to Sunday."),
  }),
  http: { method: "GET" },
  readOnly: true,
  link: ({ args, result }) => ({
    url: buildDeepLink({
      view: "roster",
      to: `/roster/${encodeURIComponent(args.teamId)}?week=${result.weekStart}`,
      params: { teamId: args.teamId, week: result.weekStart },
    }),
    label: "Open roster",
  }),
  run: async (args) => {
    const db = getDb();
    const team = await requireTeam(db, args.teamId);
    const tz = team.timezone;
    const weekStart = mondayOf(args.weekStart ?? todayIn(tz));
    const weekEnd = addDays(weekStart, 6);
    const { from, to } = weekBounds(weekStart, tz);
    const ctx = await loadRosterContext(db, team, from, to);
    const staffById = new Map(ctx.staff.map((person) => [person.id, person]));

    const weekShifts = ctx.shifts.filter((shift) => {
      const date = localParts(shift.startsAt, tz).date;
      return date >= weekStart && date <= weekEnd;
    });

    const offers = await offersForShifts(db, weekShifts.map((shift) => shift.id));
    const shifts = weekShifts.map((shift) => {
      const person = shift.staffId ? staffById.get(shift.staffId) : undefined;
      const issues: Violation[] = person
        ? checkAssignment({ shift, staff: person, shifts: ctx.shifts, availability: ctx.availability, timeZone: tz })
        : [];
      return { ...presentShift(shift, tz), staffName: person?.name ?? null, issues, offers: offers.get(shift.id) ?? [] };
    });

    const staff = ctx.staff.map((person) => ({
      id: person.id,
      name: person.name,
      roles: person.roles,
      maxHours: person.maxHours,
      weekHours: round(weeklyHours(person.id, ctx.shifts, weekStart, tz)),
      notes: person.notes,
      color: person.color,
      active: person.active,
      hasTelegram: person.hasTelegram,
      availability: ctx.availability
        .filter((rule) => rule.staffId === person.id)
        .filter((rule) => !rule.validUntil || rule.validUntil >= weekStart)
        .filter((rule) => !rule.date || (rule.date >= weekStart && rule.date <= weekEnd))
        .map((rule) => ({ id: rule.id, text: describeRule(rule) })),
    }));

    return {
      team: { id: team.id, name: team.name, timezone: tz },
      weekStart,
      days: Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
      today: todayIn(tz),
      staff,
      shifts,
      summary: {
        shifts: shifts.length,
        open: shifts.filter((shift) => !shift.staffId).length,
        withIssues: shifts.filter((shift) => shift.issues.some((issue) => issue.severity !== "warn")).length,
        warnings: shifts.filter((shift) => shift.issues.some((issue) => issue.severity === "warn")).length,
      },
    };
  },
});
