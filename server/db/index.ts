import { createGetDb } from "@agent-native/core/db";
import { registerShareableResource } from "@agent-native/core/sharing";

import * as schema from "./schema.js";

export const getDb = createGetDb(schema);
export { schema };

registerShareableResource({
  type: "team",
  resourceTable: schema.teams,
  sharesTable: schema.teamShares,
  displayName: "Team",
  titleColumn: "name",
  getResourcePath: (team) => `/roster/${team.id}`,
  getDb,
});
