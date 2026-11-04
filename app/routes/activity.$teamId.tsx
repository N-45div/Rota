import { useActionQuery, useDbSync } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useSession } from "@agent-native/core/client/use-session";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { IconBrandTelegram, IconClock, IconSparkles, IconUser, type Icon } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";

import { initials } from "@/components/roster/roster-types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { rememberTeam } from "@/lib/last-team";
import { cn } from "@/lib/utils";

type Feed = AgentNativeActionRegistry["list-activity"]["result"];
type Entry = Feed["entries"][number];
type Filter = "all" | "agent" | "staff" | "manager";

const FILTERS: Filter[] = ["all", "agent", "staff", "manager"];

function localDate(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

export default function ActivityPage() {
  const t = useT();
  const { teamId = "" } = useParams();
  const [limit, setLimit] = useState(60);
  const [filter, setFilter] = useState<Filter>("all");
  const feed = useActionQuery("list-activity", { teamId, limit }, { refetchInterval: 30_000, placeholderData: (prev) => prev });
  const me = useSession().session?.email ?? null;
  const queryClient = useQueryClient();

  useDbSync({
    queryClient,
    realtime: { reason: "staff reply on Telegram and the agent works in the background while the feed is open" },
    pauseWhenHidden: true,
  });
  useSetPageTitle(t("brand.navActivity"));
  const loadedTeam = feed.data?.teamId;
  useEffect(() => {
    if (loadedTeam) rememberTeam(loadedTeam);
  }, [loadedTeam]);

  const groups = useMemo(() => {
    if (!feed.data) return [];
    const tz = feed.data.timezone;
    const entries = feed.data.entries.filter((e) => filter === "all" || e.actorKind === filter);
    const byDay = new Map<string, Entry[]>();
    for (const entry of entries) {
      const day = localDate(entry.at, tz);
      byDay.set(day, [...(byDay.get(day) ?? []), entry]);
    }
    return [...byDay.entries()];
  }, [feed.data, filter]);

  if (feed.isPending) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 sm:p-8">
        <Skeleton className="h-10 w-48" />
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-14 rounded-xl" />
        ))}
      </main>
    );
  }

  if (feed.isError || !feed.data) {
    return (
      <main className="p-6">
        <p className="text-sm text-muted-foreground">{t("roster.notFound")}</p>
        <Link className="mt-3 inline-block text-sm underline" to="/roster">
          {t("roster.backToTeams")}
        </Link>
      </main>
    );
  }

  const data = feed.data;
  const tz = data.timezone;
  const today = localDate(new Date().toISOString(), tz);
  const yesterday = localDate(new Date(Date.now() - 86_400_000).toISOString(), tz);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const recent = data.entries.filter((e) => e.at >= weekAgo);
  const counts = {
    agent: recent.filter((e) => e.actorKind === "agent").length,
    staff: recent.filter((e) => e.actorKind === "staff").length,
    manager: recent.filter((e) => e.actorKind === "manager").length,
  };

  function dayHeading(day: string) {
    if (day === today) return t("activity.today");
    if (day === yesterday) return t("activity.yesterday");
    const [y = 1970, m = 1, d = 1] = day.split("-").map(Number);
    return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }).format(
      new Date(Date.UTC(y, m - 1, d, 12)),
    );
  }

  const timeOf = (iso: string) =>
    new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: tz }).format(new Date(iso));

  function actorLabel(entry: Entry) {
    if (entry.actorKind === "manager") return entry.actorName === me ? t("activity.you") : entry.actorName.split("@")[0];
    if (entry.actorKind === "system") return t("activity.system");
    return entry.actorName;
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-8">
      <header className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">{data.team}</p>
        <h1 className="text-3xl font-semibold tracking-tight">{t("activity.title")}</h1>
        <p className="text-sm text-muted-foreground">
          {recent.length
            ? t("activity.weekSummary", { agent: counts.agent, staff: counts.staff, manager: counts.manager })
            : t("activity.subtitle")}
        </p>
      </header>

      <div role="tablist" aria-label={t("activity.filterLabel")} className="flex w-fit gap-1 rounded-full bg-muted p-1">
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={filter === value}
            onClick={() => setFilter(value)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              filter === value && "bg-background text-foreground shadow-sm",
            )}
          >
            {t(`activity.filter_${value}`)}
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center">
          <p className="font-display text-xl">{t("activity.emptyTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("activity.emptyBody")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map(([day, entries]) => (
            <section key={day} aria-label={dayHeading(day)}>
              <h2 className="mb-3 text-lg font-semibold">{dayHeading(day)}</h2>
              <ol className="relative flex flex-col">
                {entries.map((entry, index) => (
                  <li key={entry.id} className="relative flex gap-3 pb-4">
                    {index < entries.length - 1 ? (
                      <span aria-hidden className="absolute bottom-0 left-4 top-9 w-px -translate-x-1/2 bg-border" />
                    ) : null}
                    <ActorAvatar entry={entry} />
                    <div className="min-w-0 flex-1 pt-0.5">
                      <p className="text-xs text-muted-foreground">
                        <span className={cn("font-semibold", entry.actorKind === "agent" ? "text-primary" : "text-foreground")}>
                          {actorLabel(entry)}
                        </span>
                        <span className="mx-1.5">·</span>
                        <time dateTime={entry.at} className="tabular-nums">
                          {timeOf(entry.at)}
                        </time>
                      </p>
                      <p className="mt-0.5 text-sm leading-relaxed">{entry.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}
          {data.entries.length >= limit && limit < 200 ? (
            <Button variant="outline" className="self-center" disabled={feed.isFetching} onClick={() => setLimit(200)}>
              {t("activity.showMore")}
            </Button>
          ) : null}
        </div>
      )}
    </main>
  );
}

const AVATAR: Record<Entry["actorKind"], { icon: Icon; className: string }> = {
  agent: { icon: IconSparkles, className: "bg-primary text-primary-foreground" },
  staff: { icon: IconBrandTelegram, className: "bg-sky-500 text-white" },
  manager: { icon: IconUser, className: "bg-foreground text-background" },
  system: { icon: IconClock, className: "bg-muted text-muted-foreground" },
};

function ActorAvatar({ entry }: { entry: Entry }) {
  const { icon: ActorIcon, className } = AVATAR[entry.actorKind];
  if (entry.actorKind === "staff") {
    return (
      <span aria-hidden className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-secondary-foreground ring-4 ring-background">
        {initials(entry.actorName)}
        <span className={cn("absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full ring-2 ring-background", className)}>
          <ActorIcon className="size-2.5" />
        </span>
      </span>
    );
  }
  return (
    <span aria-hidden className={cn("flex size-8 shrink-0 items-center justify-center rounded-full ring-4 ring-background", className)}>
      <ActorIcon className="size-4" />
    </span>
  );
}
