# Rota architecture

Rota is one web app with three ways in: the manager's board, the manager's AI
agent, and a Telegram bot for staff. All three call the same actions, and
every change to who works when passes through one rule checker. This document
explains how those pieces fit together.

- [System overview](#system-overview)
- [One set of actions, three callers](#one-set-of-actions-three-callers)
- [Data model](#data-model)
- [The write path](#the-write-path)
- [The rule checker](#the-rule-checker)
- [Drafting a week](#drafting-a-week)
- [Call-outs and cover](#call-outs-and-cover)
- [Shift swaps](#shift-swaps)
- [Identity and access](#identity-and-access)
- [What the agent sees](#what-the-agent-sees)
- [Live updates](#live-updates)
- [Messages to staff and automations](#messages-to-staff-and-automations)
- [Deployment](#deployment)
- [Code map](#code-map)
- [Testing](#testing)

## System overview

```mermaid
flowchart LR
  manager(["Manager<br/>browser or phone"])
  staffer(["Staff<br/>Telegram"])

  subgraph vercel["Rota on Vercel"]
    ui["Board, Team, Activity<br/>React Router"]
    agent["Manager agent<br/>AgentSidebar and /chat"]
    bot["Telegram integration<br/>webhook + staff agent"]
    actions["Actions<br/>actions/*.ts"]
    domain["Domain logic<br/>rules, draft, cover, swaps, notices"]
  end

  db[("Postgres<br/>Supabase")]
  llm["LLM<br/>OpenAI"]
  tg["Telegram Bot API"]

  manager --> ui
  manager --> agent
  staffer <--> tg
  tg -- webhook --> bot
  ui --> actions
  agent --> actions
  bot --> actions
  agent <--> llm
  bot <--> llm
  actions --> domain
  domain --> db
  domain -- offers, swaps, week, reminders --> tg
```

The app is built on [Agent-Native](https://github.com/BuilderIO/agent-native)
(`@agent-native/core`): React Router for the UI, Nitro for the server, Drizzle
for SQL, and the framework's agent chat, integrations, sharing, and sync.

## One set of actions, three callers

Every operation is a file in `actions/` made with `defineAction`. The same
action is a typed client hook for the UI, a tool for the manager's agent, and,
for a small subset, a tool for the staff agent on Telegram. Nothing writes
roster data outside an action except the Telegram YES/NO shortcut, which calls
the same library functions the actions use.

```mermaid
flowchart TB
  subgraph callers["Callers"]
    board["Board UI<br/>useActionQuery / useActionMutation"]
    mgr["Manager agent<br/>server/plugins/agent-chat.ts"]
    staffagent["Staff agent on Telegram<br/>server/plugins/integrations.ts"]
    fast["YES / NO shortcut<br/>no model call"]
  end

  subgraph actionlayer["actions/"]
    mgrActions["Manager actions<br/>get-roster, assign-shift(s), draft-week,<br/>find-cover, offer-shift, publish-week,<br/>decide-swap, add-availability, ..."]
    staffActions["Staff actions<br/>my-shifts, report-unavailable,<br/>respond-to-offer, find-swaps,<br/>request-swap, respond-to-swap, cancel-swap"]
  end

  subgraph lib["server/lib/"]
    rules["rules.ts<br/>rule checker"]
    draft["draft.ts"]
    cover["cover.ts"]
    swaps["swaps.ts"]
    notices["notices.ts"]
    activity["activity.ts"]
  end

  board --> mgrActions
  mgr --> mgrActions
  staffagent --> staffActions
  fast --> cover
  fast --> swaps
  mgrActions --> rules
  mgrActions --> draft
  mgrActions --> cover
  mgrActions --> swaps
  mgrActions --> notices
  staffActions --> cover
  staffActions --> swaps
  draft --> rules
  cover --> rules
  swaps --> rules
  mgrActions --> activity
  staffActions --> activity
```

What each caller can reach:

| Capability | Board | Manager agent | Staff on Telegram |
| --- | --- | --- | --- |
| See the week | Board | `get-roster`, `view-screen` | `my-shifts` (own shifts) |
| Assign, move, unassign | Drag, click | `assign-shift`, `assign-shifts` | No |
| Create, edit, lock shifts | Add shift, shift details | `create-shifts`, `update-shift` | No |
| Draft the week | "Fill N open with agent" | `draft-week` | No |
| Record unavailability | Person sheet | `add-availability` | `report-unavailable` (own) |
| Find and ask for cover | Shift details | `find-cover`, `offer-shift` | Answers offers |
| Swaps | Approve or turn down | `list-swaps`, `decide-swap` | Ask, agree, cancel |
| Send the week, reminders | Send to staff, Automate | `publish-week`, `send-shift-reminders` | Receives them |
| History | Activity page | `list-activity` | No |

## Data model

All tables live in Postgres (`server/db/schema.ts`), with additive migrations
in `server/plugins/db.ts`. Times are stored as UTC ISO strings and shown in the
team's time zone.

```mermaid
erDiagram
  teams ||--o{ team_shares : "shared with"
  teams ||--o{ staff : has
  teams ||--o{ shifts : has
  teams ||--o{ activity : logs
  staff ||--o{ shifts : works
  staff ||--o{ availability : "can't work"
  shifts ||--o{ cover_offers : "offered as"
  staff ||--o{ cover_offers : "asked"
  shifts ||--o{ swap_requests : "traded in"
  staff ||--o{ swap_requests : "asks or is asked"
  staff ||--o{ staff_notices : receives

  teams {
    text id PK
    text name
    text timezone
    text owner_email
    text org_id
  }
  staff {
    text id PK
    text team_id FK
    text name
    text roles "barista,opener"
    int max_hours
    text notes "prefers mornings"
    text telegram_chat_id
    text telegram_principal
    bool active
  }
  shifts {
    text id PK
    text team_id FK
    text role
    text starts_at "UTC ISO"
    text ends_at "UTC ISO"
    text staff_id FK "null when open"
    bool locked
    text status "scheduled or cancelled"
  }
  availability {
    text id PK
    text staff_id FK
    int day_of_week "weekly rule"
    text date "one-off"
    text start_time
    text end_time
    text note
  }
  cover_offers {
    text id PK
    text shift_id FK
    text staff_id FK
    text status "pending accepted declined closed"
    text delivery
  }
  swap_requests {
    text id PK
    text requester_id FK
    text requester_shift_id FK
    text peer_id FK
    text peer_shift_id FK
    text status
    text note
    text reason
  }
  staff_notices {
    text id PK
    text staff_id FK
    text kind "week or reminder"
    text ref
  }
  activity {
    text id PK
    text team_id FK
    text actor_kind "manager agent staff system"
    text actor_name
    text text "plain words"
    text shift_id
  }
```

Every table also carries `owner_email` and `org_id` for the framework's access
checks. `team_shares` is the framework's sharing table; teams are registered
as a shareable resource in `server/db/index.ts`.

## The write path

Every shift write follows the same steps. Here is `assign-shift`, the action
behind a drag on the board, an agent's assignment, and a cover acceptance.

```mermaid
sequenceDiagram
  autonumber
  participant C as Caller<br/>(board, agent)
  participant A as assign-shift
  participant DB as Postgres
  participant R as rules.ts
  participant S as Open boards

  C->>A: shiftId, staffId, override?
  A->>A: access check: editor on the team
  A->>DB: BEGIN, SELECT team ... FOR UPDATE
  A->>DB: load the shift, the week's shifts, staff, availability
  alt shift is locked
    A-->>C: 409 shift_locked
  else
    A->>R: checkAssignment(shift, person, week)
    R-->>A: violations with severity
    alt block, or override without override=true
      A-->>C: 409 rule_violation and the reasons
    else allowed
      A->>DB: UPDATE shift, INSERT activity
      A->>DB: COMMIT
      A-->>C: shift and any warnings
      A-)S: change event, board refetches and the shift glows
    end
  end
```

Locking the team row serializes writes per team, so two people (or a person
and the agent) can't both take the last slot. Rejections are HTTP 409 with
`rule_violation` or `shift_locked`, and the board and agent both show the
server's reason.

## The rule checker

`server/lib/rules.ts` is a set of pure functions over rows already in memory,
so the same checks run inside write transactions, in cover ranking, in the
week draft, in swap checks, and in unit tests.

| Rule | Severity | Meaning |
| --- | --- | --- |
| `double_booked` | block | Overlaps another shift the person already works |
| `inactive` | block | The person is no longer active |
| `missing_skill` | override | The shift's role isn't in the person's skills |
| `unavailable` | override | Clashes with a weekly or one-off unavailability |
| `over_max_hours` | override | Takes the person past their weekly max hours |
| `short_rest` | warn | Less than 10 hours between shifts |

`block` never passes. `override` passes only with `override=true`, which the
agent is told to send only when the manager asks for it. `warn` passes and
shows on the board.

Other users of the checker:

- `rankCandidates` orders everyone for a shift: eligible people first, then
  fewest hours this week, then name. `find-cover` and cover offers use it.
- `checkSwap` checks a trade as one change, so each person's hours count the
  shift they give away as gone.

## Drafting a week

"Fill N open with agent" sends a prompt to the manager agent. The agent reads
the roster, turns each person's notes ("prefers mornings") into preferences,
and calls `draft-week` once. `draft-week` is deterministic: the agent supplies
judgment (reading notes, explaining results), and the code supplies the
search.

```mermaid
flowchart TD
  fillBtn["Manager clicks<br/>Fill N open with agent"] --> prompt["sendToAgentChat"]
  prompt --> read["Agent: get-roster for the team and week"]
  read --> prefs["Agent: notes become preferences<br/>mornings, evenings, weekdays, weekends"]
  prefs --> draftCall["Agent: draft-week"]
  draftCall --> sort["Sort open shifts, hardest first<br/>(fewest eligible people)"]
  sort --> each{"For each shift"}
  each --> eligible["Everyone the rule checker allows"]
  eligible --> score["Lowest score wins:<br/>share of max hours, preference bonus or penalty,<br/>extra weekend and short rest penalties"]
  score --> assign["Assign in memory"]
  assign --> each
  each -- "none eligible" --> reason["Record why it stays open"]
  each -- done --> commit["One transaction: save assignments,<br/>log activity"]
  commit --> reply["Agent reports filled, still open, and why"]
```

On the demo café the agent fills 28 of 30 shifts in about 15 seconds and
explains the two it left open: on Saturday, every barista is either
unavailable or would go over their max hours.

## Call-outs and cover

Staff text the bot in their own words. The integration plugin answers
`/start` invite codes, unknown senders, and plain YES/NO replies itself; the
staff agent handles everything else with seven staff-only tools.

```mermaid
sequenceDiagram
  autonumber
  actor Ana as Ana (staff)
  participant TG as Telegram
  participant I as integrations.ts
  participant SA as Staff agent
  participant RU as report-unavailable
  participant DB as Postgres
  actor Jonah as Jonah (teammate)
  participant B as Manager's board

  Ana->>TG: "Feeling awful, can't do Monday"
  TG->>I: webhook
  I->>I: known chat? not a /start or YES/NO
  I->>SA: run as Ana's staff identity
  SA->>SA: my-shifts: today's date, her shifts
  SA-->>Ana: "Do you mean Monday, November 9?"
  Ana->>SA: "Yes, Monday the 9th"
  SA->>RU: report-unavailable(date)
  RU->>DB: lock team, add availability, open her shift
  RU->>DB: rank candidates, create offers for the top 3
  RU-->>SA: who was asked
  RU-)TG: offers to Jonah and Sam
  RU-)B: change event, shift shows "asking 2"
  SA-->>Ana: "Done. Jonah Brooks and Sam Rivera have been asked."
  Jonah->>TG: "Yes!"
  TG->>I: webhook
  I->>I: YES matches, latest ask is an offer
  I->>DB: respondToOffer: lock team, re-check rules, assign
  I-)TG: "It's covered" to the others asked
  I-)B: change event, shift moves to Jonah and glows
  I-->>Jonah: "It's yours, Jonah!"
```

First yes wins because every answer takes the team row lock and re-checks the
shift. If everyone asked says no, `respondToOffer` opens the next round with
the next best people. The manager can also ask for cover from the agent
(`find-cover`, then `offer-shift`) or assign someone directly.

## Shift swaps

A staff member can trade a shift with a teammate. `find-swaps` only offers
trades that pass `checkSwap` for both people, the teammate agrees on Telegram,
and the manager approves on the board.

```mermaid
stateDiagram-v2
  [*] --> asked: request-swap
  asked --> agreed: teammate says yes
  asked --> declined: teammate says no
  asked --> closed: rules fail or a shift changed
  asked --> cancelled: requester cancels
  agreed --> approved: manager approves
  agreed --> rejected: manager turns it down
  agreed --> closed: stale at approval
  agreed --> cancelled: requester cancels
  approved --> [*]
  declined --> [*]
  rejected --> [*]
  closed --> [*]
  cancelled --> [*]
```

Approval re-checks the rules and swaps both shifts in one transaction under
the team lock, then closes any other open swap that involved either shift.
Both people get a confirmation. A YES or NO on Telegram answers whichever
question that person was sent last, a cover offer or a swap request
(`latestAsk` in `swaps.ts`).

## Identity and access

```mermaid
flowchart LR
  subgraph managers["Managers"]
    m1["Signed-in user<br/>email + active org"]
  end
  subgraph staffside["Staff"]
    s1["Telegram chat"] -- "/start code" --> s2["Linked staff row"]
    s2 --> s3["Secret principal<br/>random@staff.rota.invalid<br/>org: none"]
  end
  m1 -- "editor on the team" --> teamActions["Manager actions"]
  s3 -- "requireStaffCaller" --> staffTools["Staff actions<br/>own shifts and offers only"]
  s3 -. "no team access" .-> teamActions
```

- Teams are visible to the active organization when there is one, and private
  otherwise. Staff, shifts, and availability inherit the team's access.
  Manager actions declare `access: { scope: "resource", resource: { type: "team" } }`.
- Staff link their Telegram chat with a one-time invite code. Their messages
  run as a secret per-person principal with no organization, so every manager
  action refuses them. Staff actions look the person up from that principal
  and only touch their own shifts, offers, and swaps.
- The Telegram bot token is one deployment-wide credential. Outgoing Telegram
  calls run without a user attached (`server/lib/telegram-adapter.ts`), and
  Rota's actions decide what may be sent before they get there.

## What the agent sees

The board writes its state to the framework's application state, and the
agent reads it on every turn:

- `navigation`: the view, `teamId`, and `week`, in `<current-screen>`.
- `selection:<tab>`: `{kind: "shift", id}` for the shift the manager clicked.
  `view-screen` returns it as `selectedShift`, so "who can cover this?" works.
- `navigate` moves the board to a team and week.

## Live updates

Actions record a change event when they write, and screens subscribed with
`useDbSync` refetch within a second or two. Writes that come from the Telegram
shortcut call `notifyTeamChanged`. On the board, `useJustChanged` gives
shifts that changed while the board was open a short glow, and a "Rota is
working" pill shows while the agent runs.

## Messages to staff and automations

- `publish-week` sends each person their own shifts for the week.
- `send-shift-reminders` reminds everyone working on a date (tomorrow by
  default). `staff_notices` records what was sent, so reruns never send twice.
- The "Automate" menu asks the agent to create a schedule with the
  framework's `manage-automations`: for example every Friday "draft next
  week", or every evening "send reminders". Scheduled runs call the same
  actions.

## Deployment

```mermaid
flowchart LR
  gh["GitHub<br/>push to main"] --> build["Vercel build<br/>scripts/vercel-build.sh"]
  build -- "migrations via session pooler<br/>DATABASE_MIGRATION_URL :5432" --> supa[("Supabase Postgres")]
  build --> fn["Vercel functions<br/>Nitro server + React Router"]
  fn -- "queries via transaction pooler<br/>DATABASE_URL :6543" --> supa
  tgapi["Telegram Bot API"] -- "webhook + secret" --> fn
  fn --> tgapi
  fn --> openai["OpenAI"]
```

Environment (names only; values live in Vercel as sensitive variables):
`DATABASE_URL`, `DATABASE_MIGRATION_URL`, `OPENAI_API_KEY`,
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`,
`A2A_SECRET`, `APP_URL`, `DB_OP_TIMEOUT_MS`. Setup steps are in
[docs/ROADMAP.md](docs/ROADMAP.md#telegram-setup-once-per-deployment).

Local development uses PGlite in `data/pglite`, so it needs no database.

`patches/@agent-native__core@0.222.2.patch` fixes production stalls on
serverless Postgres: background writes are registered with Vercel's
`waitUntil` so an instance isn't frozen mid-statement, and a connection that
times out is replaced instead of reused. The details are in
[docs/ROADMAP.md](docs/ROADMAP.md#framework-patch-production-reliability).

## Code map

```text
actions/                 every operation (UI hooks, agent tools, staff tools)
app/routes/              roster.$teamId, staff.$teamId, activity.$teamId, chat
app/components/roster/   board, shift details, person sheet, swaps, Telegram connect
server/db/schema.ts      tables
server/plugins/db.ts     migrations
server/plugins/agent-chat.ts      manager agent: prompt and tools
server/plugins/integrations.ts    Telegram: invites, YES/NO shortcut, staff agent
server/lib/rules.ts      rule checker
server/lib/draft.ts      week draft
server/lib/cover.ts      cover offers and answers
server/lib/swaps.ts      swap requests and approvals
server/lib/notices.ts    published week and reminders
server/lib/activity.ts   activity log and change events
server/lib/telegram*.ts  invite codes, staff identity, bot adapter
scripts/smoke/           end-to-end checks against a running server
.agents/skills/          guides for coding agents, including demo-video
```

## Testing

- `pnpm test`: unit tests for the rule checker and the week draft
  (`server/lib/rules.test.ts`, `server/lib/draft.test.ts`).
- `scripts/smoke/*.cjs`: end-to-end runs against a dev server. They post fake
  Telegram updates for linking, call-outs, cover, and swaps, and check the
  database and replies.
- `pnpm typecheck` and `pnpm agent-native:doctor` (the framework's guards for
  access scoping, credentials, and migrations).
