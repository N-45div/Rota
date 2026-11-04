// The Activity feed: plain-language entries for what the manager, Rota, and
// staff did on a team. Logging never blocks or fails the change it describes.

import { recordChange } from "@agent-native/core/server";
import { desc, eq } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import type { Executor } from "./roster.js";

export type ActorKind = "manager" | "agent" | "staff" | "system";

export interface Actor {
  kind: ActorKind;
  name: string;
}

/** Who is calling an action: the agent (tool/automation/MCP), or the signed-in manager. */
export function actorFromCtx(ctx: { caller?: string; userEmail?: string | null } | undefined): Actor {
  if (ctx?.caller === "tool" || ctx?.caller === "automation" || ctx?.caller === "mcp" || ctx?.caller === "a2a") {
    return { kind: "agent", name: "Rota" };
  }
  return { kind: "manager", name: ctx?.userEmail ?? "Manager" };
}

export const ROTA: Actor = { kind: "agent", name: "Rota" };

export async function logActivity(
  db: Executor,
  entry: { teamId: string; actor: Actor; kind: string; text: string; shiftId?: string | null },
): Promise<void> {
  try {
    const { teams } = schema;
    const [team] = await db
      .select({ ownerEmail: teams.ownerEmail, orgId: teams.orgId })
      .from(teams)
      .where(eq(teams.id, entry.teamId))
      .limit(1);
    if (!team) return;
    await db.insert(schema.activity).values({
      id: crypto.randomUUID(),
      teamId: entry.teamId,
      at: new Date().toISOString(),
      actorKind: entry.actor.kind,
      actorName: entry.actor.name,
      kind: entry.kind,
      text: entry.text.slice(0, 400),
      shiftId: entry.shiftId ?? null,
      ownerEmail: team.ownerEmail,
      orgId: team.orgId,
    });
  } catch (err) {
    console.error("[rota] activity log failed:", err instanceof Error ? err.message : err);
  }
}

/**
 * Tell open screens a team changed when the write didn't go through an action
 * (the Telegram YES/NO fast path, linking). Actions publish this themselves.
 */
export function notifyTeamChanged(teamId: string | null | undefined): void {
  if (!teamId) return;
  try {
    recordChange({ source: "action", type: "change", key: "telegram", resourceType: "team", resourceId: teamId });
  } catch (err) {
    console.error("[rota] change notify failed:", err instanceof Error ? err.message : err);
  }
}

export async function recentActivity(teamId: string, limit = 100) {
  const { activity } = schema;
  return getDb()
    .select({
      id: activity.id,
      at: activity.at,
      actorKind: activity.actorKind,
      actorName: activity.actorName,
      kind: activity.kind,
      text: activity.text,
      shiftId: activity.shiftId,
    })
    .from(activity)
    .where(eq(activity.teamId, teamId))
    .orderBy(desc(activity.at))
    .limit(limit);
}

/** "Tue, Nov 4" for a YYYY-MM-DD date. */
export function dayText(date: string): string {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d, 12)),
  );
}

/** "Tue, Nov 4 06:30 opener" for activity text. */
export function shiftLabel(shift: { date: string; start: string; role: string }): string {
  return `${dayText(shift.date)} ${shift.start} ${shift.role}`;
}
