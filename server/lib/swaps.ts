// Shift swaps between two staff members.
//
//   1. A staff member asks on Telegram to trade one of their shifts for a
//      teammate's. Only swaps that pass the rule checker for both people can
//      be asked (find-swaps lists them).
//   2. The teammate answers YES or NO on Telegram.
//   3. The manager approves or rejects. Approval re-checks the rules and
//      changes both shifts in one transaction under the team row lock.
//
// Every write takes the team row lock, like other shift writes. Telegram
// messages go out after commit via deliver() from cover.ts.

import { fail } from "@agent-native/core/action";
import { and, desc, eq, inArray, or } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { logActivity, shiftLabel, type Actor } from "./activity.js";
import { describeShift, type Outgoing } from "./cover.js";
import { loadRosterContext, presentShift, type Executor, type RosterContext, type ShiftRecord } from "./roster.js";
import { checkSwap, hasBlocking, type Violation } from "./rules.js";
import type { LinkedStaff } from "./telegram.js";

const OPEN = ["asked", "agreed"] as const;
const DAY_MS = 86_400_000;
/** How far either side of the shift to look for swap partners. */
const WINDOW_DAYS = 14;

type Presented = ReturnType<typeof presentShift>;

interface SwapRow {
  id: string;
  teamId: string;
  requesterId: string;
  requesterShiftId: string;
  peerId: string;
  peerShiftId: string;
  status: string;
  note: string | null;
  createdAt: string;
}

interface TeamLocked {
  id: string;
  name: string;
  timezone: string;
  orgId: string | null;
  ownerEmail: string;
}

const SWAP_COLUMNS = {
  id: schema.swapRequests.id,
  teamId: schema.swapRequests.teamId,
  requesterId: schema.swapRequests.requesterId,
  requesterShiftId: schema.swapRequests.requesterShiftId,
  peerId: schema.swapRequests.peerId,
  peerShiftId: schema.swapRequests.peerShiftId,
  status: schema.swapRequests.status,
  note: schema.swapRequests.note,
  createdAt: schema.swapRequests.createdAt,
};

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

function firstName(name: string) {
  return name.split(" ")[0] ?? name;
}

/** "Thu, Nov 12 · 06:30–14:30 (8h) opener" for Telegram. */
function line(shift: Presented) {
  return `${describeShift(shift)} ${shift.role}`;
}

// guard:allow-unscoped — staff have no team access by design; callers pass a team id taken from the caller's own staff row or swap.
async function lockTeam(tx: Executor, teamId: string): Promise<TeamLocked> {
  const { teams } = schema;
  const [team] = await tx
    .select({ id: teams.id, name: teams.name, timezone: teams.timezone, orgId: teams.orgId, ownerEmail: teams.ownerEmail })
    .from(teams)
    .where(eq(teams.id, teamId))
    .for("update");
  if (!team) fail("Team not found.", { errorCode: "not_found", statusCode: 404 });
  return team;
}

async function shiftById(tx: Executor, id: string) {
  const [row] = await tx.select(SHIFT_COLUMNS).from(schema.shifts).where(eq(schema.shifts.id, id)).limit(1);
  return row ?? null;
}

async function people(tx: Executor, ids: string[]) {
  const { staff } = schema;
  const rows = await tx
    .select({ id: staff.id, name: staff.name, chatId: staff.telegramChatId, active: staff.active })
    .from(staff)
    .where(inArray(staff.id, ids));
  return new Map(rows.map((row) => [row.id, row]));
}

async function openSwapShiftIds(tx: Executor, teamId: string): Promise<Set<string>> {
  const rows = await tx
    .select({ a: schema.swapRequests.requesterShiftId, b: schema.swapRequests.peerShiftId })
    .from(schema.swapRequests)
    .where(and(eq(schema.swapRequests.teamId, teamId), inArray(schema.swapRequests.status, [...OPEN])))
    .limit(500);
  return new Set(rows.flatMap((row) => [row.a, row.b]));
}

function spanOf(a: { startsAt: string; endsAt: string }, b: { startsAt: string; endsAt: string }) {
  return {
    from: a.startsAt < b.startsAt ? a.startsAt : b.startsAt,
    to: a.endsAt > b.endsAt ? a.endsAt : b.endsAt,
  };
}

function problemsOf(violations: Violation[], override = false) {
  return violations.filter((v) => v.severity === "block" || (!override && v.severity === "override")).map((v) => v.message);
}

/**
 * Is this swap still possible right now? Returns why not, or the loaded
 * context and the rule check.
 */
async function currentState(tx: Executor, team: TeamLocked, swap: SwapRow) {
  const [aShift, bShift] = await Promise.all([shiftById(tx, swap.requesterShiftId), shiftById(tx, swap.peerShiftId)]);
  const now = new Date().toISOString();
  let stale: string | null = null;
  if (!aShift || !bShift || aShift.status !== "scheduled" || bShift.status !== "scheduled") stale = "one of the shifts was removed";
  else if (aShift.staffId !== swap.requesterId || bShift.staffId !== swap.peerId) stale = "the shifts changed since it was asked";
  else if (aShift.startsAt <= now || bShift.startsAt <= now) stale = "one of the shifts has already started";
  else if (aShift.locked || bShift.locked) stale = "the manager pinned one of the shifts";
  if (stale || !aShift || !bShift) return { stale: stale ?? "one of the shifts was removed" } as const;

  const span = spanOf(aShift, bShift);
  const ctx = await loadRosterContext(tx, team, span.from, span.to);
  const a = ctx.staff.find((p) => p.id === swap.requesterId);
  const b = ctx.staff.find((p) => p.id === swap.peerId);
  if (!a || !b) return { stale: "one of them isn't on the team anymore" } as const;
  const violations = checkSwap({
    a,
    aShift,
    b,
    bShift,
    shifts: ctx.shifts,
    availability: ctx.availability,
    timeZone: team.timezone,
  });
  return {
    stale: null,
    a,
    b,
    aShift: presentShift(aShift, team.timezone),
    bShift: presentShift(bShift, team.timezone),
    violations,
  } as const;
}

// ---------------------------------------------------------------------------
// Staff side (Telegram)

export interface SwapOption {
  theirShiftId: string;
  name: string;
  shift: string;
  sameRole: boolean;
  onTelegram: boolean;
  note: string | null;
}

/** Teammates' shifts the caller could swap `myShiftId` for, best first. */
export async function findSwapOptions(me: LinkedStaff, myShiftId: string) {
  const db = getDb();
  const mine = await shiftById(db, myShiftId);
  const now = new Date().toISOString();
  if (!mine || mine.teamId !== me.teamId || mine.staffId !== me.staffId || mine.status !== "scheduled") {
    fail("That isn't one of your shifts. Use my-shifts for the right id.", { errorCode: "not_found", statusCode: 404 });
  }
  if (mine.startsAt <= now) fail("That shift has already started.", { errorCode: "not_open", statusCode: 409 });
  if (mine.locked) fail("Your manager pinned that shift, so it can't be swapped. Ask them directly.", { errorCode: "shift_locked", statusCode: 409 });

  const { teams } = schema;
  // guard:allow-unscoped — the caller's own team, from their linked staff row.
  const [team] = await db
    .select({ id: teams.id, name: teams.name, timezone: teams.timezone, orgId: teams.orgId })
    .from(teams)
    .where(eq(teams.id, me.teamId))
    .limit(1);
  if (!team) fail("Team not found.", { errorCode: "not_found", statusCode: 404 });

  const busy = await openSwapShiftIds(db, team.id);
  if (busy.has(mine.id)) {
    fail("You already asked to swap that shift. Cancel that request first if you want a different swap.", {
      errorCode: "swap_pending",
      statusCode: 409,
    });
  }

  const from = new Date(Date.parse(mine.startsAt) - WINDOW_DAYS * DAY_MS).toISOString();
  const to = new Date(Date.parse(mine.endsAt) + WINDOW_DAYS * DAY_MS).toISOString();
  const ctx: RosterContext = await loadRosterContext(db, team, from, to);
  const a = ctx.staff.find((p) => p.id === me.staffId);
  if (!a) fail("You're not on this team anymore.", { errorCode: "forbidden", statusCode: 403 });
  const byId = new Map(ctx.staff.map((p) => [p.id, p]));

  const options = ctx.shifts
    .filter(
      (s): s is ShiftRecord & { staffId: string } =>
        s.id !== mine.id &&
        Boolean(s.staffId) &&
        s.staffId !== me.staffId &&
        !s.locked &&
        s.startsAt > now &&
        s.startsAt >= from &&
        s.startsAt <= to &&
        !busy.has(s.id),
    )
    .map((theirs) => {
      const b = byId.get(theirs.staffId);
      if (!b || !b.active) return null;
      const violations = checkSwap({
        a,
        aShift: mine,
        b,
        bShift: theirs,
        shifts: ctx.shifts,
        availability: ctx.availability,
        timeZone: team.timezone,
      });
      if (hasBlocking(violations)) return null;
      return {
        theirs,
        b,
        sameRole: theirs.role.toLowerCase() === mine.role.toLowerCase(),
        distance: Math.abs(Date.parse(theirs.startsAt) - Date.parse(mine.startsAt)),
        warnings: violations.filter((v) => v.severity === "warn").map((v) => v.message),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((x, y) => Number(y.sameRole) - Number(x.sameRole) || x.distance - y.distance);

  const askable = options.filter((o) => o.b.hasTelegram).slice(0, 5);
  return {
    myShift: { id: mine.id, ...withoutIds(presentShift(mine, team.timezone)) },
    options: askable.map(
      (o): SwapOption => ({
        theirShiftId: o.theirs.id,
        name: o.b.name,
        shift: line(presentShift(o.theirs, team.timezone)),
        sameRole: o.sameRole,
        onTelegram: true,
        note: o.warnings[0] ?? null,
      }),
    ),
    notOnTelegram: [...new Set(options.filter((o) => !o.b.hasTelegram).map((o) => o.b.name))],
  };
}

function withoutIds(shift: Presented) {
  const { id: _id, staffId: _staffId, locked: _locked, ...rest } = shift;
  return rest;
}

/** The caller asks a teammate to trade shifts. */
export async function requestSwap(me: LinkedStaff, myShiftId: string, theirShiftId: string, note?: string) {
  return getDb().transaction(async (tx) => {
    const team = await lockTeam(tx, me.teamId);
    const [mine, theirs] = await Promise.all([shiftById(tx, myShiftId), shiftById(tx, theirShiftId)]);
    const now = new Date().toISOString();
    if (!mine || mine.teamId !== team.id || mine.staffId !== me.staffId || mine.status !== "scheduled") {
      fail("That isn't one of your shifts. Use my-shifts for the right id.", { errorCode: "not_found", statusCode: 404 });
    }
    if (!theirs || theirs.teamId !== team.id || theirs.status !== "scheduled" || !theirs.staffId) {
      fail("That shift isn't on your team's roster. Use find-swaps for options.", { errorCode: "not_found", statusCode: 404 });
    }
    if (theirs.staffId === me.staffId) fail("Both shifts are already yours.", { errorCode: "invalid_swap", statusCode: 409 });
    if (mine.startsAt <= now || theirs.startsAt <= now) fail("One of those shifts has already started.", { errorCode: "not_open", statusCode: 409 });
    if (mine.locked || theirs.locked) fail("The manager pinned one of those shifts, so it can't be swapped.", { errorCode: "shift_locked", statusCode: 409 });
    const busy = await openSwapShiftIds(tx, team.id);
    if (busy.has(mine.id) || busy.has(theirs.id)) {
      fail("There's already a swap request for one of those shifts.", { errorCode: "swap_pending", statusCode: 409 });
    }

    const span = spanOf(mine, theirs);
    const ctx = await loadRosterContext(tx, team, span.from, span.to);
    const a = ctx.staff.find((p) => p.id === me.staffId);
    const b = ctx.staff.find((p) => p.id === theirs.staffId);
    if (!a || !b) fail("That person isn't on your team.", { errorCode: "not_found", statusCode: 404 });
    const violations = checkSwap({ a, aShift: mine, b, bShift: theirs, shifts: ctx.shifts, availability: ctx.availability, timeZone: team.timezone });
    if (hasBlocking(violations)) {
      fail(`That swap breaks a rule: ${problemsOf(violations).join(" ")}`, {
        errorCode: "rule_violation",
        statusCode: 409,
        details: { violations },
      });
    }
    const names = await people(tx, [b.id]);
    const peerChat = names.get(b.id)?.chatId;
    if (!peerChat) {
      fail(`${b.name} isn't on Telegram yet, so I can't ask them. Your manager can swap you directly.`, {
        errorCode: "not_on_telegram",
        statusCode: 409,
      });
    }

    const id = crypto.randomUUID();
    await tx.insert(schema.swapRequests).values({
      id,
      teamId: team.id,
      requesterId: a.id,
      requesterShiftId: mine.id,
      peerId: b.id,
      peerShiftId: theirs.id,
      status: "asked",
      note: note?.trim() || null,
      createdAt: now,
      ownerEmail: team.ownerEmail,
      orgId: team.orgId,
    });
    const aP = presentShift(mine, team.timezone);
    const bP = presentShift(theirs, team.timezone);
    await logActivity(tx, {
      teamId: team.id,
      actor: { kind: "staff", name: a.name },
      kind: "swap",
      text: `${a.name} asked ${b.name} to swap ${shiftLabel(aP)} for ${shiftLabel(bP)}${note?.trim() ? ` (${note.trim()})` : ""}`,
      shiftId: mine.id,
    });
    const messages: Outgoing[] = [
      {
        chatId: peerChat,
        text: [
          `Hi ${firstName(b.name)}! ${firstName(a.name)} would like to swap shifts with you.`,
          `You'd work: ${line(aP)}`,
          `Instead of: ${line(bP)}`,
          ...(note?.trim() ? [`${firstName(a.name)} says: "${note.trim()}"`] : []),
          "Reply YES to agree or NO to pass. Your manager confirms it after.",
        ].join("\n"),
      },
    ];
    return {
      swapId: id,
      teamId: team.id,
      peer: b.name,
      myShift: line(aP),
      theirShift: line(bP),
      warnings: violations.filter((v) => v.severity === "warn").map((v) => v.message),
      messages,
    };
  });
}

export type SwapAnswerOutcome = "agreed" | "declined" | "closed" | "no_swap";

/** The teammate answers their latest swap request (or a specific one). */
export async function respondToSwap(staffId: string, answer: "yes" | "no", swapId?: string) {
  const { swapRequests } = schema;
  const [pending] = await getDb()
    .select({ id: swapRequests.id, teamId: swapRequests.teamId })
    .from(swapRequests)
    .where(and(eq(swapRequests.peerId, staffId), eq(swapRequests.status, "asked"), ...(swapId ? [eq(swapRequests.id, swapId)] : [])))
    .orderBy(desc(swapRequests.createdAt))
    .limit(1);
  if (!pending) {
    return { outcome: "no_swap" as SwapAnswerOutcome, teamId: null, reply: "You don't have any swap requests waiting.", messages: [] as Outgoing[] };
  }

  return getDb().transaction(async (tx) => {
    const team = await lockTeam(tx, pending.teamId);
    const [swap] = await tx.select(SWAP_COLUMNS).from(swapRequests).where(eq(swapRequests.id, pending.id)).limit(1);
    if (!swap || swap.status !== "asked") {
      return { outcome: "closed" as SwapAnswerOutcome, teamId: team.id, reply: "That swap request was already closed.", messages: [] as Outgoing[] };
    }
    const who = await people(tx, [swap.requesterId, swap.peerId]);
    const requester = who.get(swap.requesterId);
    const peer = who.get(swap.peerId);
    const reqName = requester?.name ?? "Your teammate";
    const peerName = peer?.name ?? "Your teammate";
    const now = new Date().toISOString();
    const tell = (text: string): Outgoing[] => (requester?.chatId ? [{ chatId: requester.chatId, text }] : []);

    if (answer === "no") {
      await tx.update(swapRequests).set({ status: "declined", answeredAt: now }).where(eq(swapRequests.id, swap.id));
      await logActivity(tx, {
        teamId: team.id,
        actor: { kind: "staff", name: peerName },
        kind: "swap",
        text: `${peerName} said no to swapping with ${reqName}`,
        shiftId: swap.requesterShiftId,
      });
      return {
        outcome: "declined" as SwapAnswerOutcome,
        teamId: team.id,
        reply: `No problem, I'll let ${firstName(reqName)} know.`,
        messages: tell(`${firstName(peerName)} can't swap this time. Want me to look for another option?`),
      };
    }

    const state = await currentState(tx, team, swap);
    const blocked = state.stale !== null ? state.stale : hasBlocking(state.violations) ? problemsOf(state.violations).join(" ") : null;
    if (blocked !== null || state.stale !== null) {
      const reason = blocked ?? "it can't go ahead";
      await tx.update(swapRequests).set({ status: "closed", answeredAt: now, reason }).where(eq(swapRequests.id, swap.id));
      await logActivity(tx, {
        teamId: team.id,
        actor: { kind: "system", name: "Rota" },
        kind: "swap",
        text: `Closed ${reqName} and ${peerName}'s swap: ${reason}`,
        shiftId: swap.requesterShiftId,
      });
      return {
        outcome: "closed" as SwapAnswerOutcome,
        teamId: team.id,
        reply: `Thanks ${firstName(peerName)}, but that swap can't happen anymore: ${reason}.`,
        messages: tell(`Your swap with ${firstName(peerName)} is off: ${reason}.`),
      };
    }

    await tx.update(swapRequests).set({ status: "agreed", answeredAt: now }).where(eq(swapRequests.id, swap.id));
    await logActivity(tx, {
      teamId: team.id,
      actor: { kind: "staff", name: peerName },
      kind: "swap",
      text: `${peerName} agreed to swap with ${reqName}: ${shiftLabel(state.aShift)} for ${shiftLabel(state.bShift)}. Waiting for your approval`,
      shiftId: swap.requesterShiftId,
    });
    return {
      outcome: "agreed" as SwapAnswerOutcome,
      teamId: team.id,
      reply: `Thanks ${firstName(peerName)}! Your manager confirms swaps; I'll message you when it's done.`,
      messages: tell(`${firstName(peerName)} agreed to swap. Your manager will confirm it; I'll message you when it's done.`),
    };
  });
}

/** The requester withdraws their open swap request (latest, or a specific one). */
export async function cancelSwap(staffId: string, swapId?: string) {
  const { swapRequests } = schema;
  const [pending] = await getDb()
    .select({ id: swapRequests.id, teamId: swapRequests.teamId })
    .from(swapRequests)
    .where(
      and(
        eq(swapRequests.requesterId, staffId),
        inArray(swapRequests.status, [...OPEN]),
        ...(swapId ? [eq(swapRequests.id, swapId)] : []),
      ),
    )
    .orderBy(desc(swapRequests.createdAt))
    .limit(1);
  if (!pending) return { cancelled: false, teamId: null, reply: "You don't have an open swap request.", messages: [] as Outgoing[] };

  return getDb().transaction(async (tx) => {
    const team = await lockTeam(tx, pending.teamId);
    const [swap] = await tx.select(SWAP_COLUMNS).from(swapRequests).where(eq(swapRequests.id, pending.id)).limit(1);
    if (!swap || !(OPEN as readonly string[]).includes(swap.status)) {
      return { cancelled: false, teamId: team.id, reply: "That swap request is already closed.", messages: [] as Outgoing[] };
    }
    await tx.update(swapRequests).set({ status: "cancelled", decidedAt: new Date().toISOString() }).where(eq(swapRequests.id, swap.id));
    const who = await people(tx, [swap.requesterId, swap.peerId]);
    const reqName = who.get(swap.requesterId)?.name ?? "Someone";
    const peer = who.get(swap.peerId);
    await logActivity(tx, {
      teamId: team.id,
      actor: { kind: "staff", name: reqName },
      kind: "swap",
      text: `${reqName} withdrew their swap request with ${peer?.name ?? "a teammate"}`,
      shiftId: swap.requesterShiftId,
    });
    return {
      cancelled: true,
      teamId: team.id,
      reply: "Done, I've withdrawn your swap request.",
      messages: peer?.chatId ? [{ chatId: peer.chatId, text: `${firstName(reqName)} withdrew the swap request. Nothing changes for you.` }] : [],
    };
  });
}

// ---------------------------------------------------------------------------
// Manager side

/** Team id for a swap, so the manager action can check access first. */
export async function teamIdForSwap(swapId: string): Promise<string> {
  const [row] = await getDb()
    .select({ teamId: schema.swapRequests.teamId })
    .from(schema.swapRequests)
    .where(eq(schema.swapRequests.id, swapId))
    .limit(1);
  if (!row) fail("Swap request not found.", { errorCode: "not_found", statusCode: 404 });
  return row.teamId;
}

/**
 * Approve or reject a swap. The caller must have checked editor access to the
 * swap's team and hold no transaction.
 */
export async function decideSwap(input: {
  swapId: string;
  approve: boolean;
  override: boolean;
  actor: Actor;
  decidedBy: string;
}) {
  const { swapRequests, shifts } = schema;
  const teamId = await teamIdForSwap(input.swapId);
  return getDb().transaction(async (tx) => {
    const team = await lockTeam(tx, teamId);
    const [swap] = await tx.select(SWAP_COLUMNS).from(swapRequests).where(eq(swapRequests.id, input.swapId)).limit(1);
    if (!swap) fail("Swap request not found.", { errorCode: "not_found", statusCode: 404 });
    if (!(OPEN as readonly string[]).includes(swap.status)) {
      fail(`That swap is already ${swap.status}.`, { errorCode: "swap_closed", statusCode: 409 });
    }
    const who = await people(tx, [swap.requesterId, swap.peerId]);
    const requester = who.get(swap.requesterId);
    const peer = who.get(swap.peerId);
    const reqName = requester?.name ?? "Someone";
    const peerName = peer?.name ?? "a teammate";
    const now = new Date().toISOString();
    const both = (text: (first: string, other: string) => string): Outgoing[] =>
      [
        requester?.chatId ? { chatId: requester.chatId, text: text(firstName(reqName), firstName(peerName)) } : null,
        peer?.chatId ? { chatId: peer.chatId, text: text(firstName(peerName), firstName(reqName)) } : null,
      ].filter((m): m is Outgoing => m !== null);

    if (!input.approve) {
      await tx
        .update(swapRequests)
        .set({ status: "rejected", decidedAt: now, decidedBy: input.decidedBy })
        .where(eq(swapRequests.id, swap.id));
      await logActivity(tx, {
        teamId: team.id,
        actor: input.actor,
        kind: "swap",
        text: `Turned down ${reqName} and ${peerName}'s swap`,
        shiftId: swap.requesterShiftId,
      });
      return {
        outcome: "rejected" as const,
        teamId: team.id,
        summary: `Turned down the swap. ${reqName} and ${peerName} keep their shifts.`,
        warnings: [] as string[],
        messages: both((me, other) => `Hi ${me}, your manager kept the original shifts, so the swap with ${other} is off.`),
      };
    }

    if (swap.status === "asked") {
      fail(`${peerName} hasn't agreed yet. Approve after they reply, or turn it down.`, {
        errorCode: "waiting_for_teammate",
        statusCode: 409,
      });
    }

    const state = await currentState(tx, team, swap);
    if (state.stale !== null) {
      await tx
        .update(swapRequests)
        .set({ status: "closed", decidedAt: now, decidedBy: input.decidedBy, reason: state.stale })
        .where(eq(swapRequests.id, swap.id));
      await logActivity(tx, {
        teamId: team.id,
        actor: { kind: "system", name: "Rota" },
        kind: "swap",
        text: `Closed ${reqName} and ${peerName}'s swap: ${state.stale}`,
        shiftId: swap.requesterShiftId,
      });
      return {
        outcome: "closed" as const,
        teamId: team.id,
        summary: `That swap can't happen anymore: ${state.stale}. I closed it.`,
        warnings: [] as string[],
        messages: both((_me, other) => `Your swap with ${other} is off: ${state.stale}.`),
      };
    }
    if (hasBlocking(state.violations, input.override)) {
      fail(problemsOf(state.violations, input.override).join(" "), {
        errorCode: "rule_violation",
        statusCode: 409,
        details: { violations: state.violations },
      });
    }

    await tx.update(shifts).set({ staffId: swap.peerId, updatedAt: now }).where(eq(shifts.id, swap.requesterShiftId));
    await tx.update(shifts).set({ staffId: swap.requesterId, updatedAt: now }).where(eq(shifts.id, swap.peerShiftId));
    await tx
      .update(swapRequests)
      .set({ status: "approved", decidedAt: now, decidedBy: input.decidedBy })
      .where(eq(swapRequests.id, swap.id));
    // Close any other open requests that touched these two shifts.
    await tx
      .update(swapRequests)
      .set({ status: "closed", decidedAt: now, reason: "one of the shifts was swapped" })
      .where(
        and(
          eq(swapRequests.teamId, team.id),
          inArray(swapRequests.status, [...OPEN]),
          or(
            inArray(swapRequests.requesterShiftId, [swap.requesterShiftId, swap.peerShiftId]),
            inArray(swapRequests.peerShiftId, [swap.requesterShiftId, swap.peerShiftId]),
          ),
        ),
      );
    await logActivity(tx, {
      teamId: team.id,
      actor: input.actor,
      kind: "swap",
      text: `Approved the swap: ${reqName} now works ${shiftLabel(state.bShift)}, ${peerName} works ${shiftLabel(state.aShift)}${
        input.override ? " (rule overridden)" : ""
      }`,
      shiftId: swap.requesterShiftId,
    });
    const messages: Outgoing[] = [
      requester?.chatId
        ? { chatId: requester.chatId, text: `Swap approved! You now work ${line(state.bShift)} instead of ${line(state.aShift)}.` }
        : null,
      peer?.chatId
        ? { chatId: peer.chatId, text: `Swap approved! You now work ${line(state.aShift)} instead of ${line(state.bShift)}.` }
        : null,
    ].filter((m): m is Outgoing => m !== null);
    return {
      outcome: "approved" as const,
      teamId: team.id,
      summary: `Approved. ${reqName} now works ${shiftLabel(state.bShift)} and ${peerName} works ${shiftLabel(state.aShift)}.`,
      warnings: state.violations.filter((v) => v.severity === "warn").map((v) => v.message),
      messages,
    };
  });
}

// ---------------------------------------------------------------------------
// Reading swaps (board, agent, my-shifts)

export interface SwapView {
  id: string;
  status: string;
  createdAt: string;
  note: string | null;
  reason: string | null;
  requester: { id: string; name: string };
  peer: { id: string; name: string };
  requesterShift: Presented & { label: string };
  peerShift: Presented & { label: string };
}

/** Swaps for a team (open ones by default), with names and local times. */
export async function listSwaps(
  db: Executor,
  team: { id: string; timezone: string },
  options: { statuses?: string[]; staffId?: string; limit?: number } = {},
): Promise<SwapView[]> {
  const { swapRequests, staff } = schema;
  const statuses = options.statuses ?? [...OPEN];
  const rows = await db
    .select({ ...SWAP_COLUMNS, reason: swapRequests.reason })
    .from(swapRequests)
    .where(
      and(
        eq(swapRequests.teamId, team.id),
        inArray(swapRequests.status, statuses as (typeof swapRequests.status.enumValues)[number][]),
        ...(options.staffId
          ? [or(eq(swapRequests.requesterId, options.staffId), eq(swapRequests.peerId, options.staffId))]
          : []),
      ),
    )
    .orderBy(desc(swapRequests.createdAt))
    .limit(options.limit ?? 50);
  if (rows.length === 0) return [];
  const shiftIds = [...new Set(rows.flatMap((r) => [r.requesterShiftId, r.peerShiftId]))];
  const staffIds = [...new Set(rows.flatMap((r) => [r.requesterId, r.peerId]))];
  const [shiftRows, staffRows] = await Promise.all([
    db.select(SHIFT_COLUMNS).from(schema.shifts).where(inArray(schema.shifts.id, shiftIds)),
    db.select({ id: staff.id, name: staff.name }).from(staff).where(inArray(staff.id, staffIds)),
  ]);
  const shiftById = new Map(shiftRows.map((s) => [s.id, s]));
  const nameById = new Map(staffRows.map((s) => [s.id, s.name]));
  const now = new Date().toISOString();
  const present = (id: string) => {
    const s = shiftById.get(id);
    if (!s) return null;
    const p = presentShift(s, team.timezone);
    return { ...p, label: shiftLabel(p) };
  };
  return rows
    .map((row): SwapView | null => {
      const requesterShift = present(row.requesterShiftId);
      const peerShift = present(row.peerShiftId);
      if (!requesterShift || !peerShift) return null;
      // An open swap whose shift already started is dead; hide it until a write closes it.
      const open = (OPEN as readonly string[]).includes(row.status);
      if (open && (requesterShift.startsAt <= now || peerShift.startsAt <= now)) return null;
      return {
        id: row.id,
        status: row.status,
        createdAt: row.createdAt,
        note: row.note,
        reason: row.reason,
        requester: { id: row.requesterId, name: nameById.get(row.requesterId) ?? "Someone" },
        peer: { id: row.peerId, name: nameById.get(row.peerId) ?? "Someone" },
        requesterShift,
        peerShift,
      };
    })
    .filter((x): x is SwapView => x !== null);
}

/** Which question did this person get most recently: a cover offer or a swap request? */
export async function latestAsk(staffId: string): Promise<"offer" | "swap" | null> {
  const { coverOffers, swapRequests } = schema;
  const db = getDb();
  const [[offer], [swap]] = await Promise.all([
    db
      .select({ at: coverOffers.createdAt })
      .from(coverOffers)
      .where(and(eq(coverOffers.staffId, staffId), eq(coverOffers.status, "pending")))
      .orderBy(desc(coverOffers.createdAt))
      .limit(1),
    db
      .select({ at: swapRequests.createdAt })
      .from(swapRequests)
      .where(and(eq(swapRequests.peerId, staffId), eq(swapRequests.status, "asked")))
      .orderBy(desc(swapRequests.createdAt))
      .limit(1),
  ]);
  if (!offer && !swap) return null;
  if (!swap) return "offer";
  if (!offer) return "swap";
  return Date.parse(swap.at) > Date.parse(offer.at) ? "swap" : "offer";
}
