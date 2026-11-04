# Chat — Agent Guide

Chat is the minimal chat-first agent-native app. `/` redirects to shared sign-in, then `/home`, the editable Get started page. Chat lives at `/chat`; new chats start there. Actions carry capabilities; screens exist only for durable workflows.

## Skills

Search with `rg --hidden --follow`; read the exact linked guide before deeper work. `.agents/skills/build-an-app/SKILL.md` — start here for vague requests to create a domain app. `.agents/skills/adding-a-feature/SKILL.md` — cross-area feature checklist. Data/integrations: `.agents/skills/actions/SKILL.md`, `.agents/skills/storing-data/SKILL.md`, `.agents/skills/security/SKILL.md`, `.agents/skills/secrets/SKILL.md`, `.agents/skills/sharing/SKILL.md`. UI: `.agents/skills/frontend-design/SKILL.md`, `.agents/skills/shadcn-ui/SKILL.md`, `.agents/skills/client-side-routing/SKILL.md`. Agent context/workflows: `.agents/skills/context-awareness/SKILL.md`, `.agents/skills/real-time-sync/SKILL.md`, `.agents/skills/reliable-mutations/SKILL.md`, `.agents/skills/performance/SKILL.md`, `.agents/skills/delegate-to-agent/SKILL.md`. Framework: `.agents/skills/agent-native-docs/SKILL.md`, `.agents/skills/agent-native-toolkit/SKILL.md`, `.agents/skills/customizing-agent-native/SKILL.md`.

Use local docs only (no web research): `pnpm action docs-search --query "<topic>"`, `pnpm action docs-search --slug "<slug>"`, `pnpm action docs-search --list`, `pnpm action source-search --query "<pattern>"`, `pnpm action source-search --path <path>`, or `pnpm action source-search --list`. For external-agent integrations, read `pnpm action docs-search --slug "external-agents"`.

## Core rules

- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Normal app data must flow through actions. Keep actions deterministic and focused; use agent chat/AgentSidebar for AI work and follow-ups in the same thread. Keep structured state in SQL and large files in configured storage; persist references only.
- For external integrations, inspect the workspace/provider connection catalog first; reuse its scoped resolver. Never hardcode credentials, webhook URLs, or private/customer data.
- Never fabricate. Report failures and recover; verify writes by reading the row or screen. Navigation is in `<current-screen>`; use `view-screen` for fresh visible-record details.

For custom branding, keep `server/plugins/agent-native-email-branding.ts` aligned: `app.name` appears in transactional email and optional `app.logoUrl` must be an absolute HTTPS URL.

## Application state

- `navigation` describes the view and selected ids. Chat is `chat` at `/chat` and `/chat/<threadId>`; the Get started page is `home` at `/home`; `/` opens shared sign-in/signup.
- Use `navigate` when supported and `view-screen` for a fresh read of visible details; basic navigation is already in `<current-screen>`.

## Building a domain app

Choose the primary workflow and route before editing. Add a domain route under `app/routes/` and set `app.homePath` in `server/plugins/agent-native-email-branding.ts` with `defineAppConfig`. The default Get started page lives at `/home`, and Chat stays at `/chat`; edit `app/routes/home.tsx` when replacing that page with a domain-specific home. Add a static link in `app/components/layout/Sidebar.tsx` before `ChatThreadsSection`; `Header.tsx` uses `APP_TITLE` elsewhere. Shared sidebar and AgentInspector remain.

Use `adding-a-feature` for functional parity and `frontend-design` for a user-facing screen. Keep feature guidance here; do not rewrite `README.md` or `DESIGN.md`. After all edits, run one typecheck, one doctor check, and one browser smoke of the primary workflow, including overlap rejection, cancellation freeing the slot, and authenticated landing. Skip production build and extra test suites.

Before building common workspace or agent UI, read `agent-native-toolkit`; for supported customization, read `customizing-agent-native`.

- Guarded verification: run `pnpm agent-native:doctor`; fix findings before done.

## Rota

Weekly staff rosters with an agent shift manager (plan and roadmap: `docs/ROADMAP.md`). Sign-in lands on `/roster`. Pages: `/roster/:teamId?week=YYYY-MM-DD` board (staff × Mon–Sun plus an open lane), `/staff/:teamId` Team, `/activity/:teamId` feed; bare paths open the last team.

- Teams are org-visible with an active org, else private; staff, shifts, and availability inherit team access.
- Every assignment goes through `server/lib/rules.ts`: `block` (double-booked, inactive) never passes; `override` (missing skill, unavailable, over max hours) needs `override=true`, only when the user asks; `warn` (rest under 10h) passes. Rejections are 409 `rule_violation`/`shift_locked`; report the reason.
- Shift writes lock the team row in a transaction so concurrent assignments can't double-book.
- Dates YYYY-MM-DD, times HH:MM in the team time zone; storage is UTC ISO. End ≤ start means the next day.
- `navigation` adds `teamId`/`week`; `selection:<tab>` holds `{kind:"shift", id}` (`view-screen` → `selectedShift`).
- Writes log plain-language entries to `activity` (`server/lib/activity.ts`).

| Action | Purpose |
|---|---|
| get-roster / list-activity | Week view; what happened |
| find-cover / offer-shift | Rank cover; ask on Telegram |
| assign-shift / assign-shifts | One (null unassigns) / batch |
| draft-week | Fill a week (preferences from notes) |
| publish-week / send-shift-reminders | Send the week; reminders |
| create-shifts / update-shift / delete-shift | Edit; `locked` pins |
| add-availability / remove-availability | Unavailability rules |
| add-staff / update-staff / create-telegram-invite | People, Telegram invite |
| seed-demo-team | Demo café |

Telegram (`server/plugins/integrations.ts`): staff link via `/start <code>` and run as a secret staff identity with no team access, limited to `my-shifts`, `report-unavailable`, and `respond-to-offer`. Setup: `docs/ROADMAP.md`.
