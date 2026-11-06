# Chat — Agent Guide

Rota is a scheduling app built on the Chat starter. `/` opens shared sign-in, then `/roster`; `/home` redirects there. Full-page chat lives at `/chat`. Actions carry capabilities; screens exist only for durable workflows.

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

- `navigation` describes the view and selected ids. Chat is `chat` at `/chat` and `/chat/<threadId>`; `/` opens shared sign-in/signup.
- Use `navigate` when supported and `view-screen` for a fresh read of visible details; basic navigation is already in `<current-screen>`.

## Building a domain app

Choose the primary workflow and route before editing. Add a domain route under `app/routes/` and set `app.homePath` in `server/plugins/agent-native-email-branding.ts` with `defineAppConfig`. Chat stays at `/chat`. Add a static link in `app/components/layout/Sidebar.tsx` before `ChatThreadsSection`; `Header.tsx` uses `APP_TITLE` elsewhere. Shared sidebar and AgentInspector remain.

Use `adding-a-feature` for functional parity and `frontend-design` for a user-facing screen. Keep feature guidance here; do not rewrite `README.md` or `DESIGN.md`. After all edits, run one typecheck, one doctor check, and one browser smoke of the primary workflow, including overlap rejection, cancellation freeing the slot, and authenticated landing. Skip production build and extra test suites.

Before building common workspace or agent UI, read `agent-native-toolkit`; for supported customization, read `customizing-agent-native`.

- Guarded verification: run `pnpm agent-native:doctor`; fix findings before done.

## Rota

Weekly staff rosters with an agent shift manager (roadmap: `docs/ROADMAP.md`). Sign-in lands on `/roster`. Pages: `/roster/:teamId?week=YYYY-MM-DD` board (staff × Mon–Sun + open lane), `/staff/:teamId` Team, `/activity/:teamId` feed; bare paths open the last team.

- Teams are org-visible with an active org, else private; their staff, shifts, and availability inherit access.
- Every assignment goes through `server/lib/rules.ts`: `block` (double-booked, inactive) never passes; `override` (missing skill, unavailable, over max hours) needs `override=true`, only when the user asks; `warn` (rest under 10h) passes. Rejections are 409 `rule_violation`/`shift_locked`; report the reason.
- Shift writes lock the team row in a transaction.
- Dates YYYY-MM-DD, times HH:MM in team time zone; stored UTC ISO. End <= start = next day.
- `navigation` adds `teamId`/`week`; `selection:<tab>` holds `{kind:"shift", id}` (`view-screen` → `selectedShift`).
- Writes log plain-language `activity` (`server/lib/activity.ts`).
- Swaps (`server/lib/swaps.ts`): staff ask, the teammate agrees, the manager approves (rules re-checked).

| Action | Purpose |
|---|---|
| get-roster / list-activity | Week view; what happened |
| find-cover / offer-shift | Rank cover; ask on Telegram |
| assign-shift / assign-shifts | One (null unassigns) / batch |
| draft-week | Fill a week (prefs from notes) |
| publish-week / send-shift-reminders | Send the week; reminders |
| list-swaps / decide-swap | Swaps; approve/turn down |
| create-shifts / update-shift / delete-shift | Edit; `locked` pins |
| add-availability / remove-availability | Unavailability |
| add-staff / update-staff / create-telegram-invite | People, Telegram invite |

Telegram (`server/plugins/integrations.ts`): staff link via `/start <code>` and run as a secret identity with no team access, limited to staff actions (`my-shifts`, call-outs, offers, swaps). Setup: `docs/ROADMAP.md`.
