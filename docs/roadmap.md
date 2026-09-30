# Architecture assessment & implementation roadmap

_Written 2026-09-26, at the start of the move from EXAMCORE (examination & question-paper system) to a unified university platform._

## 1. What exists (assessment)

| Area | Finding |
|---|---|
| Frontend | Next.js 16 App Router (RSC + server actions), React 19, Tailwind v4, shadcn/ui on Radix, TanStack Table, Recharts, cmdk command palette (Ctrl+K), next-themes (light/dark) |
| Backend | Same Next.js app. Business logic in `src/server/services/*` (server-only), pure rules in `src/lib/domain/*` (unit-tested), JSON API under `src/app/api/*` via the `api()` wrapper |
| Database | PostgreSQL (bundled `embedded-postgres` for dev), Prisma 7 with the `pg` driver adapter; pg_trgm + tsvector full-text search; append-only triggers and a lock-guard trigger |
| AuthN | Argon2id passwords, hashed session tokens, idle + absolute expiry, lockout, per-IP and per-identifier throttling, TOTP MFA with encrypted secrets, password reset tokens |
| AuthZ | Permission catalogue + editable roles; grants scoped to a department; where-builders (`paperWhere`, `questionWhere`…) enforce object-level access in the query |
| Audit | Hash-chained, append-only `AuditLog` with a verifier and an explorer UI |
| Modules | Examination sessions, examinations, schedules, question bank (versioned), blueprints, generator, setter appointments, paper builder, moderation → scrutiny → approval → lock, packaging (encrypted ZIP/PDF), archive, reports, analytics, notifications, templates & watermarks, administration |
| Files | AES-256-GCM encrypted storage behind a driver interface; HMAC-signed, expiring download URLs |
| Tests | 60 unit, 10 integration (disposable `examcore_test` DB), 9 Playwright E2E |
| Deployment | `setup.bat`/`start.bat` portable bundle; README covers production, backup/restore |

**Verdict:** the foundation is production-grade and worth keeping. The exam/question-paper subsystem already meets most of spec §15–§21 and §76. Nothing is rewritten; the platform grows around it.

### Technical debt / gaps found

1. The organisation model stops at *Institution → Department*. No campus, faculty/school or centre.
2. Authorisation scope is department-only. There is no campus- or faculty-level grant, and no concept of "my own record" (student / parent self-service).
3. There is no student, enrolment, attendance, marks, results, finance, HR or other administrative data. `Semester` is a curriculum number, not a calendar term.
4. The paper workflow is a hand-written state machine. That is right for papers, but other modules need a **reusable, configurable approval engine**.
5. The only background work is a reminders script. There is no job queue or domain-event outbox.
6. Branding and copy assume an examination cell.
7. `docs/ARCHITECTURE.md` described only the exam system. It is now `docs/question-paper-system.md`.

## 2. Target architecture

```
                         UNIVERSITY PLATFORM (one Next.js app, modular monolith)
  Experience   Student portal · Faculty portal · Admin workspace · Approval centre · Command palette
  Services     Identity & access · Org structure · Academic · Examination · Results · Finance · HR
               Workflow engine · Notifications · Events/jobs · Documents · Search · Reports · AI gateway
  Data         PostgreSQL (one schema, FK-linked) · encrypted object storage · audit hash chain
```

- **Modular monolith.** Every module is a folder under `src/server/services/<module>`, `src/features/<module>` and `src/app/(app)/<module>`, with its rules in `src/lib/domain`. Modules talk through service functions and domain events, never through each other's tables in UI code. This can be split into services later without redesigning the data.
- **One institutional data model.** Students, staff, courses, terms, rooms and departments are master data referenced by every module.
- **Scope-based ABAC.** A grant can be scoped to a department, an academic unit (faculty/school/centre, including descendants) or a campus. It resolves to a set of department ids, so every existing where-builder keeps working. Self-service access (a student's own record, a parent's ward) is a separate "subject" check.
- **Generic workflow engine.** Versioned definitions (steps, approver rules, parallel/any-of, conditions, SLA) drive instances and tasks. The Approval Centre lists tasks from the engine plus the specialised paper workflow.
- **Transactional outbox.** Domain events and background jobs are rows written in the same transaction as the change. A worker (`npm run worker`) claims them with `FOR UPDATE SKIP LOCKED`.
- **No fake functionality.** Integrations without credentials (payment gateway, SMS, AI provider) have real interfaces and a visible "not configured" state. Nothing ever simulates success.

## 3. Phases

| Phase | Scope | Status |
|---|---|---|
| 1 | Org hierarchy (campus, academic units), extended roles & permissions, scope ABAC, workflow engine, approval centre, events/jobs, sequences, configuration centre, rebrand | done |
| 2 | Students, guardians, batches, terms, rooms, offerings, registration, attendance, timetable, curriculum & degree audit, student/faculty portals | done |
| 3 | Exam registration & hall tickets, seating/invigilation, marks entry, grading schemes, results & GPA, result publication workflow, revaluation, transcripts & verifiable certificates | done |
| 4 | LMS: course spaces per class — modules and content (files, pages, links) with view tracking, announcements, assignments (late windows, penalties, attempts, grading, release), auto-graded timed quizzes, gradebook with transfer to internal marks | done |
| 5 | Finance: fee heads/structures, invoices, payments (idempotent), receipts, concessions, scholarships, GL posting | done (built before Phase 4 because exam and revaluation fees depend on it) |
| 6 | HR: employees & positions, leave policy/balances/applications (workflow), staff attendance, salary structures, payroll runs (workflow, GL accrual), payslips, appraisal | done |
| 7 | Research (proposal clearance workflow, sanction, budget-controlled append-only spending, publications with DOI de-duplication and verification) and IQAC/accreditation (frameworks, cycles, assigned metric responses with evidence, platform-computed values, review, compiled report) | done |
| 8 | Library (catalogue, circulation, holds, invoiced fines), hostels and transport (capacity triggers, invoiced fees), helpdesk (SLA, internal notes, ratings), announcements (audiences, scheduling), student documents (verification), admissions (public application, merit, offers, enrolment), placements (eligibility from records), alumni | done |
| 9 | Report builder (10 scoped datasets, summaries, computed fields, saved/shared definitions, audited CSV), institution analytics dashboard, AI gateway (provider abstraction, redaction, limits, usage log) with report/feedback/announcement drafting | done |
| 10 | Hardening (dependency audit clean, sandboxed text downloads, security review), performance (indexes, N+1 fixes), accessibility (axe WCAG 2.1 AA scans in CI), ERP end-to-end journeys, authentication/API/deployment/security/testing docs | done (ongoing per release) |

Each phase ends with typecheck, lint, unit and integration tests, a build, a migration review and a docs update before the next one starts.
