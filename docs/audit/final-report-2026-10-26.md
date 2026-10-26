# HMS — Final Audit & Verification Report

**Date:** 2026-10-26
**Branch:** `appjet` — verification in §3 was executed at commit `148f997` (later commits in this
branch are documentation corrections only and do not change code or test outcomes)
**Base:** `main` @ `644cc61` — `appjet` is **63 ahead / 0 behind**, so it merges as a clean
fast-forward with no conflicts
**Status:** All local checks pass. **Nothing has been merged or deployed.**

---

## 0. TL;DR

| Area | State |
|---|---|
| CI root cause | **Identified and fixed** on `appjet` (invalid workflow, not a test failure) |
| Public patient check-in | Re-secured with expiring, hashed, single-use kiosk tokens |
| Database at rest | Backup/restore proven; file permissions hardened to 600/700 |
| Rwanda mobile money | **Honestly blocked** on merchant approval — nothing faked |
| Duplicate project tree | Removed after proving root is a superset (0 orphans across 130 files) |
| Local test/build/lint/audit | **All green** on Node 22.23.4 (see §3) |
| CI actually observed green | **No** — requires one owner action (§4 / Appendix) |

The single remaining item is a **one-click** action available to you. Details in the Appendix.

---

## 1. Issues found

### 1.1 CI failures — root cause: invalid workflow file (CRITICAL, fixed)

Every push run in this repository failed with **zero jobs and zero logs** — no test ever ran.

Evidence gathered from the GitHub API (not inferred):
- Run #96 has `created_at == updated_at` — it died in the same second it was created.
- `runs/{id}/jobs` returns HTTP 200 with `jobs: []` (total_count 0).
- Commit check-runs: 0. Combined status: `pending` with 0 contexts.
- All 27 runs across 25 commits span 2 days and share `same_second=true` and `0 jobs`.

**Cause:** `.github/workflows/node.js.yml` referenced `${{ runner.temp }}` inside a **job-level** `env:` block. Per GitHub's context-availability documentation, `jobs.<job_id>.env` does not have access to the `runner` context (only `jobs.<job_id>.steps.env` does). GitHub therefore rejects the workflow before materializing any job — which is exactly the observed signature.

**Falsification check:** run #76 on a *non-main* branch also produced 0 jobs **and** its workflow revision carried the same job-level bug — confirming the defect is per-commit workflow invalidity, not branch-specific side effects.

**Fix:** moved `DB_PATH` from job-level `env:` to the `Initialize and seed database` step's own `env:` block. One relocated line; the workflow logic is otherwise untouched.

**Regression guard:** `server/test/ci-workflow.test.js` parses the YAML and fails if any runner context appears at job level.
**Mutation-tested (proves the guard is not vacuous):** swapping in `main`'s version makes the guard **fail** with `line 21 ... uses "runner" at job level`; restoring the fixed file makes it **pass 3/3**.

### 1.2 Public patient check-in — treated a public identifier as authentication (CRITICAL, fixed)

`POST /api/portal/checkin` accepted a patient number / MRN as proof of identity. Anyone who knew or guessed a patient number could check in as that patient, and responses leaked patient data.

**Fix:** check-in now requires a **kiosk token**:
- 256-bit entropy, generated server-side
- stored **hashed** (never in plaintext at rest)
- **expiring** (time-bounded) and **single-use** (consumed on success)
- issuance and redemption both **audit-logged**
- **rate-limited** per IP and per token with abuse lockout
- public responses carry **no** names, demographics, appointment details, or clinical data — only an opaque status

Legitimate reception/kiosk workflows are preserved (staff issue tokens; kiosk redeems them).

### 1.3 Database at rest and on disk (HIGH, addressed + documented)

- SQLite files and backups were created with world-readable permissions.
- **Fix:** `server/utils/filePermissions.js` enforces owner-only access — `600` for database/backup files, `700` for their directories — applied on creation.
- Backup **integrity and restoration** were exercised against an isolated development database:
  5 synthetic rows → backup (`integrity_check ok`) → 3 rows deleted to simulate loss → restore
  → 5 rows with identical values, permissions still `600` (§3.2).
- **Not verifiable from inside the repo:** encryption at rest depends on the volume/disk the
  deployment mounts, and TLS depends on the ingress. Both are documented as deployment
  requirements rather than silently assumed (§5).
- Encrypted-at-rest storage is a **deployment** concern and is documented rather than silently changed; see `docs/deployment.md`.

### 1.4 Rwanda mobile money — simulated, not real (HIGH, documented as blocked)

`server/services/mobileMoney.js` could mark payments complete based on client-reported success, with no provider verification. There is **no evidence** of a supported Rwanda provider integration.

**What was done:** evidence-based provider research documented in `docs/audit/mobile-money-rwanda-2026-10-26.md`; the client-trust path removed; payment state transitions and idempotency hardened; simulated payments made impossible to enable in production.

**What was NOT done (deliberately):** no API endpoints were invented. A real adapter requires the hospital's own MTN MoMo / Airtel Money merchant account and production credentials. See §4.

### 1.5 Duplicate nested project tree (MEDIUM, resolved)

A second copy of the application existed under `hospital-management-system/`. Before deleting anything, the manifests, documentation, imports and git history were compared to establish which copy was authoritative.

**Result:** the repository root is a strict superset. **Verified programmatically:** all **130** deleted files were checked for a counterpart at the equivalent root path — **0 orphans**. Root tree confirmed intact (`server`, `client`, `docs`, `.github`, 19 test files).

### 1.6 Insecure direct object references (HIGH, fixed + tested)

Record and appointment lookups trusted client-supplied IDs. Authorization middleware was hardened and object-level ownership checks added, covered by executable regression tests (7 cases) in `server/test/authorization.test.js`.

### 1.7 NEW — Node runtime requirement is not enforced (operational, documented)

While re-verifying, the sandbox had been reset to **Node v20.20.2**, and the server suite **SIGSEGV'd 16/60** tests.

This is **not** a code regression. `server/package.json` declares `engines: { "node": ">=22" }`, and `better-sqlite3@^13` is a native addon: a binary built for the Node 22/24 ABI crashes the process under Node 20.

- On **Node 22.23.4**: native module loads, **183/183 server tests pass**.
- On **Node 20.20.2**: SIGSEGV, 16 failures.

**Consequence for deployment:** the production runtime **must** be Node ≥22, matching the CI matrix (22, 24). Anyone running this on Node 20 will see crash-looping, not test failures. This is recorded as a hard requirement in `docs/deployment.md`.

---

## 2. Files changed and why

| File | Why |
|---|---|
| `.github/workflows/node.js.yml` | Move `DB_PATH`/`runner.temp` from job-level `env:` to step-level (the CI root cause) |
| `server/test/ci-workflow.test.js` | Static guard: fails if a runner context ever appears at job level |
| `server/utils/checkinTokens.js` | Kiosk token generation, hashing, expiry, single-use consumption |
| `server/routes/portal.js` | `/checkin` now requires a valid kiosk token; no patient data in public responses |
| `server/utils/portalRateLimits.js` | Per-IP / per-token rate limiting and abuse lockout for the portal |
| `server/utils/filePermissions.js` | Enforce 600/700 on database and backup files |
| `server/config/database.js` | Apply permission hardening; backup/restore paths |
| `server/config/setup.js` | Create the check-in token table and related schema |
| `server/middleware/auth.js` | Object-level ownership checks (IDOR) |
| `server/test/authorization.test.js` | IDOR regression coverage (7 cases) |
| `server/test/api.test.js` | Portal/check-in regression tests (unauthorized, invalid, expired, reused, rate-limited, success) |
| `server/config/mobileMoney.js`, `server/services/mobileMoneyPayments.js` | Remove client-trust; idempotency; block simulation in production |
| `client/src/views/portal/PatientPortal.vue` | Adapted to the token-based check-in flow |
| `docs/audit/mobile-money-rwanda-2026-10-26.md` | Provider evidence + precise blocking dependencies |
| `hospital-management-system/` (130 files, deleted) | Duplicate tree; root proven a strict superset |
| `docs/audit/final-report-2026-10-26.md` | This report |

No secrets, keys, passwords, or credentials were added. Diff scanned for credential patterns — only synthetic test fixtures present.

---

## 3. Tests actually executed and results

All commands below were run against commit `148f997` in this environment. **Node 22.23.4** (v22 LTS), matching the CI matrix.

| Check | Command | Result |
|---|---|---|
| Native module load | `require('better-sqlite3')` round-trip | **PASS** |
| Server tests | `npm test --prefix server` | **183 / 183 pass, 0 fail** |
| Client tests | `npm test --prefix client` | **247 / 247 pass** (5 files) |
| Lint | `npm run lint --prefix client` | **clean, 0 errors** |
| Production build | `npm run build --prefix client` | **success** (`✓ built in 3.72s`) |
| Prod dep audit — root | `npm audit --omit=dev` | **0 vulnerabilities** |
| Prod dep audit — client | `npm audit --omit=dev` | **0 vulnerabilities** |
| Prod dep audit — server | `npm audit --omit=dev` | **0 vulnerabilities** |
| CI workflow guard | `node --test server/test/ci-workflow.test.js` | **3 / 3 pass** |
| CI guard mutation test | swap in `main`'s workflow → expect failure | **Correctly FAILS** (`line 21 ... "runner" at job level`) |
| Nested-tree superset proof | 130 deleted paths vs root | **0 orphans** |
| Node 20 behavior | server suite on v20.20.2 | **SIGSEGV, 16 fail** → documented requirement (§1.7) |
| **Full CI job replay** | all 7 workflow steps, in order, same env | **ALL STEPS PASSED** (see below) |
| **Backup → loss → restore** | isolated temp DB, row-level diff | **5 rows → 2 → 5, exact match** |

### 3.1 CI job replayed step-for-step (stand-in for a real run)

Because I cannot dispatch the workflow, I replayed the job locally in **workflow order** with
the same environment (`NODE_ENV=test`, `JWT_SECRET`, and `DB_PATH` set only on the seed step,
unset for every later step — exactly as the YAML does). Lockfiles were checked first for
`npm ci` consistency: root 2/2, client 15/15, server 13/13 declared-vs-locked, no drift.

| # | Workflow step | Result |
|---|---|---|
| 1–3 | `npm ci` (root, client, server) | lockfiles in sync — no drift to fail on |
| 4 | `db:setup` + `db:seed` with step-scoped `DB_PATH` | **PASS**, DB created `600` |
| 5 | Lint client | **PASS** |
| 6 | Test server | **PASS** (183) |
| 7 | Test client | **PASS** (247) |
| 8 | Build client | **PASS** |
| 9 | Audit production dependencies | **PASS**, 0 vulnerabilities |

The workflow was also validated structurally with a YAML parser: it parses, job-level `env`
contains only `NODE_ENV`/`JWT_SECRET` (both legal contexts), `runner.temp` appears **only** in
step 4's `env`, every step has exactly one of `run`/`uses`, and `workflow_dispatch` is present.
Only one workflow file exists, and all three cached lockfiles are present.

### 3.2 Restore was executed, not just documented

Backup integrity alone is not a recovery plan, so the destructive half was exercised on an
isolated DB: 5 synthetic rows → backup (`integrity_check ok`) → deleted 3 rows to simulate loss
→ `--restore` → **5 rows again, values identical** (`SYNTH-1…5`), file still `600`. The CLI also
wrote a pre-restore copy of the current DB before overwriting, so a mistaken restore is itself
recoverable.

**Honest limitation:** these are local sandbox executions on Node 22 (Node 24 is not installed
here, so the matrix's second leg is unverified locally). The GitHub Actions workflow itself has
**not yet been observed to pass**, because no run has ever executed with the fixed file. That is
the one open item below. I am not claiming the CI pipeline is green.

---

## 4. Remaining blockers and external dependencies

1. **CI has not been observed green (needs your one click).**
   The fix is committed to `appjet`, but a workflow run requires an event on a branch: `push` is scoped to `main`, and `pull_request` events have never fired in this repo. I cannot trigger it — the GitHub integration for this repo has `contents:write` but **not** `pull_requests:write`, and the sandbox holds no GitHub token. See the Appendix for the one-click path.

2. **Rwanda mobile money (commercial, not technical).**
   Requires the hospital to obtain an **MTN MoMo** and/or **Airtel Money** merchant account with production credentials and provider approval. Until then the integration is intentionally inert in production; simulated payments are blocked. Exactly what is missing is itemised in `docs/audit/mobile-money-rwanda-2026-10-26.md`.

3. **Encrypted storage volume (deployment decision).**
   Application-level permissions are hardened, but encryption at rest depends on the host platform (encrypted volume or managed encrypted database). Documented in `docs/deployment.md`; not verifiable from inside the repository.

4. **TLS termination at the real deployment boundary.**
   HTTPS cannot be verified through environment-variable checks alone. Must be confirmed at the actual ingress/reverse proxy once deployed.

5. **Node ≥22 runtime requirement.**
   Must be enforced on the production host (§1.7), or the process will SIGSEGV in the SQLite driver.

---

## 5. Steps needed before production use

1. **Trigger the workflow** (Appendix) and confirm all jobs pass on both Node 22 and 24.
2. **Review the diff** `main...appjet` and merge only when satisfied. `appjet` is 51 ahead / 0 behind, so it is a conflict-free fast-forward.
3. **Provision the runtime on Node ≥22** and confirm the SQLite native module loads.
4. **Attach an encrypted volume** (or managed encrypted DB) for the SQLite file and backups; keep encryption keys and backup credentials in a secret manager, never in the repo.
5. **Verify TLS** at the ingress; confirm HTTP→HTTPS redirect and HSTS.
6. **Set production secrets** out-of-band (session secret, DB paths, portal/kiosk configuration) and confirm none are committed.
7. **Run a restore drill** from a real backup on the production storage before go-live.
8. **Complete mobile-money onboarding** before advertising online payments; leave it disabled until provider credentials exist.
9. **Rotate** any credential that was ever committed or shared during development.
10. **Re-run the full check set** on the deployment target after configuration changes.

---

## Appendix — verifying CI yourself, with one click (no PR, no merge)

`docs`/workflow inspection showed `.github/workflows/node.js.yml` on `main` **already declares `workflow_dispatch`**, so the **"Run workflow"** button is available on the default branch. This is the fastest way to get real CI evidence without opening a PR or merging:

1. Go to **Actions** → **Node.js CI** (left sidebar).
2. Click **Run workflow** (right side).
3. In **Use workflow from**, select branch **`appjet`**.
4. Click **Run workflow** and open the new run.

The run executes the **fixed** workflow file from `appjet` (GitHub resolves the workflow from the selected ref), across the Node 22/24 matrix.

**Fallback if the button is unavailable or the run still reports 0 jobs:** open a PR from `appjet` into `main`. Any `pull_request` event (`opened`/`synchronize`) will execute the corrected workflow, since this repo has never yet had a `pull_request`-triggered run.

Either way, please paste the run URL or the failing log excerpt and I will continue from the actual output rather than assumptions.

---

## Note on a previous error in my own reporting

I earlier described PR #4 (`fix/ci-workflow-errors`, branch head `6eace27d`) as "someone else's PR". That was **wrong** — the public API shows its author is **`Salomo794`**, i.e. your own PR. I also verified that branch's workflow already places `DB_PATH` at **step level** (correct), so that PR is not the source of the CI failures. `main` at `644cc61` is the only ref I found carrying the job-level bug.
