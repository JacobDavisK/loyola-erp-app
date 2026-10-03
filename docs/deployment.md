# Deployment and operations

## Components

| Component | Command | Notes |
|---|---|---|
| Web application | `npm start` (after `npm run build`) | Next.js server. Put a TLS-terminating reverse proxy in front that sets `X-Forwarded-For` / `X-Forwarded-Host` |
| Background worker | `npm run worker` | Dispatches domain events and runs queued and periodic jobs (see below). Run **exactly one** instance; the queue uses `SKIP LOCKED`, so several are safe but unnecessary. `npm run worker -- --once` drains the queues once for cron-style scheduling |
| PostgreSQL 14+ | managed service recommended | The role must be able to create the `pg_trgm` extension on the first migration |
| Object storage | local encrypted directory (`STORAGE_DIR`) | Files are AES-256-GCM encrypted before they are written. For multiple app servers, use shared storage or implement the S3/GCS/Azure driver behind `StorageDriver` in `src/server/storage.ts` |
| Mail | `EmailOutbox` table | Implement an SMTP or provider sender for the outbox (the interface is in `src/server/services/notifications.ts`) |
| Chromium | on the host, or `CHROMIUM_PATH` | Needed for PDF rendering of papers and credentials |

### Periodic jobs (enqueued by the worker)

| Job | Every | Purpose |
|---|---|---|
| `workflow.escalate` | 15 min | Escalate approval tasks past their SLA |
| `reminders.deadlines` | 12 h | Question-paper deadline reminders |
| `announcements.dispatch` | 5 min | Send scheduled announcements when they go live |
| `admissions.expireOffers` | 1 h | Lapse admission offers past their validity |
| `library.reminders` | 24 h | Due-tomorrow and overdue notices |
| `video.reminders` | 1 min | "Meeting starts soon" reminders |
| `video.retention` | 24 h | Delete recordings and meeting chat past their retention period |

*Configuration centre → System health* shows the worker heartbeat, queue depth and failed jobs.

## Environment

All variables are validated at start-up (`src/server/env.ts`); see `.env.example`.

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | |
| `APP_SECRET` | yes | ≥32 random bytes; HMAC key for signed URLs and credential seals |
| `DATA_ENCRYPTION_KEY` | yes | 32 bytes base64; encrypts files, MFA secrets, bank and tax identifiers. **Back it up separately from the database**; losing it makes encrypted data unrecoverable |
| `APP_URL` | yes | Public origin, used in links and e-mails |
| `NODE_ENV=production` | yes | Enables the `__Host-` cookie, HSTS and the production CSP; disables the demo seed and selector |
| `PAYMENT_GATEWAY`, `RAZORPAY_*` | optional | Online fee payment; off (`none`) by default |
| `AI_PROVIDER`, `ANTHROPIC_API_KEY`, `AI_MODEL` | optional | AI drafting aids; off (`none`) by default |
| `STORAGE_DIR`, `EMAIL_FROM`, `CHROMIUM_PATH` | optional | |

## First installation

```bash
npm ci
npm run build
npm run db:migrate          # applies migrations, including hand-written triggers and constraints
npm run rbac:sync           # permissions and system roles (safe to re-run; only adds)
```

Create the first administrator with a one-off script or SQL, **not** the demo seed; the seed refuses to run in production. Then:

- sign in;
- enable MFA for privileged roles under *Configuration centre → Security*;
- set up the institution, campuses, academic units, departments and programmes;
- then set up terms, fee heads, the leave policy and so on.

## Upgrades

```bash
git pull && npm ci && npm run build
npm run db:migrate && npm run rbac:sync
# restart the web servers and the worker
```

Migrations are forward-only and are tested against the seeded database in CI (`npm run test:integration` recreates the test database from migrations).

## Video conferencing (optional)

Live classes and meetings need a self-hosted **OpenVidu 3** server on its own machine (public IP, DNS name,
TLS, WebRTC/TURN ports open). Without it everything else works and meetings simply cannot start.

1. Install OpenVidu with the official installer (Single Node is enough for one campus).
2. Set `VIDEO_PROVIDER`, `OPENVIDU_URL`, `OPENVIDU_API_KEY`, `OPENVIDU_API_SECRET` (and the `RECORDING_S3_*`
   variables if recording) in the ERP environment; restart.
3. Configure OpenVidu's webhook to `https://<erp>/api/video/webhooks/openvidu` (required for attendance and
   recordings).
4. Check *Configuration centre → Video & collaboration* and `GET /api/video/health`.

Monitor `/api/video/health` (503 = video service down). Recordings live in OpenVidu's S3/MinIO bucket — include
it in backups if recordings must survive a server loss. Details: `openvidu-setup.md`, `video-administration.md`,
`video-troubleshooting.md`.

## Backup and restore

- **Database:** managed snapshots with PITR, or a scheduled `pg_dump --format=custom` to encrypted storage. Restore with `pg_restore --clean --if-exists --no-owner`. **Test a restore every term.**
- **Files:** back up `STORAGE_DIR` (or the bucket) on the same schedule. The files are useless without `DATA_ENCRYPTION_KEY`.
- **Configuration:** *Configuration centre → Backup* exports and restores the settings as validated JSON.
- **After any restore:** run *Audit logs → Verify integrity*.

## Scaling notes

- **Rate limiting** (sign-in throttling, API and export limits, the public admission form) is in-process memory. Behind several app servers, either use sticky sessions or replace `src/server/security/rate-limit.ts` with a shared store (Redis or Postgres). Account lockout is stored in the database and works across instances.
- **Reports** read at most 20,000 records per run; the database does the filtering. Heavy analytics belong in a read replica: point a second Prisma client at it for `src/server/services/insights.ts`.
- **Portable Windows bundle:** `setup.bat` / `start.bat` with the embedded PostgreSQL are intended for demonstrations and single-machine pilots, not production.
