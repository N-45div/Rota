import { actionErrorMessage, useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconArrowsExchange } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import type { Roster } from "./roster-types";

type Swap = Roster["swaps"][number];

const first = (name: string) => name.split(" ")[0] ?? name;

/** Swaps on this week: ones both staff agreed to wait for the manager here. */
export function SwapRequests({ swaps }: { swaps: Swap[] }) {
  const t = useT();
  const [busy, setBusy] = useState<{ id: string; approve: boolean } | null>(null);
  const decide = useActionMutation("decide-swap", {
    onSuccess: (result) => {
      toast.success(result.summary);
      for (const warning of result.warnings) toast.warning(warning);
    },
    onError: (error) => toast.error(actionErrorMessage(error) ?? t("swaps.failed")),
    onSettled: () => setBusy(null),
  });

  if (swaps.length === 0) return null;
  const waiting = swaps.filter((s) => s.status === "agreed");
  const asked = swaps.filter((s) => s.status === "asked");

  function act(swap: Swap, approve: boolean) {
    setBusy({ id: swap.id, approve });
    decide.mutate({ swapId: swap.id, approve });
  }

  return (
    <section
      aria-label={t("swaps.title")}
      className="flex flex-col divide-y divide-primary/15 rounded-2xl border border-primary/25 bg-primary/[0.06]"
    >
      {waiting.map((swap) => (
        <div key={swap.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <IconArrowsExchange className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium">
              {t("swaps.wantToSwap", { a: first(swap.requester), b: first(swap.peer) })}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("swaps.detail", {
                a: first(swap.requester),
                aTakes: swap.peerShift,
                b: first(swap.peer),
                bTakes: swap.requesterShift,
              })}
              {swap.note ? ` · “${swap.note}”` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-8" disabled={busy !== null} onClick={() => act(swap, false)}>
              {busy?.id === swap.id && !busy.approve ? t("swaps.turningDown") : t("swaps.turnDown")}
            </Button>
            <Button size="sm" className="h-8" disabled={busy !== null} onClick={() => act(swap, true)}>
              {busy?.id === swap.id && busy.approve ? t("swaps.approving") : t("swaps.approve")}
            </Button>
          </div>
        </div>
      ))}
      {asked.map((swap) => (
        <div key={swap.id} className="flex items-center gap-3 px-4 py-2 text-xs text-muted-foreground">
          <IconArrowsExchange className="size-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1">
            {t("swaps.asked", {
              a: first(swap.requester),
              b: first(swap.peer),
              aShift: swap.requesterShift,
              bShift: swap.peerShift,
            })}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 text-xs"
            disabled={busy !== null}
            onClick={() => act(swap, false)}
          >
            {busy?.id === swap.id ? t("swaps.turningDown") : t("swaps.turnDown")}
          </Button>
        </div>
      ))}
    </section>
  );
}
