# Rota roadmap

Rota is an AI shift manager: the agent builds the weekly staff roster, keeps
it within the rules, and handles the phone side (call-outs, cover, swaps) over
Telegram while the manager watches a live board.

Built for the Builder.io Agent-Native Hackathon. Deadline: **Mon Nov 9, 2026,
11:59 PM PT** (Nov 10 07:59 UTC). We submit by **noon PT** on Nov 9.

> Deadline confirmed (Nov 3): submissions close **Mon Nov 9, 11:59 PM PT**.
> Nov 13 is only the winner announcement.

## Working agreements

- Every commit is authored and committed as `N DIVIJ <123795325+N-45div@users.noreply.github.com>` (the owner's GitHub identity; commits before Nov 4 used `N-45div <ndivij2004@gmail.com>`). No co-author lines or tool/session trailers in commit messages.
- Default branch is `main` on github.com/N-45div/rota. Vercel (Pro, team `n45divs-projects`) deploys from it.

## Hackathon facts (from builder.io/hackathon and /rules)

- Must be built with Agent-Native, original work from Oct 27, 2026. List the
  Chat template and libraries used in the submission description.
- Submission: working app, public **Clips** recording (viewable without login),
  project description with team and pre-existing work, form at
  builder.io/hackathon/submit. Repo or live URL optional but encouraged.
- Judging: Usefulness & Execution 40%, Creativity & Design 20%, Innovation 20%,
  Cleverness & use of Agent-Native 20%.
- Optional office hours: **Tue Nov 3** and **Thu Nov 5**, 8:30 AM PT. Show a
  working build there.
- Never put real IDs, tax forms, or payment details in the demo.

## Status

| Area | State |
| --- | --- |
| Scaffold (Chat template, standalone) | Done |
| Data model: teams, staff, shifts, availability | Done |
| Rule checker (double-booking, skills, availability, max hours, rest) + tests | Done |
| Shared actions (get-roster, assign-shift(s), find-cover, shifts, staff, availability, seed) | Done, HTTP smoke test in `scripts/api-smoke.cjs` |
| Roster board: grid, open lane, popover with ranked cover, drag-and-drop with live eligibility | Done, browser-tested |
| Agent instructions, context (team, week, selected shift), roster suggestions | Done; needs a real LLM run |
| Telegram: staff invite links, staff identity, staff actions (`my-shifts`, `report-unavailable`), invite UI | Done, tested with simulated webhooks; needs a real bot token |
| Call-out flow: sick report opens the shift, best 3 eligible asked on Telegram, YES/NO (instant, no model), first yes wins, next round on all-no, board shows "asking N" | Done, `scripts/callout-smoke.cjs` |
| Live at https://rota-n45divs-projects.vercel.app (Vercel Pro, functions in Tokyo `hnd1`, Supabase Postgres Tokyo, OpenAI GPT-6 Luna) | Done Nov 3. First real agent run: "Fill 30 open" drafted 28/30 in 18 s via `draft-week` and explained the 2 it couldn't fill. |
| Telegram on production (@Rotaagentbot) | Done Nov 4: webhook set, linking and the AI call-out path verified on production (sick message → shift opened in 7 s). Real-phone delivery test pending. |
| Send to staff (publish-week), night-before reminders, Automate menu | Done Nov 4 |
| Rota brand: warm theme (cream, tomato, espresso), Fraunces headings, Rota mark and icons, branded sign-in page | Done Nov 4 |
| Team page (`/staff`), Activity feed (`/activity`, plain-language log of what the manager, Rota, and staff did), last-team memory | Done Nov 4, live on production |

## Database: Supabase

Rota talks to Postgres directly (Drizzle), so it needs Supabase's connection
strings, not the supabase-js publishable key. In Supabase → **Connect**:

- `DATABASE_URL` = **Transaction pooler** URL (port 6543), used by the app.
- `DATABASE_MIGRATION_URL` = **Session pooler** URL (port 5432), used only by
  `scripts/vercel-build.sh` for release migrations.

Put both in Vercel (project rota → Settings → Environment Variables, Sensitive,
Production + Preview) with the real database password. Never commit them.

Model: `OPENAI_API_KEY` is set in Vercel; the framework picks OpenAI from it.

## Telegram setup (once per deployment)

1. In Telegram, message @BotFather, send `/newbot`, copy the token and the bot username.
2. In Vercel (project rota → Settings → Environment Variables): `TELEGRAM_BOT_TOKEN` (Sensitive), `TELEGRAM_BOT_USERNAME` (no @), `TELEGRAM_WEBHOOK_SECRET` (any long random string), `A2A_SECRET` (random; required in production for agent replies), `APP_URL` (the production URL). Redeploy.
3. Signed in as the team admin: `POST /_agent-native/integrations/telegram/enable`.
4. Register the webhook (the framework's `/setup` can't read deploy env secrets for a signed-in user in production, so use the script):
   `TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... node scripts/telegram-set-webhook.mjs https://rota-n45divs-projects.vercel.app`
5. On the board, click a staff member → Connect Telegram → send them the link.

After rotating the token (BotFather `/revoke`): update `TELEGRAM_BOT_TOKEN` in Vercel, redeploy, and rerun step 4.

Telegram calls use the deployment's bot token from the environment in every context (`server/lib/telegram-adapter.ts`).

Local testing without a bot: `scripts/telegram-smoke.cjs` and `scripts/callout-smoke.cjs` post fake Telegram updates.

## Timeline to submission (deadline Nov 9)

| Day | Work |
| --- | --- |
| Oct 30 – Nov 2 | Done: scaffold, data model, rule checker, board with drag-and-drop, agent instructions, Telegram linking with limited staff identities, call-out flow (offers, YES/NO, next round), Vercel project linked to GitHub. |
| **Tue Nov 3** | **Office hours 8:30 AM PT.** Connect Neon + keys → first live deploy, real bot, first real agent runs ("draft next week", a real call-out); fix what breaks. |
| **Wed Nov 4** | Done: publish the week on Telegram, Automate menu, reminders; UI revamp (brand, Team page, Activity feed, sign-in). |
| **Thu Nov 5** | **Office hours #2.** Shift swaps between staff (both agree, rules checked, manager approves). |
| **Fri Nov 6** | Agent presence on the board, phone-width pass on the board, README. |
| **Sat Nov 7** | Real-phone test with friends on Telegram, bug bash, **record the Clips demo**. |
| **Sun Nov 8** | Buffer: fix, re-record if needed, write the submission description. |
| **Mon Nov 9** | **Submit by noon PT** and confirm receipt. |

Cut list if behind (in this order): swaps, night-before reminders, publish
week, presence polish. Stretch only if ahead: set up a team from a photo of a
paper rota. The call-out flow and drafting are the demo; never cut those.

## Demo script (about 2.5 minutes)

1. Split screen: board on the laptop, Telegram on a phone. "It's 6 AM. Your
   barista just texted that she's sick."
2. The shift turns open on the board instantly; the agent messages the best
   eligible people (fewest hours first). One replies "yes"; the shift fills.
3. Drag a shift onto someone: rows light up green/grey with reasons; a bad drop
   is refused with the rule in plain words.
4. "Fill 30 open with agent" drafts next week in one go and explains anything
   it couldn't fill.
5. Close: one set of actions, used by the board, the chat, and Telegram.

## After the hackathon: Rota for agencies and service businesses

Prompted by agency owners asking for one platform instead of Trello + Notion +
Slack + email + invoicing ("Agency owners would happily pay monthly for
this"). Expand Rota rather than start a new app; the core carries over:
people, time, rules, and one agent that serves different audiences with
different permissions.

**The bridge:** agencies schedule people too. "Who works on which client this
week" is a roster where clients replace roles. Rota's board, rule checker, and
hours tracking become resource planning, and tracked hours feed invoices.

**Principle:** sell the glue, not another app. The agent does the work between
tools: turns client messages into tasks, guards scope, answers "where are we
at?", turns finished work into invoices, and chases payment. People approve.

Phases:

1. **Clients and projects.** Clients, projects, a task board (reuse the board
   and live sync), and resource planning on the existing roster.
2. **Client portal: one agent, two audiences.** Magic-link portal (no client
   account): status, chat, approvals, invoices. The client-facing agent answers
   from real project data and cannot edit the board or see internal notes.
   This reuses the limited-identity pattern built for Telegram staff.
3. **Scope guard (hero feature).** Client asks for something new → agent splits
   it into tasks, checks it against the agreed scope or retainer, flags
   out-of-scope work, and drafts a change order the agency approves and the
   client accepts.
4. **Invoicing and payments.** Invoices from tracked hours, shifts, or
   milestones; Stripe payments; overdue reminders as automations.
5. **Later.** Docs and images (file storage), client chat over email and
   WhatsApp, Slack sync, proposals and contracts, time tracking.

Keep each phase shippable on its own; don't build all five at once.
