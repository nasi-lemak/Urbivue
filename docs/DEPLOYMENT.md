# Urbivue Deployment Runbook

Single-box production deployment with Docker Compose. Suitable for a small/medium
municipality; split services (managed Postgres, multiple API replicas behind a load
balancer) when load demands — the code has no single-box assumptions beyond the
in-memory public rate limiter (swap for Redis when running replicas).

## 1. Prerequisites

- A Linux host with Docker + Docker Compose, 4 GB+ RAM.
- A domain + TLS terminator in front (Caddy, Traefik, nginx with certbot, or a cloud LB).
  The stack itself listens on plain HTTP :80.
- Firewall: expose 443 (via your TLS proxy) and, only if field devices publish MQTT
  directly, 1883 — and then enable Mosquitto authentication first
  (`infra/docker/mosquitto.conf` ships dev-only anonymous access).

## 2. Configuration

Set these in the shell or an `.env` file next to the compose file:

| Variable | Required | Purpose |
|---|---|---|
| `POSTGRES_PASSWORD` | yes | Database password (compose refuses to start without it) |
| `JWT_SECRET` | yes | Session token signing key — long random string |
| `INGEST_API_KEY` | yes | Shared key for HTTP telemetry ingestion |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | first run | Initial admin account for the seed |
| `ALERT_WEBHOOK_URL` | no | JSON webhook notification channel |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | no | Telegram notification channel |
| `LIGHTING_ON_START` / `LIGHTING_ON_END` | no | Street-lighting on-hours (default 19 / 7, server-local time) |
| `PUBLIC_RATE_LIMIT_PER_MINUTE` | no | Per-IP limit on public report/rating POSTs (default 10) |
| `DEPOT_LON` / `DEPOT_LAT` | no | Start point for bin collection routing |

## 3. First deployment

```bash
git clone <repo> && cd Urbivue
export POSTGRES_PASSWORD=... JWT_SECRET=... INGEST_API_KEY=...
docker compose -f infra/docker/docker-compose.prod.yml up -d --build

# Apply migrations, then seed the admin user + asset types (idempotent):
docker compose -f infra/docker/docker-compose.prod.yml exec \
  -e SEED_ADMIN_EMAIL -e SEED_ADMIN_PASSWORD api node dist/platform/db/migrate.js
docker compose -f infra/docker/docker-compose.prod.yml exec \
  -e SEED_ADMIN_EMAIL -e SEED_ADMIN_PASSWORD api node dist/platform/db/seed.js
```

Then: sign in at `https://<domain>/`, the citizen portal is `https://<domain>/portal`,
health check is `GET /api/health`.

> The seed also loads the KL demo assets. For a real city, decommission or skip them and
> import your inventory via `POST /api/assets/import?type=<assetType>&dryRun=true` (GeoJSON,
> dry-run first — it returns a per-feature validation report).

## 4. Upgrades

```bash
git pull
docker compose -f infra/docker/docker-compose.prod.yml up -d --build   # rebuild + restart
docker compose -f infra/docker/docker-compose.prod.yml exec api node dist/platform/db/migrate.js
```

Migrations are forward-only and transactional; the API tolerates a schema that is one
migration ahead. Order: build → restart → migrate is fine for additive migrations (all
current ones are); for destructive ones, migrate during a maintenance window.

## 5. Backup & restore

Nightly dump (add to cron on the host):

```bash
docker compose -f infra/docker/docker-compose.prod.yml exec -T db \
  pg_dump -U urbivue -Fc urbivue > /backups/urbivue-$(date +%F).dump
```

Restore into a fresh volume:

```bash
docker compose -f infra/docker/docker-compose.prod.yml exec -T db \
  pg_restore -U urbivue -d urbivue --clean --if-exists < /backups/urbivue-YYYY-MM-DD.dump
```

Readings are the bulk of the data. Retention: raw readings can be trimmed with a simple
scheduled `DELETE FROM readings WHERE ts < now() - interval '90 days'` until Timescale
retention policies are wired in (tracked as a deferred item).

## 6. Monitoring the platform itself

- `GET /api/health` — liveness (checks the DB round-trip); wire to your uptime monitor.
- API logs are structured NestJS output on stdout — `docker compose logs -f api`.
- Every alert also goes to the log channel, so a log aggregator captures incident history
  even without webhook/Telegram configured.
- The absence rules watch the sensors; nothing watches the API but your uptime monitor —
  do set one up.

## 7. Security notes

- All staff endpoints require JWT auth; public endpoints are read-only except report
  intake and ratings, which are rate-limited per IP.
- Set a strong `JWT_SECRET`; the API refuses to boot in production without one.
- Rotate `INGEST_API_KEY` by updating the env and restarting; devices/gateways need the
  new key. (Per-device credentials are a deferred hardening item.)
- Mosquitto must not run with `allow_anonymous true` if port 1883 is exposed beyond a
  private network.
