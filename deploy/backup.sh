#!/usr/bin/env bash
# Nightly Postgres backup (Plan A — local Postgres only; on Neon use its
# built-in point-in-time restore instead). Add to crontab:
#   0 3 * * * /path/to/repo/deploy/backup.sh >> /var/log/bi-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p backups
STAMP=$(date +%Y%m%d-%H%M%S)
OUT="backups/bug_intelligence-${STAMP}.sql.gz"

docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec -T postgres pg_dump -U postgres bug_intelligence | gzip > "$OUT"

# Keep 14 days
find backups -name '*.sql.gz' -mtime +14 -delete

echo "$(date -Iseconds) backup written: $OUT ($(du -h "$OUT" | cut -f1))"
