import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { deliver, respondToOffer } from "../server/lib/cover.js";
import { requireStaffCaller } from "../server/lib/telegram.js";

// guard:allow-resource-action-access — authorized by the caller's own staff identity (requireStaffCaller); it only answers that person's own offers.
export default defineAction({
  description:
    "Staff only (Telegram): answer the caller's open shift offer. YES takes the shift if it's still open and the rules allow; NO passes it on to the next people. Use when they clearly accept or decline.",
  schema: z.object({
    answer: z.enum(["yes", "no"]).describe("yes to take the shift, no to pass"),
  }),
  mcpTool: false,
  changeResource: (_input, result) => {
    const teamId = (result as { teamId?: string | null } | undefined)?.teamId;
    return teamId ? { resourceType: "team", resourceId: teamId } : null;
  },
  run: async ({ answer }, ctx) => {
    const me = await requireStaffCaller(ctx);
    const response = await respondToOffer(me.staffId, answer);
    await deliver(response.messages);
    return {
      outcome: response.outcome,
      teamId: response.teamId,
      shift: response.shift,
      nextAsked: response.nextRound?.offeredTo ?? [],
      replyToStaff: response.reply,
    };
  },
});
