// Dev-only Node preload: log outgoing chat-API messages to a file instead of sending them, so a demo
// can show the bot's real words without real phones.
//
//   NODE_OPTIONS="--import /abs/path/capture-outbound.mjs" CAPTURE_FILE=/abs/path/outbound.jsonl \
//   CAPTURE_PREFIX=https://api.telegram.org/bot pnpm dev
//
// Each matching request is appended as {at, method, body} and answered with a stub success.
// Telegram-shaped replies are returned for api.telegram.org; anything else gets {ok: true}.
// Never use this in production.
import fs from "node:fs";

// guard:allow-env-credential — a log file path for local recordings, not a secret.
const file = process.env.CAPTURE_FILE;
// guard:allow-env-credential — which API URLs to capture, not a secret.
const prefixes = (process.env.CAPTURE_PREFIX || "https://api.telegram.org/bot").split(",").map((p) => p.trim());
const realFetch = globalThis.fetch;
let nextId = 1000;

if (file && realFetch) {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input?.url ?? String(input));
    if (!prefixes.some((p) => url.startsWith(p))) return realFetch(input, init);
    const method = url.split("?")[0].split("/").pop();
    let body = init?.body;
    try {
      body = JSON.parse(body);
    } catch {
      /* keep raw */
    }
    fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), method, body }) + "\n");
    let result = { ok: true };
    if (url.startsWith("https://api.telegram.org/bot")) {
      // guard:allow-env-credential — the bot's public @username for the stub getMe reply, not a secret.
      const username = process.env.TELEGRAM_BOT_USERNAME || "demo_bot";
      result =
        method === "getMe"
          ? { ok: true, result: { id: 1, is_bot: true, username, first_name: "Bot" } }
          : { ok: true, result: { message_id: nextId++, date: Math.floor(Date.now() / 1000), chat: { id: body?.chat_id } } };
    }
    return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } });
  };
}
