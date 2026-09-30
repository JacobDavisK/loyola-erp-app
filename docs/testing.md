# Testing

| Suite | Command | What it covers |
|---|---|---|
| Type check | `npm run typecheck` | The whole code base, including generated Prisma types |
| Lint | `npm run lint` | ESLint with React and Next rules (including the React Compiler purity and refs rules) |
| Unit | `npm test` | Pure domain rules in `src/lib/domain`: permissions and scope, the workflow engine, attendance, timetable, curriculum and degree audit, grading and GPA, valuation, seating, money and invoicing, scholarships, HR (leave, payroll, tax), LMS (windows, quiz grading, shuffling), research and IQAC, campus services (fines, SLA, merit, eligibility), the report-builder definition engine, question-paper generation and similarity |
| Integration | `npm run test:integration` | Services against a real PostgreSQL: the disposable `examcore_test` database is recreated from migrations and seeded before the run. Covers authorisation and scope, workflows end to end, database triggers (immutability, capacity, balanced journals), finance postings, payroll, LMS, research and IQAC, campus services, admissions, the report builder, analytics and the AI gateway (with an injected fake provider) |
| End-to-end | `npm run build && npm run test:e2e` | Playwright against a production build (`next start` on :3200) and the test database: sign-in and the question-paper lifecycle; leave application and approval; a timed quiz; online admission and a forged status link; library circulation; helpdesk; report builder with CSV download; access denial for students |
| Accessibility | part of `test:e2e` (`tests/e2e/a11y.spec.ts`) | axe-core WCAG 2.1 A/AA scans of 23 pages across public, student, staff, HR and finance users. The run fails on serious or critical violations |
| Everything | `npm run test:all` | All of the above except the type check and lint |

## Conventions

- **Domain rules are pure and unit-tested first.** Services orchestrate them and are covered by integration tests.
- **Integration tests use the seeded demo data** through `as(handle)` (`tests/integration/helpers.ts`), which builds the real authorisation context for a demo account.
- **Every security-relevant rule gets a negative test:** out-of-scope access, self-approval, tampering attempts against triggers, invalid transitions.
- **External services are never called in tests.** The payment gateway is verified with signed fixtures, and the AI provider is replaced with `setAiProvider(fake)`.
- **Dates:** tests that depend on "now" compute relative dates. Seeded demo data is relative to the seed time.

## CI recommendation

```bash
npm ci
npm run typecheck && npm run lint && npm test
npm run test:integration          # needs PostgreSQL (e.g. a service container) and DATABASE_URL
npm run build && npm run test:e2e # needs Playwright browsers: npx playwright install --with-deps chromium
npm audit --omit=dev
```

Manual release checks: keyboard-only walkthroughs of the main journeys; a screen-reader pass (NVDA or VoiceOver) on forms and tables; the dark-mode contrast check; and a restore from backup.
