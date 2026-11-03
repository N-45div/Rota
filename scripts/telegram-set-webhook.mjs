// Point the Telegram bot at the deployed app. Run once per deployment URL, and
// again after rotating the bot token or webhook secret.
//
//   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... \
//     node scripts/telegram-set-webhook.mjs https://your-app.vercel.app
//
// Uses the same request as the framework's /integrations/telegram/setup.
const base = (process.argv[2] || process.env.APP_URL || "").replace(/\/$/, "");
const token = process.env.TELEGRAM_BOT_TOKEN; // guard:allow-env-credential — deployment bot token, operator-run setup script
const secret = process.env.TELEGRAM_WEBHOOK_SECRET; // guard:allow-env-credential — deployment webhook secret, operator-run setup script
if (!base || !token || !secret) {
  console.error("Usage: TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... node scripts/telegram-set-webhook.mjs <app-url>");
  process.exit(1);
}
const api = (method, body) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  }).then((res) => res.json());

const me = await api("getMe");
if (!me.ok) {
  console.error("Bot token rejected:", me.description);
  process.exit(1);
}
const set = await api("setWebhook", { url: `${base}/_agent-native/integrations/telegram/webhook`, secret_token: secret });
const info = await api("getWebhookInfo");
console.log(`@${me.result.username}: setWebhook ${set.ok ? "ok" : "failed: " + set.description}`);
console.log(`webhook: ${info.result?.url} (pending ${info.result?.pending_update_count ?? 0}${info.result?.last_error_message ? `, last error: ${info.result.last_error_message}` : ""})`);
