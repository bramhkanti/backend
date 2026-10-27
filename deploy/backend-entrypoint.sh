#!/bin/sh
# Applies pending database migrations, then starts Medusa.
# Migrations are idempotent: already-applied ones are skipped.
set -e

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "Running database migrations..."
  npx medusa db:migrate
fi

exec "$@"
