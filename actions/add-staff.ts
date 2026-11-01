import { defineAction } from "@agent-native/core/action";
import { count, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { requireTeam, requireUser, STAFF_COLORS } from "../server/lib/roster.js";
import { formatRoles, parseRoles } from "../server/lib/rules.js";

export default defineAction({
  description: "Add one or more staff members to a team, with their skills and weekly hour limit.",
  access: {
    scope: "resource",
    resource: { type: "team", idFrom: "teamId", level: "editor" },
  },
  schema: z.object({
    teamId: z.string().describe("Team id from list-teams"),
    staff: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(60).describe("Display name"),
          roles: z.array(z.string()).default([]).describe('Skills, e.g. ["barista", "opener"]'),
          maxHours: z.coerce.number().int().min(1).max(80).default(40).describe("Most hours per week"),
          notes: z.string().max(300).optional().describe('Preferences the agent should respect, e.g. "prefers mornings"'),
        }),
      )
      .min(1)
      .max(50)
      .describe("People to add"),
  }),
  changeResource: (input) => ({ resourceType: "team", resourceId: input.teamId }),
  run: async (args, ctx) => {
    const ownerEmail = requireUser(ctx);
    return getDb().transaction(async (tx) => {
      const team = await requireTeam(tx, args.teamId, { forUpdate: true, write: true });
      const [counted] = await tx
        .select({ value: count() })
        .from(schema.staff)
        .where(eq(schema.staff.teamId, team.id));
      const existing = Number(counted?.value ?? 0);
      const rows = args.staff.map((person, index) => ({
        id: crypto.randomUUID(),
        teamId: team.id,
        name: person.name,
        roles: formatRoles(person.roles),
        maxHours: person.maxHours,
        notes: person.notes ?? null,
        color: STAFF_COLORS[(existing + index) % STAFF_COLORS.length] ?? null,
        ownerEmail,
        orgId: team.orgId,
      }));
      await tx.insert(schema.staff).values(rows);
      return {
        teamId: team.id,
        staff: rows.map((row) => ({ id: row.id, name: row.name, roles: parseRoles(row.roles), maxHours: row.maxHours })),
      };
    });
  },
});
