# Authentication

Code: `src/server/auth/{login,session,current}.ts`, `src/server/security/{password,totp,rate-limit,crypto}.ts`, `src/app/(auth)`.

## Sign-in

- **Identifier:** e-mail address or employee ID. Students and guardians sign in with the e-mail on their portal account.
- **Passwords:** hashed with **Argon2id** (OWASP parameters: 19 MiB memory, 2 iterations). The policy (length, character classes, maximum age) is configured under *Configuration centre → Security*.
- **Generic errors:** a wrong password and an unknown account produce the same message, so sign-in cannot be used to discover accounts.
- **Throttling:** per IP and per identifier.
- **Lockout:** after `maxFailedLogins` consecutive failures, the account is locked for `lockoutMinutes`. The lock and each failure are audited.
- **MFA (TOTP):** users enrol under *Profile & security*; the secret is stored encrypted (AES-256-GCM). Roles listed in `security.requireMfaForRoles` must enrol, and the app keeps them on the enrolment page until they do. After the password step, a session exists only in the *MFA pending* state, which can do nothing but complete the second factor.
- **Password reset:** single-use, expiring token (only its hash is stored) sent by e-mail. A successful reset revokes every session of the account.
- **Demo selector:** exists only when `NODE_ENV` ≠ production **and** `EXAMCORE_DEMO_MODE=true`.

## Sessions

- A random 256-bit token lives in an HttpOnly, SameSite=Lax cookie. The cookie is `__Host-examcore_session` (Secure, host-only) in production, so HTTPS is required.
- The database stores only the token's **SHA-256** hash, together with device, IP and last-seen time.
- **Expiry:** absolute (`sessionAbsoluteHours`, or `rememberDeviceDays` with *Remember this device*) and idle (`sessionIdleMinutes`; not applied to remembered devices). Both are checked on every request.
- Users review and revoke their other sessions under *Profile & security*. Administrators can revoke all of a user's sessions.
- `src/proxy.ts` only checks that a session cookie is present, a cheap edge check. **Real validation happens on the server for every page, action and API call** (`readSession` → `buildAuthContext`).

## The authorisation context

`buildAuthContext` resolves, once per request:

- the user's roles and grants, with scope (department, academic unit, campus or global) and optional expiry;
- the **subject**: the student record linked to a student account, wards for a guardian, and the employee record for staff;
- the permission map used by `can`, `scopeOf` and the where-builders.

See [authorization.md](authorization.md).

## Accounts that are not staff

- **Students:** the registry provisions a portal account from the student record (unique e-mail).
- **Guardians:** accounts are provisioned per guardian, with separate switches for academic and fee visibility.
- **Applicants** never get an account. The public application uses a private status link: the application number plus a 24-byte token, of which only the hash is stored and which is compared in constant time.
- **Graduates** keep their student account (status Graduated) for alumni features and certificates.

## Service-to-service

The payment-gateway webhook (`/api/payments/webhook`) is the only unauthenticated mutating endpoint. It is authenticated by the provider's HMAC signature, and the payment is re-fetched from the provider before anything is recorded. See [finance.md](finance.md).
