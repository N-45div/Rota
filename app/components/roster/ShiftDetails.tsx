import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconAlertTriangle,
  IconLock,
  IconLockOpen,
  IconSparkles,
  IconTrash,
  IconUserMinus,
} from "@tabler/icons-react";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { blockingIssues, dayLabel, onlyOverridable, type RosterShift, type RosterStaff } from "./roster-types";
import type { useRosterMutations } from "./use-roster-mutations";

interface ShiftDetailsProps {
  shift: RosterShift;
  staff: RosterStaff[];
  mutations: ReturnType<typeof useRosterMutations>;
  onDone: () => void;
}

export function ShiftDetails({ shift, staff, mutations, onDone }: ShiftDetailsProps) {
  const t = useT();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const cover = useActionQuery("find-cover", { shiftId: shift.id });
  const color = (id: string | null) => staff.find((p) => p.id === id)?.color ?? "var(--muted-foreground)";
  const when = `${dayLabel(shift.date).long} · ${shift.start}–${shift.end}${shift.endsNextDay ? " +1" : ""}`;
  const problems = blockingIssues(shift.issues);
  const warnings = shift.issues.filter((issue) => issue.severity === "warn");

  function assign(staffId: string | null, override = false) {
    mutations.assign.mutate({ shiftId: shift.id, staffId, override });
    onDone();
  }

  function askAgent() {
    const who = shift.staffName ?? t("roster.open");
    sendToAgentChat({
      message: shift.staffId
        ? t("roster.askAgentAssigned", { role: shift.role, when, who })
        : t("roster.askAgentOpen", { role: shift.role, when }),
      context: `Shift id ${shift.id}: ${shift.role}, ${shift.date} ${shift.start}-${shift.end}, assigned to ${who}.`,
      submit: true,
    });
    onDone();
  }

  return (
    <div className="flex w-80 flex-col gap-3 text-sm">
      <div>
        <p className="font-medium">{when}</p>
        <p className="text-xs text-muted-foreground">
          <span className="capitalize">{shift.role}</span> · {shift.hours}h{shift.note ? ` · ${shift.note}` : ""}
        </p>
      </div>

      {shift.staffId ? (
        <div className="flex items-center gap-2 rounded-md border border-border px-2.5 py-2">
          <span className="size-2.5 shrink-0 rounded-full" style={{ background: color(shift.staffId) }} />
          <span className="min-w-0 flex-1 truncate font-medium">{shift.staffName}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            disabled={shift.locked}
            onClick={() => assign(null)}
          >
            <IconUserMinus className="size-3.5" />
            {t("roster.unassign")}
          </Button>
        </div>
      ) : null}

      {problems.length > 0 || warnings.length > 0 ? (
        <ul className="space-y-1">
          {[...problems, ...warnings].map((issue) => (
            <li
              key={issue.code}
              className={cn(
                "flex gap-1.5 text-xs",
                issue.severity === "warn" ? "text-amber-600 dark:text-amber-400" : "text-destructive",
              )}
            >
              <IconAlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}

      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">
          {shift.staffId ? t("roster.swapWith") : t("roster.whoCanTakeIt")}
        </p>
        {cover.isPending ? (
          <div className="space-y-1.5">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-9 rounded-md" />
            ))}
          </div>
        ) : (
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {(cover.data?.candidates ?? []).map((candidate) => {
              const overridable = onlyOverridable(candidate);
              return (
                <li
                  key={candidate.staffId}
                  className={cn(
                    "flex items-start gap-2 rounded-md px-2 py-1.5",
                    candidate.eligible ? "hover:bg-accent" : "opacity-80",
                  )}
                >
                  <span
                    className="mt-1.5 size-2 shrink-0 rounded-full"
                    style={{ background: color(candidate.staffId) }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate font-medium">{candidate.name}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {candidate.weekHours}/{candidate.maxHours}h
                      </span>
                    </div>
                    {!candidate.eligible ? (
                      <p className="text-xs text-muted-foreground">
                        {candidate.violations
                          .filter((v) => v.severity !== "warn")
                          .map((v) => v.message)
                          .join(" ")}
                      </p>
                    ) : null}
                  </div>
                  {candidate.eligible ? (
                    <Button
                      size="sm"
                      className="h-7 px-2.5 text-xs"
                      disabled={shift.locked}
                      onClick={() => assign(candidate.staffId)}
                    >
                      {t("roster.assign")}
                    </Button>
                  ) : overridable ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      disabled={shift.locked}
                      onClick={() => assign(candidate.staffId, true)}
                    >
                      {t("roster.assignAnyway")}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-1 border-t border-border pt-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2 text-xs"
          onClick={() => mutations.update.mutate({ shiftId: shift.id, locked: !shift.locked })}
        >
          {shift.locked ? <IconLockOpen className="size-3.5" /> : <IconLock className="size-3.5" />}
          {shift.locked ? t("roster.unlock") : t("roster.lock")}
        </Button>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={askAgent}>
          <IconSparkles className="size-3.5" />
          {t("roster.askAgent")}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-8 text-muted-foreground hover:text-destructive"
          aria-label={t("roster.deleteShift")}
          disabled={shift.locked}
          onClick={() => setConfirmDelete(true)}
        >
          <IconTrash className="size-3.5" />
        </Button>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("roster.deleteShiftTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("roster.deleteShiftDescription", { when })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("roster.keepShift")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                mutations.remove.mutate({ shiftId: shift.id });
                onDone();
              }}
            >
              {t("roster.deleteShift")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
