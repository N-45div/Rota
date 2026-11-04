import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { requireTeam } from "../server/lib/roster.js";
import { listSwaps } from "../server/lib/swaps.js";

export default defineAction({
  description:
    "Shift swaps on a team. status 'agreed' means both staff agreed and it waits for the manager (decide-swap); 'asked' means the teammate hasn't replied yet. Pass include='all' for finished ones too.",
  access: {
    scope: "resource",
    resource: { type: "team", idFrom: "teamId", level: "viewer" },
  },
  schema: z.object({
    teamId: z.string().describe("Team id from list-teams"),
    include: z
      .enum(["open", "all"])
      .default("open")
      .describe("open: waiting on the teammate or manager; all: also approved, declined, rejected, cancelled, closed"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ teamId, include }) => {
    const recent = include === "all";
    const db = getDb();
    const team = await requireTeam(db, teamId);
    const swaps = await listSwaps(db, team, {
      ...(recent ? { statuses: ["asked", "agreed", "approved", "declined", "rejected", "cancelled", "closed"] } : {}),
      limit: recent ? 30 : 50,
    });
    return {
      teamId: team.id,
      swaps: swaps.map((s) => ({
        id: s.id,
        status: s.status,
        requester: s.requester.name,
        requesterShift: s.requesterShift.label,
        peer: s.peer.name,
        peerShift: s.peerShift.label,
        note: s.note,
        reason: s.reason,
        createdAt: s.createdAt,
      })),
    };
  },
});
