import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { useActionQuery, useDbSync } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { IconCalendarOff, IconPencil, IconPlus, IconSparkles } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";

import { PersonSheet } from "@/components/roster/PersonSheet";
import { dayLabel, initials, type Roster, type RosterStaff } from "@/components/roster/roster-types";
import { TelegramConnect } from "@/components/roster/TelegramConnect";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { rememberTeam } from "@/lib/last-team";
import { cn } from "@/lib/utils";

export default function TeamPage() {
  const t = useT();
  const { teamId = "" } = useParams();
  const roster = useActionQuery("get-roster", { teamId }, { refetchInterval: 30_000 });
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<RosterStaff | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useDbSync({
    queryClient,
    realtime: { reason: "staff connect Telegram and the agent changes availability while this page is open" },
    pauseWhenHidden: true,
  });
  useSetPageTitle(t("brand.navTeam"));
  const loadedTeam = roster.data?.team.id;
  useEffect(() => {
    if (loadedTeam) rememberTeam(loadedTeam);
  }, [loadedTeam]);

  if (roster.isPending) {
    return (
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-8">
        <Skeleton className="h-10 w-56" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-56 rounded-2xl" />
          ))}
        </div>
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
  const people = [...data.staff].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  const active = data.staff.filter((p) => p.active);
  const onTelegram = active.filter((p) => p.hasTelegram).length;
  const booked = active.reduce((sum, p) => sum + p.weekHours, 0);
  const missing = active.length - onTelegram;

  function openSheet(person: RosterStaff | null) {
    setEditing(person);
    setSheetOpen(true);
  }

  function tellRota(person: RosterStaff) {
    sendToAgentChat({
      message: `${person.name.split(" ")[0]} `,
      context: `Staff ${person.id} (${person.name}) on team ${data.team.id} (${data.team.name}).`,
      contextLabel: person.name,
      submit: false,
    });
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-8">
      <header className="flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">{data.team.name}</p>
          <h1 className="text-3xl font-semibold tracking-tight">{t("team.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("team.summary", { people: active.length, telegram: onTelegram, hours: Math.round(booked) })}
          </p>
        </div>
        <Button className="h-10 gap-2" onClick={() => openSheet(null)}>
          <IconPlus className="size-4" />
          {t("team.addPerson")}
        </Button>
      </header>

      {missing > 0 ? (
        <div className="flex items-start gap-3 rounded-2xl border border-primary/25 bg-primary/[0.07] px-4 py-3 text-sm">
          <IconSparkles className="mt-0.5 size-4 shrink-0 text-primary" />
          <p>{t("team.telegramNudge", { count: missing })}</p>
        </div>
      ) : null}

      {people.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center">
          <p className="font-display text-xl">{t("team.emptyTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("team.emptyBody")}</p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {people.map((person) => (
            <li key={person.id}>
              <PersonCard
                person={person}
                roster={data}
                onEdit={() => openSheet(person)}
                onTellRota={() => tellRota(person)}
              />
            </li>
          ))}
        </ul>
      )}

      <PersonSheet teamId={data.team.id} person={editing} open={sheetOpen} onOpenChange={setSheetOpen} />
    </main>
  );
}

function PersonCard({
  person,
  roster,
  onEdit,
  onTellRota,
}: {
  person: RosterStaff;
  roster: Roster;
  onEdit: () => void;
  onTellRota: () => void;
}) {
  const t = useT();
  const share = person.maxHours > 0 ? Math.min(1, person.weekHours / person.maxHours) : 0;
  const over = person.weekHours > person.maxHours;
  const next = roster.shifts
    .filter((s) => s.staffId === person.id && s.date >= roster.today)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  const color = person.color ?? "hsl(var(--muted-foreground))";

  return (
    <article
      className={cn(
        "flex h-full flex-col gap-4 rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_hsl(var(--foreground)/0.04)]",
        !person.active && "opacity-60",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
          style={{ background: color }}
        >
          {initials(person.name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium leading-tight">{person.name}</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {person.roles.length ? (
              person.roles.map((role) => (
                <span key={role} className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium capitalize text-muted-foreground">
                  {role}
                </span>
              ))
            ) : (
              <span className="text-xs text-muted-foreground">{t("team.noSkills")}</span>
            )}
            {!person.active ? (
              <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                {t("team.inactive")}
              </span>
            ) : null}
          </div>
        </div>
        <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label={t("team.edit", { name: person.name })} onClick={onEdit}>
          <IconPencil className="size-4" />
        </Button>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-muted-foreground">{t("team.thisWeek")}</span>
          <span className={cn("tabular-nums", over ? "font-medium text-destructive" : "text-foreground")}>
            {t("team.hours", { hours: person.weekHours, max: person.maxHours })}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full transition-[width] duration-500", over && "bg-destructive")}
            style={{ width: `${Math.round(share * 100)}%`, ...(over ? {} : { background: color }) }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {next
            ? t("team.nextShift", {
                day: dayLabel(next.date).weekday,
                start: next.start,
                end: next.end,
                role: next.role,
              })
            : t("team.noShifts")}
        </p>
      </div>

      {person.notes ? (
        <p className="border-l-2 border-primary/40 pl-3 text-sm italic text-foreground/80">{person.notes}</p>
      ) : null}

      {person.availability.length > 0 ? (
        <ul className="space-y-1 text-xs">
          {person.availability.map((rule) => (
            <li key={rule.id} className="flex items-start gap-1.5 text-muted-foreground">
              <IconCalendarOff className="mt-px size-3.5 shrink-0" />
              <span>{rule.text}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-auto flex flex-col gap-2 border-t border-border pt-3">
        <TelegramConnect staffId={person.id} name={person.name} connected={person.hasTelegram} />
        <button
          type="button"
          onClick={onTellRota}
          className="flex items-center gap-1.5 self-start rounded-md text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <IconSparkles className="size-3.5" />
          {t("team.tellRota", { name: person.name.split(" ")[0] })}
        </button>
      </div>
    </article>
  );
}
