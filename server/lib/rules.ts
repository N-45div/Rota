// The rule checker. Pure functions over in-memory rows so the same checks run
// in write actions (inside a transaction), in find-cover, and in tests.
//
// Severity:
//   block    never allowed (double-booking, inactive staff)
//   override allowed only when the manager explicitly overrides
//   warn     allowed, but shown on the board

import { hoursBetween, localParts, mondayOf, parseHhMm } from "./time.js";

export interface RuleStaff {
  id: string;
  name: string;
  roles: string[];
  maxHours: number;
  active: boolean;
}

export interface RuleShift {
  id: string;
  role: string;
  startsAt: string;
  endsAt: string;
  staffId: string | null;
}

export interface RuleAvailability {
  id: string;
  staffId: string;
  dayOfWeek: number | null;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  validFrom: string | null;
  validUntil: string | null;
  note: string | null;
}

export type ViolationCode =
  | "inactive"
  | "double_booked"
  | "missing_skill"
  | "unavailable"
  | "over_max_hours"
  | "short_rest";

export type Severity = "block" | "override" | "warn";

export interface Violation {
  code: ViolationCode;
  severity: Severity;
  message: string;
}

export const MIN_REST_HOURS = 10;

export function parseRoles(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((role) => role.trim().toLowerCase())
    .filter(Boolean);
}

export function formatRoles(roles: string[]): string {
  return [...new Set(roles.map((role) => role.trim().toLowerCase()).filter(Boolean))].join(",");
}

interface Segment {
  date: string;
  dayOfWeek: number;
  from: number;
  to: number;
}

// Split a shift into per-local-day segments (a closing shift can cross
// midnight).
function segments(shift: Pick<RuleShift, "startsAt" | "endsAt">, timeZone: string): Segment[] {
  const start = localParts(shift.startsAt, timeZone);
  const end = localParts(shift.endsAt, timeZone);
  if (start.date === end.date) {
    return [{ date: start.date, dayOfWeek: start.dayOfWeek, from: start.minutes, to: end.minutes }];
  }
  const result: Segment[] = [
    { date: start.date, dayOfWeek: start.dayOfWeek, from: start.minutes, to: 1440 },
  ];
  if (end.minutes > 0) {
    result.push({ date: end.date, dayOfWeek: end.dayOfWeek, from: 0, to: end.minutes });
  }
  return result;
}

function ruleApplies(rule: RuleAvailability, segment: Segment): boolean {
  if (rule.validFrom && segment.date < rule.validFrom) return false;
  if (rule.validUntil && segment.date > rule.validUntil) return false;
  if (rule.date && rule.date !== segment.date) return false;
  if (!rule.date && rule.dayOfWeek !== segment.dayOfWeek) return false;
  if (!rule.startTime || !rule.endTime) return true;
  const from = parseHhMm(rule.startTime);
  const to = parseHhMm(rule.endTime);
  return segment.from < to && segment.to > from;
}

export function describeRule(rule: RuleAvailability): string {
  const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const when = rule.date ?? `every ${DAYS[rule.dayOfWeek ?? 0] ?? "?"}`;
  const window = rule.startTime && rule.endTime ? ` ${rule.startTime}–${rule.endTime}` : "";
  return rule.note ? `${when}${window} (${rule.note})` : `${when}${window}`;
}

function overlaps(a: Pick<RuleShift, "startsAt" | "endsAt">, b: Pick<RuleShift, "startsAt" | "endsAt">) {
  return a.startsAt < b.endsAt && a.endsAt > b.startsAt;
}

/** Hours `staffId` works in the local week (Mon-Sun) containing `date`. */
export function weeklyHours(
  staffId: string,
  shifts: RuleShift[],
  weekStart: string,
  timeZone: string,
  excludeShiftId?: string,
): number {
  let total = 0;
  for (const shift of shifts) {
    if (shift.staffId !== staffId || shift.id === excludeShiftId) continue;
    if (mondayOf(localParts(shift.startsAt, timeZone).date) !== weekStart) continue;
    total += hoursBetween(shift.startsAt, shift.endsAt);
  }
  return total;
}

export interface CheckInput {
  shift: RuleShift;
  staff: RuleStaff;
  /** Every scheduled shift in the surrounding window, including `shift`. */
  shifts: RuleShift[];
  availability: RuleAvailability[];
  timeZone: string;
}

/** Problems with putting `staff` on `shift`, given the other shifts. */
export function checkAssignment({ shift, staff, shifts, availability, timeZone }: CheckInput): Violation[] {
  const violations: Violation[] = [];
  const others = shifts.filter((other) => other.id !== shift.id && other.staffId === staff.id);

  if (!staff.active) {
    violations.push({ code: "inactive", severity: "block", message: `${staff.name} is not active.` });
  }

  const clash = others.find((other) => overlaps(other, shift));
  if (clash) {
    const start = localParts(clash.startsAt, timeZone);
    const end = localParts(clash.endsAt, timeZone);
    violations.push({
      code: "double_booked",
      severity: "block",
      message: `${staff.name} already works ${clash.role} ${start.date} ${start.time}–${end.time}.`,
    });
  }

  if (!staff.roles.includes(shift.role.toLowerCase())) {
    violations.push({
      code: "missing_skill",
      severity: "override",
      message: `${staff.name} isn't trained as ${shift.role}.`,
    });
  }

  const segs = segments(shift, timeZone);
  const blocked = availability.find(
    (rule) => rule.staffId === staff.id && segs.some((segment) => ruleApplies(rule, segment)),
  );
  if (blocked) {
    violations.push({
      code: "unavailable",
      severity: "override",
      message: `${staff.name} is unavailable ${describeRule(blocked)}.`,
    });
  }

  const weekStart = mondayOf(localParts(shift.startsAt, timeZone).date);
  const hours = weeklyHours(staff.id, shifts, weekStart, timeZone, shift.id) + hoursBetween(shift.startsAt, shift.endsAt);
  if (hours > staff.maxHours) {
    violations.push({
      code: "over_max_hours",
      severity: "override",
      message: `${staff.name} would work ${round(hours)}h this week (max ${staff.maxHours}h).`,
    });
  }

  for (const other of others) {
    if (overlaps(other, shift)) continue;
    const gap =
      other.endsAt <= shift.startsAt
        ? hoursBetween(other.endsAt, shift.startsAt)
        : hoursBetween(shift.endsAt, other.startsAt);
    if (gap < MIN_REST_HOURS) {
      violations.push({
        code: "short_rest",
        severity: "warn",
        message: `Only ${round(gap)}h rest between ${staff.name}'s shifts (aim for ${MIN_REST_HOURS}h).`,
      });
      break;
    }
  }

  return violations;
}

export function hasBlocking(violations: Violation[], override = false): boolean {
  return violations.some(
    (violation) => violation.severity === "block" || (!override && violation.severity === "override"),
  );
}

export interface Candidate {
  staffId: string;
  name: string;
  eligible: boolean;
  weekHours: number;
  maxHours: number;
  violations: Violation[];
}

/**
 * Everyone who could take `shift`, best first: eligible people before
 * ineligible ones, then fewest hours this week, then name.
 */
export function rankCandidates(input: Omit<CheckInput, "staff"> & { staff: RuleStaff[] }): Candidate[] {
  const weekStart = mondayOf(localParts(input.shift.startsAt, input.timeZone).date);
  return input.staff
    .filter((person) => person.id !== input.shift.staffId)
    .map((person) => {
      const violations = checkAssignment({ ...input, staff: person });
      return {
        staffId: person.id,
        name: person.name,
        eligible: !hasBlocking(violations),
        weekHours: round(weeklyHours(person.id, input.shifts, weekStart, input.timeZone)),
        maxHours: person.maxHours,
        violations,
      };
    })
    .sort(
      (a, b) =>
        Number(b.eligible) - Number(a.eligible) ||
        a.weekHours - b.weekHours ||
        a.name.localeCompare(b.name),
    );
}

export interface SwapInput {
  /** The person asking, and the shift they give up. */
  a: RuleStaff;
  aShift: RuleShift;
  /** The teammate, and the shift they give up. */
  b: RuleStaff;
  bShift: RuleShift;
  shifts: RuleShift[];
  availability: RuleAvailability[];
  timeZone: string;
}

/**
 * Check a swap as one change: `a` takes `bShift` and `b` takes `aShift` at
 * the same time, so each person's hours and overlaps count the shift they
 * give away as gone.
 */
export function checkSwap({ a, aShift, b, bShift, shifts, availability, timeZone }: SwapInput): Violation[] {
  const after = shifts.map((shift) =>
    shift.id === aShift.id ? { ...shift, staffId: b.id } : shift.id === bShift.id ? { ...shift, staffId: a.id } : shift,
  );
  return [
    ...checkAssignment({ shift: { ...bShift, staffId: a.id }, staff: a, shifts: after, availability, timeZone }),
    ...checkAssignment({ shift: { ...aShift, staffId: b.id }, staff: b, shifts: after, availability, timeZone }),
  ];
}

export function round(value: number): number {
  return Math.round(value * 10) / 10;
}
