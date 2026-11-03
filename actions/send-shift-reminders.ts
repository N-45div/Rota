import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { sendReminders } from "../server/lib/notices.js";
import { requireTeam } from "../server/lib/roster.js";
import { addDays, DATE_RE, todayIn } from "../server/lib/time.js";

export default defineAction({
  description:
    "Remind everyone with a shift on a date (default: tomorrow in the team's time zone) on Telegram. Safe to run more than once: each person is reminded about each shift only once. Meant for a daily evening automation.",
  access: {
    scope: "resource",
    resource: { type: "team", idFrom: "teamId", level: "editor" },
  },
  schema: z.object({
    teamId: z.string().describe("Team id from list-teams"),
    date: z.string().regex(DATE_RE).optional().describe("Day to remind about, YYYY-MM-DD in the team's time zone; defaults to tomorrow"),
  }),
  run: async ({ teamId, date }) => {
    const team = await requireTeam(getDb(), teamId, { write: true });
    const [owner] = await getDb()
      .select({ ownerEmail: schema.teams.ownerEmail })
      .from(schema.teams)
      .where(eq(schema.teams.id, team.id))
      .limit(1);
    const day = date ?? addDays(todayIn(team.timezone), 1);
    const result = await sendReminders({ ...team, ownerEmail: owner!.ownerEmail }, day);
    return { teamId: team.id, ...result };
  },
});
