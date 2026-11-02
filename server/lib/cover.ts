// Cover offers: after a call-out, offer the open shift to the best eligible
// people on Telegram. The first "yes" that still passes the rules gets it.
//
// Database work happens inside the caller's transaction (holding the team row
// lock, like every other shift write). Telegram messages go out afterwards via
// deliver(), so a slow or failed send never holds the lock or rolls back data.

import { telegramAdapter } from "@agent-native/core/server";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { loadRosterContext, presentShift, type Executor, type ShiftRecord } from "./roster.js";
import { checkAssignment, hasBlocking, rankCandidates } from "./rules.js";

export const DEFAULT_OFFER_COUNT = 3;

export interface Outgoing {
  chatId: string;
  text: string;
  /** Offer whose delivery status to record. */
  offerId?: string;
}

export interface OfferRound {
  shift: ReturnType<typeof presentShift>;
  offeredTo: string[];
  /** Eligible people who haven't connected Telegram yet. */
  notOnTelegram: string[];
  messages: Outgoing[];
}

function dayText(date: string): string {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

export function describeShift(shift: ReturnType<typeof presentShift>): string {
  return `${dayText(shift.date)} · ${shift.start}–${shift.end}${shift.endsNextDay ? " (+1)" : ""} (${shift.hours}h)`;
}

function firstName(name: string) {
  return name.split(" ")[0] ?? name;
}

async function teamRow(tx: Executor, teamId: string) {
  const { teams } = schema;
  const [team] = await tx
    .select({ id: teams.id, name: teams.name, timezone: teams.timezone, orgId: teams.orgId, ownerEmail: teams.ownerEmail })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  return team ?? null;
}

const SHIFT_COLUMNS = {
  id: schema.shifts.id,
  teamId: schema.shifts.teamId,
  role: schema.shifts.role,
  startsAt: schema.shifts.startsAt,
  endsAt: schema.shifts.endsAt,
  staffId: schema.shifts.staffId,
  locked: schema.shifts.locked,
  note: schema.shifts.note,
  status: schema.shifts.status,
};

/**
 * Offer an open shift to the next best eligible people who are on Telegram
 * and haven't been asked yet. Call inside a transaction that holds the team
 * row lock. Returns null when the shift is no longer open.
 */
export async function createOffers(
  tx: Executor,
  teamId: string,
  shiftId: string,
  limit = DEFAULT_OFFER_COUNT,
): Promise<OfferRound | null> {
  const team = await teamRow(tx, teamId);
  if (!team) return null;
  const [shift] = await tx
    .select(SHIFT_COLUMNS)
    .from(schema.shifts)
    .where(and(eq(schema.shifts.id, shiftId), eq(schema.shifts.teamId, teamId)))
    .limit(1);
  if (!shift || shift.status !== "scheduled" || shift.staffId || shift.locked) return null;
  if (shift.startsAt <= new Date().toISOString()) return null;

  const record: ShiftRecord = { ...shift };
  const ctx = await loadRosterContext(tx, team, shift.startsAt, shift.endsAt);
  const ranked = rankCandidates({
    shift: record,
    staff: ctx.staff,
    shifts: ctx.shifts,
    availability: ctx.availability,
    timeZone: team.timezone,
  });

  const { coverOffers, staff } = schema;
  const asked = new Set(
    (await tx.select({ staffId: coverOffers.staffId }).from(coverOffers).where(eq(coverOffers.shiftId, shiftId))).map(
      (row) => row.staffId,
    ),
  );
  const eligible = ranked.filter((c) => c.eligible && !asked.has(c.staffId));
  const chats = eligible.length
    ? await tx
        .select({ id: staff.id, chatId: staff.telegramChatId })
        .from(staff)
        .where(and(inArray(staff.id, eligible.map((c) => c.staffId)), isNotNull(staff.telegramChatId)))
    : [];
  const chatById = new Map(chats.map((row) => [row.id, row.chatId as string]));

  const picked = eligible.filter((c) => chatById.has(c.staffId)).slice(0, limit);
  const presented = presentShift(record, team.timezone);
  const messages: Outgoing[] = [];
  for (const candidate of picked) {
    const offerId = crypto.randomUUID();
    await tx.insert(coverOffers).values({
      id: offerId,
      teamId,
      shiftId,
      staffId: candidate.staffId,
      ownerEmail: team.ownerEmail,
      orgId: team.orgId,
    });
    messages.push({
      offerId,
      chatId: chatById.get(candidate.staffId)!,
      text: `Hi ${firstName(candidate.name)}! Can you cover a ${shift.role} shift at ${team.name}?\n${describeShift(presented)}\nReply YES to take it or NO to pass.`,
    });
  }

  return {
    shift: presented,
    offeredTo: picked.map((c) => c.name),
    notOnTelegram: eligible.filter((c) => !chatById.has(c.staffId)).map((c) => c.name),
    messages,
  };
}

/** Send messages after the transaction commits, and record delivery. */
export async function deliver(messages: Outgoing[]): Promise<{ sent: number; failed: number }> {
  if (messages.length === 0) return { sent: 0, failed: 0 };
  const adapter = telegramAdapter();
  let sent = 0;
  let failed = 0;
  for (const message of messages) {
    let ok = false;
    try {
      await adapter.sendMessageToTarget?.({ text: message.text, platformContext: {} }, { destination: message.chatId });
      ok = Boolean(adapter.sendMessageToTarget);
    } catch (err) {
      console.error("[rota] Telegram send failed:", err instanceof Error ? err.message : err);
    }
    if (ok) sent += 1;
    else failed += 1;
    if (message.offerId) {
      await getDb()
        .update(schema.coverOffers)
        .set({ delivery: ok ? "sent" : "failed" })
        .where(eq(schema.coverOffers.id, message.offerId));
    }
  }
  return { sent, failed };
}

export type OfferOutcome = "assigned" | "taken" | "not_allowed" | "declined" | "no_offer" | "expired";

export interface OfferResponse {
  outcome: OfferOutcome;
  teamId: string | null;
  reply: string;
  shift: ReturnType<typeof presentShift> | null;
  /** Messages to send after commit: closing notes to others, next round. */
  messages: Outgoing[];
  nextRound: OfferRound | null;
}

/**
 * A staff member answers their latest pending offer (or a specific one).
 * Runs its own transaction with the team row lock.
 */
export async function respondToOffer(
  staffId: string,
  answer: "yes" | "no",
  offerId?: string,
): Promise<OfferResponse> {
  const { coverOffers, staff, shifts, teams } = schema;
  const db = getDb();
  const [offer] = await db
    .select({ id: coverOffers.id, teamId: coverOffers.teamId, shiftId: coverOffers.shiftId })
    .from(coverOffers)
    .where(
      and(
        eq(coverOffers.staffId, staffId),
        eq(coverOffers.status, "pending"),
        ...(offerId ? [eq(coverOffers.id, offerId)] : []),
      ),
    )
    .orderBy(desc(coverOffers.createdAt))
    .limit(1);
  if (!offer) {
    return {
      outcome: "no_offer",
      teamId: null,
      reply: "You don't have any open shift offers right now.",
      shift: null,
      messages: [],
      nextRound: null,
    };
  }

  return db.transaction(async (tx) => {
    // guard:allow-unscoped — staff have no team access by design; this person's own pending offer (looked up by their staffId above) is the authorization.
    const [team] = await tx
      .select({ id: teams.id, name: teams.name, timezone: teams.timezone, orgId: teams.orgId })
      .from(teams)
      .where(eq(teams.id, offer.teamId))
      .for("update");
    const [shift] = await tx.select(SHIFT_COLUMNS).from(shifts).where(eq(shifts.id, offer.shiftId)).limit(1);
    const [me] = await tx
      .select({ name: staff.name })
      .from(staff)
      .where(eq(staff.id, staffId))
      .limit(1);
    const now = new Date().toISOString();
    const close = (status: "accepted" | "declined" | "closed") =>
      tx.update(coverOffers).set({ status, respondedAt: now }).where(eq(coverOffers.id, offer.id));
    const name = firstName(me?.name ?? "there");

    if (!team || !shift || shift.status !== "scheduled") {
      await close("closed");
      return { outcome: "expired", teamId: offer.teamId, reply: "That shift was removed, so there's nothing to cover.", shift: null, messages: [], nextRound: null };
    }
    const presented = presentShift(shift, team.timezone);
    if (shift.startsAt <= now) {
      await close("closed");
      return { outcome: "expired", teamId: team.id, reply: "That shift has already started.", shift: presented, messages: [], nextRound: null };
    }

    if (answer === "no") {
      await close("declined");
      const [stillPending] = await tx
        .select({ id: coverOffers.id })
        .from(coverOffers)
        .where(and(eq(coverOffers.shiftId, shift.id), eq(coverOffers.status, "pending")))
        .limit(1);
      // Everyone asked so far said no: ask the next people in line.
      const nextRound = !stillPending && !shift.staffId ? await createOffers(tx, team.id, shift.id) : null;
      return {
        outcome: "declined",
        teamId: team.id,
        reply: `No problem, thanks for letting me know, ${name}.`,
        shift: presented,
        messages: nextRound?.messages ?? [],
        nextRound,
      };
    }

    if (shift.staffId) {
      await close("closed");
      return { outcome: "taken", teamId: team.id, reply: `Thanks ${name}! Someone already took that shift.`, shift: presented, messages: [], nextRound: null };
    }

    // Rules may have changed since the offer went out.
    const ctx = await loadRosterContext(tx, { id: team.id, name: team.name, timezone: team.timezone, orgId: team.orgId }, shift.startsAt, shift.endsAt);
    const person = ctx.staff.find((p) => p.id === staffId);
    const violations = person
      ? checkAssignment({ shift: { ...shift, staffId }, staff: person, shifts: ctx.shifts, availability: ctx.availability, timeZone: team.timezone })
      : [];
    if (!person || hasBlocking(violations)) {
      await close("closed");
      const reason = violations.filter((v) => v.severity !== "warn").map((v) => v.message).join(" ") || "You're not on this team anymore.";
      return { outcome: "not_allowed", teamId: team.id, reply: `Sorry ${name}, I can't give you that one. ${reason}`, shift: presented, messages: [], nextRound: null };
    }

    const note = shift.note ? `${shift.note} → covered by ${person.name}` : `Covered by ${person.name} via Telegram`;
    await tx.update(shifts).set({ staffId, note: note.slice(0, 200), updatedAt: now }).where(eq(shifts.id, shift.id));
    await close("accepted");

    // Tell everyone else who was asked that it's covered.
    const others = await tx
      .select({ id: coverOffers.id, chatId: staff.telegramChatId })
      .from(coverOffers)
      .innerJoin(staff, eq(staff.id, coverOffers.staffId))
      .where(and(eq(coverOffers.shiftId, shift.id), eq(coverOffers.status, "pending")));
    if (others.length) {
      await tx
        .update(coverOffers)
        .set({ status: "closed", respondedAt: now })
        .where(inArray(coverOffers.id, others.map((o) => o.id)));
    }
    const messages: Outgoing[] = others
      .filter((o) => o.chatId)
      .map((o) => ({ chatId: o.chatId as string, text: `Update: the ${shift.role} shift on ${describeShift(presented)} is covered now. Thanks!` }));

    return {
      outcome: "assigned",
      teamId: team.id,
      reply: `It's yours, ${name}! ${shift.role} · ${describeShift({ ...presented, staffId })}. Thanks for covering.`,
      shift: { ...presented, staffId },
      messages,
      nextRound: null,
    };
  });
}

/** Pending offers per shift, for the board. */
export async function offersForShifts(db: Executor, shiftIds: string[]) {
  if (shiftIds.length === 0) return new Map<string, { staffName: string; status: string; delivery: string }[]>();
  const { coverOffers, staff } = schema;
  const rows = await db
    .select({ shiftId: coverOffers.shiftId, staffName: staff.name, status: coverOffers.status, delivery: coverOffers.delivery })
    .from(coverOffers)
    .innerJoin(staff, eq(staff.id, coverOffers.staffId))
    .where(inArray(coverOffers.shiftId, shiftIds))
    .orderBy(coverOffers.createdAt)
    .limit(500);
  const map = new Map<string, { staffName: string; status: string; delivery: string }[]>();
  for (const row of rows) {
    const { shiftId, ...rest } = row;
    map.set(shiftId, [...(map.get(shiftId) ?? []), rest]);
  }
  return map;
}
