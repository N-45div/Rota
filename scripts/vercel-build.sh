#!/usr/bin/env bash
# Vercel build. Production must have a real database: without DATABASE_URL the
# migrations would run against a throwaway local database and the deployed app
# would have no data store, so fail loudly instead.
set -euo pipefail
if [ "${VERCEL_ENV:-}" = "production" ] && [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set. Connect the Neon database in Vercel (project rota, Storage tab), then redeploy." >&2
  exit 1
fi
NITRO_PRESET=vercel pnpm build
if [ "${VERCEL_ENV:-}" = "production" ]; then
  pnpm migrate:production
fi
