# Jacob Davis K — Loyola University platform

**University ERP platform**: student information, academics, examinations and confidential question papers, results and credentials, learning management, finance, HR and payroll, research and accreditation, campus services, admissions and careers, reporting and analytics, all in one application with one security model.

| Area | Modules |
|---|---|
| Students and academics | Student register and guardians, terms and calendar, classes and timetable, registration, attendance, curricula and degree audit, student and guardian portals |
| Examinations | Question bank and blueprints, paper setting, moderation, scrutiny, approval, lock and secure export; exam registration, hall tickets, seating and invigilation, marks, valuation, grading, results, revaluation, verifiable transcripts and certificates |
| Learning | Course spaces with content, announcements, assignments, auto-graded quizzes and a gradebook |
| Finance | Fee structures, invoices, counter and online payments, concessions, refunds, scholarships, double-entry ledger |
| People | Employees, leave, staff attendance, payroll and payslips, appraisal |
| Research and quality | Sponsored projects and grants, publications, IQAC and accreditation metrics with evidence |
| Campus | Library, hostels, transport, helpdesk, announcements, student documents |
| Admissions and careers | Public online admissions with merit offers, placements, alumni |
| Insight | Report builder, institution analytics, optional AI drafting aids |
| Platform | Scoped RBAC, configurable approval workflows, domain events and job queue, tamper-evident audit log |

| | |
|---|---|
| Stack | Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · shadcn/ui · Prisma 7 · PostgreSQL · Zod · Recharts |
| Tests | Vitest unit and integration suites (integration against a disposable PostgreSQL), Playwright end-to-end and axe accessibility suites; see [docs/testing.md](docs/testing.md) |

**Documentation:**

- **Platform:** [architecture](docs/architecture.md), [roadmap](docs/roadmap.md), [database](docs/database.md), [authentication](docs/authentication.md), [authorisation](docs/authorization.md), [security](docs/security.md), [workflows](docs/workflows.md), [API](docs/api.md), [deployment](docs/deployment.md), [testing](docs/testing.md).
- **Modules:** [academics](docs/academics.md), [examination](docs/examination.md), [question papers](docs/question-paper-system.md), [LMS](docs/lms.md), [finance](docs/finance.md), [HR](docs/hr.md), [research and IQAC](docs/research-iqac.md), [campus services](docs/campus-services.md), [reporting and AI](docs/reporting-ai.md).

---

## Quick start (local development)

Requirements: **Node.js 20.9+** (22 or 24 recommended). No PostgreSQL install is needed: a local server is bundled via `embedded-postgres`.

```bash
npm install                 # also runs `prisma generate`
cp .env.example .env        # then set APP_SECRET and DATA_ENCRYPTION_KEY (see below)
npm run db:start            # terminal 1: local PostgreSQL on :54329 (data in .pgdata/)
npm run db:setup            # terminal 2: apply migrations + seed demo data
npm run dev                 # http://localhost:3100
```

Generate the two secrets with:

```bash
node -e "const c=require('crypto');console.log('APP_SECRET='+c.randomBytes(32).toString('base64url'));console.log('DATA_ENCRYPTION_KEY='+c.randomBytes(32).toString('base64'))"
```

PDF export needs a Chromium. Either `npx playwright install chromium`, or point `CHROMIUM_PATH` at an installed Chrome/Edge.

> The dev server uses port **3100**. `APP_URL` must match it, because it is used for CSRF origin checks and signed download links.

### Using an existing PostgreSQL

Set `DATABASE_URL` to any PostgreSQL 14+ database whose role may create the `pg_trgm` extension (needed on first migration). Then run `npm run db:setup` and skip `db:start`.

## Demo data & accounts

`npm run db:seed` **wipes and recreates** demo data. It refuses to run when `NODE_ENV=production`.

- **Loyola University:** 5 departments, 7 programmes and 20 courses with units, outcomes and blueprints.
- **Question bank:** 193 questions (MCQ, short/long answer, numerical, case study…) with maths and version history.
- **Archive:** the archived April 2026 session, providing usage history for reuse checks.
- **November 2026 session:** papers already in several states (draft, submitted, under scrutiny, awaiting approval) plus overdue and upcoming setter assignments.

All accounts use the password **`Examcore@2026`**. In development the sign-in page shows a **demo role selector**. It appears only when `EXAMCORE_DEMO_MODE=true` **and** `NODE_ENV !== "production"`.

| Role | E-mail | Employee ID | Scope |
|---|---|---|---|
| Super Admin | admin@example.edu | EMP1001 | **Everything**: every permission of every role, can act on any approval, class, paper or script, and can open any student's portal |
| Examination Controller | controller@example.edu | EMP1002 | Whole institution: sessions, setters, final approval & lock, packaging, audit |
| Deputy Controller | deputy@example.edu | EMP1003 | Operations and packaging; no final approval |
| Exam Cell Staff | examcell@example.edu | EMP1004 | Examinations, schedules, setter logistics, reports; no paper content |
| Approver (Dean) | approver@example.edu | EMP1005 | Final approval; archive |
| Auditor | auditor@example.edu | EMP1006 | Read-only audit log, analytics and reports |
| HoD, Computer Science | hod.cs@example.edu | EMP2001 | Department: blueprints, setter appointment, question review (also a setter) |
| Paper Setter | setter@example.edu | EMP2101 | Own assignments; question bank for their department |
| Moderator | moderator@example.edu | EMP3001 | Moderation of assigned CS papers |
| Scrutiny Officer | scrutiny@example.edu | EMP3101 | Technical scrutiny |

More setters and moderators exist (`setter2`…`setter7`, `moderator2`).

### Five-minute walkthrough

1. **Setter** (`setter@example.edu`), **Assignments**, then *Open builder* on BCS301.
   - Press **Generate** to build a paper from the blueprint, then **Apply to paper**.
   - Save with **Ctrl+S** and submit with **Ctrl+Enter**.
2. **Moderator**, **Moderation**, then open BCS301 and click **Start moderation**.
   - Replace or comment on questions, tick the validation checklist, then click **Approve & send to scrutiny**.
3. **Scrutiny Officer**, **Scrutiny**.
   - The automated checks (marks, numbering, equations, images, confidentiality…) must all pass before **Pass scrutiny**.
4. **Controller**, **Approvals**, then **Approve & lock**.
   - This creates version *2.0 FINAL*, which is immutable at the database level.
   - The final PDF, print batch and encrypted package are now available under **Packaging**.
5. **Controller** or **Auditor**, **Audit logs**, then **Verify integrity**. This recomputes the tamper-evident hash chain.

**Ctrl+K** opens the command palette and global search anywhere in the app.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js dev server, production build, and production server (port 3100) |
| `npm run db:start` | Run the bundled local PostgreSQL (dev only) |
| `npm run db:migrate` | Apply migrations (`prisma migrate deploy`) — use this in production |
| `npm run db:new-migration -- <name>` | Create a new migration after editing `prisma/schema/*.prisma` (non-interactive; review the SQL before applying) |
| `npm run rbac:sync` | Add new permissions/roles to an existing database after an upgrade (`-- --dry` to preview) |
| `npm run worker` | Background worker: domain events, job queue, workflow SLA escalation, reminders (`-- --once` for cron) |
| `npm run db:seed` / `db:setup` | Seed demo data / migrate + seed |
| `npm run jobs:reminders` | Send deadline-approaching and overdue notifications (idempotent per day — schedule it) |
| `npm run typecheck` / `lint` | TypeScript and ESLint |
| `npm test` | Unit tests |
| `npm run test:integration` | Integration tests (creates and drops the `examcore_test` database) |
| `npm run test:e2e` | Playwright end-to-end suite (**run `npm run build` first**; starts `next start` on :3200 against the test DB) |
| `npm run test:all` | Everything |

## Configuration

All settings are environment variables and are validated at start-up (`src/server/env.ts`). See `.env.example`.

| Variable | Notes |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `APP_SECRET` | ≥32 random bytes. HMAC key for signed, expiring file-download URLs |
| `DATA_ENCRYPTION_KEY` | 32 bytes, base64. AES-256-GCM key for MFA secrets and every stored file (PDFs, packages, uploads) |
| `APP_URL` | Public origin. Used for the CSRF origin check and absolute links |
| `EXAMCORE_DEMO_MODE` | Enables the demo role selector outside production |
| `STORAGE_DRIVER` / `STORAGE_DIR` | `local` keeps encrypted files outside `public/`. Swap in an object-storage adapter in `src/server/storage.ts` for production |
| `EMAIL_DRIVER` / `EMAIL_FROM` | `outbox` records mail in the `EmailOutbox` table. Add an SMTP or provider adapter in `src/server/services/notifications.ts` to deliver |
| `CHROMIUM_PATH` | Optional Chromium/Chrome/Edge executable for PDF rendering |
| `PAYMENT_GATEWAY`, `RAZORPAY_*` | Optional online fee payment (off by default; students pay at the counter) |
| `AI_PROVIDER`, `ANTHROPIC_API_KEY`, `AI_MODEL` | Optional AI drafting aids (off by default; nothing is simulated) |

Institution-level rules live in the database and are edited in the app under **Administration**, with every change audited:

- **Security:** password policy, lockout, session length, which roles must use MFA.
- **Workflow:** reuse window, similarity threshold, deadline warning days, and so on.
- **Branding and watermark policy.**

## Production deployment

1. Provision managed **PostgreSQL 14+**, with encryption at rest, automated backups and PITR.
2. Set `NODE_ENV=production` and strong unique values for `APP_SECRET` and `DATA_ENCRYPTION_KEY`, kept in a secrets manager.
   - Losing `DATA_ENCRYPTION_KEY` makes stored files and MFA enrolments unrecoverable. Back it up separately from the database.
3. Build, migrate and sync roles:

   ```bash
   npm ci && npm run build && npm run db:migrate && npm run rbac:sync
   ```

4. Create the first administrator with a one-off script or SQL, **not** the demo seed. The seed refuses to run in production.
5. Run `npm start` behind a TLS-terminating reverse proxy that sets `X-Forwarded-For`.
   - In production the session cookie is `__Host-examcore_session` (Secure, HttpOnly), and HSTS is sent, so HTTPS is required.
6. Install a Chromium on the host, or set `CHROMIUM_PATH`, for PDF generation.
7. Run the background worker (`npm run worker`) as a service. It sends notifications and runs scheduled jobs; see [docs/deployment.md](docs/deployment.md).
8. Replace the `local` storage and `outbox` e-mail drivers with your object store and mail provider.
9. Require MFA for privileged roles under **Administration → Security**. Controllers, approvers and admins are recommended.

`GET /api/health` reports database connectivity for load-balancer checks.

## Backup & restore

- **Database:** use managed snapshots/PITR, or schedule the following to encrypted, access-restricted storage:

  ```bash
  pg_dump --format=custom --file examcore-$(date +%F).dump "$DATABASE_URL"
  ```

  Restore into an empty database:

  ```bash
  pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" examcore-YYYY-MM-DD.dump
  ```

  Test a restore every term.
- **Files:** back up `STORAGE_DIR` (or the bucket) on the same schedule. Files are already encrypted, so they are useless without `DATA_ENCRYPTION_KEY`.
- **Configuration:** **Administration → Backup** exports and restores the security and workflow settings as JSON. Every value is validated on restore, and the restore is audited.
- After a restore, run **Audit logs → Verify integrity** to confirm the audit log is intact.

## Security summary

- **Passwords and sign-in**
  - Passwords are hashed with Argon2id.
  - Accounts lock after repeated failures, and sign-in is rate-limited per IP and per identifier.
  - The sign-in error is generic, so it cannot be used to discover accounts.
  - TOTP MFA is available, and can be required per role.
- **Sessions:** server-side sessions with only a SHA-256 hash of the token stored. Idle and absolute expiry. All sessions are revoked on password reset, and users can review and sign out their other sessions under **Profile**.
- **Authorisation**
  - Granular RBAC with department scoping. Every server action and API route checks permissions.
  - List queries are scoped in the database query itself, so there is no IDOR.
  - Separation of duties: a setter cannot moderate or approve their own paper, and nobody (the Super Admin included) decides their own request.
- **CSRF and headers:** same-origin check on mutating requests. Strict CSP with `frame-ancestors 'none'`, HSTS (in production), `nosniff` and a strict referrer policy.
- **Confidentiality**
  - Papers are never served from `public/`. Files are encrypted at rest (AES-256-GCM) and downloaded through short-lived HMAC-signed URLs.
  - Every export is watermarked with the viewer's identity and time, and logged.
- **Integrity**
  - The audit log is an append-only SHA-256 hash chain, and Postgres triggers reject UPDATE/DELETE on audit, version, usage and transition tables.
  - Approved and locked papers cannot be edited, which is also enforced by a trigger.
- **Input safety:** question content uses a restricted markdown subset rendered without raw HTML, so there is no stored XSS. All input is validated with Zod.

## API

JSON endpoints are available for integration. They use session cookie auth, return `{ data }` or `{ error }`, and apply the same permissions as the UI.

| Endpoint | Methods |
|---|---|
| `/api/auth` | `POST` sign in `{identifier,password,remember}` · `GET` current identity · `DELETE` sign out |
| `/api/papers` | `GET` papers in scope (metadata only) |
| `/api/papers/:id` | `GET` content (audited) · `PUT` save structure (setter, editable states only) |
| `/api/papers/:id/{submit,moderate,scrutinize,approve,lock,release,archive,reopen}` | `POST` workflow transitions |
| `/api/papers/:id/export?kind=draft\|moderation\|final` | `GET` watermarked PDF |
| `/api/questions` | `GET` full-text search with filters · `POST` create |
| `/api/questions/:id` | `GET` · `PATCH` (creates a new version) · `DELETE` (retire) |
| `/api/question-bank` | `GET` bank composition |
| `/api/examinations`, `/api/courses`, `/api/roles` | `GET` |
| `/api/assignments`, `/api/blueprints`, `/api/users` | `GET` · `POST` where permitted |
| `/api/reports`, `/api/reports/:kind?format=csv\|xlsx\|pdf` | Reports |
| `/api/audit`, `/api/audit/export` | Audit log (`?verify=1` recomputes the chain) |
| `/api/files/:id?exp=&sig=` | Signed download of an encrypted file |
| `/api/health` | Liveness and DB check |

## Project layout

```
prisma/                 schema, migrations (incl. hand-written triggers), seed + demo question banks
scripts/                local Postgres launcher, scheduled jobs
src/app/(auth)          sign-in, MFA, password reset
src/app/(app)           the application (one folder per module)
src/app/api             JSON API
src/components          shell (sidebar, command palette), shared app components, shadcn/ui
src/features            client components + server actions per module
src/lib/domain          pure domain logic: permissions, workflow, blueprint, generator, similarity, scrutiny, diff
src/server              env, db, auth, security, storage, PDF rendering, services (business logic)
tests/                  unit, integration, e2e
docs/                   architecture, security model, role matrix
```

## Known limitations

- Rate limits are held in process memory; use sticky sessions or a shared store with several app servers ([docs/deployment.md](docs/deployment.md)).
- Statutory HR filings (PF/ESI returns, Form 16), LMS rubrics/forums/plagiarism checks, and SCORM/LTI are not included; see the module documents for their "not included" lists.

- The e-mail and object-storage drivers are development implementations (outbox table, local disk). Production adapters still need to be written; the interfaces are in place.
- There are no browser push notifications, and no profile photo upload. In-app and e-mail (outbox) notifications are implemented.
- Bulk question import (CSV/Word) is not implemented. Questions are authored in the app or via `POST /api/questions`.
- The CSP allows `'unsafe-inline'` scripts (needed by Next.js without nonces). Moving to a nonce-based CSP in `proxy.ts` is a recommended hardening step before go-live.
- The E2E suite runs against a production build, so run `npm run build` before `npm run test:e2e`.
