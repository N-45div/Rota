import { useT } from "@agent-native/core/client/i18n";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { dayLabel } from "./roster-types";
import type { useRosterMutations } from "./use-roster-mutations";

interface AddShiftFormProps {
  teamId: string;
  date: string;
  roles: string[];
  mutations: ReturnType<typeof useRosterMutations>;
  onDone: () => void;
}

export function AddShiftForm({ teamId, date, roles, mutations, onDone }: AddShiftFormProps) {
  const t = useT();
  const [role, setRole] = useState(roles[0] ?? "barista");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("17:00");

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!role.trim() || !start || !end) return;
    mutations.create.mutate({ teamId, shifts: [{ date, start, end, role: role.trim().toLowerCase() }] });
    onDone();
  }

  return (
    <form onSubmit={submit} className="flex w-64 flex-col gap-3">
      <p className="text-sm font-medium">{t("roster.addShiftOn", { day: dayLabel(date).long })}</p>
      <div className="space-y-1.5">
        <Label htmlFor="new-shift-role">{t("roster.role")}</Label>
        <Input
          id="new-shift-role"
          list="roster-roles"
          value={role}
          onChange={(event) => setRole(event.target.value)}
          maxLength={40}
          required
        />
        <datalist id="roster-roles">
          {roles.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="new-shift-start">{t("roster.start")}</Label>
          <Input id="new-shift-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-shift-end">{t("roster.end")}</Label>
          <Input id="new-shift-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} required />
        </div>
      </div>
      <Button type="submit" size="sm">
        {t("roster.addShift")}
      </Button>
    </form>
  );
}
