# OWASP Top 10 Mitigation Notes

This project uses the OWASP Top 10 web application risks as a release checklist for
the AlmaLinux/Docker/PostgreSQL deployment path.

| OWASP 2021 Category | Current Mitigations |
| --- | --- |
| A01 Broken Access Control | Route middleware enforces authentication and manager/planner/engineer/PM roles; authenticated requests re-check active user status and current role from the database; project/task/customer/visit routes include ownership checks; iCal uses scoped feed tokens instead of session JWTs; project attachments are not served from public static routes. |
| A02 Cryptographic Failures | Bcrypt password hashing; required production `JWT_SECRET`; production requires `CUSTOMER_FIELD_KEY` and `ATTACHMENT_KEY`; AES-256-GCM helpers for customer PII and attachments; reset tokens stored as hashes. |
| A03 Injection | Parameterized SQL facade; upload type allowlists; CSP blocks inline scripts; new SQL translation tests cover placeholder conversion and unsafe dialect rewrites. |
| A04 Insecure Design | DEV to PROD promotion documented; production config fails fast for missing security settings; in-app package updates/restarts are disabled in production unless explicitly opted in. |
| A05 Security Misconfiguration | Helmet/CSP/HSTS support, strict CORS default, health checks, Docker production env templates, required `APP_URL`, explicit reverse-proxy trust setting, non-root app container, and dropped Linux capabilities for the app service. |
| A06 Vulnerable and Outdated Components | Docker image builds from lockfiles; `npm test` baseline added; run `npm audit` or equivalent dependency scanning in CI before promotion. |
| A07 Identification and Authentication Failures | Rate limiting on auth endpoints; password length and expiry policy; TOTP 2FA with replay prevention; token-version checks revoke older JWTs after sensitive account changes; partial 2FA tokens and download-scoped tokens are rejected by normal API auth; failed/successful login events are audited. |
| A08 Software and Data Integrity Failures | Production updates should happen through Git/Docker deploy scripts; in-app update endpoints are blocked in production by default. |
| A09 Security Logging and Monitoring Failures | Audit log table and manager audit UI; failed login counter feeds system alerts; auth failures and successes are now recorded as audit events. |
| A10 Server-Side Request Forgery | Webhook URLs are validated before storage and again before outbound sends; the guard rejects credentials, non-HTTPS URLs, local hostnames, and DNS results resolving to private/link-local/metadata addresses. |

## Release Checklist

- Run `cd server && npm test`.
- Run `SMOKE_PASSWORD='<admin password>' ./deploy/smoke-test.sh` against DEV.
- Run dependency scanning: `npm run audit:prod` in both `server/` and `client/`.
- Confirm PROD `.env` has unique values for `JWT_SECRET`, `CUSTOMER_FIELD_KEY`, and `ATTACHMENT_KEY`.
- After setting `CUSTOMER_FIELD_KEY`, run `npm run encrypt:customers -- --dry` from `server/`, then `npm run encrypt:customers` to backfill customer `name`, contact, address, and notes fields.
- Back up `CUSTOMER_FIELD_KEY` and `ATTACHMENT_KEY` in a secrets manager before production use. Losing either key can make encrypted data unrecoverable.
- Confirm `APP_URL` is the public HTTPS production URL.
- Confirm `ALLOW_IN_APP_UPDATES=false` in production.
