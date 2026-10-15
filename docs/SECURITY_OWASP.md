# OWASP Top 10 Mitigation Notes

This project uses the OWASP Top 10 web application risks as a release checklist for
the AlmaLinux/Docker/PostgreSQL deployment path.

| OWASP 2021 Category | Current Mitigations |
| --- | --- |
| A01 Broken Access Control | Route middleware enforces authentication and manager/planner/engineer/PM roles; authenticated requests re-check active user status and current role from the database; module permissions (and their revocation) cover the module's related endpoints too (attachments, milestones, time logs, calendar, iCal feed, search); project/task/customer/visit routes include ownership checks; task updates refuse a change made by someone else meanwhile (409); iCal uses scoped feed tokens instead of session JWTs; project attachments are not served from public static routes. |
| A02 Cryptographic Failures | Bcrypt password hashing; required production `JWT_SECRET`; production requires `CUSTOMER_FIELD_KEY` and `ATTACHMENT_KEY`; AES-256-GCM helpers for customer PII, attachments and 2FA seeds; reset and email-confirmation tokens stored as hashes; SFTP copies only sign in to a trusted host key; backup checks keep the database address's `sslmode` verification. |
| A03 Injection | Parameterized SQL (`?` placeholders converted to `$n`; values are never concatenated into SQL, and report definitions use registry keys rather than identifiers from the browser); a test rejects SQLite-only syntax; CI prepares every static SQL statement against PostgreSQL; uploaded backups are checked statement by statement against what pg_dump writes (a narrowing check, not a sandbox: the app's database user must not be a superuser); CSV exports encode every cell and neutralise formulas; upload type allowlists; CSP blocks inline scripts. |
| A04 Insecure Design | DEV to PROD promotion documented; production config fails fast for missing security settings; in-app package updates/restarts are disabled in production unless explicitly opted in. |
| A05 Security Misconfiguration | Helmet/CSP/HSTS support, strict CORS default, health checks, Docker production env templates, required `APP_URL`, explicit reverse-proxy trust setting, non-root app container, dropped Linux capabilities for the app service; the production Compose file removes the database port (`!reset`), checked in CI. |
| A06 Vulnerable and Outdated Components | Docker image builds from lockfiles; CI runs `npm test`, `npm audit --omit=dev` and a full `npm audit` (development and test tools too) for server and client on every push and pull request. |
| A07 Identification and Authentication Failures | Rate limiting on auth endpoints per address, and per account for sign-in, 2FA codes and in-session password checks; password length and expiry policy; TOTP 2FA with replay prevention, set up by POST with the new seed kept apart until confirmed; turning 2FA off ends other sessions; a new email needs the current password and confirmation from the new address, and the old address is told; Microsoft sign-in binds to the identity provider's subject, not the email; token-version checks revoke older JWTs after sensitive account changes; partial 2FA tokens and download-scoped tokens are rejected by normal API auth. |
| A08 Software and Data Integrity Failures | Production updates should happen through Git/Docker deploy scripts; in-app update endpoints are blocked in production by default. |
| A09 Security Logging and Monitoring Failures | Audit log table and manager audit UI; failed login counter feeds system alerts; sign-in, 2FA and email changes are recorded as audit events; error logs carry only safe fields (never request bodies, query strings or database detail). |
| A10 Server-Side Request Forgery | Every outbound address people type (webhooks, Request Tracker, software feeds, SAML metadata) is checked before use: https, no credentials, no local host names, and no private, loopback, link-local, metadata or embedded-IPv4 (mapped, NAT64, 6to4, Teredo) addresses in any IPv6 spelling. Requests then connect only to the checked addresses (no second DNS answer) and do not follow redirects, except software feeds, which follow at most 3, each checked the same way. |

## Release Checklist

- Run `cd server && npm test` and `cd client && npm test && npm run test:e2e` (CI runs these plus the PostgreSQL checks; confirm the latest CI run on the release branch is green).
- Run `SMOKE_PASSWORD='<admin password>' ./deploy/smoke-test.sh` against DEV.
- Run dependency scanning: `npm audit` (all dependencies) in both `server/` and `client/`.
- Confirm the app's database user is not a superuser (see deploy/README.md, Backups).
- Confirm PROD `.env` has unique values for `JWT_SECRET`, `CUSTOMER_FIELD_KEY`, and `ATTACHMENT_KEY`.
- After setting `CUSTOMER_FIELD_KEY`, run `npm run encrypt:customers -- --dry` from `server/`, then `npm run encrypt:customers` to backfill customer `name`, contact, address, and notes fields.
- Back up `CUSTOMER_FIELD_KEY` and `ATTACHMENT_KEY` in a secrets manager before production use. Losing either key can make encrypted data unrecoverable. If either key is ever suspected compromised, see [KEY_ROTATION.md](KEY_ROTATION.md) — rotation needs a maintenance window with the current design, not a config change.
- Confirm `APP_URL` is the public HTTPS production URL.
- Confirm `ALLOW_IN_APP_UPDATES=false` in production.
