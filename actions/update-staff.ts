import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { requireTeam, teamIdForStaff, teamChange } from "../server/lib/roster.js";
import { formatRoles, parseRoles } from "../server/lib/rules.js";

export default defineAction({
  description:
    "Update a staff member's name, skills, weekly hour limit, notes, or active status. Existing shifts are not re-checked; get-roster will flag any that no longer fit.",
  schema: z.object({
    staffId: z.string().describe("Staff id from get-roster"),
    name: z.string().trim().min(1).max(60).optional().describe("New display name"),
    roles: z.array(z.string()).optional().describe("Replacement list of skills"),
    maxHours: z.coerce.number().int().min(1).max(80).optional().describe("Most hours per week"),
    notes: z.string().max(300).nullable().optional().describe("Preferences, or null to clear"),
    active: z.boolean().optional().describe("False hides them from new assignments"),
  }),
  changeResource: teamChange,
  run: async (args) => {
    const teamId = await teamIdForStaff(getDb(), args.staffId);
    await assertAccess("team", teamId, "editor");
    const team = await requireTeam(getDb(), teamId, { write: true });
    const patch: Partial<typeof schema.staff.$inferInsert> = {};
    if (args.name !== undefined) patch.name = args.name;
    if (args.roles !== undefined) patch.roles = formatRoles(args.roles);
    if (args.maxHours !== undefined) patch.maxHours = args.maxHours;
    if (args.notes !== undefined) patch.notes = args.notes;
    if (args.active !== undefined) patch.active = args.active;
    const [row] = await getDb()
      .update(schema.staff)
      .set(patch)
      .where(eq(schema.staff.id, args.staffId))
      .returning({
        id: schema.staff.id,
        name: schema.staff.name,
        roles: schema.staff.roles,
        maxHours: schema.staff.maxHours,
        notes: schema.staff.notes,
        active: schema.staff.active,
      });
    if (!row) fail("Staff member not found.", { errorCode: "not_found", statusCode: 404 });
    return { ...row, roles: parseRoles(row.roles), teamId: team.id };
  },
});
