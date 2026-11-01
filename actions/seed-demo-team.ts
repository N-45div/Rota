import { defineAction, fail } from "@agent-native/core/action";
import { buildDeepLink } from "@agent-native/core/server";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { requireUser, shiftWindow, STAFF_COLORS, type ShiftRecord, type StaffRecord } from "../server/lib/roster.js";
import { checkAssignment, formatRoles, hasBlocking, parseRoles, rankCandidates, type RuleAvailability } from "../server/lib/rules.js";
import { addDays, DATE_RE, isValidTimeZone, mondayOf, todayIn, zonedToUtcIso } from "../server/lib/time.js";

const PEOPLE = [
  { key: "maya", name: "Maya Chen", roles: ["barista", "opener"], maxHours: 32, notes: "Prefers mornings." },
  { key: "leo", name: "Leo Park", roles: ["kitchen"], maxHours: 40, notes: null },
  { key: "priya", name: "Priya Shah", roles: ["barista", "closer"], maxHours: 24, notes: "Student. Classes Tuesday and Thursday mornings." },
  { key: "sam", name: "Sam Rivera", roles: ["barista", "kitchen", "opener", "closer"], maxHours: 40, notes: "Shift lead. Can cover anything." },
  { key: "ana", name: "Ana Souza", roles: ["barista"], maxHours: 28, notes: null },
  { key: "jonah", name: "Jonah Brooks", roles: ["kitchen", "closer", "barista"], maxHours: 32, notes: "Wants more weekend hours." },
  { key: "zoe", name: "Zoe Kim", roles: ["barista", "opener"], maxHours: 20, notes: "Weekends only during term." },
] as const;

type Key = (typeof PEOPLE)[number]["key"];

const UNAVAILABLE: { who: Key; dayOfWeek: number; startTime?: string; endTime?: string; note: string }[] = [
  { who: "priya", dayOfWeek: 2, startTime: "06:00", endTime: "13:00", note: "class" },
  { who: "priya", dayOfWeek: 4, startTime: "06:00", endTime: "13:00", note: "class" },
  { who: "ana", dayOfWeek: 7, note: "family day" },
  ...[1, 2, 3, 4, 5].map((dayOfWeek) => ({ who: "zoe" as const, dayOfWeek, note: "college" })),
];

const WEEKDAY = [
  { role: "opener", start: "06:30", end: "14:30" },
  { role: "kitchen", start: "07:00", end: "15:00" },
  { role: "barista", start: "10:00", end: "15:00" },
  { role: "closer", start: "14:00", end: "20:00" },
];
const WEEKEND = [
  { role: "opener", start: "07:00", end: "15:00" },
  { role: "kitchen", start: "08:00", end: "16:00" },
  { role: "barista", start: "09:00", end: "17:00" },
  { role: "barista", start: "11:00", end: "16:00" },
  { role: "closer", start: "14:00", end: "20:00" },
];

export default defineAction({
  description:
    "Create a demo café team with seven staff, their availability, a filled roster for this week, and an open roster for next week. Use when the user wants to try the app or reset the demo.",
  schema: z.object({
    name: z.string().trim().min(1).max(80).default("Bean & Leaf Café").describe("Team name"),
    timezone: z.string().default("America/Los_Angeles").describe("IANA time zone for the café"),
    weekStart: z.string().regex(DATE_RE).optional().describe("Any date in the filled week, YYYY-MM-DD; defaults to this week"),
  }),
  link: ({ result }) => ({
    url: buildDeepLink({ view: "roster", to: `/roster/${encodeURIComponent(result.id)}` }),
    label: `Open ${result.name}`,
  }),
  run: async (args, ctx) => {
    const ownerEmail = requireUser(ctx);
    if (!isValidTimeZone(args.timezone)) fail(`Unknown time zone "${args.timezone}".`, { errorCode: "invalid_timezone" });
    const tz = args.timezone;
    const orgId = ctx?.orgId ?? null;
    const thisWeek = mondayOf(args.weekStart ?? todayIn(tz));
    const nextWeek = addDays(thisWeek, 7);

    const team = {
      id: crypto.randomUUID(),
      name: args.name,
      timezone: tz,
      ownerEmail,
      orgId,
      visibility: orgId ? ("org" as const) : ("private" as const),
    };
    const ids = Object.fromEntries(PEOPLE.map((p) => [p.key, crypto.randomUUID()])) as Record<Key, string>;
    const staffRows = PEOPLE.map((p, index) => ({
      id: ids[p.key],
      teamId: team.id,
      name: p.name,
      roles: formatRoles([...p.roles]),
      maxHours: p.maxHours,
      notes: p.notes,
      color: STAFF_COLORS[index % STAFF_COLORS.length] ?? null,
      ownerEmail,
      orgId,
    }));
    const availabilityRows = UNAVAILABLE.map((rule) => ({
      id: crypto.randomUUID(),
      teamId: team.id,
      staffId: ids[rule.who],
      dayOfWeek: rule.dayOfWeek,
      date: null,
      startTime: rule.startTime ?? null,
      endTime: rule.endTime ?? null,
      validFrom: null,
      validUntil: null,
      note: rule.note,
      ownerEmail,
      orgId,
    }));

    const buildWeek = (weekStart: string): ShiftRecord[] =>
      Array.from({ length: 7 }, (_, day) => addDays(weekStart, day)).flatMap((date, day) =>
        (day < 5 ? WEEKDAY : WEEKEND).map((slot) => {
          const { startDate, endDate } = shiftWindow(date, slot.start, slot.end);
          return {
            id: crypto.randomUUID(),
            role: slot.role,
            startsAt: zonedToUtcIso(startDate, slot.start, tz),
            endsAt: zonedToUtcIso(endDate, slot.end, tz),
            staffId: null,
            locked: false,
            note: null,
          };
        }),
      );

    // Fill this week with the same rules the app enforces: the best-ranked
    // eligible person for each shift, in time order.
    const ruleStaff: StaffRecord[] = staffRows.map((row) => ({
      id: row.id,
      name: row.name,
      roles: parseRoles(row.roles),
      maxHours: row.maxHours,
      active: true,
      notes: row.notes,
      color: row.color,
      hasTelegram: false,
    }));
    const ruleAvailability: RuleAvailability[] = availabilityRows;
    const current = buildWeek(thisWeek);
    for (const shift of current) {
      const [best] = rankCandidates({ shift, staff: ruleStaff, shifts: current, availability: ruleAvailability, timeZone: tz });
      if (best?.eligible) {
        const person = ruleStaff.find((p) => p.id === best.staffId)!;
        const violations = checkAssignment({ shift: { ...shift, staffId: person.id }, staff: person, shifts: current, availability: ruleAvailability, timeZone: tz });
        if (!hasBlocking(violations)) shift.staffId = person.id;
      }
    }
    const upcoming = buildWeek(nextWeek);

    await getDb().transaction(async (tx) => {
      await tx.insert(schema.teams).values(team);
      await tx.insert(schema.staff).values(staffRows);
      await tx.insert(schema.availability).values(availabilityRows);
      await tx
        .insert(schema.shifts)
        .values([...current, ...upcoming].map((shift) => ({ ...shift, teamId: team.id, ownerEmail, orgId })));
    });

    return {
      id: team.id,
      name: team.name,
      timezone: tz,
      thisWeek,
      nextWeek,
      staff: staffRows.length,
      filled: current.filter((s) => s.staffId).length,
      openThisWeek: current.filter((s) => !s.staffId).length,
      openNextWeek: upcoming.length,
    };
  },
});
