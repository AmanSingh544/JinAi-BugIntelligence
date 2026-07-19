# Production Deployment — Free-Tier Runbook

Two supported shapes, both free:

| | Plan A (recommended) | Plan B (fallback) |
|---|---|---|
| Compute | Oracle Cloud Always-Free VM (4 ARM cores / 24 GB) | GCP `e2-micro` always-free VM (1 GB) |
| Database | Postgres container on the VM (`with-db` profile) | Neon free tier (pgvector, auto-wake, PITR) |
| Redis | Container on the VM (both plans) | same |
| TLS + domain | DuckDNS subdomain + Caddy auto-HTTPS (both plans) | same |
| Backups | `deploy/backup.sh` nightly cron | Neon point-in-time restore |

Why a VM and not serverless: this app runs 12 always-on BullMQ workers with
delayed retries and cron jobs. Scale-to-zero platforms stop background
processing while asleep, and per-command Redis billing (Upstash) is a cost
trap for BullMQ polling. See the discussion in the repo history.

---

## 0. One-time signups (~20 min, browser)

1. **VM** — Oracle Cloud: create an *Always Free* `VM.Standard.A1.Flex`
   instance (Ubuntu 22.04+, 2–4 OCPU, 8–24 GB). If Oracle capacity fights
   you, fall back to GCP `e2-micro` (then use Plan B for the DB).
   Open ingress ports **80** and **443** in the cloud firewall / security list.
2. **DNS** — https://duckdns.org → create `yourname.duckdns.org` pointing at
   the VM's public IP.
3. *(Plan B only)* **Neon** — create a free project, enable nothing special
   (pgvector ships enabled); copy the **pooled** and **direct** connection
   strings.
4. **UptimeRobot** (after first deploy) — free monitor on
   `https://yourname.duckdns.org/api/v1/healthz`, keyword `ok`.

## 1. Server prep (once, on the VM)

```bash
sudo apt-get update && sudo apt-get install -y git docker.io docker-compose-v2
sudo usermod -aG docker $USER && newgrp docker

git clone https://github.com/AmanSingh544/JinAi-BugIntelligence.git
cd JinAi-BugIntelligence
```

## 2. Configure

```bash
cp .env.production.example .env.production
nano .env.production
```

Minimum edits:
- `DOMAIN` — your DuckDNS name
- `JWT_SECRET` — `openssl rand -hex 32`
- `AI_API_KEY` — your Groq key
- **Plan A**: uncomment `COMPOSE_PROFILES=with-db`, set `POSTGRES_PASSWORD`
  (`openssl rand -hex 16`)
- **Plan B**: comment the local-DB lines; set Neon's `DATABASE_URL`
  (pooled, `&pgbouncer=true`) and `DIRECT_URL` (direct)

## 3. Deploy

```bash
./deploy/deploy.sh
```

The script pulls latest code, builds the dashboard with the production API
URL baked in, builds the backend image (migrations run automatically on
boot), and starts everything behind Caddy with auto-provisioned TLS.

Verify:
```bash
curl -s https://$DOMAIN/api/v1/healthz     # → {"ok":true}
```
Then open `https://$DOMAIN`, register the first account, create a project.

## 4. Point the clients at production

- **Extension popup**: API key `bi_live_…` from your project, ingest URL
  `https://$DOMAIN/api/v1/ingest/batch`.
- **Sourcemap CLI**: `BUG_INTELLIGENCE_API_URL=https://$DOMAIN/api/v1`.
- Enable replay/screenshots + sampling for the target environment in
  Settings (production environments default to off).

## 5. Ongoing

| Task | How |
|---|---|
| Update to latest code | `./deploy/deploy.sh` (CI must be green first) |
| Nightly DB backup (Plan A) | `crontab -e` → `0 3 * * * /home/USER/JinAi-BugIntelligence/deploy/backup.sh >> /var/log/bi-backup.log 2>&1` |
| Restore (Plan A) | `gunzip -c backups/FILE.sql.gz \| docker compose -f docker-compose.prod.yml --env-file .env.production exec -T postgres psql -U postgres bug_intelligence` |
| Logs | `docker compose -f docker-compose.prod.yml logs -f backend` |
| Prometheus metrics | Blocked publicly (403 at Caddy). Scrape from the VM: `curl localhost` via `docker compose exec backend wget -qO- localhost:4000/api/v1/metrics` |

## Production-safety defaults (do not change casually)

- `auto_merge_enabled` stays **false** on every repository until the autofix
  validation sandbox exists — approval-required autofix only.
- `JWT_SECRET` must never be the example value; the login system is only as
  strong as this string.
- `uploads/` lives in `./data/uploads` on the host — include it in any
  VM-level backup along with `backups/`.

## Troubleshooting

- **Caddy can't get a certificate** — DNS not propagated yet or port 80
  blocked in the cloud firewall. `docker compose … logs caddy`.
- **Backend restarts in a loop (Plan A first boot)** — Postgres was still
  initializing; it self-heals via `restart: unless-stopped` within a minute.
- **`migrate deploy` fails on Neon** — `DIRECT_URL` missing or pooled URL
  used for migrations; both must be set as documented.
- **Extension sends nothing** — re-check the ingest URL (must be
  `https://…/api/v1/ingest/batch`) and that Start Capture is on.
