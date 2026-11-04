import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { actorFromCtx, logActivity } from "../server/lib/activity.js";
import { publishWeek } from "../server/lib/notices.js";
import { requireTeam } from "../server/lib/roster.js";
import { DATE_RE, mondayOf } from "../server/lib/time.js";

export default defineAction({
  description:
    "Send every staff member who is connected on Telegram their own shifts for a week, with total hours. Sending again after changes sends the updated week. Only do this when the manager asks to publish or send the week; it messages real people.",
  access: {
    scope: "resource",
    resource: { type: "team", idFrom: "teamId", level: "editor" },
  },
  schema: z.object({
    teamId: z.string().describe("Team id from list-teams"),
    weekStart: z.string().regex(DATE_RE).describe("Any date in the week, YYYY-MM-DD in the team's time zone"),
  }),
  changeResource: (input) => ({ resourceType: "team", resourceId: input.teamId }),
  run: async ({ teamId, weekStart }, ctx) => {
    const team = await requireTeam(getDb(), teamId, { write: true });
    const [owner] = await getDb()
      .select({ ownerEmail: schema.teams.ownerEmail })
      .from(schema.teams)
      .where(eq(schema.teams.id, team.id))
      .limit(1);
    const week = mondayOf(weekStart);
    const result = await publishWeek({ ...team, ownerEmail: owner!.ownerEmail }, week);
    await logActivity(getDb(), {
      teamId: team.id,
      actor: actorFromCtx(ctx),
      kind: "publish",
      text: `Sent ${result.range} to ${result.sentTo.length} people on Telegram`,
    });
    return {
      teamId: team.id,
      weekStart: week,
      ...result,
      summary: `Sent ${result.range} to ${result.sentTo.length} people on Telegram${
        result.failed.length ? `; couldn't reach ${result.failed.join(", ")}` : ""
      }${result.notOnTelegram.length ? `; not on Telegram: ${result.notOnTelegram.join(", ")}` : ""}${
        result.openShifts ? `. ${result.openShifts} shift(s) are still open.` : "."
      }`,
    };
  },
});
