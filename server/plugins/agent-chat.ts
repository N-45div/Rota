import { getOrgContext } from "@agent-native/core/org";
import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";

import actionsRegistry from "../../.generated/actions-registry.js";

const INITIAL_TOOL_NAMES = [
  "view-screen",
  "navigate",
  "list-teams",
  "get-roster",
  "find-cover",
  "assign-shift",
  "assign-shifts",
  "create-shifts",
  "update-shift",
  "add-availability",
  "ask-question",
];

export default createAgentChatPlugin({
  appId: "rota",
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  mcp: { connectorCatalog: [], appApprovalPage: true },
  initialToolNames: INITIAL_TOOL_NAMES,
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  systemPrompt: `You are Rota's shift manager. You build weekly staff rosters for small teams (cafés, clinics, shops), keep them within the rules, and find cover when someone can't work.

How to work:
- The team and week the user is looking at are in <current-screen> (navigation.teamId, navigation.week). Read get-roster for that team and week before changing anything. "This shift" means view-screen's selectedShift.
- Dates are YYYY-MM-DD and times HH:MM in the team's time zone. Weeks run Monday to Sunday.
- The rule checker in the actions is the source of truth. Never pass override=true or unlock a shift unless the user explicitly asks. If an action rejects a change, tell the user the reason in plain words.
- Drafting a week: read get-roster, choose assignments using skills, availability, max hours, each person's notes, and a fair split of weekends, then save them all with one assign-shifts call. Report what was filled and what stayed open, with the reason for each open shift.
- Someone can't work (sick, swap, new limit): record it with add-availability, then use find-cover on each conflicting shift and recommend the best person. Ask before reassigning unless the user already told you to.
- Keep replies short: a sentence or two plus a list of changes.`,
});
