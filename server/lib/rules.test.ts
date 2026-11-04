import { describe, expect, it } from "vitest";

import {
  checkAssignment,
  checkSwap,
  hasBlocking,
  rankCandidates,
  type RuleAvailability,
  type RuleShift,
  type RuleStaff,
} from "./rules.js";
import { localParts, mondayOf, weekBounds, zonedToUtcIso } from "./time.js";

const TZ = "America/New_York";

function shift(id: string, date: string, start: string, end: string, staffId: string | null, role = "barista"): RuleShift {
  const endDate = end <= start ? nextDay(date) : date;
  return {
    id,
    role,
    startsAt: zonedToUtcIso(date, start, TZ),
    endsAt: zonedToUtcIso(endDate, end, TZ),
    staffId,
  };
}

function nextDay(date: string) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const maya: RuleStaff = { id: "maya", name: "Maya", roles: ["barista", "opener"], maxHours: 16, active: true };
const leo: RuleStaff = { id: "leo", name: "Leo", roles: ["kitchen"], maxHours: 40, active: true };

describe("time helpers", () => {
  it("round-trips local time across a DST change", () => {
    // US DST ends Sunday 2026-11-01.
    expect(localParts(zonedToUtcIso("2026-10-31", "07:00", TZ), TZ).time).toBe("07:00");
    expect(localParts(zonedToUtcIso("2026-11-02", "07:00", TZ), TZ).time).toBe("07:00");
    expect(zonedToUtcIso("2026-11-02", "07:00", TZ)).toBe("2026-11-02T12:00:00.000Z");
  });

  it("finds the Monday of a week and its bounds", () => {
    expect(mondayOf("2026-11-05")).toBe("2026-11-02");
    expect(mondayOf("2026-11-08")).toBe("2026-11-02");
    expect(weekBounds("2026-11-02", TZ).from).toBe("2026-11-02T05:00:00.000Z");
  });
});

describe("checkAssignment", () => {
  it("allows a clean assignment", () => {
    const s = shift("s1", "2026-11-02", "07:00", "15:00", null);
    expect(checkAssignment({ shift: s, staff: maya, shifts: [s], availability: [], timeZone: TZ })).toEqual([]);
  });

  it("blocks double-booking", () => {
    const a = shift("a", "2026-11-02", "07:00", "15:00", "maya");
    const b = shift("b", "2026-11-02", "12:00", "18:00", null);
    const v = checkAssignment({ shift: b, staff: maya, shifts: [a, b], availability: [], timeZone: TZ });
    expect(v.map((x) => x.code)).toContain("double_booked");
    expect(hasBlocking(v, true)).toBe(true);
  });

  it("needs an override for a missing skill", () => {
    const s = shift("s", "2026-11-02", "07:00", "15:00", null, "barista");
    const v = checkAssignment({ shift: s, staff: leo, shifts: [s], availability: [], timeZone: TZ });
    expect(v.map((x) => x.code)).toEqual(["missing_skill"]);
    expect(hasBlocking(v)).toBe(true);
    expect(hasBlocking(v, true)).toBe(false);
  });

  it("respects weekly and date-specific unavailability", () => {
    const sunday = shift("s", "2026-11-08", "09:00", "17:00", null);
    const weekly: RuleAvailability = {
      id: "r1", staffId: "maya", dayOfWeek: 7, date: null, startTime: null, endTime: null,
      validFrom: null, validUntil: null, note: "no Sundays",
    };
    expect(checkAssignment({ shift: sunday, staff: maya, shifts: [sunday], availability: [weekly], timeZone: TZ }).map((x) => x.code)).toContain("unavailable");

    const morningOnly: RuleAvailability = { ...weekly, id: "r2", dayOfWeek: 7, startTime: "18:00", endTime: "23:00" };
    expect(checkAssignment({ shift: sunday, staff: maya, shifts: [sunday], availability: [morningOnly], timeZone: TZ })).toEqual([]);

    const expired: RuleAvailability = { ...weekly, id: "r3", validUntil: "2026-11-01" };
    expect(checkAssignment({ shift: sunday, staff: maya, shifts: [sunday], availability: [expired], timeZone: TZ })).toEqual([]);
  });

  it("catches a closing shift that crosses into an unavailable morning", () => {
    const close = shift("c", "2026-11-03", "18:00", "01:00", null);
    const wedMorning: RuleAvailability = {
      id: "r", staffId: "maya", dayOfWeek: 3, date: null, startTime: "00:00", endTime: "06:00",
      validFrom: null, validUntil: null, note: null,
    };
    expect(checkAssignment({ shift: close, staff: maya, shifts: [close], availability: [wedMorning], timeZone: TZ }).map((x) => x.code)).toContain("unavailable");
  });

  it("flags going over max hours and short rest", () => {
    const mon = shift("m", "2026-11-02", "07:00", "15:00", "maya");
    const tueClose = shift("t", "2026-11-03", "15:00", "23:00", "maya");
    const wedOpen = shift("w", "2026-11-04", "06:00", "10:00", null);
    const v = checkAssignment({ shift: wedOpen, staff: maya, shifts: [mon, tueClose, wedOpen], availability: [], timeZone: TZ });
    expect(v.map((x) => x.code).sort()).toEqual(["over_max_hours", "short_rest"]);
  });
});

describe("rankCandidates", () => {
  it("puts eligible people with fewer hours first", () => {
    const ana: RuleStaff = { id: "ana", name: "Ana", roles: ["barista"], maxHours: 40, active: true };
    const busy = shift("x", "2026-11-03", "07:00", "15:00", "ana");
    const open = shift("o", "2026-11-04", "07:00", "15:00", null);
    const ranked = rankCandidates({ shift: open, staff: [ana, maya, leo], shifts: [busy, open], availability: [], timeZone: TZ });
    expect(ranked.map((c) => [c.name, c.eligible])).toEqual([
      ["Maya", true],
      ["Ana", true],
      ["Leo", false],
    ]);
  });
});

describe("checkSwap", () => {
  const zoe: RuleStaff = { id: "zoe", name: "Zoe", roles: ["barista"], maxHours: 40, active: true };

  it("counts the shift each person gives away, so a full week can still swap", () => {
    // Maya is at her 16h max; trading 8h for 8h keeps her at 16h.
    const shifts = [
      shift("mon", "2026-11-09", "07:00", "15:00", "maya"),
      shift("tue", "2026-11-10", "07:00", "15:00", "maya"),
      shift("wed", "2026-11-11", "07:00", "15:00", "zoe"),
    ];
    const plain = checkAssignment({ shift: { ...shifts[2]!, staffId: "maya" }, staff: maya, shifts, availability: [], timeZone: TZ });
    expect(plain.map((v) => v.code)).toContain("over_max_hours");
    const swap = checkSwap({ a: maya, aShift: shifts[1]!, b: zoe, bShift: shifts[2]!, shifts, availability: [], timeZone: TZ });
    expect(hasBlocking(swap)).toBe(false);
  });

  it("refuses a swap that double-books either person", () => {
    const shifts = [
      shift("maya-tue", "2026-11-10", "07:00", "15:00", "maya"),
      shift("maya-wed", "2026-11-11", "12:00", "18:00", "maya"),
      shift("zoe-wed", "2026-11-11", "07:00", "15:00", "zoe"),
    ];
    const swap = checkSwap({ a: maya, aShift: shifts[0]!, b: zoe, bShift: shifts[2]!, shifts, availability: [], timeZone: TZ });
    expect(swap.find((v) => v.code === "double_booked")?.message).toContain("Maya");
    expect(hasBlocking(swap, true)).toBe(true);
  });

  it("flags a missing skill on either side", () => {
    const shifts = [
      shift("leo-mon", "2026-11-09", "07:00", "15:00", "leo", "kitchen"),
      shift("zoe-tue", "2026-11-10", "07:00", "15:00", "zoe"),
    ];
    const swap = checkSwap({ a: leo, aShift: shifts[0]!, b: zoe, bShift: shifts[1]!, shifts, availability: [], timeZone: TZ });
    expect(swap.filter((v) => v.code === "missing_skill").map((v) => v.message)).toEqual([
      "Leo isn't trained as barista.",
      "Zoe isn't trained as kitchen.",
    ]);
  });
});
