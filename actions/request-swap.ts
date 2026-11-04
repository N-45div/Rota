import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { deliver } from "../server/lib/cover.js";
import { requestSwap } from "../server/lib/swaps.js";
import { requireStaffCaller } from "../server/lib/telegram.js";

// guard:allow-resource-action-access — authorized by the caller's own staff identity (requireStaffCaller); it only trades the caller's own shift, and the teammate and manager must both agree.
export default defineAction({
  description:
    "Staff only (Telegram): ask a teammate to swap shifts. The teammate gets a YES/NO message; if they agree, the manager approves and both shifts change. Only use an option from find-swaps that the caller picked.",
  schema: z.object({
    myShiftId: z.string().describe("The caller's shift id"),
    theirShiftId: z.string().describe("The teammate's shift id from find-swaps"),
    note: z.string().trim().max(160).optional().describe("Why, in their words, passed on to the teammate"),
  }),
  mcpTool: false,
  changeResource: (_input, result) => {
    const teamId = (result as { teamId?: string } | undefined)?.teamId;
    return teamId ? { resourceType: "team", resourceId: teamId } : null;
  },
  run: async ({ myShiftId, theirShiftId, note }, ctx) => {
    const me = await requireStaffCaller(ctx);
    const { messages, ...result } = await requestSwap(me, myShiftId, theirShiftId, note);
    const delivery = await deliver(messages);
    return {
      ...result,
      delivered: delivery.sent > 0,
      summary: delivery.sent
        ? `Asked ${result.peer}. If they agree, your manager confirms it.`
        : `Saved the request, but the message to ${result.peer} didn't go out. Your manager can see it.`,
    };
  },
});
