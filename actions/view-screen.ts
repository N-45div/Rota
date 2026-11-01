import { defineAction } from "@agent-native/core/action";
import { readAppState, readAppStateForCurrentTab } from "@agent-native/core/application-state";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { presentShift, requireTeam } from "../server/lib/roster.js";

export default defineAction({
  description:
    "Read what the user is looking at: the current view, and on the roster the team, week, and the shift they selected. Basic navigation is already in <current-screen>; call this for the selected shift's details.",
  schema: z.object({}),
  http: false,
  readOnly: true,
  run: async () => {
    const navigation = (await readAppState("navigation")) as
      | { view?: string; teamId?: string; week?: string }
      | null;
    const selection = (await readAppStateForCurrentTab("selection")) as
      | { kind?: string; id?: string; label?: string }
      | null;

    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;

    if (navigation?.view === "roster" && navigation.teamId) {
      try {
        const team = await requireTeam(getDb(), navigation.teamId);
        screen.team = { id: team.id, name: team.name, timezone: team.timezone };
        if (selection?.kind === "shift" && selection.id) {
          const { shifts, staff } = schema;
          const [row] = await getDb()
            .select({
              id: shifts.id,
              role: shifts.role,
              startsAt: shifts.startsAt,
              endsAt: shifts.endsAt,
              staffId: shifts.staffId,
              locked: shifts.locked,
              note: shifts.note,
              staffName: staff.name,
            })
            .from(shifts)
            .leftJoin(staff, eq(staff.id, shifts.staffId))
            .where(and(eq(shifts.id, selection.id), eq(shifts.teamId, team.id)))
            .limit(1);
          if (row) {
            screen.selectedShift = { ...presentShift(row, team.timezone), staffName: row.staffName };
            screen.hint = "The user means this shift when they say 'this shift'. Use find-cover for candidates.";
          }
        }
      } catch {
        screen.team = null;
      }
    } else if (selection) {
      screen.selection = selection;
    }

    if (Object.keys(screen).length === 0) {
      return "No application state found. Is the app running?";
    }
    return screen;
  },
});
