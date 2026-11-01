# Rota roadmap

Rota is an AI shift manager: the agent builds the weekly staff roster, keeps
it within the rules, and handles the phone side (call-outs, cover, swaps) over
Telegram while the manager watches a live board.

Built for the Builder.io Agent-Native Hackathon. Deadline: **Mon Nov 9, 2026,
11:59 PM PT** (Nov 10 07:59 UTC). We submit by **noon PT** on Nov 9.

## Working agreements

- Every commit is authored and committed as `N-45div <ndivij2004@gmail.com>`. No co-author lines or tool/session trailers in commit messages.
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
| Deploy (host + Postgres) and Telegram webhook | Needs the owner's accounts |

## Telegram setup (once per deployment)

1. In Telegram, message @BotFather, send `/newbot`, copy the token and the bot username.
2. Set env vars: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (any long random string), `TELEGRAM_BOT_USERNAME`.
3. Signed in as the team admin, `POST /_agent-native/integrations/telegram/enable`, then `POST /_agent-native/integrations/telegram/setup` to register the webhook.
4. On the board, click a staff member → Connect Telegram → send them the link.

Local testing without a bot: `scripts/telegram-smoke.cjs` posts fake Telegram updates.

## Timeline to submission

| Day | Work |
| --- | --- |
| **Sun Nov 1** | Telegram foundation: staff invite links (`/start <code>`), each linked staff member runs as their own limited identity, staff actions (`my-shifts`, `report-unavailable`). This roadmap. |
| **Mon Nov 2** | Deploy (host + Neon Postgres), set LLM key, create the bot with BotFather, register the webhook. First real agent run: "draft next week". Fix whatever it gets wrong. |
| **Tue Nov 3** | **Office hours 8:30 AM PT**: show board + agent drafting. Then the call-out flow: staff texts "sick tomorrow" → shift goes open on the board → agent offers it to the best eligible people on Telegram → first "yes" gets it → manager notified with undo. |
| **Wed Nov 4** | Publish the week to everyone on Telegram. Automations: Friday "draft next week", night-before shift reminders. |
| **Thu Nov 5** | **Office hours #2.** Shift swaps between staff (both agree, rules checked, manager approves). Manager setting: auto-approve vs ask. |
| **Fri Nov 6** | Polish: agent presence and recent-edit highlights on the board, phone-width check, empty/error states, README. |
| **Sat Nov 7** | Bug bash, rehearse the demo script, **record the Clips demo**. |
| **Sun Nov 8** | Buffer. Re-record if needed. Write the submission description. |
| **Mon Nov 9** | **Submit by noon PT** and confirm receipt. |

Cut list if behind (in this order): swaps, night-before reminders, publish
week, presence polish. The call-out flow and drafting are the demo; never cut
those.

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
