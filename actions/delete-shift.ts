import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { requireTeam, teamIdForShift, teamChange } from "../server/lib/roster.js";

export default defineAction({
  description: "Remove a shift from the roster. Fails with shift_locked (409) if the manager pinned it.",
  schema: z.object({
    shiftId: z.string().describe("Shift id from get-roster"),
  }),
  changeResource: teamChange,
  run: async ({ shiftId }) => {
    const teamId = await teamIdForShift(getDb(), shiftId);
    await assertAccess("team", teamId, "editor");
    return getDb().transaction(async (tx) => {
      const team = await requireTeam(tx, teamId, { forUpdate: true, write: true });
      const { shifts } = schema;
      const [shift] = await tx
        .select({ id: shifts.id, locked: shifts.locked, status: shifts.status })
        .from(shifts)
        .where(and(eq(shifts.id, shiftId), eq(shifts.teamId, team.id)))
        .limit(1);
      if (!shift || shift.status !== "scheduled") fail("Shift not found.", { errorCode: "not_found", statusCode: 404 });
      if (shift.locked) {
        fail("This shift is locked by the manager. Unlock it first.", { errorCode: "shift_locked", statusCode: 409 });
      }
      await tx
        .update(shifts)
        .set({ status: "cancelled", updatedAt: new Date().toISOString() })
        .where(eq(shifts.id, shiftId));
      return { id: shiftId, teamId: team.id, status: "cancelled" as const };
    });
  },
});
