import { runMigrations } from "@agent-native/core/db";

export default runMigrations(
  [
    {
      version: 1,
      name: "teams-staff-shifts-availability",
      sql: `CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_at TEXT NOT NULL DEFAULT (now()),
  owner_email TEXT NOT NULL DEFAULT 'local@localhost',
  org_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'private'
);
CREATE TABLE IF NOT EXISTS team_shares (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (now()),
  notified_at TEXT
);
CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id),
  name TEXT NOT NULL,
  roles TEXT NOT NULL DEFAULT '',
  max_hours INTEGER NOT NULL DEFAULT 40 CHECK (max_hours > 0 AND max_hours <= 80),
  notes TEXT,
  color TEXT,
  telegram_chat_id TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  owner_email TEXT NOT NULL,
  org_id TEXT,
  created_at TEXT NOT NULL DEFAULT (now())
);
CREATE TABLE IF NOT EXISTS shifts (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id),
  role TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  staff_id TEXT REFERENCES staff(id),
  locked BOOLEAN NOT NULL DEFAULT FALSE,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled')),
  owner_email TEXT NOT NULL,
  org_id TEXT,
  created_at TEXT NOT NULL DEFAULT (now()),
  updated_at TEXT NOT NULL DEFAULT (now()),
  CHECK (ends_at > starts_at)
);
CREATE TABLE IF NOT EXISTS availability (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id),
  staff_id TEXT NOT NULL REFERENCES staff(id),
  day_of_week INTEGER CHECK (day_of_week BETWEEN 1 AND 7),
  date TEXT,
  start_time TEXT,
  end_time TEXT,
  valid_from TEXT,
  valid_until TEXT,
  note TEXT,
  owner_email TEXT NOT NULL,
  org_id TEXT,
  created_at TEXT NOT NULL DEFAULT (now()),
  CHECK (day_of_week IS NOT NULL OR date IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS teams_owner_org_name_idx ON teams (owner_email, org_id, name);
CREATE INDEX IF NOT EXISTS team_shares_resource_idx ON team_shares (resource_id, principal_type, principal_id);
CREATE INDEX IF NOT EXISTS staff_team_idx ON staff (team_id, name);
CREATE INDEX IF NOT EXISTS shifts_team_starts_idx ON shifts (team_id, starts_at);
CREATE INDEX IF NOT EXISTS shifts_staff_starts_idx ON shifts (staff_id, starts_at);
CREATE INDEX IF NOT EXISTS availability_team_staff_idx ON availability (team_id, staff_id)`,
    },
    {
      version: 2,
      name: "staff-telegram-link",
      sql: `ALTER TABLE staff ADD COLUMN IF NOT EXISTS telegram_invite_code TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS telegram_principal TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS telegram_linked_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS staff_telegram_invite_idx ON staff (telegram_invite_code) WHERE telegram_invite_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS staff_telegram_principal_idx ON staff (telegram_principal) WHERE telegram_principal IS NOT NULL;
CREATE INDEX IF NOT EXISTS staff_telegram_chat_idx ON staff (telegram_chat_id)`,
    },
    {
      version: 3,
      name: "cover-offers",
      sql: `CREATE TABLE IF NOT EXISTS cover_offers (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id),
  shift_id TEXT NOT NULL REFERENCES shifts(id),
  staff_id TEXT NOT NULL REFERENCES staff(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'closed')),
  delivery TEXT NOT NULL DEFAULT 'pending' CHECK (delivery IN ('pending', 'sent', 'failed')),
  created_at TEXT NOT NULL DEFAULT (now()),
  responded_at TEXT,
  owner_email TEXT NOT NULL,
  org_id TEXT
);
CREATE INDEX IF NOT EXISTS cover_offers_shift_idx ON cover_offers (shift_id, status);
CREATE INDEX IF NOT EXISTS cover_offers_staff_idx ON cover_offers (staff_id, status, created_at)`,
    },
  ],
  { table: "rota_app_migrations" },
);
