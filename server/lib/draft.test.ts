import { describe, expect, it } from "vitest";

import { draftWeek } from "./draft.js";
import { checkAssignment, hasBlocking, type RuleAvailability, type RuleShift, type RuleStaff } from "./rules.js";
import { addDays, localParts, zonedToUtcIso } from "./time.js";

const TZ = "America/Los_Angeles";
const WEEK = "2026-11-09";

const staff: RuleStaff[] = [
  { id: "maya", name: "Maya Chen", roles: ["barista", "opener"], maxHours: 32, active: true },
  { id: "leo", name: "Leo Park", roles: ["kitchen"], maxHours: 40, active: true },
  { id: "priya", name: "Priya Shah", roles: ["barista", "closer"], maxHours: 24, active: true },
  { id: "sam", name: "Sam Rivera", roles: ["barista", "kitchen", "opener", "closer"], maxHours: 40, active: true },
  { id: "ana", name: "Ana Souza", roles: ["barista"], maxHours: 28, active: true },
  { id: "jonah", name: "Jonah Brooks", roles: ["kitchen", "closer", "barista"], maxHours: 32, active: true },
  { id: "zoe", name: "Zoe Kim", roles: ["barista", "opener"], maxHours: 20, active: true },
];

const availability: RuleAvailability[] = [
  { id: "a1", staffId: "priya", dayOfWeek: 2, date: null, startTime: "06:00", endTime: "13:00", validFrom: null, validUntil: null, note: "class" },
  { id: "a2", staffId: "priya", dayOfWeek: 4, date: null, startTime: "06:00", endTime: "13:00", validFrom: null, validUntil: null, note: "class" },
  { id: "a3", staffId: "ana", dayOfWeek: 7, date: null, startTime: null, endTime: null, validFrom: null, validUntil: null, note: "family" },
  ...[1, 2, 3, 4, 5].map((d) => ({ id: `z${d}`, staffId: "zoe", dayOfWeek: d, date: null, startTime: null, endTime: null, validFrom: null, validUntil: null, note: "college" })),
];

const WEEKDAY = [["opener", "06:30", "14:30"], ["kitchen", "07:00", "15:00"], ["barista", "10:00", "15:00"], ["closer", "14:00", "20:00"]];
const WEEKEND = [["opener", "07:00", "15:00"], ["kitchen", "08:00", "16:00"], ["barista", "09:00", "17:00"], ["barista", "11:00", "16:00"], ["closer", "14:00", "20:00"]];

function week(): RuleShift[] {
  return Array.from({ length: 7 }, (_, d) => addDays(WEEK, d)).flatMap((date, d) =>
    (d < 5 ? WEEKDAY : WEEKEND).map(([role, start, end], i) => ({
      id: `${date}-${i}`,
      role: role!,
      startsAt: zonedToUtcIso(date, start!, TZ),
      endsAt: zonedToUtcIso(date, end!, TZ),
      staffId: null,
    })),
  );
}

describe("draftWeek", () => {
  it("fills the demo week without breaking a rule", () => {
    const shifts = week();
    const { assignments, unfilled } = draftWeek({ open: shifts, staff, shifts, availability, timeZone: TZ, preferences: [] });
    expect(assignments.length + unfilled.length).toBe(30);
    expect(assignments.length).toBeGreaterThanOrEqual(28);
    // Re-check every assignment against the final roster.
    const final = shifts.map((s) => ({ ...s, staffId: assignments.find((a) => a.shiftId === s.id)?.staffId ?? null }));
    for (const s of final.filter((x) => x.staffId)) {
      const person = staff.find((p) => p.id === s.staffId)!;
      expect(hasBlocking(checkAssignment({ shift: s, staff: person, shifts: final, availability, timeZone: TZ }))).toBe(false);
    }
    for (const u of unfilled) expect(u.reason.length).toBeGreaterThan(10);
  });

  it("honors preferences", () => {
    const shifts = week();
    const { assignments } = draftWeek({
      open: shifts,
      staff,
      shifts,
      availability,
      timeZone: TZ,
      preferences: [{ staffId: "maya", prefer: "mornings" }, { staffId: "jonah", prefer: "weekends" }],
    });
    const of = (id: string) => assignments.filter((a) => a.staffId === id).map((a) => shifts.find((s) => s.id === a.shiftId)!);
    const mayaShifts = of("maya");
    expect(mayaShifts.length).toBeGreaterThan(0);
    expect(mayaShifts.every((s) => localParts(s.startsAt, TZ).minutes < 12 * 60)).toBe(true);
    expect(of("jonah").filter((s) => localParts(s.startsAt, TZ).dayOfWeek >= 6).length).toBeGreaterThanOrEqual(2);
  });
});
