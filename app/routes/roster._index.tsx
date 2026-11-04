import { actionErrorMessage, useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useSetPageTitle } from "@agent-native/toolkit/app-shell";
import { IconCoffee } from "@tabler/icons-react";
import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { pickTeam } from "@/lib/last-team";

function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export default function RosterIndex() {
  const t = useT();
  useSetPageTitle(t("roster.nav"));
  const navigate = useNavigate();
  const teams = useActionQuery("list-teams", {});
  const [name, setName] = useState("");

  const seed = useActionMutation("seed-demo-team", {
    onSuccess: (result) => navigate(`/roster/${result.id}`),
    onError: (error) => toast.error(actionErrorMessage(error) ?? t("roster.createFailed")),
  });
  const create = useActionMutation("create-team", {
    onSuccess: (result) => navigate(`/roster/${result.id}`),
    onError: (error) => toast.error(actionErrorMessage(error) ?? t("roster.createFailed")),
  });

  if (teams.isPending) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col gap-3 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-28 rounded-xl" />
      </main>
    );
  }

  const first = pickTeam(teams.data?.teams ?? []);
  if (first) return <Navigate to={`/roster/${first.id}`} replace />;

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 p-6 pt-16">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold tracking-tight">{t("roster.emptyTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("roster.emptyBody")}</p>
      </div>
      <Button
        className="h-11 gap-2"
        disabled={seed.isPending}
        onClick={() => seed.mutate({ timezone: browserTimeZone() })}
      >
        <IconCoffee className="size-4" />
        {seed.isPending ? t("roster.loadingDemo") : t("roster.loadDemo")}
      </Button>
      <form
        className="space-y-3 rounded-xl border border-border p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) create.mutate({ name: name.trim(), timezone: browserTimeZone() });
        }}
      >
        <Label htmlFor="team-name">{t("roster.startFresh")}</Label>
        <div className="flex gap-2">
          <Input
            id="team-name"
            placeholder={t("roster.teamNamePlaceholder")}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
          />
          <Button type="submit" variant="outline" disabled={!name.trim() || create.isPending}>
            {t("roster.create")}
          </Button>
        </div>
      </form>
    </main>
  );
}
