---
name: demo-video
description: >-
  Make a demo film of this Agent-Native app with HyperFrames and publish it on
  Clips. Use when asked for a demo, launch, walkthrough, or hackathon video, a
  voiceover script for one, or to upload, chapter, caption, or share a video on
  Clips.
scope: dev
---

# Demo Video (HyperFrames + Clips)

A demo film built from the app's real screens and the real words its agent and
bots produced, rendered frame by frame with HyperFrames, timed to a voiceover
script, and published on Clips with chapters and a transcript.

## What makes it an Agent-Native demo

- Show people and the agent working on the same data: something a person does
  in the UI, something the agent does, something that arrives from outside
  (Telegram, Slack, email), the rule that keeps it safe, and the shared trail.
- Every screen is a capture and every chat bubble is a message the app really
  sent. Never mock UI or invent bot text.
- Set up state with the same actions the UI and agent call
  (`pnpm action <name> --flag value`), so captures show real results.

## Workflow

1. **Story first.** Pick 6–10 beats for a 90–120 s film. For each beat write
   what is on screen and the one sentence the narrator says. Lead with the
   moment a user feels (someone texts, the board changes), then show how.
2. **Real state.** Run the dev server. To capture a bot's messages without real
   phones, preload `scripts/capture-outbound.mjs` (it logs outgoing chat-API
   calls to a file and answers them). Run the agent for real, from the in-app
   chat or an action, and wait for it to finish.
3. **Capture.** `scripts/shoot.mjs` opens the signed-in app at 1920×1080 with
   2× pixels. Shoot each state of a screen (before, working, after) from the
   same scroll position so a crossfade reads as the UI changing. Save element
   boxes (`box()`) for cursor targets and punch-ins, and the real message text,
   in a JSON file next to the shots.
4. **Build the film.** `scripts/film_kit.py` writes a HyperFrames project:
   phones with chat bubbles, a camera over stacked captures (punch in,
   crossfade, cursor click, pull back), titles, transitions, an end card.
   Start from `scripts/example_film.py`. Put `gsap.min.js` (from
   `node_modules/gsap/dist/`) in `<film>/assets/vendor/` and fonts in
   `<film>/assets/fonts/`. `film.write()` also writes `timing.json`.
5. **Check, look, render.** In the film folder:
   `npx hyperframes check --json` (fix every error),
   `npx hyperframes snapshot --at 1,5,9` (look at every scene),
   then `npx hyperframes render -o demo.mp4 -q delivery`. Check the MP4 with
   `ffprobe` and a few frames pulled with `ffmpeg -ss <t> -frames:v 1`.
   `references/hyperframes.md` has the rules that keep renders correct.
6. **Voiceover script.** Write `SCRIPT.md` (per scene: start time, what is on
   screen, the lines) and the same lines as an `.srt`. Run
   `python3 scripts/vo_check.py voiceover.srt <film>/timing.json`. It must pass
   (at most 2.7 words a second, no cue crossing a scene). If the person records
   the voice, render silent; otherwise add an `<audio id>` in `index.html`.
7. **Publish on Clips.** Upload, add chapters from `timing.json`, import the
   transcript, check frames, and make it public only when the person says it's
   ready. Steps and tool calls are in `references/clips.md`; the client is
   `scripts/clips-mcp.mjs`.

## Files

| File | What it does |
| --- | --- |
| `scripts/film_kit.py` | Builds the HyperFrames project: scenes, phone chats, camera, cursor, titles, transitions |
| `scripts/example_film.py` | A three-scene film to copy from |
| `scripts/shoot.mjs` | Signed-in Playwright captures at 2×, element boxes, hides dev emails |
| `scripts/capture-outbound.mjs` | Dev preload that logs a bot's outgoing messages instead of sending them |
| `scripts/vo_check.py` | Checks an `.srt` voiceover against `timing.json` |
| `scripts/clips-mcp.mjs`, `scripts/clips-upload.mjs` | Clips MCP client and chunked uploader |

In a container without IPv6, start the dev server with
`DEV_HOST=127.0.0.1 pnpm exec agent-native dev`.

## Scene patterns

| Beat | Kit calls |
| --- | --- |
| Someone texts the bot | `ground("primary")`, `phone(...)` with real messages, `title(on_primary=True)`, `drift()` while people read |
| The app reacts | `cam([...before, after])`, `move()` to the change, `show(1)`, `full()` |
| A click or drag | `cursor_path()` to a saved box, `show()` the next capture just after the click |
| A rule says no | Punch in on the error text and hold it; the reason is the point |
| Phone to app | `whip_out("#stage")` then `cam(hidden=True)` + `whip_in()` |
| Close | `iris_out()` or `fade_to()`, an end card with the live URL and "Built with Agent-Native" |

## Don'ts

- Don't run the dev server's real bot token or message real people for a
  recording; use the capture preload.
- Don't crossfade two captures whose layout moved (a banner closing, a row
  added): it shows a double image. Cut on a camera move instead.
- Don't publish, make public, or share a clip without the person's go-ahead.
- Don't commit captures or renders to the app repo; keep them in a scratch
  folder and hand over the MP4 and script.
