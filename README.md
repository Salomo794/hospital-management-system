# Hospital Management System

A full-stack Hospital Management System with a Vue 3 client and a Node.js/Express + SQLite API.

## Features

- JWT authentication and role-based access for administrators, doctors, nurses, receptionists, pharmacists, and lab technicians
- Patient registration, access cards, portal PIN provisioning, demographics, and medical history
- Doctor profiles, weekly schedules, appointment availability, and booking
- Electronic medical records, prescriptions, medication safety checks, and lab orders/results
- Pharmacy inventory, partial dispensing, expiry/low-stock alerts, and interaction screening
- Procurement: suppliers, purchase orders with draft/submit/approve/receive workflow, partial deliveries, and reorder suggestions priced from cost price
- Billing, validated partial payments, summaries, and financial reports
- Admission and bed management with occupancy protection
- Notifications, operational dashboards, smart forecasts, and a rule-based assistant
- Patient portal and kiosk APIs, including appointment, result, prescription, bill, and check-in access

## Technology

| Layer | Technology |
| --- | --- |
| Client | Vue 3, Vue Router, Pinia, Axios, Vite, Chart.js |
| API | Node.js 22+, Express, JWT, bcryptjs |
| Database | SQLite via `better-sqlite3` |
| Tests | Node test runner and Supertest |

## Setup

Run all commands from the repository root.

### 1. Install dependencies

```bash
npm run install:all
```

For a reproducible CI-style installation, use `npm ci` in the root, `client`, and `server` directories.

### 2. Configure the API

```bash
cp server/.env.example server/.env
```

Generate a unique JWT secret before starting the API. Do not use the placeholder in a deployed environment.

Important optional settings:

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `5000` | API port |
| `JWT_SECRET` | none | Required random secret of at least 32 characters |
| `JWT_EXPIRE` | `7d` | Staff-session lifetime |
| `PORTAL_JWT_EXPIRE` | `24h` | Patient-portal session lifetime |
| `CORS_ORIGINS` | local dev origins | Comma-separated production client origins |
| `DB_PATH` | `server/hospital.db` | SQLite database path; relative paths resolve from `server/` |
| `APP_TIMEZONE` | `Africa/Kigali` | IANA zone the hospital operates in; see [Timezones](#timezones) |
| `ALLOW_SIMULATED_PAYMENTS` | `false` | Enables demo portal payments only when `NODE_ENV` is `development` or `test` |

To use a non-default API port during client development, create `client/.env.local`:

```dotenv
VITE_API_PROXY_TARGET=http://localhost:5001
```

### 3. Initialize the database

```bash
npm run db:setup
npm run db:seed
```

`db:setup` is idempotent and applies schema migrations. `db:seed` is for isolated demo environments and refuses to run in production unless `ALLOW_DEMO_SEED=true` is explicitly set. It prints generated patient portal PINs once.

### 4. Run in development

```bash
npm run dev
```

- Client: <http://localhost:3000>
- API: <http://localhost:5000>
- Readiness: <http://localhost:5000/api/health>

## Demo staff accounts

All generated demo staff accounts use password `password123`:

| Role | Email |
| --- | --- |
| Admin | `admin@hospital.com` |
| Doctor | `doctor@hospital.com` |
| Nurse | `nurse@hospital.com` |
| Receptionist | `receptionist@hospital.com` |
| Pharmacist | `pharmacist@hospital.com` |
| Lab technician | `labtech@hospital.com` |

Never run demo seeding against a real patient database.

## Commands

| Command | Description |
| --- | --- |
| `npm run install:all` | Install root, API, and client dependencies |
| `npm run dev` | Run API and Vite development servers |
| `npm run server` | Run only the API |
| `npm run client` | Run only the client |
| `npm run db:setup` | Create/apply database schema and indexes |
| `npm run db:seed` | Load demo fixtures |
| `npm run db:backup` | Take a verified backup of the database |
| `npm run build` | Build the production client |
| `npm test` | Run API integration tests on an isolated database |
| `npm run check` | Build the client and run API tests |

## Tests

The API integration tests run against a throwaway SQLite database, so they never touch development data. Current coverage:

| File | Focus |
| --- | --- |
| `server/test/api.test.js` | Scheduling, lab results, billing, portal payments, medication safety, AI and dashboard scoping |
| `server/test/audit-refunds.test.js` | Audit-log filtering and role boundaries, payment refunds |
| `server/test/procurement.test.js` | Purchase-order workflow, separation of duties, partial receipts, stock-ledger consistency |
| `server/test/migrations.test.js` | Schema invariants and legacy-data migrations |
| `server/test/time.test.js` | Hospital-timezone and daylight-saving handling |
| `npm run audit` | Audit production dependencies in all packages |

## API groups

All endpoints are under `/api`:

- `/auth`, `/users`
- `/patients`, `/doctors`, `/appointments`
- `/emr`, `/prescriptions`
- `/pharmacy`, `/procurement`, `/laboratory`
- `/billing`, `/reports`, `/audit`
- `/notifications`, `/admissions`
- `/audit` for the admin-only activity trail
- `/ai`, `/smart`
- `/portal` for patient self-service and kiosk operations
- `/portal` in the client for the patient portal SPA

The API returns JSON for successful requests, validation failures, unknown routes, malformed JSON, and unexpected server errors.

### Payment methods

`server/config/paymentMethods.js` is the single source of truth for the accepted payment methods. Add or remove an entry in its `PAYMENT_METHODS` array and the API validators, the `payments` table `CHECK` constraint, and the billing dropdowns all follow, because the client reads the list from `GET /api/billing/payment-methods` instead of hardcoding it.

The configured methods are cash, card, credit card, mobile wallet, mobile money, UPI/QR, online, bank transfer, cheque/demand draft, insurance, and other.

Widening the list widens a SQLite `CHECK` constraint, which cannot be altered in place. The API therefore rebuilds the `payments` table on start, copying every existing row and preserving the transaction-reference index; stored values that are no longer supported are folded into `other` with a warning. The rebuild is skipped once the stored table already matches, so restarting is safe and idempotent.

### Mobile money (MTN MoMo, Airtel Money)

Mobile money comes in two forms, and only the second one needs an external provider.

**Assisted — available immediately, nothing to configure.** The patient transfers to the hospital's own mobile money number and reception records the payment against the bill, entering the confirmation code from the patient's phone. This is the ordinary way a hospital takes MoMo, and it works with no payment provider, no API keys, and no internet connection. It is recorded through the normal payment endpoint with `payment_method: "mobile_money"`, and the **confirmation code is mandatory** because it is the only evidence the money moved; without it a reception mistake would be indistinguishable from a patient who never paid. The entry settles the bill on the spot and is audited under `billing.mobile_money.assisted`, naming the member of staff who entered it so a disputed payment stays traceable.

**Automated — needs a provider.** The prompt is pushed to the patient's phone and the provider confirms it, so the hospital never has to take the patient's word for it. This is what the rest of this section describes, and it is switched off until a provider is configured.

Mobile money is the one method that is not collected in hand. The patient receives a prompt on their own handset and approves it with their PIN, so the hospital cannot know the outcome at the moment the request is sent. The design follows from that one fact: **a request does not settle a bill.**

Every payment row therefore carries a settlement `status` of `pending`, `completed`, `failed`, or `cancelled`, and only `completed` rows count towards a bill. `recalculateBillPayment` filters on it, so a charge the patient has not approved yet can never mark a bill paid — a patient cannot walk out with services the hospital has not been paid for. Money recorded before this column existed was taken in hand and migrates to `completed`, so historical bills stay settled.

The flow is:

1. `POST /api/billing/:id/mobile-money` (staff) or `POST /api/portal/bills/:id/pay` with `payment_method: "mobile_money"` (patient) writes a `pending` row and returns **202**. The charge is always the full outstanding balance; a partial figure is rejected rather than silently ignored.
2. Paystack sends the prompt. A provider outage fails the pending row rather than deleting it, so the attempt stays auditable and the customer can be asked to retry.
3. Paystack calls `POST /api/billing/mobile-money/webhook`, which settles the row and recalculates the bill. The body is authenticated with an HMAC over the raw request bytes, so the global JSON parser captures the raw body for that one path.
4. If a webhook never arrives, staff can force a re-check against the provider with `GET /api/billing/mobile-money/payments/:paymentId?sync=1`.

Redelivered webhooks are harmless: a charge that has already reached a terminal state is acknowledged and ignored, and the record number doubles as the provider reference under a unique index, so a duplicated request collides at the database rather than opening a second charge. A bill with a request already in flight refuses another one for the same reason.

Configuration lives in `server/config/mobileMoney.js` and is documented in `server/.env.example`. The rail stays off until `MOBILE_MONEY_ENABLED=true` and a provider secret is present, and it is advertised to the client through `GET /api/billing/mobile-money/config` so the UI only offers a method that actually works. The `mock` provider exercises the full lifecycle without an account and is **refused when `NODE_ENV=production`** — a simulated charge that marks a real bill paid is a revenue hole.

**Provider and market coverage matter.** Paystack sells the mobile money channel only in **Ghana, Kenya and Côte d'Ivoire**. It is licensed in Rwanda and settles in RWF, but does not offer mobile money there, so MTN MoMo and Airtel Money cannot be charged through it. The networks offered are therefore resolved from the market — inferred from `PAYSTACK_CURRENCY`, or set explicitly with `PAYSTACK_MARKET` — rather than hardcoded, and a market with no mobile money coverage leaves the rail switched off with a reason the operator can read instead of failing on the first real charge. A Rwandan deployment that wants automated collection needs a provider that supports MTN Rwanda and Airtel Rwanda; **Flutterwave** does, with published API documentation, a sandbox that auto-approves test charges, and pricing of 3.5% per mobile money transaction. Assisted collection needs none of this.

Provider access is behind a small adapter in `server/services/mobileMoney.js` (`initializeCharge`, `verifyCharge`, `verifyWebhook`), so adding another aggregator is a new adapter rather than a change to the billing routes.

### Timezones

Timestamps are stored in UTC and sent to the client as `YYYY-MM-DD HH:MM:SS`, with no offset marker. Two rules follow from that, and breaking either one silently corrupts data rather than raising an error:

- **An instant is read as UTC.** The client parses these through `client/src/utils/datetime.js` and renders them in the hospital's timezone, so two staff members never disagree about when a lab result landed. Reading them as local time — which is what a bare timestamp string means to a date library — shows every timestamp hours early and rolls the date over at the wrong moment.
- **A bare date is never converted.** `2026-01-16` is a calendar day, not an instant. A date of birth or an appointment date must stay on the day it names, so those values bypass the timezone entirely.

Anything that means "today" to staff — the day's takings, the check-in queue, this month's revenue, overdue stock — is resolved against `APP_TIMEZONE` rather than UTC, so the window is computed as a pair of real instants and is correct across daylight-saving changes instead of assuming every day is 24 hours. Change the zone with `APP_TIMEZONE` in `server/.env`; an unrecognised value falls back to the default with a warning rather than failing.

### Backups

`npm run db:backup` writes a verified, consistent copy of the database into `server/backups` and keeps a rolling window. It uses SQLite's `VACUUM INTO` rather than copying the file, so it is safe to run against a live database and cannot capture a half-written page.

Every backup is integrity-checked and reopened before the command reports success, and each one gets a small JSON manifest recording when it was taken and why. Retained backups are ignored by Git.

| Command | Description |
| --- | --- |
| `npm run db:backup` | Take a verified backup and rotate old ones |
| `npm run db:backup -- --label nightly` | Record why the backup was taken |
| `npm run db:backup -- --keep 30` | Retain 30 instead of the default 14 |
| `npm run db:backup -- --list` | List retained backups |
| `npm run db:backup -- --verify <file>` | Check a backup opens and passes `integrity_check` |
| `npm run db:backup -- --restore <file>` | Restore a backup, keeping a pre-restore copy first |

An untested backup is not a backup. Schedule the command, and occasionally run `--verify` or a restore into a scratch database. The `--restore` path copies the current database aside before replacing it, so a restore is itself reversible.

### Refunds and the audit trail

Payments are append-only, so a mistake at the desk can be reversed without destroying the money trail. `POST /api/billing/payments/:paymentId/refund` records a refund as its own row and requires a reason of at least three characters; the original payment is kept and flagged with the amount already refunded. Omitting the amount refunds everything still refundable, and a payment that has not settled — an unapproved mobile money charge, say — has nothing to refund.

A bill's `paid_amount` and `payment_status` are derived from the ledger rather than incremented, so a bill cannot drift away from the money actually recorded against it. Revenue figures in the billing summary, the dashboard, and the financial reports are all net of refunds.

`audit_log` records who did what, and who looked at what. `server/utils/audit.js` is the only writer, and the route handlers call `recordAudit()` for bill and payment changes, refunds, patient records, portal PIN resets, pharmacy dispensing, procurement, staff account changes, and both successful and failed sign-ins.

It logs **reads** as well as writes. Opening a patient chart, a clinical history, a medical record, or a lab order is an access event, because "who was looking at this patient's data" is the question an access log exists to answer, and a trail that only captured changes cannot answer it. Read entries deliberately store only the identity of the record — never its contents — so the log does not become a second copy of the patient data.

Read it at `GET /api/audit`, which is admin-only, or from **Admin → Audit Log** in the client.

Two details are deliberate. Credentials never reach the log: password, portal PIN, and access code fields are redacted, and a portal PIN reset is recorded without the new value. And because patient ids share a namespace with user ids, a portal actor is written with `actor_type` and `actor_label` while `user_id` stays null, so a patient session can never be mistaken for a staff account. Auditing is best-effort by design — a failure is logged and swallowed rather than being allowed to fail a clinical or financial request.

### Idempotent financial and inventory mutations

Pharmacy dispensing and patient-portal bill payments require a stable `request_id` in the JSON body (or an `X-Request-ID` header). Retrying the same request with the same key returns the original result without applying the mutation twice; reusing a key with different parameters returns HTTP 409.

### Purchase order lifecycle

```
draft ──submit──▶ submitted ──approve──▶ approved ──receive──▶ partially_received ──receive──▶ received
  └──────────────── cancel ────────────────┴──────────────┴──────────┴──────┘
```

Procurement is restricted to administrators and pharmacists. Two rules are enforced server-side rather than in the client:

- **Separation of duties.** A pharmacist may raise and receive orders, but only an administrator may approve one, and nobody may approve an order they raised themselves. Submitting notifies every other active administrator.
- **Receipts cannot invent stock.** A receipt is validated in full before anything is written, cannot exceed what is still outstanding on a line, and updates `medicines.stock_quantity` and writes an `inventory_transactions` row in the same transaction. A delivery may also update the batch number and expiry date it arrives with. A partially received order cannot be cancelled, because the goods are already real stock.

Order totals are always recalculated from their line items, never accepted from the request. Every state change is written to the audit log.

## Production

Build and start through the included Windows launcher:

```bat
set NODE_ENV=production
start-hms.cmd
```

The launcher rebuilds the client every time, applies database setup, and then starts Express in production mode. It refuses to start when dependencies are missing or the runtime is older than Node.js 22.

For non-Windows production starts:

```bash
npm run build
NODE_ENV=production npm run server
```

Use HTTPS, a strong `JWT_SECRET`, an explicit `CORS_ORIGINS` allowlist, encrypted database backups, and a process supervisor. SQLite database files and `.env` files are intentionally excluded from Git.
