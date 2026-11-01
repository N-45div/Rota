// Types derived from the actions, so the board always matches what the
// server returns.
export type Roster = AgentNativeActionRegistry["get-roster"]["result"];
export type RosterShift = Roster["shifts"][number];
export type RosterStaff = Roster["staff"][number];
export type CoverResult = AgentNativeActionRegistry["find-cover"]["result"];
export type Candidate = CoverResult["candidates"][number];
export type Issue = RosterShift["issues"][number];

/** Shown on the board: a person can't take the shift unless overridden. */
export function blockingIssues(issues: Issue[]) {
  return issues.filter((issue) => issue.severity !== "warn");
}

export function onlyOverridable(candidate: Candidate) {
  return (
    !candidate.eligible &&
    candidate.violations.length > 0 &&
    candidate.violations.every((v) => v.severity !== "block")
  );
}

/** "Mon 2" style day label, computed from a YYYY-MM-DD string without time zone drift. */
export function dayLabel(date: string, locale?: string) {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  const value = new Date(Date.UTC(y, m - 1, d, 12));
  return {
    weekday: new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(value),
    day: new Intl.DateTimeFormat(locale, { day: "numeric", timeZone: "UTC" }).format(value),
    long: new Intl.DateTimeFormat(locale, {
      weekday: "long",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(value),
  };
}

export function weekRangeLabel(days: string[], locale?: string) {
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) return "";
  const fmt = (date: string) => {
    const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
    return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" }).format(
      new Date(Date.UTC(y, m - 1, d, 12)),
    );
  };
  return `${fmt(first)} – ${fmt(last)}`;
}

export function shiftDate(date: string, days: number) {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function errorCodeOf(error: unknown): string | undefined {
  if (error && typeof error === "object" && "errorCode" in error && typeof error.errorCode === "string") {
    return error.errorCode;
  }
  return undefined;
}
