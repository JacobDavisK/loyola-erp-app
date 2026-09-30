# API

The application is primarily driven by **server actions** (`src/features/*/actions.ts`). Each is a thin wrapper around a service in `src/server/services`, which authenticates, authorises, validates (Zod) and audits. A JSON API is also provided for integrations and scripts.

## Conventions

- **Auth:** the same session cookie as the UI. Sign in with `POST /api/auth`.
- **Envelope:** success is `{ "data": … }`; failure is `{ "error": "message", "code"?: "…" }` with the right HTTP status (401, 403, 404, 409, 422, 429, 500). Validation errors return `issues: [{ path, message }]`.
- **CSRF:** mutating requests must carry an `Origin` header matching the host; `src/proxy.ts` rejects others with 403. The payment webhook is the only exception (it is HMAC-authenticated).
- **Rate limit:** 240 requests per minute per user. Exports are limited to 10 per minute.
- **Permissions and scope** are exactly those of the UI: the same services and where-builders are used.
- **Caching:** responses are `Cache-Control: private, no-store`.

## Endpoints

| Endpoint | Methods | Permission |
|---|---|---|
| `/api/auth` | `POST` sign in `{identifier, password, remember}` · `GET` current identity · `DELETE` sign out | — |
| `/api/health` | `GET` liveness and database check (for load balancers) | public |
| `/api/users` | `GET` directory search · `POST` create | `user.directory` / `admin.users.manage` |
| `/api/roles` | `GET` | `admin.roles.manage` |
| `/api/courses`, `/api/examinations` | `GET` | `academic.view` / `exam.view` |
| `/api/questions` | `GET` search · `POST` create | `question.view` / `question.create` |
| `/api/questions/:id` | `GET` · `PATCH` (new version) · `DELETE` (retire) | question permissions |
| `/api/question-bank` | `GET` composition | `question.view` |
| `/api/blueprints`, `/api/assignments` | `GET` · `POST` | blueprint / assignment permissions |
| `/api/papers`, `/api/papers/:id` | `GET` (content is audited) · `PUT` structure | paper scope |
| `/api/papers/:id/{submit,moderate,scrutinize,approve,lock,release,archive,reopen}` | `POST` workflow transition | per transition |
| `/api/papers/:id/export?kind=draft\|moderation\|final` | `GET` watermarked PDF | export permissions |
| `/api/reports`, `/api/reports/:kind?format=csv\|xlsx\|pdf` | examination reports | `report.view` |
| `/api/report-builder/export` | `GET ?id=` saved report · `POST {definition, name}` ad-hoc; CSV | the dataset's permission (viewer's scope) |
| `/api/students/export` | `GET` CSV of the filtered student list | `student.export` |
| `/api/audit`, `/api/audit/export` | `GET` (`?verify=1` recomputes the hash chain) | `audit.view` |
| `/api/files/:id?exp=&sig=&d=` | `GET` signed, expiring download of an encrypted file; needs a session too | signature + session |
| `/api/payments/callback` | `POST` browser return from the gateway (verified) | session |
| `/api/payments/webhook` | `POST` gateway webhook | provider HMAC signature |

## Example

```bash
# Sign in and keep the cookie (a same-origin Origin header is required)
curl -c jar -H "Origin: https://erp.example.edu" -H "Content-Type: application/json" \
  -d '{"identifier":"registrar@example.edu","password":"…","remember":false}' https://erp.example.edu/api/auth

# Export a saved report
curl -b jar -o balances.csv "https://erp.example.edu/api/report-builder/export?id=<reportId>"
```

## Adding an endpoint

Wrap the handler with `api(handler, { perm })` from `src/server/api.ts`. It provides session auth, the permission check, rate limiting and error mapping. Call a **service**, never Prisma directly with user input, so that object-level scope and auditing apply.
