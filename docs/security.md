# Security

This summarises the controls; details are in [authentication.md](authentication.md), [authorization.md](authorization.md) and the module documents.

## Threat model (priorities)

1. **Unauthorised access to confidential academic data:** question papers before the examination, marks and results before publication, and other people's records (IDOR).
2. **Tampering with outcomes:** marks, results, payments, payroll and audit history.
3. **Account takeover:** credential stuffing, session theft.
4. **Injection:** SQL, stored XSS, formula injection in exports, malicious uploads.
5. **Abuse of public surfaces:** the admission form, the certificate verifier, the payment webhook.

## Controls

| Area | Control |
|---|---|
| Authentication | Argon2id; lockout; per-IP and per-identifier throttling; TOTP MFA (required per role); server-side sessions storing only token hashes; `__Host-` Secure HttpOnly cookie; idle and absolute expiry; revoke-all on password reset |
| Authorisation | RBAC with scoped grants (department, unit, campus, global; expiring). Every server action, page and API route checks a permission, **and** every query is scoped by a where-builder, so a record outside scope is indistinguishable from a missing one. Relationship checks cover instructor of a class, reporting manager, task assignee and data owner |
| Separation of duties | No self-approval anywhere in the workflow engine. The IT Admin cannot read papers or records. The Super Admin holds every permission by institution policy, but cannot decide its own requests, is fully audited, and should be limited to very few MFA-protected accounts. Other checks: verifier ≠ uploader for documents; reviewer ≠ preparer for IQAC metrics; research publications are verified by someone else. Payroll is computed by HR, approved by Finance and the Registrar, and paid by Accounts |
| Integrity (database-enforced) | **Append-only (trigger):** the SHA-256 hash-chained audit log, workflow actions, mark revisions, status changes, payment allocations, journal entries and lines (with balanced journals checked at commit), salary history, grant expenses, helpdesk messages and the AI usage log. **Freeze or guard:** approved papers, published results, payments (forward-only status), approved payslips and payroll runs, submitted assignments and quiz attempts. **Capacity and uniqueness:** hostel beds, transport seats, one open loan per copy |
| Confidentiality | **Files:** encrypted with AES-256-GCM before storage, served only through short-lived HMAC-signed URLs plus a session, never from `public/`. **Upload types:** detected from content (no SVG or HTML); text is served with a `sandbox` CSP. **Watermarking:** paper exports carry the viewer's identity. **Encrypted fields:** bank and tax identifiers are encrypted and only ever displayed masked. **Quizzes:** answer keys never leave the server |
| Input and output | Zod validation on every input; Prisma parameterised queries (raw SQL only with tagged templates); restricted markdown for rich content (no raw HTML); CSV cells are protected against formula injection |
| Transport and browser | HSTS; strict CSP (`frame-ancestors 'none'`, `object-src 'none'`, `form-action 'self'`; the payment provider is allowed only when configured); `X-Frame-Options: DENY`; `nosniff`; `Referrer-Policy: same-origin`; restrictive `Permissions-Policy`; COOP; same-origin checks on mutating API requests |
| Public surfaces | **Admission form:** rate-limited per IP and per e-mail; private status links hold only a token hash, compared in constant time. **Certificate verifier:** rate-limited, and shows only what is sealed. **Payment webhook:** HMAC-verified, and the payment is re-fetched from the provider before recording |
| Privacy | Least-privilege scopes; guardians see only what the institution enables per guardian; the alumni directory is opt-in; exports of personal data are flagged in the audit log. **AI:** off by default, sends no records, redacts identifiers from free text, and logs only metadata |
| Supply chain | `npm audit` reports 0 known vulnerabilities (transitive `mysql2`, `deepmerge-ts` and `uuid` are pinned to patched versions via `overrides`). Run `npm audit` in CI and before releases |

## Residual risks and recommendations before go-live

- **CSP `'unsafe-inline'` scripts** are needed by Next.js without nonces. Move to a nonce-based CSP in `src/proxy.ts`.
- **In-memory rate limits:** use a shared store when running more than one app server (see [deployment.md](deployment.md)).
- **Server actions accept bodies up to 16 MB** for uploads. Per-file limits are enforced after authentication, but consider a reverse-proxy body limit per route.
- **Development drivers:** mail (outbox table) and local storage need production adapters.
- **Testing:** commission an external penetration test; review role assignments each term (grants support expiry dates).
- **Keys:** keep `DATA_ENCRYPTION_KEY` and `APP_SECRET` in a secrets manager, rotate them with a planned re-encryption, and never commit `.env`.

## Reporting a vulnerability

Report privately to the institution's IT security contact with steps to reproduce. Do not include real student data in reports.
