# Visual Design Contract

Rota is a warm, café-floor scheduling board. The roster is the canvas; the
agent works beside it in the AgentSidebar, and staff reach it through Telegram.

## Product mode

- Mode: `operate`
- Audience and cadence: managers of small hospitality and retail teams, checking
  and changing the week several times a day, often on a phone.
- Primary workflow: see the week at a glance, fill or fix shifts (by hand or
  with the agent), and handle call-outs and swaps without leaving the board.

## Visual direction

- Direction name: Warm hospitality
- Palette family: cream background, tomato primary (`--primary`), espresso
  foreground; tokens live in `app/global.css` with an espresso dark theme. Each
  staff member keeps their own color for their shifts.
- Type treatment: Fraunces (`font-display`) for page titles and the wordmark,
  the system sans for everything else; tabular numbers for times and hours.
- Composition: sidebar with Roster, Team, Activity, and Ask Rota; the board is
  staff rows × Mon–Sun with an open-shifts lane on top. Team is a card grid;
  Activity is a timeline grouped by day.
- Shape language: rounded cards and chips, soft borders, small colored bars
  for people, tomato used sparingly for primary actions and agent presence.
- Agent presence: the "Rota is working" pill, a brief glow on shifts that
  change while the board is open, and sparkle icons on agent actions.
- Anti-references: dense spreadsheet grids, cold blue SaaS chrome, modal-heavy
  flows, and controls that duplicate what the agent can already do.

## Guardrails

- Use the semantic tokens in `app/global.css`; don't hard-code colors outside
  staff colors.
- Every write goes through actions and the rule checker; the UI acknowledges
  within 100 ms and shows the server's reason when a rule blocks a change.
- Keep the board usable at phone width (no page-level horizontal scroll).
- Keep contextual AI in the AgentSidebar; full-page chat stays at `/chat`.
