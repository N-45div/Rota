import { actionErrorMessage, useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconBrandTelegram, IconCheck, IconCopy } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import type { RosterStaff } from "./roster-types";

export function StaffDetails({ person }: { person: RosterStaff }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const invite = useActionMutation("create-telegram-invite", {
    onError: (error) => toast.error(actionErrorMessage(error) ?? t("roster.inviteFailed")),
  });
  const share = invite.data?.link ?? (invite.data ? `/start ${invite.data.code}` : null);

  async function copy() {
    if (!share) return;
    try {
      await navigator.clipboard.writeText(share);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t("roster.copyFailed"));
    }
  }

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
        {person.hasTelegram ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <IconBrandTelegram className="size-4 text-sky-500" />
            {t("roster.telegramConnected")}
          </p>
        ) : share ? (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">{t("roster.inviteHint", { name: person.name.split(" ")[0] })}</p>
            <div className="flex items-center gap-1.5">
              <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 text-xs">{share}</code>
              <Button
                variant="outline"
                size="icon"
                className="size-8 shrink-0"
                aria-label={t("roster.copyInvite")}
                onClick={copy}
              >
                {copied ? <IconCheck className="size-3.5" /> : <IconCopy className="size-3.5" />}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-full gap-1.5"
            disabled={invite.isPending}
            onClick={() => invite.mutate({ staffId: person.id })}
          >
            <IconBrandTelegram className="size-4 text-sky-500" />
            {t("roster.connectTelegram")}
          </Button>
        )}
      </div>
    </div>
  );
}
