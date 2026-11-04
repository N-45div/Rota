import { defineAction } from "@agent-native/core/action";
import { and, eq, gt, lt } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { presentShift } from "../server/lib/roster.js";
import { listSwaps } from "../server/lib/swaps.js";
import { requireStaffCaller } from "../server/lib/telegram.js";
import { addDays, todayIn, zonedToUtcIso } from "../server/lib/time.js";

export default defineAction({
  description:
    "Staff only (Telegram): the caller's upcoming shifts, their open swap requests, and today's date in the team's time zone. Call this first to know today's date and which shifts they mean.",
  schema: z.object({
    days: z.coerce.number().int().min(1).max(31).default(14).describe("How many days ahead to include"),
  }),
  readOnly: true,
  mcpTool: false,
  run: async ({ days }, ctx) => {
    const me = await requireStaffCaller(ctx);
    const today = todayIn(me.timezone);
    const from = zonedToUtcIso(today, "00:00", me.timezone);
    const to = zonedToUtcIso(addDays(today, days), "00:00", me.timezone);
    const { shifts } = schema;
    const rows = await getDb()
      .select({
        id: shifts.id,
        role: shifts.role,
        startsAt: shifts.startsAt,
        endsAt: shifts.endsAt,
        staffId: shifts.staffId,
        locked: shifts.locked,
        note: shifts.note,
      })
      .from(shifts)
      .where(
        and(
          eq(shifts.staffId, me.staffId),
          eq(shifts.status, "scheduled"),
          gt(shifts.endsAt, from),
          lt(shifts.startsAt, to),
        ),
      )
      .orderBy(shifts.startsAt)
      .limit(60);
    const swaps = await listSwaps(getDb(), { id: me.teamId, timezone: me.timezone }, { staffId: me.staffId });
    return {
      name: me.staffName,
      team: me.teamName,
      timezone: me.timezone,
      today,
      openSwaps: swaps.map((s) => ({
        status: s.status === "asked" ? "waiting for the teammate" : "waiting for the manager",
        iAsked: s.requester.id === me.staffId,
        with: s.requester.id === me.staffId ? s.peer.name : s.requester.name,
        give: s.requester.id === me.staffId ? s.requesterShift.label : s.peerShift.label,
        take: s.requester.id === me.staffId ? s.peerShift.label : s.requesterShift.label,
      })),
      shifts: rows.map((row) => {
        const { staffId: _s, locked: _l, ...shift } = presentShift(row, me.timezone);
        return shift;
      }),
    };
  },
});
