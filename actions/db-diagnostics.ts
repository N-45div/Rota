import { defineAction } from "@agent-native/core/action";
import { createDbExec, getRuntimeDatabaseUrl } from "@agent-native/core/db";
import { z } from "zod";

import { requireUser } from "../server/lib/roster.js";

// TEMPORARY (Nov 6): diagnose production query stalls. Opens a private
// connection (not the shared pool) and reports what the database is doing.
// guard:allow-resource-action-access — signed-in only, reads database session metadata, no app data; remove after diagnosis.
export default defineAction({
  description: "Internal diagnostics. Do not call.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  agentTool: false,
  mcpTool: false,
  run: async (_args, ctx) => {
    requireUser(ctx);
    const started = Date.now();
    const exec = await createDbExec({ url: getRuntimeDatabaseUrl() });
    try {
      const sessions = await exec.execute(`
        select pid, usename, application_name, client_addr::text as client, state, wait_event_type, wait_event,
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
      const settings = await exec.execute(`select current_setting('idle_in_transaction_session_timeout') as idle_tx_timeout, current_setting('statement_timeout') as statement_timeout`);
      return { ms: Date.now() - started, at: new Date().toISOString(), settings: settings.rows[0], blocked: blocked.rows, sessions: sessions.rows };
    } finally {
      await exec.close?.().catch(() => undefined);
    }
  },
});
