import { actionErrorMessage, useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconBrandTelegram, IconCheck, IconCopy } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

/** Telegram status for one person: connected, or a one-tap invite to send them. */
export function TelegramConnect({ staffId, name, connected }: { staffId: string; name: string; connected: boolean }) {
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

  if (connected) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <IconBrandTelegram className="size-4 text-sky-500" />
        {t("roster.telegramConnected")}
      </p>
    );
  }

  if (share) {
    return (
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">{t("roster.inviteHint", { name: name.split(" ")[0] })}</p>
        <div className="flex items-center gap-1.5">
          <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 text-xs">{share}</code>
          <Button variant="outline" size="icon" className="size-8 shrink-0" aria-label={t("roster.copyInvite")} onClick={copy}>
            {copied ? <IconCheck className="size-3.5" /> : <IconCopy className="size-3.5" />}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8 w-full gap-1.5"
      disabled={invite.isPending}
      onClick={() => invite.mutate({ staffId })}
    >
      <IconBrandTelegram className="size-4 text-sky-500" />
      {t("roster.connectTelegram")}
    </Button>
  );
}
