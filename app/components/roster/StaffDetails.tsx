import { useT } from "@agent-native/core/client/i18n";

import type { RosterStaff } from "./roster-types";
import { TelegramConnect } from "./TelegramConnect";

export function StaffDetails({ person }: { person: RosterStaff }) {
  const t = useT();
  return (
    <div className="flex w-72 flex-col gap-3 text-sm">
      <div>
        <p className="font-medium">{person.name}</p>
        <p className="text-xs text-muted-foreground">
          <span className="capitalize">{person.roles.join(" · ")}</span> ·{" "}
          {t("roster.hoursOfMax", { hours: person.weekHours, max: person.maxHours })}
        </p>
      </div>

      {person.notes ? <p className="text-xs">{person.notes}</p> : null}

      {person.availability.length > 0 ? (
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">{t("roster.unavailable")}</p>
          <ul className="space-y-0.5 text-xs">
            {person.availability.map((rule) => (
              <li key={rule.id}>{rule.text}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="border-t border-border pt-3">
        <TelegramConnect staffId={person.id} name={person.name} connected={person.hasTelegram} />
      </div>
    </div>
  );
}
