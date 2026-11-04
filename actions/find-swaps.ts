import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { findSwapOptions } from "../server/lib/swaps.js";
import { requireStaffCaller } from "../server/lib/telegram.js";

// guard:allow-resource-action-access — authorized by the caller's own staff identity (requireStaffCaller); it only starts from the caller's own shift.
export default defineAction({
  description:
    "Staff only (Telegram): teammates' shifts the caller could swap one of their shifts for, within two weeks, best first (same role, closest date). Every option already passes the rules for both people. Use my-shifts first for the shift id.",
  schema: z.object({
    shiftId: z.string().describe("The caller's shift id from my-shifts"),
  }),
  readOnly: true,
  mcpTool: false,
  run: async ({ shiftId }, ctx) => {
    const me = await requireStaffCaller(ctx);
    return findSwapOptions(me, shiftId);
  },
});
