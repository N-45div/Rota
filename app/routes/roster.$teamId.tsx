import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import {
  actionErrorMessage,
  deleteClientAppState,
  useActionMutation,
  useActionQuery,
  useDbSync,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import {
  IconBrandTelegram,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconRepeat,
  IconSparkles,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";

import { RosterBoard } from "@/components/roster/RosterBoard";
import { shiftDate, weekRangeLabel } from "@/components/roster/roster-types";
import { useRosterMutations } from "@/components/roster/use-roster-mutations";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { rememberTeam } from "@/lib/last-team";
import { TAB_ID } from "@/lib/tab-id";

export default function RosterWeekRoute() {
  const t = useT();
  const { teamId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const week = searchParams.get("week") ?? undefined;
  const params = useMemo(() => ({ teamId, ...(week ? { weekStart: week } : {}) }), [teamId, week]);
  const roster = useActionQuery("get-roster", params, { refetchInterval: 30_000 });
  const mutations = useRosterMutations(params);
  const [confirmSend, setConfirmSend] = useState(false);
  const publish = useActionMutation("publish-week", {
    onSuccess: (result) => toast.success(result.summary),
    onError: (error) => toast.error(actionErrorMessage(error) ?? t("roster.publishFailed")),
  });
  const queryClient = useQueryClient();

  // Staff can change shifts by message and the agent can work in the
  // background, so the board must update while it is open.
  useDbSync({
    queryClient,
    realtime: { reason: "staff messages and background agent runs change shifts while the roster is open" },
    pauseWhenHidden: true,
  });

  useSetPageTitle(roster.data?.team.name ?? t("roster.nav"));
  const loadedTeam = roster.data?.team.id;
  useEffect(() => {
    if (loadedTeam) rememberTeam(loadedTeam);
  }, [loadedTeam]);

  // Clear the selected shift when leaving the board.
  useEffect(
    () => () => {
      void deleteClientAppState(`selection:${TAB_ID}`, { requestSource: TAB_ID });
    },
    [],
  );

  if (roster.isPending) {
    return (
      <main className="flex flex-col gap-4 p-4 sm:p-6">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-[520px] rounded-xl" />
      </main>
    );
  }

  if (roster.isError || !roster.data) {
    return (
      <main className="p-6">
        <p className="text-sm text-muted-foreground">{t("roster.notFound")}</p>
        <Link className="mt-3 inline-block text-sm underline" to="/roster">
          {t("roster.backToTeams")}
        </Link>
      </main>
    );
  }

  const data = roster.data;
  const { open, withIssues } = data.summary;
  const isThisWeek = data.days.includes(data.today);

  function goToWeek(weekStart: string | null) {
    setSearchParams(weekStart ? { week: weekStart } : {});
  }

  function draftWithAgent() {
    sendToAgentChat({
      message: t("roster.draftPrompt", { week: weekRangeLabel(data.days), count: open }),
      context: `Team ${data.team.id} (${data.team.name}), week starting ${data.weekStart}.`,
      submit: true,
    });
  }

  function automate(kind: "friday" | "reminders") {
    sendToAgentChat({
      message:
        kind === "friday"
          ? t("roster.automateFridayPrompt", { team: data.team.name })
          : t("roster.automateRemindersPrompt", { team: data.team.name }),
      context: `Team ${data.team.id} (${data.team.name}), time zone ${data.team.timezone}.`,
      submit: true,
    });
  }

  const connected = data.staff.filter((person) => person.hasTelegram).length;
  const sentAt = data.publishedAt
    ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(
        new Date(data.publishedAt),
      )
    : null;

  function reviewWithAgent() {
    sendToAgentChat({
      message: t("roster.reviewPrompt", { week: weekRangeLabel(data.days) }),
      context: `Team ${data.team.id} (${data.team.name}), week starting ${data.weekStart}.`,
      submit: true,
    });
  }

  return (
    <main className="flex min-h-full flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            aria-label={t("roster.previousWeek")}
            onClick={() => goToWeek(shiftDate(data.weekStart, -7))}
          >
            <IconChevronLeft className="size-4" />
          </Button>
          <span className="min-w-36 text-center text-sm font-medium tabular-nums">{weekRangeLabel(data.days)}</span>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            aria-label={t("roster.nextWeek")}
            onClick={() => goToWeek(shiftDate(data.weekStart, 7))}
          >
            <IconChevronRight className="size-4" />
          </Button>
          {!isThisWeek ? (
            <Button variant="ghost" size="sm" className="ml-1 h-8" onClick={() => goToWeek(null)}>
              {t("roster.thisWeek")}
            </Button>
          ) : null}
        </div>

        <p className="text-sm text-muted-foreground">
          {open === 0 && withIssues === 0
            ? t("roster.allCovered")
            : [
                open > 0 ? t("roster.openCount", { count: open }) : null,
                withIssues > 0 ? t("roster.issueCount", { count: withIssues }) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
          {sentAt ? <span className="ml-2 text-xs">· {t("roster.sentAt", { when: sentAt })}</span> : null}
        </p>

        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-9 gap-1.5">
                <IconRepeat className="size-4" />
                {t("roster.automate")}
                <IconChevronDown className="size-3.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => automate("friday")}>{t("roster.automateFriday")}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => automate("reminders")}>{t("roster.automateReminders")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            className="h-9 gap-2"
            disabled={publish.isPending || data.shifts.length === 0}
            onClick={() => setConfirmSend(true)}
          >
            <IconBrandTelegram className="size-4 text-sky-500" />
            {publish.isPending ? t("roster.sending") : sentAt ? t("roster.resend") : t("roster.sendToStaff")}
          </Button>
          {open > 0 ? (
            <Button className="h-9 gap-2" onClick={draftWithAgent}>
              <IconSparkles className="size-4" />
              {t("roster.fillWithAgent", { count: open })}
            </Button>
          ) : (
            <Button variant="outline" className="h-9 gap-2" onClick={reviewWithAgent}>
              <IconSparkles className="size-4" />
              {t("roster.reviewWithAgent")}
            </Button>
          )}
        </div>
      </div>

      <RosterBoard roster={data} mutations={mutations} />

      <AlertDialog open={confirmSend} onOpenChange={setConfirmSend}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("roster.sendTitle", { week: weekRangeLabel(data.days) })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("roster.sendDescription", { count: connected })}
              {open > 0 ? ` ${t("roster.sendOpenWarning", { count: open })}` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("roster.notYet")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={connected === 0}
              onClick={() => publish.mutate({ teamId: data.team.id, weekStart: data.weekStart })}
            >
              {t("roster.sendToStaff")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
