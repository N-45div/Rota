// Time helpers for a team's local time zone. Shifts are stored as UTC ISO
// strings but entered and displayed as a local date plus HH:MM.

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let dtf = formatterCache.get(timeZone);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatterCache.set(timeZone, dtf);
  }
  return dtf;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

const WEEKDAYS: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

export interface LocalParts {
  /** YYYY-MM-DD */
  date: string;
  /** ISO weekday, 1 = Monday ... 7 = Sunday */
  dayOfWeek: number;
  /** Minutes since local midnight, 0-1439 */
  minutes: number;
  /** HH:MM */
  time: string;
}

export function localParts(isoOrMs: string | number, timeZone: string): LocalParts {
  const ms = typeof isoOrMs === "number" ? isoOrMs : Date.parse(isoOrMs);
  const parts: Record<string, string> = {};
  for (const part of formatter(timeZone).formatToParts(new Date(ms))) {
    parts[part.type] = part.value;
  }
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    dayOfWeek: WEEKDAYS[parts.weekday ?? ""] ?? 1,
    minutes: hour * 60 + minute,
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

function offsetMs(utcMs: number, timeZone: string): number {
  const parts: Record<string, string> = {};
  for (const part of formatter(timeZone).formatToParts(new Date(utcMs))) {
    parts[part.type] = part.value;
  }
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Convert a local date and HH:MM in `timeZone` to a UTC ISO string. */
export function zonedToUtcIso(date: string, time: string, timeZone: string): string {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  const [hh = 0, mm = 0] = time.split(":").map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  // Two passes settle the offset around DST changes.
  let ts = naive - offsetMs(naive, timeZone);
  ts = naive - offsetMs(ts, timeZone);
  return new Date(ts).toISOString();
}

export function addDays(date: string, days: number): string {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
}

/** ISO weekday (1-7) of a YYYY-MM-DD date. */
export function dayOfWeekOf(date: string): number {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

/** The Monday on or before `date`. */
export function mondayOf(date: string): string {
  return addDays(date, 1 - dayOfWeekOf(date));
}

export function todayIn(timeZone: string): string {
  return localParts(Date.now(), timeZone).date;
}

/** UTC bounds of the local week that starts on Monday `weekStart`. */
export function weekBounds(weekStart: string, timeZone: string) {
  return {
    from: zonedToUtcIso(weekStart, "00:00", timeZone),
    to: zonedToUtcIso(addDays(weekStart, 7), "00:00", timeZone),
  };
}

export function hoursBetween(startsAt: string, endsAt: string): number {
  return (Date.parse(endsAt) - Date.parse(startsAt)) / 3_600_000;
}

export function parseHhMm(value: string): number {
  const [hh = 0, mm = 0] = value.split(":").map(Number);
  return hh * 60 + mm;
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
