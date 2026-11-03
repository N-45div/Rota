// Messages Rota sends to staff on Telegram outside of cover offers: the
// published week and night-before reminders. Each is recorded in
// staff_notices so reminders never go out twice.

import { and, eq, max } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { sendTelegram } from "./cover.js";
import { loadRosterContext, presentShift, type TeamRow } from "./roster.js";
import { round } from "./rules.js";
import { addDays, localParts, weekBounds } from "./time.js";

function dayText(date: string, opts: Intl.DateTimeFormatOptions) {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

const firstName = (name: string) => name.split(" ")[0] ?? name;

async function linkedStaff(teamId: string) {
  const { staff } = schema;
  const rows = await getDb()
    .select({ id: staff.id, name: staff.name, chatId: staff.telegramChatId, active: staff.active })
    .from(staff)
    .where(eq(staff.teamId, teamId))
    .limit(200);
  return rows.filter((row) => row.active);
}

/** When this week was last sent to staff, or null. */
export async function weekPublishedAt(teamId: string, weekStart: string): Promise<string | null> {
  const { staffNotices } = schema;
  const [row] = await getDb()
    .select({ at: max(staffNotices.sentAt) })
    .from(staffNotices)
    .where(and(eq(staffNotices.teamId, teamId), eq(staffNotices.kind, "week"), eq(staffNotices.ref, weekStart)));
  return row?.at ?? null;
}

/** Send each connected person their shifts for the week. */
export async function publishWeek(team: TeamRow & { ownerEmail: string }, weekStart: string) {
  const tz = team.timezone;
  const weekEnd = addDays(weekStart, 6);
  const { from, to } = weekBounds(weekStart, tz);
  const ctx = await loadRosterContext(getDb(), team, from, to);
  const range = `${dayText(weekStart, { month: "short", day: "numeric" })}–${dayText(weekEnd, { month: "short", day: "numeric" })}`;
  const inWeek = ctx.shifts
    .map((s) => presentShift(s, tz))
    .filter((s) => s.date >= weekStart && s.date <= weekEnd)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const people = await linkedStaff(team.id);

  const sentTo: string[] = [];
  const failed: string[] = [];
  const notOnTelegram: string[] = [];
  for (const person of people) {
    if (!person.chatId) {
      notOnTelegram.push(person.name);
      continue;
    }
    const mine = inWeek.filter((s) => s.staffId === person.id);
    const lines = mine.map(
      (s) => `${dayText(s.date, { weekday: "short", day: "numeric" })} · ${s.start}–${s.end}${s.endsNextDay ? " (+1)" : ""} ${s.role}`,
    );
    const hours = round(mine.reduce((sum, s) => sum + s.hours, 0));
    const text = mine.length
      ? `Hi ${firstName(person.name)}! Your shifts at ${team.name}, ${range}:\n${lines.join("\n")}\nTotal ${hours}h. If you can't make one, just tell me here.`
      : `Hi ${firstName(person.name)}! You have no shifts at ${team.name} for ${range}.`;
    const ok = await sendTelegram(person.chatId, text);
    (ok ? sentTo : failed).push(person.name);
    const now = new Date().toISOString();
    await getDb()
      .insert(schema.staffNotices)
      .values({
        id: crypto.randomUUID(),
        teamId: team.id,
        staffId: person.id,
        kind: "week",
        ref: weekStart,
        sentAt: now,
        delivery: ok ? "sent" : "failed",
        ownerEmail: team.ownerEmail,
        orgId: team.orgId,
      })
      .onConflictDoUpdate({
        target: [schema.staffNotices.staffId, schema.staffNotices.kind, schema.staffNotices.ref],
        set: { sentAt: now, delivery: ok ? "sent" : "failed" },
      });
  }
  return {
    range,
    sentTo,
    failed,
    notOnTelegram,
    openShifts: inWeek.filter((s) => !s.staffId).length,
  };
}

/**
 * Remind everyone working on `date` (team time). Safe to run more than once:
 * a sent reminder is never repeated, and a failed one is retried next run.
 */
export async function sendReminders(team: TeamRow & { ownerEmail: string }, date: string) {
  const tz = team.timezone;
  const { from, to } = weekBounds(date, tz);
  const ctx = await loadRosterContext(getDb(), team, from, to);
  const people = new Map((await linkedStaff(team.id)).map((p) => [p.id, p]));
  const todays = ctx.shifts
    .filter((s) => s.staffId && localParts(s.startsAt, tz).date === date)
    .map((s) => presentShift(s, tz));
  const label = dayText(date, { weekday: "long", month: "short", day: "numeric" });

  let sent = 0;
  let already = 0;
  const failed: string[] = [];
  const notOnTelegram: string[] = [];
  for (const shift of todays) {
    const person = people.get(shift.staffId!);
    if (!person) continue;
    if (!person.chatId) {
      notOnTelegram.push(person.name);
      continue;
    }
    // Claim the reminder first, so a second run (or a concurrent one) skips it.
    const claimed = await getDb()
      .insert(schema.staffNotices)
      .values({
        id: crypto.randomUUID(),
        teamId: team.id,
        staffId: person.id,
        kind: "reminder",
        ref: shift.id,
        ownerEmail: team.ownerEmail,
        orgId: team.orgId,
      })
      .onConflictDoNothing()
      .returning({ id: schema.staffNotices.id });
    if (claimed.length === 0) {
      already += 1;
      continue;
    }
    const ok = await sendTelegram(
      person.chatId,
      `Reminder: you work ${label}, ${shift.start}–${shift.end}${shift.endsNextDay ? " (+1)" : ""} as ${shift.role} at ${team.name}. If you can't make it, reply here.`,
    );
    if (ok) sent += 1;
    else {
      // Release the claim so the next run tries again.
      failed.push(person.name);
      await getDb().delete(schema.staffNotices).where(eq(schema.staffNotices.id, claimed[0]!.id));
    }
  }
  return { date, shifts: todays.length, sent, alreadyReminded: already, failed, notOnTelegram: [...new Set(notOnTelegram)] };
}

