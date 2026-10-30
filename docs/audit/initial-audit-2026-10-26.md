# HMS Audit — Initial Findings

**Repository:** `Salomo794/hospital-management-system`  
**Audit date:** 2026-10-26  
**Status:** Initial static review; not a full production-readiness certification.

## Scope inspected

The root repository tree, README, root/server/client package manifests, CI workflow, server startup and health route, authentication middleware, database configuration, production-readiness checks, backup encryption helper, AI assistant route, mobile-money configuration/adapter, and representative server/client tests were inspected through GitHub.

No production database or real patient data was accessed. Runtime testing could not be completed in this environment.

## Confirmed findings

| ID | Priority | Finding and evidence | Impact | Status / verification |
| --- | --- | --- | --- | --- |
| HMS-001 | High | The public `GET /api/health` endpoint returned `error.message` when database readiness failed (`server/index.js`). | Database paths and internal infrastructure details could be exposed to unauthenticated callers. | **Fixed on audit branch:** failure response is now generic HTTP 503. Regression test added in `server/test/health-endpoint.test.js`. Test execution is pending. |
| HMS-002 | Medium | Three date-based summaries in `server/routes/ai.js` derived “today” from `new Date().toISOString()` instead of the configured hospital timezone. The app already provides `zonedDate()` in `server/config/time.js`. | Around midnight, appointment and operational summaries could use the wrong calendar day for the hospital. | **Fixed on audit branch:** all three use `zonedDate()`. A boundary-time integration regression test was added to `server/test/api.test.js`. Test execution is pending. |
| HMS-003 | High / deployment decision | The backup encryption helper explicitly notes that the SQLite database itself is not encrypted at rest; only backups can be encrypted (`server/utils/backupCrypto.js`). | A copied or stolen live database file could expose sensitive records if host/storage access is compromised. | **Open:** decide and verify host-volume encryption or an approved encrypted-database approach before handling real patient data. This requires a deployment/architecture decision, not a silent database replacement. |
| HMS-004 | High / integration dependency | The configured mobile-money adapters are Paystack and a development/test mock. The configuration explicitly excludes Rwanda from Paystack's chargeable mobile-money markets; there is no Mukuru adapter in `server/services/mobileMoney.js`. | Automated MTN Rwanda/Airtel Money collection is not established by the current adapter configuration. A mock cannot be used for real settlement. | **Open:** obtain an approved provider contract, sandbox credentials, current API/webhook documentation, and verify end-to-end settlement before enabling a Rwandan provider. |
| HMS-005 | Medium | The repository contains a second project tree under `hospital-management-system/`, including its own README and package manifest. Its documented scripts differ from the root manifest, and code-search results show older copies of the health and UTC-date patterns. | Developers may edit, test, or deploy the wrong copy; fixes can drift between trees. | **Open:** determine which copy is authoritative. No files were deleted because the intended use of the nested copy is not established. |
| HMS-006 | High / verification blocker | GitHub Actions reports failed runs for both the audit branch and the current `main` commit. The available run/job API response did not expose job details, so the failing step could not be established. | The changes cannot be claimed to pass CI, and the baseline CI failure needs diagnosis before merge. | **Open:** inspect the Actions run details in GitHub and rerun the checks once the cause is known. |
| HMS-007 | High / deployment verification | `server/config/productionReadiness.js` checks HTTPS-shaped public URL and CORS configuration, but its own comment notes that it cannot prove TLS is actually terminated securely at the deployment boundary. | Configuration checks alone cannot prove live traffic is protected by HTTPS. | **Open:** verify TLS at the actual host/reverse proxy and test the deployed endpoint before production use. |

| HMS-008 | High | The unauthenticated public `POST /api/portal/checkin` accepts patient identifiers and originally returned the patient's name, MRN, date of birth, gender, and appointment details. An MRN/access code is not an authentication factor. | Anyone who knows or guesses an identifier could retrieve personal/appointment information and trigger a check-in in the patient's name. | **Partially mitigated on audit branch:** response now contains only check-in status, queue position, and a generic message; regression test execution is pending. The endpoint still allows unauthenticated check-in by identifier, so production should require a patient PIN/portal session or a purpose-built, high-entropy, expiring kiosk token before enabling this workflow. |\n\n## Existing safeguards observed

- Server-side JWT authentication and role authorization middleware.
- Request validation, rate limiting, security headers, and generic handling for most server errors.
- Password-reset logic and session invalidation after password changes.
- Audit logging utilities and multiple server/client test files.
- Backup creation, integrity verification, restore support, and optional authenticated backup encryption.
- Payment state handling that distinguishes pending and completed transactions, with a mock provider restricted to non-production use by configuration.

These observations are code-level only; they do not prove every route or workflow is correct.

## Verification record

- Static repository inspection: completed for the files listed in scope.
- Regression tests added: health-error disclosure and hospital-timezone appointment summaries.
- Local tests/build: **not run**; this environment could not resolve GitHub to clone the repository.
- GitHub Actions: **failed** for the audit branch and baseline `main`; actionable job logs were unavailable through the connected API during this review.
- Real payment provider sandbox: **not tested**.
- Production deployment, TLS, backup restoration against an isolated production-like environment, clinical review, and regulatory review: **not performed**.

## Recommended next steps

1. Diagnose the existing GitHub Actions failure and obtain a passing test/build run.
2. Review the two code fixes and regression tests on the audit pull request.
3. Decide which repository tree is authoritative and resolve the duplicate project copy without deleting anything until confirmed.
4. Agree on database-at-rest protection and an approved Rwanda payment provider.
5. Run the full root-level checks (`npm run check`, `npm run audit`) in a clean environment, then review each result.
6. Perform route-by-route authorization/data-integrity review and isolated backup/restore verification.
7. Complete qualified clinical, privacy, security, operational, and regulatory review before using real patient data.

**Conclusion:** This is an initial evidence-based audit, not a declaration that the HMS is production-ready.

## Follow-up — 2026-10-27

Local verification on Node 22.23 (disposable SQLite database, demo seed only):
`db:setup`, `db:seed`, `lint`, server tests, client tests, `build` and `audit` all ran.

| ID | Update |
| --- | --- |
| HMS-006 | **Root cause established.** Runs 40339101273 and 40339968348 (on `main`, commit `644cc61`) ended in 0s with no jobs: GitHub reported "workflow file issue". `.github/workflows/node.js.yml` on `main` used the `runner` context in job-level `env`, which is not available there. Fixed by `c1ae844` on this branch (path exported from a step). Workflow run 40489058274 on this branch passed on Node 22.x and 24.x. `main` stays broken until this branch is merged. |
| HMS-008 | **Fixed, verified locally.** `POST /api/portal/checkin` now requires either a valid portal session or an identifier plus the patient's portal PIN. Unknown, ambiguous, wrong-PIN and PIN-less records return the same 401; PIN guesses are limited per patient and address; the typed identifier is no longer stored in `checkins.qr_token`. Four regression tests in `server/test/api.test.js`. A purpose-built expiring kiosk token is still a possible later improvement; patients without a provisioned PIN cannot use anonymous check-in until staff issue one. |
| HMS-005 | **Evidence gathered, not deleted.** `hospital-management-system/` is a single-commit older snapshot (no `productionReadiness.js`, no `AppIcon.vue`, older views). Nothing in CI, `render.yaml`, `vercel.json`, root `package.json` or the README references it. It appears obsolete, but removal needs the owner's confirmation. |

## Follow-up — 2026-10-30

Both tracked project trees now use MySQL only; SQLite runtime code and the `better-sqlite3` dependency have been removed. The nested server suite passed all 129 tests against the dedicated `hms_test` schema. SQLite references in the original findings and verification record describe the earlier audit state only. The nested project was retained and converted rather than deleted. HMS-003's deployment concern remains: database-at-rest protection must be provided and verified by the MySQL host; backup encryption alone does not protect the live database.
