import {
  callAction,
  writeClientAppState,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconAlertTriangle,
  IconArrowsExchange,
  IconBrandTelegram,
  IconCheck,
  IconLock,
  IconPlus,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TAB_ID } from "@/lib/tab-id";
import { cn } from "@/lib/utils";

import { AddShiftForm } from "./AddShiftForm";
import {
  blockingIssues,
  dayLabel,
  initials,
  type Candidate,
  type Roster,
  type RosterShift,
} from "./roster-types";
import { ShiftDetails } from "./ShiftDetails";
import { StaffDetails } from "./StaffDetails";
import type { useRosterMutations } from "./use-roster-mutations";

interface RosterBoardProps {
  roster: Roster;
  mutations: ReturnType<typeof useRosterMutations>;
}

export function RosterBoard({ roster, mutations }: RosterBoardProps) {
  const t = useT();
  const [dragging, setDragging] = useState<RosterShift | null>(null);
  const [dragCover, setDragCover] = useState<Map<string, Candidate> | null>(
    null,
  );
  const [openShiftId, setOpenShiftId] = useState<string | null>(null);
  const [addingOn, setAddingOn] = useState<string | null>(null);

  const byCell = useMemo(() => {
    const map = new Map<string, RosterShift[]>();
    for (const shift of roster.shifts) {
      const key = `${shift.staffId ?? "open"}|${shift.date}`;
      map.set(key, [...(map.get(key) ?? []), shift]);
    }
    for (const list of map.values())
      list.sort((a, b) => a.start.localeCompare(b.start));
    return map;
  }, [roster.shifts]);

  const roles = useMemo(
    () =>
      [
        ...new Set([
          ...roster.shifts.map((s) => s.role),
          ...roster.staff.flatMap((p) => p.roles),
        ]),
      ].sort(),
    [roster.shifts, roster.staff],
  );

  const coverage = (date: string) => {
    const day = roster.shifts.filter((s) => s.date === date);
    return { filled: day.filter((s) => s.staffId).length, total: day.length };
  };

  function selectShift(shift: RosterShift | null) {
    setOpenShiftId(shift?.id ?? null);
    if (shift) {
      void writeClientAppState(
        `selection:${TAB_ID}`,
        {
          kind: "shift",
          id: shift.id,
          label: `${shift.role} ${shift.date} ${shift.start}–${shift.end} (${shift.staffName ?? "open"})`,
        },
        { requestSource: TAB_ID },
      );
    }
  }

  function startDrag(event: React.DragEvent, shift: RosterShift) {
    event.dataTransfer.setData("text/plain", shift.id);
    event.dataTransfer.effectAllowed = "move";
    setDragging(shift);
    setDragCover(null);
    callAction("find-cover", { shiftId: shift.id }, { method: "GET" })
      .then((result) =>
        setDragCover(new Map(result.candidates.map((c) => [c.staffId, c]))),
      )
      .catch(() => setDragCover(null));
  }

  function endDrag() {
    setDragging(null);
    setDragCover(null);
  }

  function dropProps(staffId: string | null, date: string) {
    const active = dragging && dragging.date === date;
    return {
      onDragOver: (event: React.DragEvent) => {
        if (!active) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      },
      onDrop: (event: React.DragEvent) => {
        if (!dragging || dragging.date !== date) return;
        event.preventDefault();
        if (dragging.staffId !== staffId) {
          mutations.assign.mutate({ shiftId: dragging.id, staffId });
        }
        endDrag();
      },
    };
  }

  function dragState(staffId: string): "eligible" | "blocked" | "self" | null {
    if (!dragging) return null;
    if (dragging.staffId === staffId) return "self";
    const candidate = dragCover?.get(staffId);
    if (!candidate) return null;
    return candidate.eligible ? "eligible" : "blocked";
  }

  function chip(shift: RosterShift, inOpenLane: boolean) {
    const person = roster.staff.find((p) => p.id === shift.staffId);
    const problems = blockingIssues(shift.issues);
    const warned = shift.issues.length > problems.length;
    const asking = shift.staffId ? 0 : shift.offers.filter((offer) => offer.status === "pending").length;
    const viaTelegram = Boolean(shift.staffId) && shift.offers.some((offer) => offer.status === "accepted");
    return (
      <Popover
        key={shift.id}
        open={openShiftId === shift.id}
        onOpenChange={(open) => selectShift(open ? shift : null)}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            draggable={!shift.locked}
            onDragStart={(event) => startDrag(event, shift)}
            onDragEnd={endDrag}
            data-shift-id={shift.id}
            className={cn(
              "group relative flex w-full flex-col rounded-md border bg-background py-1.5 pr-1.5 pl-2.5 text-left transition-[box-shadow,opacity] hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              inOpenLane
                ? "border-dashed border-amber-500/70 bg-amber-50/60 dark:bg-amber-950/20"
                : "border-border",
              problems.length > 0 && "border-destructive/60 bg-destructive/5",
              dragging?.id === shift.id && "opacity-40",
              !shift.locked && "cursor-grab active:cursor-grabbing",
            )}
          >
            <span
              aria-hidden
              className="absolute inset-y-1 left-1 w-[3px] rounded-full"
              style={{
                background: inOpenLane
                  ? "transparent"
                  : (person?.color ?? "var(--border)"),
              }}
            />
            <span className="flex items-center gap-1 text-[11px] font-medium whitespace-nowrap tabular-nums sm:text-xs">
              {shift.start}–{shift.end}
              {shift.endsNextDay ? (
                <sup className="text-[9px] text-muted-foreground">+1</sup>
              ) : null}
              <span className="ml-auto flex items-center gap-0.5">
                {problems.length > 0 ? (
                  <IconAlertTriangle
                    className="size-3.5 text-destructive"
                    aria-label={t("roster.hasProblem")}
                  />
                ) : warned ? (
                  <IconAlertTriangle
                    className="size-3.5 text-amber-500"
                    aria-label={t("roster.hasWarning")}
                  />
                ) : null}
                {shift.swap ? (
                  <IconArrowsExchange
                    className={cn("size-3.5", shift.swap.status === "agreed" ? "text-primary" : "text-muted-foreground")}
                    aria-label={shift.swap.status === "agreed" ? t("swaps.chipWaitingYou") : t("swaps.chipAsked")}
                  />
                ) : null}
                {shift.locked ? (
                  <IconLock
                    className="size-3 text-muted-foreground"
                    aria-label={t("roster.locked")}
                  />
                ) : null}
              </span>
            </span>
            <span className="flex min-w-0 flex-wrap items-center gap-x-1 text-[11px] text-muted-foreground">
              <span className="truncate capitalize">{shift.role}</span>
              {asking > 0 ? (
                <span className="flex shrink-0 items-center gap-0.5 text-sky-600 dark:text-sky-400">
                  <IconBrandTelegram className="size-3" aria-hidden />
                  {t("roster.askingCount", { count: asking })}
                </span>
              ) : viaTelegram ? (
                <IconBrandTelegram className="size-3 shrink-0 text-sky-500" aria-label={t("roster.coveredOnTelegram")} />
              ) : null}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-3">
          <ShiftDetails
            shift={shift}
            staff={roster.staff}
            mutations={mutations}
            onDone={() => selectShift(null)}
          />
        </PopoverContent>
      </Popover>
    );
  }

  const openCount = roster.shifts.filter((s) => !s.staffId).length;

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <div className="grid min-w-[876px] grid-cols-[120px_repeat(7,minmax(108px,1fr))] sm:min-w-[1040px] sm:grid-cols-[216px_repeat(7,minmax(0,1fr))]">
        {/* Day headers */}
        <div className="sticky left-0 z-10 border-b border-border bg-card" />
        {roster.days.map((date) => {
          const label = dayLabel(date);
          const { filled, total } = coverage(date);
          const isToday = date === roster.today;
          return (
            <div
              key={date}
              className={cn(
                "flex items-baseline gap-1.5 border-b border-l border-border px-2.5 py-2",
                isToday && "bg-accent/60",
              )}
            >
              <span
                className={cn(
                  "text-xs text-muted-foreground",
                  isToday && "font-medium text-foreground",
                )}
              >
                {label.weekday}
              </span>
              <span
                className={cn(
                  "text-sm font-semibold tabular-nums",
                  isToday && "text-primary",
                )}
              >
                {label.day}
              </span>
              <span
                className={cn(
                  "ml-auto text-[11px] tabular-nums",
                  total > 0 && filled === total
                    ? "text-muted-foreground"
                    : "text-amber-600 dark:text-amber-400",
                )}
              >
                {total > 0 ? `${filled}/${total}` : ""}
              </span>
            </div>
          );
        })}

        {/* Open shifts lane */}
        <div className="sticky left-0 z-10 flex items-center gap-2 border-b border-border bg-card px-2 py-2 sm:px-3">
          <span className="text-sm font-medium">{t("roster.openShifts")}</span>
          {openCount > 0 ? (
            <span className="rounded-full bg-amber-100 px-1.5 text-[11px] font-medium text-amber-800 tabular-nums dark:bg-amber-900/40 dark:text-amber-300">
              {openCount}
            </span>
          ) : null}
        </div>
        {roster.days.map((date) => (
          <div
            key={date}
            {...dropProps(null, date)}
            className={cn(
              "flex min-h-14 flex-col gap-1.5 border-b border-l border-border p-1.5",
              date === roster.today && "bg-accent/30",
              dragging?.date === date &&
                dragging.staffId &&
                "bg-amber-50/70 dark:bg-amber-950/20",
            )}
          >
            {(byCell.get(`open|${date}`) ?? []).map((shift) =>
              chip(shift, true),
            )}
            <Popover
              open={addingOn === date}
              onOpenChange={(open) => setAddingOn(open ? date : null)}
            >
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-full justify-start gap-1 px-1.5 text-[11px] text-muted-foreground opacity-60 hover:opacity-100 focus-visible:opacity-100"
                  aria-label={t("roster.addShiftOn", {
                    day: dayLabel(date).long,
                  })}
                >
                  <IconPlus className="size-3" />
                  {t("roster.addShort")}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-3">
                <AddShiftForm
                  teamId={roster.team.id}
                  date={date}
                  roles={roles}
                  mutations={mutations}
                  onDone={() => setAddingOn(null)}
                />
              </PopoverContent>
            </Popover>
          </div>
        ))}

        {/* One row per person */}
        {roster.staff.map((person) => {
          const state = dragState(person.id);
          const candidate = dragCover?.get(person.id);
          const pct = Math.min(100, (person.weekHours / person.maxHours) * 100);
          const full = person.weekHours >= person.maxHours;
          return (
            <div key={person.id} className="contents">
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label={t("roster.staffDetails", { name: person.name })}
                    className={cn(
                      "sticky left-0 z-10 flex items-center gap-2.5 border-b border-border bg-card px-2 py-2 text-left transition-colors sm:px-3 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset",
                      state === "eligible" &&
                        "bg-emerald-50 dark:bg-emerald-950/30",
                      state === "blocked" && "opacity-55",
                      !person.active && "opacity-50",
                    )}
                  >
                    <span
                      className="hidden size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white sm:flex"
                      style={{
                        background: person.color ?? "var(--muted-foreground)",
                      }}
                      aria-hidden
                    >
                      {initials(person.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <span className="truncate text-sm font-medium">
                          {person.name}
                        </span>
                        {person.hasTelegram ? (
                          <IconBrandTelegram
                            className="size-3.5 shrink-0 text-sky-500"
                            aria-label={t("roster.telegramConnected")}
                          />
                        ) : null}
                        {state === "eligible" ? (
                          <IconCheck className="size-3.5 shrink-0 text-emerald-600" />
                        ) : null}
                      </div>
                      {/* While dragging, the reason replaces the skills line so row heights stay put. */}
                      {state === "blocked" && candidate ? (
                        <p
                          className="truncate text-[11px] text-muted-foreground"
                          title={candidate.violations
                            .map((v) => v.message)
                            .join(" ")}
                        >
                          {
                            candidate.violations.find(
                              (v) => v.severity !== "warn",
                            )?.message
                          }
                        </p>
                      ) : (
                        <p className="truncate text-[11px] text-muted-foreground capitalize">
                          {person.roles.join(" · ")}
                        </p>
                      )}
                      <div
                        className="mt-1 flex items-center gap-1.5"
                        title={t("roster.hoursOfMax", {
                          hours: person.weekHours,
                          max: person.maxHours,
                        })}
                      >
                        <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn(
                              "h-full rounded-full",
                              full ? "bg-amber-500" : "bg-primary/70",
                            )}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {person.weekHours}/{person.maxHours}h
                        </span>
                      </div>
                    </div>
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  side="right"
                  className="w-auto p-3"
                >
                  <StaffDetails person={person} />
                </PopoverContent>
              </Popover>
              {roster.days.map((date) => {
                const droppable = dragging?.date === date && state !== "self";
                return (
                  <div
                    key={date}
                    {...dropProps(person.id, date)}
                    className={cn(
                      "flex min-h-14 flex-col gap-1.5 border-b border-l border-border p-1.5 transition-colors",
                      date === roster.today && "bg-accent/30",
                      droppable &&
                        state === "eligible" &&
                        "bg-emerald-50 dark:bg-emerald-950/30",
                      droppable && state === "blocked" && "bg-muted/60",
                    )}
                  >
                    {(byCell.get(`${person.id}|${date}`) ?? []).map((shift) =>
                      chip(shift, false),
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
