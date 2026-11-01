import { defineAction, fail } from "@agent-native/core/action";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { requireTeam } from "../server/lib/roster.js";

export default defineAction({
  description: "Delete unavailability rules by id (ids come from get-roster staff[].availability).",
  access: {
    scope: "resource",
    resource: { type: "team", idFrom: "teamId", level: "editor" },
  },
  schema: z.object({
    teamId: z.string().describe("Team id from list-teams"),
    ids: z.array(z.string()).min(1).max(50).describe("Availability rule ids"),
  }),
  changeResource: (input) => ({ resourceType: "team", resourceId: input.teamId }),
  run: async (args) => {
    const db = getDb();
    const team = await requireTeam(db, args.teamId, { write: true });
    const removed = await db
      .delete(schema.availability)
      .where(and(eq(schema.availability.teamId, team.id), inArray(schema.availability.id, args.ids)))
      .returning({ id: schema.availability.id });
    if (removed.length === 0) fail("No matching rules found.", { errorCode: "not_found", statusCode: 404 });
    return { teamId: team.id, removed: removed.map((r) => r.id) };
  },
});
