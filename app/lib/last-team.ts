// Remembers the team you last opened, so Roster, Team, and Activity all open
// the same team. A per-browser convenience only; it can be empty or blocked.

const KEY = "rota:last-team";

export function readLastTeam(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function rememberTeam(teamId: string) {
  try {
    window.localStorage.setItem(KEY, teamId);
  } catch {
    // Private mode or blocked storage: nothing to remember.
  }
}

/** The remembered team if it's still in the list, else the first one. */
export function pickTeam<T extends { id: string }>(teams: T[]): T | undefined {
  const last = readLastTeam();
  return teams.find((team) => team.id === last) ?? teams[0];
}
