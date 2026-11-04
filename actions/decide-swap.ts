import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { actorFromCtx } from "../server/lib/activity.js";
import { deliver } from "../server/lib/cover.js";
import { requireUser, teamChange } from "../server/lib/roster.js";
import { decideSwap, teamIdForSwap } from "../server/lib/swaps.js";

export default defineAction({
  description:
    "Approve or turn down a shift swap (from list-swaps or get-roster). Approving re-checks the rules for both people and changes both shifts at once; it fails with rule_violation (409) if a rule now breaks, or waiting_for_teammate if the teammate hasn't agreed. Both staff are told on Telegram. Only approve when the manager says so; override=true only when they explicitly override a rule.",
  schema: z.object({
    swapId: z.string().describe("Swap id"),
    approve: z.boolean().describe("true to approve, false to turn it down"),
    override: z.boolean().default(false).describe("Allow overridable rules (skill, availability, max hours). Only when the user asks."),
  }),
  changeResource: teamChange,
  run: async ({ swapId, approve, override }, ctx) => {
    const decidedBy = requireUser(ctx);
    const teamId = await teamIdForSwap(swapId);
    await assertAccess("team", teamId, "editor");
    const { messages, ...result } = await decideSwap({ swapId, approve, override, actor: actorFromCtx(ctx), decidedBy });
    const delivery = await deliver(messages);
    return { ...result, toldOnTelegram: delivery.sent };
  },
});
