import { defineAction } from "@agent-native/core/action";
import { createDbExec, getRuntimeDatabaseUrl, type DbExec } from "@agent-native/core/db";
import { z } from "zod";

import { requireUser } from "../server/lib/roster.js";

// TEMPORARY (Nov 6): diagnose production query stalls. Uses private
// connections (not the shared pool) and reports what the database is doing.
// guard:allow-resource-action-access — signed-in only, reads database session metadata, no app data; remove after diagnosis.

const STUCK_SQL = `state = 'active' and wait_event = 'ClientRead' and now() - query_start > interval '60 seconds'`;

async function withExec<T>(url: string, run: (exec: DbExec) => Promise<T>): Promise<T> {
  const exec = await createDbExec({ url });
  try {
    return await run(exec);
  } finally {
    await exec.close?.().catch(() => undefined);
  }
}

/** Fire concurrent queries on one connection (they pipeline) and time them. */
async function pipelineProbe(url: string) {
  return withExec(url, async (exec) => {
    const results: string[] = [];
    for (let round = 0; round < 3; round++) {
      const started = Date.now();
      const outcomes = await Promise.allSettled(
        Array.from({ length: 12 }, (_, i) =>
          exec.execute({ sql: "select $1::int as n, now() as at, (select count(*) from activity) as c", args: [i] }),
        ),
      );
      const failed = outcomes.filter((o) => o.status === "rejected").length;
      results.push(`${Date.now() - started}ms${failed ? ` (${failed} failed)` : ""}`);
    }
    return results;
  });
}

export default defineAction({
  description: "Internal diagnostics. Do not call.",
  schema: z.object({
    experiment: z.enum(["none", "pipeline"]).default("none"),
    terminateStuck: z.enum(["no", "yes"]).default("no"),
  }),
  http: { method: "GET" },
  readOnly: true,
  agentTool: false,
  mcpTool: false,
  run: async ({ experiment, terminateStuck }, ctx) => {
    requireUser(ctx);
    const started = Date.now();
    const url = getRuntimeDatabaseUrl();
    const report: Record<string, unknown> = {};
    await withExec(url, async (exec) => {
      if (terminateStuck === "yes") {
        const killed = await exec.execute(
          `select pid, pg_terminate_backend(pid) as ok from pg_stat_activity where datname = current_database() and ${STUCK_SQL}`,
        );
        report.terminated = killed.rows;
      }
      const sessions = await exec.execute(`
        select pid, usename, application_name, state, wait_event_type, wait_event,
               extract(epoch from now() - backend_start)::int as conn_s,
               extract(epoch from now() - xact_start)::int as xact_s,
               extract(epoch from now() - query_start)::int as query_s,
               left(regexp_replace(query, '\\s+', ' ', 'g'), 100) as query
        from pg_stat_activity
        where datname = current_database() and pid <> pg_backend_pid()
        order by xact_start nulls last
        limit 40`);
      const blocked = await exec.execute(`
        select a.pid, left(regexp_replace(a.query, '\\s+', ' ', 'g'), 80) as query, pg_blocking_pids(a.pid) as blocked_by
        from pg_stat_activity a
        where cardinality(pg_blocking_pids(a.pid)) > 0
        limit 20`);
      const settings = await exec.execute(
        `select current_setting('idle_in_transaction_session_timeout') as idle_tx_timeout, current_setting('statement_timeout') as statement_timeout`,
      );
      Object.assign(report, { settings: settings.rows[0], blocked: blocked.rows, sessions: sessions.rows });
    });
    if (experiment === "pipeline") {
      const port = (() => {
        try {
          return new URL(url).port;
        } catch {
          return "?";
        }
      })();
      const sessionUrl = url.replace(":6543/", ":5432/");
      const probe = async (u: string) => pipelineProbe(u).catch((err) => [`error: ${err instanceof Error ? err.message : String(err)}`]);
      report.pipeline = {
        runtimePort: port,
        transactionPooler: port === "6543" ? await probe(url) : "not on 6543",
        sessionPooler: sessionUrl !== url ? await probe(sessionUrl) : "no session url",
      };
    }
    return { ms: Date.now() - started, at: new Date().toISOString(), ...report };
  },
});
