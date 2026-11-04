import { useActionQuery } from "@agent-native/core/client/hooks";
import { Navigate } from "react-router";

import { Skeleton } from "@/components/ui/skeleton";
import { pickTeam } from "@/lib/last-team";

/** Opens `${base}/<team>` for the last-used team; with no teams, the roster's setup screen. */
export function TeamRedirect({ base }: { base: "/staff" | "/activity" }) {
  const teams = useActionQuery("list-teams", {});
  if (teams.isPending) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-6">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-40 rounded-xl" />
      </main>
    );
  }
  const team = pickTeam(teams.data?.teams ?? []);
  return <Navigate to={team ? `${base}/${team.id}` : "/roster"} replace />;
}
