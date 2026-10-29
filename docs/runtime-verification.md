# Runtime verification and authentication diagnostics

Stages 1–2 implementation, 29 October 2026. This does not assert that the original hosted session loss is diagnosed.

## Safe diagnostic events

Server actions emit a JSON event only when session verification fails. Fields are restricted to `event`, `action`, generated `requestId` and `category`; no user/record IDs, payloads, payment references, cookies, JWTs or exception objects are logged. Expired/missing/disabled-user sessions retain the existing `SESSION_EXPIRED` result and new-tab recovery. An exception while resolving session/user produces `AUTH_UNAVAILABLE` with a support reference, rather than incorrectly presenting it as an expired session or letting a query exception escape.

Auth.js error logging is replaced with bounded category-only events: `JWTSessionError`, `SessionTokenError`, `MissingSecret`, `UntrustedHost`, `CallbackRouteError`, `CredentialsSignin`, `AccessDenied`, `AdapterError` or `OtherAuthError`. Nested provider/adapter causes and debug metadata are excluded. Warnings produce `configuration_warning`. A request ID is generated per event; it is not a distributed trace identifier and does not prove correlation between different events.

To diagnose Vercel: filter logs by `erp.auth`, record the action support reference and category, and verify configured `AUTH_URL`, stable secret and cookie domain/protocol across deployment environments using protected settings. Never paste credential values into logs/chat. An executor-local AUTH_URL is not evidence of Vercel's configured value. Do not weaken authorization or add JWT/user-ID fallbacks to bypass a missing session.

## Read-only verifier

Run `npx tsx scripts/verify-runtime.ts`. Output is booleans/classifications only. It checks configuration presence, URL syntax, Neon endpoint/TLS settings and whether AUTH_URL is local. It does not output configured URL, hostname, token or account values. Missing base configuration fails exit status; missing management credentials are reported as capability limits rather than app failures.

Optional `--database` executes only `SELECT 1` inside a read-only transaction. Optional `--storage` performs a provider list request limited to one object and checks an existing object's private origin without printing its identity or content. Empty storage is explicitly unverified; this check does not prove upload/checksum or anonymous-denial behavior. Neither option seeds, migrates, uploads nor deletes data. Existing administrator storage-check UI performs a separately authorized temporary upload/read/denial/delete test.

## Observed in this cloud executor

Presence-only verifier executed successfully: database URL and auth secret configured; URL is a Neon endpoint requiring TLS; AUTH_URL is local. No Blob token, Vercel management token or Neon API key was present. Therefore this environment cannot inspect Vercel logs/settings, rotate database credentials, provision a Neon test branch, or perform a live Blob provider check through these credentials. No management connector was available to root at inspection.

Required external setup: securely bind a dedicated test-branch URL and management access if branch provisioning is requested; provide Vercel log/settings access; bind private Blob token through secure environment settings. Existing shared Neon business URL must not be reused for synthetic write workflows. No production credential/configuration was changed by this work.

## Executed tests

`tests/auth-recovery.test.ts`: 4 passed. Covers denied writes for missing sessions, sanitized session lookup failures, same-operation-key retry after login, and matching protection on master/archive entrypoints. Scoped ESLint passed. Parent runs final integrated typecheck/build and browser verification.
