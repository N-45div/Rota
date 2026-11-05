import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { recentActivity } from "../server/lib/activity.js";
import { requireTeam } from "../server/lib/roster.js";
import { localParts, mondayOf } from "../server/lib/time.js";

export default defineAction({
  description:
    "What happened on a team, newest first, in plain words: call-outs, cover offers and answers, drafts, assignments, weeks sent, reminders, availability changes, and Telegram connections. actorKind says whether the manager, Rota (the agent), or a staff member did it. Use for 'what happened today?'.",
  access: {
    scope: "resource",
    resource: { type: "team", idFrom: "teamId", level: "viewer" },
  },
  schema: z.object({
    teamId: z.string().describe("Team id from list-teams"),
    limit: z.coerce.number().int().min(1).max(200).default(60).describe("How many entries"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ teamId, limit }) => {
    const team = await requireTeam(getDb(), teamId);
    const entries = (await recentActivity(team.id, limit)).map(({ shiftStartsAt, ...entry }) => ({
      ...entry,
      // The roster week the entry's shift is in, so the feed can link to it.
      week: shiftStartsAt ? mondayOf(localParts(shiftStartsAt, team.timezone).date) : null,
    }));
    return { teamId: team.id, team: team.name, timezone: team.timezone, entries };
  },
});
