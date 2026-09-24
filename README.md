# Hospital Management System

A full-stack Hospital Management System with a Vue 3 client and a Node.js/Express + SQLite API.

## Features

- JWT authentication and role-based access for administrators, doctors, nurses, receptionists, pharmacists, and lab technicians
- Patient registration, access cards, portal PIN provisioning, demographics, and medical history
- Doctor profiles, weekly schedules, appointment availability, and booking
- Electronic medical records, prescriptions, medication safety checks, and lab orders/results
- Pharmacy inventory, partial dispensing, expiry/low-stock alerts, and interaction screening
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
| `DB_PATH` | `server/hospital.db` | SQLite database path |
| `ALLOW_SIMULATED_PAYMENTS` | `false` | Explicitly enables demo portal payments in production |

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
| `npm run build` | Build the production client |
| `npm test` | Run API integration tests on an isolated database |
| `npm run check` | Build the client and run API tests |
| `npm run audit` | Audit production dependencies in all packages |

## API groups

All endpoints are under `/api`:

- `/auth`, `/users`
- `/patients`, `/doctors`, `/appointments`
- `/emr`, `/prescriptions`
- `/pharmacy`, `/laboratory`
- `/billing`, `/reports`
- `/notifications`, `/admissions`
- `/ai`, `/smart`
- `/portal` for patient self-service and kiosk operations
- `/portal` in the client for the patient portal SPA

The API returns JSON for successful requests, validation failures, unknown routes, malformed JSON, and unexpected server errors.

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
