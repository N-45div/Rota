# Rota

**Your AI shift manager.** Rota builds the weekly staff roster with you, keeps
it within your rules, and handles the phone side of scheduling (call-outs,
cover, swaps) over Telegram while you watch the board.

Live: https://rota-n45divs-projects.vercel.app

Built with [Agent-Native](https://github.com/BuilderIO/agent-native) for the
[Builder.io Agent-Native Hackathon](https://www.builder.io/hackathon): people
and an agent working on the same roster.

## What it does

- **Draft a fair week in seconds.** "Fill 30 open with agent" drafts the week
  from skills, availability, max hours, and each person's notes ("prefers
  mornings"), then explains anything it couldn't fill.
- **Rules you can trust.** Every change goes through one rule checker, whether
  it's a drag on the board, an agent tool call, or a staff reply: no
  double-booking, skills, availability, weekly hours, rest between shifts.
- **Call-outs on Telegram.** Staff text the bot "I'm sick tomorrow". Rota opens
  the shift and asks the three best eligible teammates. The first YES gets it.
- **Shift swaps.** Staff ask to trade a shift, and Rota only offers swaps that
  pass the rules for both people. The teammate agrees, the manager approves on
  the board, and both get a confirmation.
- **Send the week.** Each person gets their own shifts on Telegram, plus a
  reminder the night before.
- **Activity feed.** A plain-language history of what the manager, Rota, and
  staff did, linked back to the roster.

## How people and the agent share the work

The board, the agent, and the Telegram bot all call the same actions
(`actions/`). The agent sees what you're looking at (team, week, selected
shift), so "who can cover this shift?" just works. Changes from Telegram or
the agent show up on the open board within seconds, and the shifts that
changed glow.

## Demo video

The demo film was made by the coding agent with this repo's
[`demo-video` skill](.agents/skills/demo-video/SKILL.md): real screen captures
and real bot messages, cut together with HyperFrames, timed to a voiceover
script, and published on Clips through its MCP server.

## Run locally

```bash
pnpm install
pnpm dev
```

Sign in with **Continue as local dev**, then **Load demo café**. Put
`OPENAI_API_KEY` in `.env` to use the agent. Telegram setup and production
notes are in `docs/ROADMAP.md`.

## Stack

Agent-Native (React Router, Drizzle), Postgres on Supabase, Vercel, and the
Telegram Bot API.
