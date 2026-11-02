import { defineAction, fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { createOffers, DEFAULT_OFFER_COUNT, deliver } from "../server/lib/cover.js";
import { requireTeam, teamChange, teamIdForShift } from "../server/lib/roster.js";

export default defineAction({
  description:
    "Ask the best eligible people on Telegram to cover an open shift (fewest hours first, people already asked are skipped). The first to reply YES gets it if the rules still allow. Use after someone calls out, or when the manager asks to find cover.",
  schema: z.object({
    shiftId: z.string().describe("Open shift id from get-roster"),
    count: z.coerce
      .number()
      .int()
      .min(1)
      .max(10)
      .default(DEFAULT_OFFER_COUNT)
      .describe("How many people to ask at once"),
  }),
  changeResource: teamChange,
  run: async ({ shiftId, count }) => {
    const teamId = await teamIdForShift(getDb(), shiftId);
    await assertAccess("team", teamId, "editor");
    const round = await getDb().transaction(async (tx) => {
      await requireTeam(tx, teamId, { forUpdate: true, write: true });
      return createOffers(tx, teamId, shiftId, count);
    });
    if (!round) {
      fail("That shift isn't open (it's assigned, locked, removed, or already started).", {
        errorCode: "not_open",
        statusCode: 409,
      });
    }
    const delivery = await deliver(round.messages);
    return {
      teamId,
      shift: round.shift,
      askedOnTelegram: round.offeredTo,
      notOnTelegram: round.notOnTelegram,
      delivered: delivery.sent,
      failed: delivery.failed,
      summary: round.offeredTo.length
        ? `Asked ${round.offeredTo.join(", ")} on Telegram.`
        : round.notOnTelegram.length
          ? `Nobody eligible is on Telegram yet. Eligible: ${round.notOnTelegram.join(", ")}.`
          : "Nobody else is eligible for this shift.",
    };
  },
});
