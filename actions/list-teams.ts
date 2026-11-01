import { defineAction } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { accessFilter } from "@agent-native/core/sharing";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description: "List the teams (workplaces) the current user can see, with their time zones.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  link: () => ({
    url: buildDeepLink({ view: "roster", to: "/roster" }),
    label: "Open Rota",
  }),
  run: async () => {
    const { teams, teamShares } = schema;
    const rows = await getDb()
      .select({ id: teams.id, name: teams.name, timezone: teams.timezone })
      .from(teams)
      .where(accessFilter(teams, teamShares))
      .orderBy(teams.name)
      .limit(100);
    return { teams: rows };
  },
});
