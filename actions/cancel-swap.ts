import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { deliver } from "../server/lib/cover.js";
import { cancelSwap } from "../server/lib/swaps.js";
import { requireStaffCaller } from "../server/lib/telegram.js";

// guard:allow-resource-action-access — authorized by the caller's own staff identity (requireStaffCaller); it only withdraws a request that person made.
export default defineAction({
  description: "Staff only (Telegram): withdraw the caller's open swap request.",
  schema: z.object({}),
  mcpTool: false,
  changeResource: (_input, result) => {
    const teamId = (result as { teamId?: string | null } | undefined)?.teamId;
    return teamId ? { resourceType: "team", resourceId: teamId } : null;
  },
  run: async (_args, ctx) => {
    const me = await requireStaffCaller(ctx);
    const { messages, ...result } = await cancelSwap(me.staffId);
    await deliver(messages);
    return { cancelled: result.cancelled, teamId: result.teamId, replyToStaff: result.reply };
  },
});
