// Rota's Telegram bot is one deployment-wide credential (TELEGRAM_BOT_TOKEN and
// TELEGRAM_WEBHOOK_SECRET in the host environment), not a per-user key.
//
// In production the framework only reads deploy environment secrets when no
// user is attached to the request; with a signed-in manager or a staff
// identity attached it looks for per-user/org vault secrets instead. So the
// adapter's Telegram calls run without a user. Authorization for *what* gets
// sent is enforced by Rota's actions before they reach this adapter.
import { runWithRequestContext, telegramAdapter, type PlatformAdapter } from "@agent-native/core/server";

async function withoutUser<T>(fn: () => Promise<T>): Promise<T> {
  return await runWithRequestContext({} as Parameters<typeof runWithRequestContext>[0], fn);
}

export function rotaTelegramAdapter(): PlatformAdapter {
  const base = telegramAdapter();
  const adapter: PlatformAdapter = {
    ...base,
    verifyWebhook: (event) => withoutUser(() => base.verifyWebhook(event)),
    sendResponse: (message, context, options) => withoutUser(() => base.sendResponse(message, context, options)),
    getStatus: (baseUrl) => withoutUser(() => base.getStatus(baseUrl)),
  };
  if (base.sendMessageToTarget) {
    const send = base.sendMessageToTarget.bind(base);
    adapter.sendMessageToTarget = (message, target) => withoutUser(() => send(message, target));
  }
  return adapter;
}
