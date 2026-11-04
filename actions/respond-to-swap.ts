import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { deliver } from "../server/lib/cover.js";
import { respondToSwap } from "../server/lib/swaps.js";
import { requireStaffCaller } from "../server/lib/telegram.js";

// guard:allow-resource-action-access — authorized by the caller's own staff identity (requireStaffCaller); it only answers a swap request sent to that person.
export default defineAction({
  description:
    "Staff only (Telegram): answer the swap request a teammate sent the caller. YES passes it to the manager for approval (if the rules still allow); NO declines it.",
  schema: z.object({
    answer: z.enum(["yes", "no"]).describe("yes to agree, no to pass"),
  }),
  mcpTool: false,
  changeResource: (_input, result) => {
    const teamId = (result as { teamId?: string | null } | undefined)?.teamId;
    return teamId ? { resourceType: "team", resourceId: teamId } : null;
  },
  run: async ({ answer }, ctx) => {
    const me = await requireStaffCaller(ctx);
    const { messages, ...result } = await respondToSwap(me.staffId, answer);
    await deliver(messages);
    return { outcome: result.outcome, teamId: result.teamId, replyToStaff: result.reply };
  },
});
