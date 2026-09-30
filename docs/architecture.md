# Architecture

The platform (branded *Jacob Davis K* in `src/lib/brand.ts`) is a **modular monolith**: one Next.js application and one PostgreSQL database. Modules are separated in code, not by network boundaries. This is the right size for a single university (thousands of users, tens of thousands of students). The seams below are drawn so that a module can later move into its own service without redesigning its data.

```
Browser ── React Server Components (pages read)          src/app/(app)/<module>/**
        ├─ Client components + server actions (writes)    src/features/<module>/**
        └─ JSON API for integrations                      src/app/api/**            (api() wrapper)
                     │
                     ▼
  Services: business rules, authorisation, audit, events  src/server/services/**   (server-only)
        auth/current  → AuthContext { user, roles, grants: permission → department scope }
        auth/access   → query where-builders (object-level authorisation)
        workflow      → generic approval engine + module registry (src/server/workflow/**)
        events / jobs → transactional outbox + PostgreSQL job queue (scripts/worker.ts)
                     │
                     ▼
  Pure domain rules (no I/O, unit-tested)                 src/lib/domain/**
        permissions · org-scope · workflow-engine · (exam) workflow · blueprint · generator …
                     │
                     ▼
  Prisma 7 (pg driver adapter) → PostgreSQL                prisma/schema/*.prisma
        FK constraints · CHECK constraints · append-only triggers · tsvector/pg_trgm search
```

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | Keep EXAMCORE's code and grow it into the platform, rather than start again | It already had production-grade auth, RBAC, audit, a workflow state machine, tests and a design system. Rewriting would have thrown that away. |
| 2 | Modular monolith, not microservices | One team, one database and transactional consistency between modules (for example "invoice paid → exam registration allowed"). Microservices would add distributed transactions with no benefit at this scale. |
| 3 | Multi-file Prisma schema (`prisma/schema/<module>.prisma`) | The model will reach well over 100 entities. One file per module keeps ownership clear. |
| 4 | Scope resolves to department ids | Every grant, whether scoped to a department, faculty/school or campus, becomes a set of department ids when the session is built. Existing query where-builders keep working unchanged. |
| 5 | Generic workflow engine, with papers kept on their own state machine | Question papers have domain-specific states (moderation, scrutiny, lock) and DB-level lock triggers. Every other approval (access, leave, fee concessions, results, certificates…) uses one configurable engine. |
| 6 | Transactional outbox + PostgreSQL job queue (no Redis/Kafka yet) | Events and jobs are committed atomically with the change that caused them. `FOR UPDATE SKIP LOCKED` gives safe concurrent workers. Swap in a broker only when throughput demands it. |
| 7 | Integrations sit behind interfaces with an explicit "not configured" state | Payment gateways, SMS and AI providers never simulate success (spec §84). |
| 8 | Product name lives in `src/lib/brand.ts` | It can be rebranded without touching screens. The institution's own name and logo are data, set in the Configuration centre. |

## Module layout

| Layer | Location | Rule |
|---|---|---|
| Schema | `prisma/schema/<module>.prisma` | Foreign keys to master data. Never duplicate master data. |
| Domain rules | `src/lib/domain/<topic>.ts` | Pure functions only. Unit-tested. No Prisma or Next imports. |
| Services | `src/server/services/<module>.ts` | Take an `AuthContext`, check permission and scope, run in a transaction, write an audit entry and emit events. |
| Workflow hooks | `src/server/workflow/modules/<module>.ts` | Register default steps and completion hooks. Must not import the workflow service. |
| Jobs & subscribers | `src/server/jobs.ts` | `defineJob` / `onEvent` registrations, loaded by the worker. |
| Actions | `src/features/<module>/actions.ts` | `"use server"`. Thin wrappers: `requireAuth`, then the service, then `revalidatePath`. |
| UI | `src/features/<module>/*.tsx`, `src/app/(app)/<module>/**` | Pages read through scoped queries; mutations go through actions only. |

## Runtime processes

| Process | Command | Notes |
|---|---|---|
| Web | `npm start` (prod) / `npm run dev` | Stateless; scale horizontally behind a load balancer. |
| Worker | `npm run worker` | Dispatches domain events, runs queued jobs, escalates overdue approvals and sends deadline reminders. Run at least one. More are safe (SKIP LOCKED). `--once` drains and exits, for cron. |
| Database | managed PostgreSQL 14+ | `npm run db:start` gives a bundled dev server. |

See also: [authorization.md](authorization.md), [workflows.md](workflows.md), [question-paper-system.md](question-paper-system.md), [roadmap.md](roadmap.md).
