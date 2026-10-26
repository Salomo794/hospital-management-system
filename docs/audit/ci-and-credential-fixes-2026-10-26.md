# HMS Audit — CI Failure, Credential Logging, and Verification Record

**Repository:** `Salomo794/hospital-management-system`
**Date:** 2026-10-26
**Branch:** `appjet` (fixes applied here; nothing merged, nothing deployed)
**Companion document:** `docs/audit/initial-audit-2026-10-26.md` (initial findings HMS-001…HMS-008)

This document records what changed, and — importantly — the commands that were actually
executed. Findings carried over from the initial audit keep their IDs. Any status that
says "verified" is backed by a command run recorded in the Verification record below.

No production database, real patient record, or live credential was used. All databases
created during this work were throwaway SQLite files in temporary directories.

---

## Why CI failed on every run (closes HMS-006)

The traceable symptom was that *all* workflow runs failed with no jobs at all — no
failing step, no logs, no build output. That pattern means GitHub rejected the workflow
file before scheduling any work, not that a test failed.

The cause was in `.github/workflows/node.js.yml`:

```yaml
jobs:
  build:
    env:
      DB_PATH: ${{ runner.temp }}/hms-ci/hospital.db   # invalid here
```

`runner` is only available to a **step**, never to a job-level `env:` block. Referencing
it there makes the entire workflow invalid, so it can never start. This is a parse-time
failure, which is why 26 runs produced zero diagnostics.

**Fix:** `DB_PATH` was removed from the job-level environment and moved into the
environment of the step that actually provisions the database, where `runner` is in scope:

```yaml
    - name: Initialize and seed database
      env:
        DB_PATH: ${{ runner.temp }}/hms-ci/hospital.db
      run: |
        npm run db:setup
        npm run db:seed
```

The remaining job-level variables (`NODE_ENV`, `JWT_SECRET`) are static strings, so they
are valid at that scope.

A second, quieter CI problem was fixed at the same time: `npm run audit` is a CI step and
it previously exited non-zero because of production dependency advisories. A workflow can
be perfectly valid and still fail on that step. The advisories were fixed rather than
suppressed (see below).

**Regression test:** `server/test/ci-workflow.test.js` reads the real workflow file and
asserts that no job-level `env:` block uses a context GitHub does not expose there. It is
deliberately dependency-free (indentation-based) so it cannot rot behind a parser upgrade.

---

## Seeded portal credentials were printed to stdout (new finding: HMS-009)

| Field | Detail |
| --- | --- |
| Priority | High |
| Location | `server/config/seed.js` |

`db:seed` printed a live, working MRN/PIN pair for every seeded patient portal account,
plus the shared demo staff password:

```
Demo login credentials (password: password123):
  Admin:        admin@hospital.com
  ...
Demo patient portal credentials:
  MRN-4CFA4014: 633398
```

This is not cosmetic. `db:seed` is executed by the CI workflow, and CI logs on a public
repository are readable by anyone. Printing a *valid* portal PIN turns a build log into a
credential disclosure. The same output also lands in terminal scrollback, screen shares,
and pasted bug reports.

**Fix (two layers):**

1. Credentials are no longer printed by default. `server/config/seed.js` gained
   `shouldPrintDemoCredentials()`, which returns true only when
   `SHOW_DEMO_CREDENTIALS=true` **and** `NODE_ENV` is not `production`. When suppressed,
   the script prints how to opt in and points at the "Forgot portal PIN" flow.
2. The pre-existing production guard is unchanged and still refuses to seed at all in
   production unless `ALLOW_DEMO_SEED=true`.

**Regression test:** `server/test/seed-credentials.test.js` runs the real setup + seed
scripts in a temporary directory and asserts on the actual process output, because the
risk is precisely what the process prints:

- default run prints no `MRN-XXXXXXXX: ######` pair and does mention how to opt in;
- `SHOW_DEMO_CREDENTIALS=true` does reveal the pairs;
- `NODE_ENV=production` never prints credentials even with both override flags set;
- production seeding without an override fails with a clear message.

Verified that the test genuinely detects the old behaviour rather than passing vacuously:
against the pre-fix script (`efb30d4`) **2 of the 4 tests fail**; with the fix **4 of 4
pass**. The first check was itself initially misleading — `git checkout` restored a
committed copy that already contained the fix, so the test passed and proved nothing. The
comparison was redone against the genuine pre-fix revision.

---

## Dependency advisories (contributes to HMS-006)

`npm run audit` is a CI gate, so advisories are build failures, not suggestions.

| Package | Scope | Action |
| --- | --- | --- |
| `body-parser` < 1.20.9 | server | updated to 1.20.9 |
| `nodemailer` | server | updated to 10.2.1 |
| `follow-redirects` < 1.16.2 | client | updated to 1.16.2 |

Result: `found 0 vulnerabilities` for root, server, and client.

These are patch/minor updates within the existing stack; no framework or architecture
change was made.

---

## Verification record

Environment note: the sandbox default Node 20 caused `better-sqlite3@13.0.3` to segfault
(exit 139). All runs below used Node **22.23.4**, which is the version the root
`package.json` requires (`>=22`) and the version CI pins.

| Check | Command | Result |
| --- | --- | --- |
| Server tests | `node --test --test-concurrency=1` (in `server/`) | **167 pass, 0 fail** (baseline was 160 before the added regressions) |
| Client tests | `npm run test:client` | **247 pass**, 5 files |
| Lint | `npm run lint` | exit 0, no warnings |
| Dependency audit | `npm run audit` | `found 0 vulnerabilities` ×3, exit 0 |
| Client build | `npm run build` | exit 0, built in ~3.5s |
| CI seed sequence, exact reproduction | `db:setup` → `db:seed` with `DB_PATH` in a fresh temp dir | exit 0, database created, **0** credential pairs in output |
| `db:setup` on a non-existent nested directory | `DB_PATH=/tmp/.../nested/hospital.db npm run db:setup` | exit 0 — setup creates parent directories, so the CI step cannot fail on a missing folder |
| Pre-fix vs post-fix regression check | `server/test/seed-credentials.test.js` against `efb30d4` and current | 2 fail → 4 pass |
| Workflow structure | inspection of parsed job/step `env` blocks | no `runner` context at job level; `DB_PATH` only in the seeding step |

Checks are evidence for those commands only. They do not constitute a production-readiness
certification, and several deployment-level items remain open below.

---

## Reviewed and found already adequate

These were checked during this pass and did **not** need changes:

- **Public check-in privacy (HMS-008):** the response returns only check-in status, queue
  position, and a generic message — no name, MRN, DOB, gender, or appointment detail.
  Covered by an existing regression test.
- **Health endpoint (HMS-001):** failure responses are generic (HTTP 503); no
  `error.message` disclosure.
- **Hospital timezone (HMS-002):** date-based summaries use `zonedDate()`, not
  `toISOString()`.
- **Privilege escalation:** `POST /api/auth/register` is `authenticate` + `authorize('admin')`
  with validation middleware; it is not a public self-service endpoint.
- **Role changes:** `PUT /api/users/:id` is admin-only, validates against a fixed role
  list, records an audit entry for every audited field, and blocks an admin from
  deactivating or demoting their own account. `DELETE /api/users/:id` blocks
  self-deactivation.
- **Login abuse:** rate limiting is applied per identifier *and* per IP.
- **Audit logging** is present on user, billing, and clinical mutations; refunds have
  dedicated coverage.

---

## Still open — needs an owner decision

These are not fixed here, and are recorded rather than silently changed.

| ID | Priority | Item | Why it is not fixed in this pass |
| --- | --- | --- | --- |
| HMS-003 | High | The live SQLite database is not encrypted at rest; only backups can be encrypted. | Choosing full-disk/volume encryption versus an encrypted-database design is an infrastructure decision. Replacing SQLite would violate the stack-preservation requirement. |
| HMS-004 | High | No production mobile-money adapter for Rwanda. Paystack configuration excludes Rwanda; the only fallback is a mock. | Requires a provider contract, sandbox credentials, and verified settlement/webhook behaviour. A mock must never be enabled for real money. |
| HMS-005 | Medium | A tracked second project tree under `hospital-management-system/` (130 files) contains a **stale copy of the same invalid workflow**, plus older copies of `seed.js` and `portal.js`. | Not executed by CI (GitHub only reads `.github/workflows` at the repository root), but a real footgun: a developer could work in or copy from the wrong tree. Deleting 130 tracked files requires the owner to confirm the nested copy is unintended, so it is flagged rather than removed. |
| HMS-007 | High | `productionReadiness.js` validates HTTPS-shaped configuration but cannot prove TLS is terminated at the deployment boundary. | Must be verified against the real host/reverse proxy during deployment. |
| New | Medium | `server/config/setup.js` has no production guard, unlike `seed.js`. | Schema setup legitimately runs against production databases, so a blanket block would be wrong. Deciding the intended policy is an owner decision. |
| New | Low | CI runs on Node 22.x and 24.x only; the sandbox default (Node 20) crashes `better-sqlite3`. | The declared `engines` field already requires `>=22`, so this is consistent — noted so contributors do not debug a phantom segfault on older Node. |

---

## Scope and limitations

- Reviewed: CI workflow, seed/setup configuration, auth and user-management routes, portal
  check-in, health endpoint, time handling, dependency manifests, and the existing test
  suites.
- Not reviewed in depth here: the full billing/payment state machine, the complete
  audit-log write path for every mutating route, AI-assistant prompt handling, and
  backup restore under load.
- No merge and no deployment was performed. The changes are for review.
