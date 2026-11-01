import { actionErrorMessage, useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { Roster } from "./roster-types";

/**
 * Writes for the roster board. Each one updates the cached roster first so
 * the board responds instantly, then rolls back and shows the server's reason
 * if the rule checker rejects it.
 */
export function useRosterMutations(params: { teamId: string; weekStart?: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const queryKey = ["action", "get-roster", params];

  async function patchCache(update: (old: Roster) => Roster) {
    await queryClient.cancelQueries({ queryKey });
    const previous = queryClient.getQueryData<Roster>(queryKey);
    if (previous) queryClient.setQueryData<Roster>(queryKey, update(previous));
    return { previous };
  }

  function rollback(context: unknown, error: unknown, fallback: string) {
    const previous = (context as { previous?: Roster } | undefined)?.previous;
    if (previous) queryClient.setQueryData(queryKey, previous);
    toast.error(actionErrorMessage(error) ?? fallback);
  }

  const assign = useActionMutation("assign-shift", {
    onMutate: ({ shiftId, staffId }) =>
      patchCache((old) => ({
        ...old,
        shifts: old.shifts.map((shift) =>
          shift.id === shiftId
            ? {
                ...shift,
                staffId: staffId ?? null,
                staffName: old.staff.find((person) => person.id === staffId)?.name ?? null,
                issues: [],
              }
            : shift,
        ),
      })),
    onError: (error, _input, context) => rollback(context, error, t("roster.assignFailed")),
    onSuccess: (result) => {
      const warning = result.warnings.find((w) => w.severity === "warn");
      if (warning) toast.warning(warning.message);
    },
  });

  const update = useActionMutation("update-shift", {
    onMutate: ({ shiftId, locked }) =>
      patchCache((old) => ({
        ...old,
        shifts: old.shifts.map((shift) =>
          shift.id === shiftId && locked !== undefined ? { ...shift, locked } : shift,
        ),
      })),
    onError: (error, _input, context) => rollback(context, error, t("roster.updateFailed")),
  });

  const remove = useActionMutation("delete-shift", {
    onMutate: ({ shiftId }) =>
      patchCache((old) => ({ ...old, shifts: old.shifts.filter((shift) => shift.id !== shiftId) })),
    onError: (error, _input, context) => rollback(context, error, t("roster.deleteFailed")),
  });

  const create = useActionMutation("create-shifts", {
    onError: (error) => toast.error(actionErrorMessage(error) ?? t("roster.createFailed")),
    onSuccess: (result) => {
      for (const miss of result.unassigned) toast.warning(miss.reason);
    },
  });

  return { assign, update, remove, create };
}
