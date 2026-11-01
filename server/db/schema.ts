import { sql } from "drizzle-orm";
import { boolean, integer, pgTable, text } from "drizzle-orm/pg-core";
import {
  createSharesTable,
  ownableColumns,
} from "@agent-native/core/db/schema";

// A team is one workplace (a café, a clinic). Everything else belongs to a
// team and inherits its access.
export const teams = pgTable("teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  // IANA time zone. Shift times are entered and shown in this zone.
  timezone: text("timezone").notNull().default("UTC"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()`),
  ...ownableColumns(),
});
export const teamShares = createSharesTable("team_shares");

export const staff = pgTable("staff", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  name: text("name").notNull(),
  // Comma-separated skills, e.g. "barista,opener". Parse with parseRoles().
  roles: text("roles").notNull().default(""),
  maxHours: integer("max_hours").notNull().default(40),
  // Free-text preferences the agent reads, e.g. "prefers mornings".
  notes: text("notes"),
  color: text("color"),
  telegramChatId: text("telegram_chat_id"),
  active: boolean("active").notNull().default(true),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()`),
});

// Times are UTC ISO text from Date#toISOString(), so string order is time
// order. A null staffId is an open shift.
export const shifts = pgTable("shifts", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  role: text("role").notNull(),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at").notNull(),
  staffId: text("staff_id"),
  locked: boolean("locked").notNull().default(false),
  note: text("note"),
  status: text("status", { enum: ["scheduled", "cancelled"] })
    .notNull()
    .default("scheduled"),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`now()`),
});

// When someone can't work. Either a weekly rule (dayOfWeek) or a single date,
// optionally limited to a time window in the team's time zone.
export const availability = pgTable("availability", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  staffId: text("staff_id").notNull(),
  // ISO weekday: 1 = Monday ... 7 = Sunday.
  dayOfWeek: integer("day_of_week"),
  // YYYY-MM-DD in the team's time zone.
  date: text("date"),
  // HH:MM in the team's time zone. Both null means the whole day.
  startTime: text("start_time"),
  endTime: text("end_time"),
  // Optional YYYY-MM-DD bounds for weekly rules ("no weekends this month").
  validFrom: text("valid_from"),
  validUntil: text("valid_until"),
  note: text("note"),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()`),
});
