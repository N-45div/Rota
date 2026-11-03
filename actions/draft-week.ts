import { defineAction } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { draftWeek, hoursSummary } from "../server/lib/draft.js";
import { loadRosterContext, presentShift, requireTeam } from "../server/lib/roster.js";
import { addDays, DATE_RE, localParts, mondayOf, todayIn, weekBounds } from "../server/lib/time.js";

export default defineAction({
  description:
    "Fill a week's open shifts in one step. Uses the rule checker for every assignment, fills the hardest shifts first, spreads hours by each person's max, spreads weekends, and honors preferences you pass (read them from staff notes, e.g. 'prefers mornings' -> mornings). Locked shifts and shifts already assigned are left alone. Returns what was filled and why anything stayed open. Use this for 'draft the week' instead of assigning shifts one by one.",
  access: {
    scope: "resource",
    resource: { type: "team", idFrom: "teamId", level: "editor" },
  },
  schema: z.object({
    teamId: z.string().describe("Team id from list-teams"),
    weekStart: z.string().regex(DATE_RE).describe("Any date in the week, YYYY-MM-DD in the team's time zone"),
    preferences: z
      .array(
        z.object({
          staffId: z.string().describe("Staff id from get-roster"),
          prefer: z.enum(["mornings", "evenings", "weekdays", "weekends"]).describe("What this person prefers"),
        }),
      )
      .max(100)
      .default([])
      .describe("Preferences taken from staff notes"),
  }),
  link: ({ args }) => ({
    url: buildDeepLink({
      view: "roster",
      to: `/roster/${encodeURIComponent(args.teamId)}?week=${mondayOf(args.weekStart)}`,
      params: { teamId: args.teamId, week: mondayOf(args.weekStart) },
    }),
    label: "Open roster",
  }),
  changeResource: (input) => ({ resourceType: "team", resourceId: input.teamId }),
  run: async (args) =>
    getDb().transaction(async (tx) => {
      const team = await requireTeam(tx, args.teamId, { forUpdate: true, write: true });
      const tz = team.timezone;
      const weekStart = mondayOf(args.weekStart);
      const weekEnd = addDays(weekStart, 6);
      const { from, to } = weekBounds(weekStart, tz);
      const ctx = await loadRosterContext(tx, team, from, to);
      const now = new Date().toISOString();
      const open = ctx.shifts.filter((s) => {
        const date = localParts(s.startsAt, tz).date;
        return !s.staffId && !s.locked && s.startsAt > now && date >= weekStart && date <= weekEnd;
      });
      const knownStaff = new Set(ctx.staff.map((p) => p.id));
      const result = draftWeek({
        open,
        staff: ctx.staff,
        shifts: ctx.shifts,
        availability: ctx.availability,
        timeZone: tz,
        preferences: args.preferences.filter((p) => knownStaff.has(p.staffId)),
      });

      const stamp = new Date().toISOString();
      for (const a of result.assignments) {
        await tx.update(schema.shifts).set({ staffId: a.staffId, updatedAt: stamp }).where(eq(schema.shifts.id, a.shiftId));
      }

      const byId = new Map(ctx.shifts.map((s) => [s.id, s]));
      const nameOf = new Map(ctx.staff.map((p) => [p.id, p.name]));
      const after = ctx.shifts.map((s) => {
        const a = result.assignments.find((x) => x.shiftId === s.id);
        return a ? { ...s, staffId: a.staffId } : s;
      });
      const describe = (id: string) => {
        const p = presentShift(byId.get(id)!, tz);
        return `${p.date} ${p.start}–${p.end} ${p.role}`;
      };

      return {
        teamId: team.id,
        weekStart,
        openBefore: open.length,
        filled: result.assignments.length,
        stillOpen: result.unfilled.map((u) => ({ shiftId: u.shiftId, shift: describe(u.shiftId), reason: u.reason })),
        hours: hoursSummary(ctx.staff, after, weekStart, tz),
        sample: result.assignments.slice(0, 5).map((a) => `${describe(a.shiftId)} → ${nameOf.get(a.staffId)}`),
      };
    }),
});
