#!/usr/bin/env bash
# Deploy / update the production stack. Run from the repo root on the server:
#   ./deploy/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=.env.production
if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE — copy .env.production.example and fill it in." >&2
  exit 1
fi

DOMAIN=$(grep -E '^DOMAIN=' "$ENV_FILE" | head -1 | cut -d= -f2)
if [ -z "$DOMAIN" ] || [ "$DOMAIN" = "yourname.duckdns.org" ]; then
  echo "Set a real DOMAIN in $ENV_FILE first." >&2
  exit 1
fi

echo "→ Pulling latest code"
git pull --ff-only

echo "→ Building dashboard (VITE_API_URL=https://${DOMAIN}/api/v1)"
docker run --rm \
  -v "$PWD/dashboard":/app -w /app \
  -e VITE_API_URL="https://${DOMAIN}/api/v1" \
  node:20-alpine sh -c "npm ci --no-audit --no-fund && npm run build"

echo "→ Building + starting services"
docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" up -d --build

docker image prune -f >/dev/null

echo "✓ Deployed: https://${DOMAIN}"
echo "  Health:   curl -s https://${DOMAIN}/api/v1/healthz"
