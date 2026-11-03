#!/usr/bin/env bash
# Vercel build for Rota.
#
# Database URLs (Supabase):
#   DATABASE_URL            transaction pooler (port 6543) for the app at runtime
#   DATABASE_MIGRATION_URL  session pooler (port 5432) for release migrations;
#                           migrations take advisory locks, which a transaction
#                           pooler can't hold across statements.
set -euo pipefail

if [ "${VERCEL_ENV:-}" = "production" ]; then
  if [ -z "${DATABASE_URL:-}" ]; then
    echo "DATABASE_URL is not set. Add the Supabase transaction pooler URL in Vercel (project rota, Settings, Environment Variables), then redeploy." >&2
    exit 1
  fi
  if [ -z "${DATABASE_MIGRATION_URL:-}" ] && [[ "$DATABASE_URL" == *":6543"* ]]; then
    echo "DATABASE_URL is a transaction pooler URL. Also set DATABASE_MIGRATION_URL to the Supabase session pooler URL (port 5432) so migrations run safely." >&2
    exit 1
  fi
fi

NITRO_PRESET=vercel pnpm build

if [ "${VERCEL_ENV:-}" = "production" ]; then
  DATABASE_URL="${DATABASE_MIGRATION_URL:-$DATABASE_URL}" pnpm migrate:production
fi
