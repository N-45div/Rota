import { defineAction, fail } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { requireUser } from "../server/lib/roster.js";
import { isValidTimeZone } from "../server/lib/time.js";

export default defineAction({
  description:
    "Create a team (one workplace, e.g. a café). Visible to the organization when one is active, otherwise only to its creator.",
  schema: z.object({
    name: z.string().trim().min(1).max(80).describe('Workplace name, e.g. "Bean & Leaf Café"'),
    timezone: z
      .string()
      .default("UTC")
      .describe('IANA time zone where the team works, e.g. "America/Los_Angeles"'),
  }),
  link: ({ result }) => ({
    url: buildDeepLink({ view: "roster", to: `/roster/${encodeURIComponent(result.id)}` }),
    label: `Open ${result.name}`,
  }),
  run: async (args, ctx) => {
    const ownerEmail = requireUser(ctx);
    if (!isValidTimeZone(args.timezone)) {
      fail(`Unknown time zone "${args.timezone}".`, { errorCode: "invalid_timezone" });
    }
    const orgId = ctx?.orgId ?? null;
    const team = {
      id: crypto.randomUUID(),
      name: args.name,
      timezone: args.timezone,
      ownerEmail,
      orgId,
      visibility: orgId ? ("org" as const) : ("private" as const),
    };
    await getDb().insert(schema.teams).values(team);
    return { id: team.id, name: team.name, timezone: team.timezone };
  },
});
