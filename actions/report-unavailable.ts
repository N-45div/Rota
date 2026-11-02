import { defineAction, fail } from "@agent-native/core/action";
import { and, eq, gt, lt } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { createOffers, deliver, type OfferRound } from "../server/lib/cover.js";
import { presentShift } from "../server/lib/roster.js";
import { checkAssignment, describeRule, type RuleAvailability } from "../server/lib/rules.js";
import { requireStaffCaller } from "../server/lib/telegram.js";
import { addDays, DATE_RE, parseHhMm, TIME_RE, todayIn, zonedToUtcIso } from "../server/lib/time.js";

// guard:allow-resource-action-access — authorized by the caller's own staff identity (requireStaffCaller), which only reaches that person's shifts; staff have no team access by design.
export default defineAction({
  description:
    "Staff only (Telegram): record that the caller can't work on a date (sick, emergency, appointment). Their shifts that clash become open on the manager's board, and the best eligible teammates are asked on Telegram to cover. Confirm the date with them first; use my-shifts for today's date.",
  schema: z.object({
    date: z.string().regex(DATE_RE).describe("The day they can't work, YYYY-MM-DD in the team's time zone"),
    startTime: z.string().regex(TIME_RE).optional().describe("Only from this time, HH:MM; omit for the whole day"),
    endTime: z.string().regex(TIME_RE).optional().describe("Only until this time, HH:MM; omit for the whole day"),
    reason: z.string().trim().min(1).max(200).describe('Short reason in their words, e.g. "sick"'),
  }),
  mcpTool: false,
  changeResource: (_input, result) =>
    result ? { resourceType: "team", resourceId: (result as { teamId: string }).teamId } : null,
  run: async (args, ctx) => {
    const me = await requireStaffCaller(ctx);
    const tz = me.timezone;
    const today = todayIn(tz);
    if (args.date < today) fail("That date has already passed.", { errorCode: "invalid_date" });
    if (args.date > addDays(today, 90)) fail("That's more than 90 days away; ask your manager.", { errorCode: "invalid_date" });
    if ((args.startTime === undefined) !== (args.endTime === undefined)) {
      fail("Give both a start and end time, or neither for the whole day.", { errorCode: "invalid_rule" });
    }
    if (args.startTime && args.endTime && parseHhMm(args.endTime) <= parseHhMm(args.startTime)) {
      fail("The end time must be after the start time.", { errorCode: "invalid_rule" });
    }

    const { teams, shifts, availability } = schema;
    const outcome = await getDb().transaction(async (tx) => {
      // Same team-row lock as the manager's shift writes, so a cover
      // assignment and a call-out can't interleave.
      const [team] = await tx
        .select({ id: teams.id, orgId: teams.orgId, ownerEmail: teams.ownerEmail })
        .from(teams)
        .where(eq(teams.id, me.teamId))
        .for("update");
      if (!team) fail("Team not found.", { errorCode: "not_found", statusCode: 404 });

      const rule: RuleAvailability = {
        id: crypto.randomUUID(),
        staffId: me.staffId,
        dayOfWeek: null,
        date: args.date,
        startTime: args.startTime ?? null,
        endTime: args.endTime ?? null,
        validFrom: null,
        validUntil: null,
        note: args.reason,
      };
      await tx.insert(availability).values({ ...rule, teamId: team.id, ownerEmail: team.ownerEmail, orgId: team.orgId });

      // Their shifts touching that date (a closing shift can spill into it).
      const from = zonedToUtcIso(addDays(args.date, -1), "00:00", tz);
      const to = zonedToUtcIso(addDays(args.date, 1), "00:00", tz);
      const mine = await tx
        .select({
          id: shifts.id,
          role: shifts.role,
          startsAt: shifts.startsAt,
          endsAt: shifts.endsAt,
          staffId: shifts.staffId,
          locked: shifts.locked,
          note: shifts.note,
        })
        .from(shifts)
        .where(and(eq(shifts.staffId, me.staffId), eq(shifts.status, "scheduled"), gt(shifts.endsAt, from), lt(shifts.startsAt, to)));

      const person = { id: me.staffId, name: me.staffName, roles: [], maxHours: 1000, active: true };
      const clashing = mine.filter((shift) =>
        checkAssignment({ shift, staff: person, shifts: [shift], availability: [rule], timeZone: tz }).some(
          (v) => v.code === "unavailable",
        ),
      );

      const opened = [];
      const pinned = [];
      const now = new Date().toISOString();
      for (const shift of clashing) {
        if (shift.locked) {
          // The manager pinned this one; leave it for them to decide.
          pinned.push(presentShift(shift, tz));
          continue;
        }
        const note = `${me.staffName} can't work: ${args.reason}`;
        await tx.update(shifts).set({ staffId: null, note, updatedAt: now }).where(eq(shifts.id, shift.id));
        opened.push(presentShift({ ...shift, staffId: null, note }, tz));
      }

      // Ask the best eligible teammates on Telegram, inside the same lock.
      const rounds: OfferRound[] = [];
      for (const shift of opened) {
        const round = await createOffers(tx, team.id, shift.id);
        if (round) rounds.push(round);
      }

      return {
        teamId: team.id,
        name: me.staffName,
        recorded: describeRule(rule),
        opened,
        pinnedForManager: pinned,
        rounds,
      };
    });

    // Send after the transaction commits.
    await deliver(outcome.rounds.flatMap((round) => round.messages));
    const askedNames = [...new Set(outcome.rounds.flatMap((round) => round.offeredTo))];
    const offline = [...new Set(outcome.rounds.flatMap((round) => round.notOnTelegram))];
    const { rounds: _rounds, ...result } = outcome;
    const cover = askedNames.length
      ? ` and asked ${askedNames.join(", ")} on Telegram`
      : offline.length
        ? `; ${offline.join(", ")} could cover but aren't on Telegram, so the manager will arrange it`
        : "; nobody else is free and qualified, so the manager will arrange cover";
    return {
      ...result,
      askedToCover: askedNames,
      summary:
        result.opened.length + result.pinnedForManager.length === 0
          ? "Noted. They had no shifts at that time."
          : `Opened ${result.opened.length} shift(s) for cover${result.opened.length ? cover : ""}${
              result.pinnedForManager.length ? `; ${result.pinnedForManager.length} pinned shift(s) left for the manager` : ""
            }.`,
    };
  },
});
