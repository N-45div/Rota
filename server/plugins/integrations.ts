// Messaging integrations (Telegram for staff). Replaces the framework's
// default integrations plugin so each staff member's messages run as their
// own limited identity instead of a shared service account.
import {
  createIntegrationsPlugin,
  loadActionsFromStaticRegistry,
  type IncomingMessage,
} from "@agent-native/core/server";

import actionsRegistry from "../../.generated/actions-registry.js";
import { notifyTeamChanged } from "../lib/activity.js";
import { deliver, respondToOffer } from "../lib/cover.js";
import { findStaffByChat, linkTelegram } from "../lib/telegram.js";
import { rotaTelegramAdapter } from "../lib/telegram-adapter.js";

const STAFF_TOOLS = ["my-shifts", "report-unavailable", "respond-to-offer"] as const;

// Clear one-word answers to a shift offer skip the model entirely.
const YES = /^(y|yes|yep|yeah|yup|sure|ok|okay|i can|i'?ll take it|count me in)[.! ]*$/i;
const NO = /^(n|no|nope|nah|can'?t|cannot|i can'?t|pass|sorry,? (no|i can'?t))[.! ]*$/i;

const UNKNOWN_SENDER =
  "Hi! I'm the team's scheduling assistant. Ask your manager for your Rota invite link to connect.";

function telegramChat(incoming: IncomingMessage) {
  const context = incoming.platformContext ?? {};
  const chatId = context.chatId;
  return {
    chatId: typeof chatId === "number" || typeof chatId === "string" ? String(chatId) : null,
    chatType: typeof context.chatType === "string" ? context.chatType : null,
    rawText: typeof context.rawText === "string" ? context.rawText.trim() : incoming.text,
  };
}

export default createIntegrationsPlugin({
  appId: "rota",
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  initialToolNames: STAFF_TOOLS,
  callAgent: false,
  // Use the deployment's bot token for every Telegram call (see telegram-adapter.ts).
  adapterOverrides: [rotaTelegramAdapter()],
  systemPrompt: `You are Rota, the scheduling assistant for a small team, chatting with one staff member on Telegram.

You can do three things for them: show their upcoming shifts (my-shifts), record a day they can't work (report-unavailable), and answer a shift offer they were sent (respond-to-offer). You cannot change anyone else's shifts, approve swaps, or talk about pay.

- Call my-shifts first: it gives today's date in the team's time zone and their shifts. Work out "tomorrow" or "Friday" from that date.
- When they can't make it (sick, emergency, appointment), check which day you understood, then call report-unavailable. Tell them it's done and that their manager sees the shift as open now. Wish them well if they're sick.
- After report-unavailable, tell them who was asked to cover (askedToCover), if anyone.
- If they reply to a shift offer with a clear yes or no, call respond-to-offer and pass on its replyToStaff text. If it's conditional ("only until 2"), say partial shifts go through their manager.
- If the request is anything else, say their manager handles it.
- Reply in short plain text. No markdown tables or headings.`,

  // Runs before the agent: invite links and unknown senders never reach it.
  beforeProcess: async (incoming) => {
    if (incoming.platform !== "telegram") return { handled: false };
    const { chatId, chatType, rawText } = telegramChat(incoming);
    if (!chatId) return { handled: true };
    // Only one-to-one chats; ignore groups.
    if (chatType && chatType !== "private") return { handled: true };

    const start = /^\/start(?:@\w+)?(?:\s+(\S+))?/i.exec(rawText);
    if (start) {
      const code = start[1];
      if (code) {
        const linked = await linkTelegram(code, chatId);
        return {
          handled: true,
          responseText: linked
            ? `Hi ${linked.staffName.split(" ")[0]}! You're connected to ${linked.teamName}. Message me here if you can't make a shift, or ask "what are my shifts?"`
            : "That invite has expired or was already used. Ask your manager for a new one.",
        };
      }
      const existing = await findStaffByChat(chatId);
      return {
        handled: true,
        responseText: existing
          ? `Hi ${existing.staffName.split(" ")[0]}! Ask me about your shifts, or tell me if you can't make one.`
          : UNKNOWN_SENDER,
      };
    }

    const known = await findStaffByChat(chatId);
    if (!known) return { handled: true, responseText: UNKNOWN_SENDER };

    const answer = YES.test(rawText) ? "yes" : NO.test(rawText) ? "no" : null;
    if (answer) {
      const response = await respondToOffer(known.staffId, answer);
      if (response.outcome !== "no_offer") {
        notifyTeamChanged(response.teamId);
        await deliver(response.messages);
        return { handled: true, responseText: response.reply };
      }
    }
    return { handled: false };
  },

  // Who the agent runs as. Linked staff get their own secret identity with no
  // team access (orgId null), so manager actions refuse them.
  resolveExecutionContext: async (incoming) => {
    if (incoming.platform === "telegram") {
      const { chatId } = telegramChat(incoming);
      const staff = chatId ? await findStaffByChat(chatId) : null;
      if (staff?.principal) {
        return { ownerEmail: staff.principal, orgId: null, principalType: "service" };
      }
    }
    return { ownerEmail: `integration@${incoming.platform}`, orgId: null, principalType: "service" };
  },
});
