import { actionErrorMessage, useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";

import type { RosterStaff } from "./roster-types";

interface PersonSheetProps {
  teamId: string;
  /** The person to edit; omit to add someone new. */
  person?: RosterStaff | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const fieldClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function splitSkills(value: string) {
  return value
    .split(",")
    .map((skill) => skill.trim().toLowerCase())
    .filter(Boolean);
}

export function PersonSheet({ teamId, person, open, onOpenChange }: PersonSheetProps) {
  const t = useT();
  const editing = Boolean(person);
  const [name, setName] = useState("");
  const [skills, setSkills] = useState("");
  const [maxHours, setMaxHours] = useState("40");
  const [notes, setNotes] = useState("");
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (!open) return;
    setName(person?.name ?? "");
    setSkills(person?.roles.join(", ") ?? "");
    setMaxHours(String(person?.maxHours ?? 40));
    setNotes(person?.notes ?? "");
    setActive(person?.active ?? true);
  }, [open, person]);

  const close = () => onOpenChange(false);
  const add = useActionMutation("add-staff", {
    onSuccess: (result) => {
      toast.success(t("team.added", { name: result.staff[0]?.name ?? name }));
      close();
    },
    onError: (error) => toast.error(actionErrorMessage(error) ?? t("team.saveFailed")),
  });
  const update = useActionMutation("update-staff", {
    onSuccess: () => {
      toast.success(t("team.saved"));
      close();
    },
    onError: (error) => toast.error(actionErrorMessage(error) ?? t("team.saveFailed")),
  });
  const pending = add.isPending || update.isPending;
  const hours = Number.parseInt(maxHours, 10);
  const valid = name.trim().length > 0 && Number.isFinite(hours) && hours >= 1 && hours <= 80;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!valid || pending) return;
    const roles = splitSkills(skills);
    if (person) {
      update.mutate({
        staffId: person.id,
        name: name.trim(),
        roles,
        maxHours: hours,
        notes: notes.trim() ? notes.trim() : null,
        active,
      });
    } else {
      add.mutate({
        teamId,
        staff: [{ name: name.trim(), roles, maxHours: hours, ...(notes.trim() ? { notes: notes.trim() } : {}) }],
      });
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="font-display text-2xl">{editing ? person?.name : t("team.addTitle")}</SheetTitle>
          <SheetDescription>{editing ? t("team.editDescription") : t("team.addDescription")}</SheetDescription>
        </SheetHeader>
        <form id="person-form" onSubmit={submit} className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
          <div className="space-y-1.5">
            <Label htmlFor="person-name">{t("team.name")}</Label>
            <Input id="person-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="person-skills">{t("team.skills")}</Label>
            <Input
              id="person-skills"
              value={skills}
              placeholder={t("team.skillsPlaceholder")}
              onChange={(e) => setSkills(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t("team.skillsHint")}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="person-hours">{t("team.maxHours")}</Label>
            <Input
              id="person-hours"
              type="number"
              inputMode="numeric"
              min={1}
              max={80}
              className="w-28"
              value={maxHours}
              onChange={(e) => setMaxHours(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="person-notes">{t("team.notes")}</Label>
            <textarea
              id="person-notes"
              rows={3}
              maxLength={300}
              className={fieldClass}
              value={notes}
              placeholder={t("team.notesPlaceholder")}
              onChange={(e) => setNotes(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t("team.notesHint")}</p>
          </div>
          {editing ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-[hsl(var(--primary))]"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
              {t("team.activeLabel")}
            </label>
          ) : null}
        </form>
        <SheetFooter className="border-t border-border">
          <Button type="submit" form="person-form" disabled={!valid || pending}>
            {pending ? t("team.saving") : editing ? t("team.save") : t("team.add")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
