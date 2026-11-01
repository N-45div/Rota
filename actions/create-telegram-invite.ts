import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { teamChange, teamIdForStaff } from "../server/lib/roster.js";
import { inviteLink, newInviteCode } from "../server/lib/telegram.js";

export default defineAction({
  description:
    "Create a one-time Telegram invite for a staff member. They open the link (or send /start CODE to the bot) to connect, then they can check shifts and report when they can't work. A new invite replaces any unused one.",
  schema: z.object({
    staffId: z.string().describe("Staff id from get-roster"),
  }),
  mcpTool: false,
  changeResource: teamChange,
  run: async ({ staffId }) => {
    const db = getDb();
    const teamId = await teamIdForStaff(db, staffId);
    await assertAccess("team", teamId, "editor");
    const code = newInviteCode();
    const [row] = await db
      .update(schema.staff)
      .set({ telegramInviteCode: code })
      .where(eq(schema.staff.id, staffId))
      .returning({ name: schema.staff.name });
    if (!row) fail("Staff member not found.", { errorCode: "not_found", statusCode: 404 });
    return {
      teamId,
      staffId,
      name: row.name,
      code,
      link: inviteLink(code),
      instructions: `Send ${row.name} the link, or ask them to message the bot: /start ${code}`,
    };
  },
});
