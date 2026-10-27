#!/bin/sh
# Daily backup: Postgres dump + uploaded product images, kept for 14 days.
# Run from cron (see deploy/README.md). Copy the backups OFF the server too.
set -eu

cd "$(dirname "$0")"
BACKUP_DIR="${BACKUP_DIR:-/opt/bramhkanti/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y-%m-%d_%H%M)"
mkdir -p "$BACKUP_DIR"

# Database (custom format: restore with pg_restore)
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > "$BACKUP_DIR/db_$STAMP.dump"

# Uploaded images
docker compose exec -T medusa tar -czf - -C /repo/apps/backend/.medusa/server static \
  > "$BACKUP_DIR/static_$STAMP.tar.gz"

# Drop old backups
find "$BACKUP_DIR" -type f \( -name 'db_*.dump' -o -name 'static_*.tar.gz' \) -mtime +"$KEEP_DAYS" -delete

echo "Backup done: $BACKUP_DIR (db_$STAMP.dump, static_$STAMP.tar.gz)"
