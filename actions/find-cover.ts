import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { loadRosterContext, presentShift, requireTeam, teamIdForShift } from "../server/lib/roster.js";
import { rankCandidates } from "../server/lib/rules.js";

export default defineAction({
  description:
    "Rank who could work a shift, best first: people who pass every rule, then fewest hours this week. Ineligible people are listed last with the reasons. Use for 'who can cover this?' and when someone calls out.",
  schema: z.object({
    shiftId: z.string().describe("Shift id from get-roster"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ shiftId }) => {
    const db = getDb();
    const teamId = await teamIdForShift(db, shiftId);
    await assertAccess("team", teamId, "viewer");
    const team = await requireTeam(db, teamId);
    const { shifts } = schema;
    const [row] = await db
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
      .where(and(eq(shifts.id, shiftId), eq(shifts.teamId, team.id)))
      .limit(1);
    if (!row || row.status !== "scheduled") fail("Shift not found.", { errorCode: "not_found", statusCode: 404 });

    const ctx = await loadRosterContext(db, team, row.startsAt, row.endsAt);
    const ranked = rankCandidates({
      shift: row,
      staff: ctx.staff,
      shifts: ctx.shifts,
      availability: ctx.availability,
      timeZone: team.timezone,
    });
    const telegram = new Map(ctx.staff.map((p) => [p.id, p.hasTelegram]));
    const current = ctx.staff.find((p) => p.id === row.staffId);

    return {
      teamId: team.id,
      shift: { ...presentShift(row, team.timezone), staffName: current?.name ?? null },
      candidates: ranked.map((c) => ({ ...c, hasTelegram: telegram.get(c.staffId) ?? false })),
    };
  },
});
