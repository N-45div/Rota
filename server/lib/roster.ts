import { fail } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq, gt, lt } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import {
  parseRoles,
  round,
  type RuleAvailability,
  type RuleShift,
  type RuleStaff,
} from "./rules.js";
import { addDays, hoursBetween, localParts } from "./time.js";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Executor = Db | Tx;

export interface TeamRow {
  id: string;
  name: string;
  timezone: string;
  orgId: string | null;
}

/**
 * Load a team the caller can access, or fail with 404. Pass `forUpdate` inside
 * a transaction to lock the team row: every write that changes assignments
 * takes this lock first, so concurrent writers for one team run one at a time
 * and the rule checker always sees the latest shifts.
 */
export async function requireTeam(
  db: Executor,
  teamId: string,
  options: { forUpdate?: boolean; write?: boolean } = {},
): Promise<TeamRow> {
  const { teams, teamShares } = schema;
  const query = db
    .select({ id: teams.id, name: teams.name, timezone: teams.timezone, orgId: teams.orgId })
    .from(teams)
    .where(
      and(
        eq(teams.id, teamId),
        accessFilter(teams, teamShares, undefined, options.write ? "editor" : "viewer"),
      ),
    );
  const [team] = options.forUpdate ? await query.for("update") : await query.limit(1);
  if (!team) fail("Team not found.", { errorCode: "not_found", statusCode: 404 });
  return team;
}

/** Find the team that owns a shift, so shift-keyed actions can check access. */
export async function teamIdForShift(db: Executor, shiftId: string): Promise<string> {
  const [row] = await db
    .select({ teamId: schema.shifts.teamId })
    .from(schema.shifts)
    .where(eq(schema.shifts.id, shiftId))
    .limit(1);
  if (!row) fail("Shift not found.", { errorCode: "not_found", statusCode: 404 });
  return row.teamId;
}

export async function teamIdForStaff(db: Executor, staffId: string): Promise<string> {
  const [row] = await db
    .select({ teamId: schema.staff.teamId })
    .from(schema.staff)
    .where(eq(schema.staff.id, staffId))
    .limit(1);
  if (!row) fail("Staff member not found.", { errorCode: "not_found", statusCode: 404 });
  return row.teamId;
}

export interface StaffRecord extends RuleStaff {
  notes: string | null;
  color: string | null;
  hasTelegram: boolean;
}

export interface ShiftRecord extends RuleShift {
  locked: boolean;
  note: string | null;
}

export interface RosterContext {
  staff: StaffRecord[];
  shifts: ShiftRecord[];
  availability: RuleAvailability[];
}

/**
 * Staff, availability, and scheduled shifts around [from, to). The window is
 * padded by a day on each side so rest-gap checks see neighbouring shifts.
 */
export async function loadRosterContext(
  db: Executor,
  team: TeamRow,
  from: string,
  to: string,
): Promise<RosterContext> {
  const { staff, shifts, availability } = schema;
  const paddedFrom = new Date(Date.parse(from) - 86_400_000 * 2).toISOString();
  const paddedTo = new Date(Date.parse(to) + 86_400_000 * 2).toISOString();

  const [staffRows, shiftRows, availabilityRows] = await Promise.all([
    db
      .select({
        id: staff.id,
        name: staff.name,
        roles: staff.roles,
        maxHours: staff.maxHours,
        active: staff.active,
        notes: staff.notes,
        color: staff.color,
        telegramChatId: staff.telegramChatId,
      })
      .from(staff)
      .where(eq(staff.teamId, team.id))
      .orderBy(staff.name)
      .limit(200),
    db
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
      .where(
        and(
          eq(shifts.teamId, team.id),
          eq(shifts.status, "scheduled"),
          lt(shifts.startsAt, paddedTo),
          gt(shifts.endsAt, paddedFrom),
        ),
      )
      .orderBy(shifts.startsAt)
      .limit(1000),
    db
      .select({
        id: availability.id,
        staffId: availability.staffId,
        dayOfWeek: availability.dayOfWeek,
        date: availability.date,
        startTime: availability.startTime,
        endTime: availability.endTime,
        validFrom: availability.validFrom,
        validUntil: availability.validUntil,
        note: availability.note,
      })
      .from(availability)
      .where(eq(availability.teamId, team.id))
      .limit(1000),
  ]);

  return {
    staff: staffRows.map(({ telegramChatId, ...row }) => ({
      ...row,
      roles: parseRoles(row.roles),
      hasTelegram: Boolean(telegramChatId),
    })),
    shifts: shiftRows,
    availability: availabilityRows,
  };
}

/** A shift as the UI and agent see it: local date and HH:MM in the team zone. */
export function presentShift(shift: ShiftRecord, timeZone: string) {
  const start = localParts(shift.startsAt, timeZone);
  const end = localParts(shift.endsAt, timeZone);
  return {
    id: shift.id,
    role: shift.role,
    staffId: shift.staffId,
    locked: shift.locked,
    note: shift.note,
    date: start.date,
    start: start.time,
    end: end.time,
    endsNextDay: end.date !== start.date,
    hours: round(hoursBetween(shift.startsAt, shift.endsAt)),
    startsAt: shift.startsAt,
    endsAt: shift.endsAt,
  };
}

/** Local start/end for a shift entered as date + HH:MM; end before start means next day. */
export function shiftWindow(date: string, start: string, end: string) {
  return { startDate: date, endDate: end <= start ? addDays(date, 1) : date };
}

export const STAFF_COLORS = [
  "#2563eb",
  "#db2777",
  "#16a34a",
  "#ea580c",
  "#7c3aed",
  "#0891b2",
  "#ca8a04",
  "#dc2626",
  "#4f46e5",
  "#0d9488",
];

/** changeResource for actions keyed by a child id: publish to the team in the result. */
export function teamChange(_input: unknown, result: unknown) {
  const teamId = (result as { teamId?: unknown } | null | undefined)?.teamId;
  return typeof teamId === "string" ? { resourceType: "team", resourceId: teamId } : null;
}

export function requireUser(ctx: { userEmail?: string | null } | undefined): string {
  return ctx?.userEmail ?? fail("Sign in first.", { statusCode: 401 });
}
