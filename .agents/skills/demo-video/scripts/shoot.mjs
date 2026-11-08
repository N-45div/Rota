// Playwright helper for capturing an Agent-Native app's real screens at 1920x1080, 2x pixels.
//
//   import { open } from "./shoot.mjs";
//   const { page, shot, close } = await open({ baseUrl: "http://127.0.0.1:8080", out: "film/assets/shots" });
//   await page.goto("http://127.0.0.1:8080/roster");
//   await shot("board-before");
//   ... drive the app (or run `pnpm action ...` in another process), wait for the change ...
//   await shot("board-after");
//   await close();
//
// Sign-in: clicks "Continue as local dev" when the dev sign-in page shows it.
// hide: CSS selectors or text patterns to hide before each shot (account chips, dev emails).
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// require() finds Playwright from the app's node_modules or a global install (NODE_PATH); a bare ESM import would not.
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

export async function open({
  baseUrl = "http://127.0.0.1:8080",
  out = "film/assets/shots",
  width = 1920,
  height = 1080,
  scale = 2,
  hideText = [/@local\.test/i],
  hideSelectors = [],
} = {}) {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const dev = page.getByRole("button", { name: /local dev/i });
  if (await dev.count()) {
    await dev.first().click();
    await page.waitForLoadState("networkidle");
  }

  async function hide() {
    await page.evaluate(
      ({ patterns, selectors }) => {
        const regexes = patterns.map(([src, flags]) => new RegExp(src, flags));
        for (const sel of selectors) for (const el of document.querySelectorAll(sel)) el.style.visibility = "hidden";
        for (const el of document.querySelectorAll("body *")) {
          if (el.children.length === 0 && regexes.some((r) => r.test(el.textContent || ""))) {
            (el.closest("button") || el).style.visibility = "hidden";
          }
        }
      },
      { patterns: hideText.map((r) => [r.source, r.flags]), selectors: hideSelectors },
    );
  }

  async function shot(name, options = {}) {
    await page.waitForLoadState("networkidle");
    await hide();
    const file = path.join(out, `${name}.png`);
    await page.screenshot({ path: file, ...options });
    console.log("shot", file);
    return file;
  }

  /** Bounding box of an element in capture coordinates (CSS pixels), for cursor targets and punch-ins. */
  async function box(locator) {
    const b = await locator.boundingBox();
    return b && { x: b.x, y: b.y, width: b.width, height: b.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
  }

  return { browser, context, page, shot, box, hide, close: () => browser.close() };
}
