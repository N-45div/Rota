// Drafting a week: fill open shifts in one pass, using the same rule checker
// as every other write. Pure function over in-memory rows so it is fast,
// testable, and commits atomically in the calling action.
//
// Order: the hardest shifts first (fewest eligible people), so easy shifts
// don't use up the only person who can do a hard one.
// Choice: lowest score wins. The score is the share of their max hours the
// person would work, minus a bonus when the shift matches a stated preference,
// plus a penalty when it doesn't (so their hours are saved for shifts they
// asked for), small penalties for extra weekend shifts, and for short rest.

import {
  checkAssignment,
  hasBlocking,
  rankCandidates,
  round,
  weeklyHours,
  type RuleAvailability,
  type RuleShift,
  type RuleStaff,
} from "./rules.js";
import { hoursBetween, localParts, mondayOf } from "./time.js";

export type Preference = "mornings" | "evenings" | "weekdays" | "weekends";

export interface DraftInput {
  /** Open shifts to fill (staffId null, not locked). */
  open: RuleShift[];
  staff: RuleStaff[];
  /** Every scheduled shift around the week, including `open`. */
  shifts: RuleShift[];
  availability: RuleAvailability[];
  timeZone: string;
  preferences: { staffId: string; prefer: Preference }[];
}

export interface DraftResult {
  assignments: { shiftId: string; staffId: string }[];
  unfilled: { shiftId: string; reason: string }[];
}

function traits(shift: RuleShift, timeZone: string) {
  const start = localParts(shift.startsAt, timeZone);
  const end = localParts(shift.endsAt, timeZone);
  return {
    morning: start.minutes < 12 * 60,
    evening: start.minutes >= 14 * 60 || end.minutes >= 18 * 60 || end.date !== start.date,
    weekend: start.dayOfWeek >= 6,
  };
}

function matches(prefer: Preference, t: ReturnType<typeof traits>) {
  switch (prefer) {
    case "mornings":
      return t.morning;
    case "evenings":
      return t.evening;
    case "weekends":
      return t.weekend;
    case "weekdays":
      return !t.weekend;
  }
}

/** One plain sentence on why nobody could take a shift. */
export function unfilledReason(shift: RuleShift, staff: RuleStaff[], shifts: RuleShift[], availability: RuleAvailability[], timeZone: string): string {
  const role = shift.role.toLowerCase();
  const trained = staff.filter((p) => p.active && p.roles.includes(role));
  if (trained.length === 0) return `Nobody is trained as ${shift.role}.`;
  const ranked = rankCandidates({ shift, staff: trained, shifts, availability, timeZone });
  const why = ranked
    .slice(0, 4)
    .map((c) => {
      const v = c.violations.find((x) => x.severity !== "warn");
      const short =
        v?.code === "over_max_hours"
          ? "would go over max hours"
          : v?.code === "unavailable"
            ? "unavailable"
            : v?.code === "double_booked"
              ? "already working then"
              : v?.code === "inactive"
                ? "inactive"
                : "not available";
      return `${c.name.split(" ")[0]} ${short}`;
    })
    .join(", ");
  return `Everyone trained as ${shift.role} is busy: ${why}.`;
}

export function draftWeek(input: DraftInput): DraftResult {
  const { staff, availability, timeZone } = input;
  // Work on copies so callers keep their arrays.
  const shifts = input.shifts.map((s) => ({ ...s }));
  const byId = new Map(shifts.map((s) => [s.id, s]));
  const prefs = new Map<string, Preference[]>();
  for (const p of input.preferences) prefs.set(p.staffId, [...(prefs.get(p.staffId) ?? []), p.prefer]);

  const eligibleCount = (shift: RuleShift) =>
    staff.filter((person) => !hasBlocking(checkAssignment({ shift, staff: person, shifts, availability, timeZone }))).length;

  const queue = input.open
    .map((s) => byId.get(s.id)!)
    .filter(Boolean)
    .map((shift) => ({ shift, count: eligibleCount(shift) }))
    .sort((a, b) => a.count - b.count || a.shift.startsAt.localeCompare(b.shift.startsAt));

  const weekendCount = new Map<string, number>();
  const assignments: DraftResult["assignments"] = [];
  const unfilled: DraftResult["unfilled"] = [];

  for (const { shift } of queue) {
    const t = traits(shift, timeZone);
    const weekStart = mondayOf(localParts(shift.startsAt, timeZone).date);
    let best: { person: RuleStaff; score: number } | null = null;

    for (const person of staff) {
      const violations = checkAssignment({ shift: { ...shift, staffId: person.id }, staff: person, shifts, availability, timeZone });
      if (hasBlocking(violations)) continue;
      const share = (weeklyHours(person.id, shifts, weekStart, timeZone) + hoursBetween(shift.startsAt, shift.endsAt)) / person.maxHours;
      const mine = prefs.get(person.id) ?? [];
      const liked = mine.some((p) => matches(p, t));
      const wantsWeekends = mine.includes("weekends");
      let score = share;
      if (liked) score -= 0.5;
      else if (mine.length > 0) score += 0.3;
      if (t.weekend && !wantsWeekends) score += 0.15 * (weekendCount.get(person.id) ?? 0);
      if (violations.some((v) => v.severity === "warn")) score += 0.3;
      if (!best || score < best.score || (score === best.score && person.name < best.person.name)) best = { person, score };
    }

    if (best) {
      shift.staffId = best.person.id;
      assignments.push({ shiftId: shift.id, staffId: best.person.id });
      if (t.weekend) weekendCount.set(best.person.id, (weekendCount.get(best.person.id) ?? 0) + 1);
    } else {
      unfilled.push({ shiftId: shift.id, reason: unfilledReason(shift, staff, shifts, availability, timeZone) });
    }
  }

  return { assignments, unfilled };
}

/** Hours per person in the week after the draft, for the summary. */
export function hoursSummary(staff: RuleStaff[], shifts: RuleShift[], weekStart: string, timeZone: string) {
  return staff.map((p) => ({ name: p.name, hours: round(weeklyHours(p.id, shifts, weekStart, timeZone)), maxHours: p.maxHours }));
}
