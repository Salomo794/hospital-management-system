# Deployment guide

This covers three ways to run the system in production: a single **Render** service, a self-hosted **Docker Compose** stack with automatic HTTPS, or a split **Vercel + Render** setup. Read "Before you go live" first; production refuses to start until those items are in place, by design.

> Nothing in this repository deploys itself. Merging to `main` does not publish anything, and no step here should be run against real patient data until the checks in "Verify the deployment" pass and the owner has signed off.

## Before you go live

Production (`NODE_ENV=production`) fails closed. The server will not start unless all of these are true:

| Requirement | Why | Where it is checked |
| --- | --- | --- |
| **MySQL 8 reached over TLS** (`DATABASE_SSL=true`, plus `DATABASE_SSL_CA` if the server's certificate is not from a public CA) | Patient data must not cross the network in clear text. The certificate is verified. | `server/config/database.js` |
| **`PUBLIC_URL`** is an `https://` address with no trailing slash | Password-reset links are built from it | `server/config/productionReadiness.js` |
| **`CORS_ORIGINS`** lists at least one exact `https://` origin | Required even when the client and API share one origin: set it to the same value as `PUBLIC_URL` | `productionReadiness.js` |
| **SMTP** (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`) | Password resets cannot be delivered otherwise | `productionReadiness.js` |
| **`BACKUP_ENCRYPTION_KEY`**, at least 16 characters, stored outside the repository | Backups are complete copies of the patient database | `productionReadiness.js` |
| **`JWT_SECRET`**, at least 32 random characters | Signs every session | `server/index.js` |
| **A licensed drug-interaction dataset loaded** (`npm run db:interactions`) | The bundled data is a 16-pair demonstration; silence from the check would be read as safety | `server/index.js` |

The last row is the one most likely to surprise you. A clinical reference dataset (for example a licensed interaction database) has to be obtained and clinically reviewed by the hospital; this repository cannot supply one. See the README, "Before this handles real patient data", for the CSV format. `ALLOW_DEMO_INTERACTIONS=true` bypasses the check and exists only for an isolated demo with no real patients.

Also decide before go-live (these are not enforced in code):

- **Database encryption at rest.** Backups are encrypted by the app; the live database is not. Use a MySQL host with encrypted storage and confirm it.
- **A payment provider for Rwanda.** Paystack does not offer MTN MoMo or Airtel Money in Rwanda, and no Mukuru adapter exists. Keep `MOBILE_MONEY_ENABLED=false` until a provider is contracted and tested in its sandbox. Cash and other recorded payment methods are unaffected.
- **Clinical, privacy and regulatory review** for your jurisdiction.

## Generating secrets

```bash
openssl rand -base64 48   # JWT_SECRET
openssl rand -base64 32   # BACKUP_ENCRYPTION_KEY
```

Keep both in your host's secret store and in a password manager. A lost `BACKUP_ENCRYPTION_KEY` makes every backup unreadable, and there is no recovery.

## Option 1: Single Render service

The server serves the built client from `client/dist`, so the client and API share one origin.

1. Create a managed or self-managed **MySQL 8** database that accepts TLS connections. Render does not host MySQL, so use a provider that does.
2. Push this repository to GitHub and create a Render Web Service from it. `render.yaml` already sets the build, pre-deploy, start and health-check settings (`/api/health`).
3. Set the secret environment variables that `render.yaml` leaves blank:
   `DATABASE_URL`, `PUBLIC_URL`, `CORS_ORIGINS`, `BACKUP_ENCRYPTION_KEY`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`.
   `JWT_SECRET` is generated for you. `DATABASE_SSL=true` is already set; if the database's CA is private, add it as a Render Secret File and set `DATABASE_SSL_CA` to its path.
4. Deploy. The pre-deploy command applies the schema (`npm run db:setup`, safe to repeat).
5. Create the first administrator and load the interaction dataset (see "First run").

The `render.yaml` plan is `free`, which sleeps when idle and is suitable for a trial, not for a hospital. Choose an always-on plan for real use.

## Option 2: Docker Compose with automatic HTTPS

This runs the app behind Caddy, which obtains and renews the certificate. It does **not** include a database: point it at an external MySQL 8 over TLS.

```bash
cp deploy/docker.env.example deploy/docker.env   # app settings and secrets
cp deploy/caddy.env.example  deploy/caddy.env    # domain and email for the certificate
# edit both files, then:
docker compose up -d --build
docker compose exec app node server/config/createAdmin.js   # first administrator
```

Requirements: the domain's DNS must already point at the machine, and ports 80 and 443 must be open, or Caddy cannot get a certificate. The app container applies the schema on every start. Encrypted backups are written to the `hms_backups` volume; schedule one from the host:

```cron
30 2 * * * cd /srv/hms && docker compose exec -T app node server/config/mysqlBackup.js --label nightly --require
```

and copy that volume off the machine regularly.

`deploy/docker.env` and `deploy/caddy.env` are gitignored. Caddy only receives its own file, not the app's secrets.

The root-level `Caddyfile` is an older example for running Caddy directly on a host; `deploy/Caddyfile` is the one the Compose stack uses.

## Option 3: Vercel frontend + Render backend

The client uses relative `/api` paths, so Vercel rewrites `/api/*` to the backend.

1. Deploy the backend as in Option 1 and note its URL.
2. On Vercel, import the repository. Build command `npm run build --prefix client`, output `client/dist`.
3. In `vercel.json`, replace `https://YOUR-RENDER-APP.onrender.com` with the backend URL.
4. On the backend set `CORS_ORIGINS` to the Vercel origin and `PUBLIC_URL` to the address staff open (the Vercel one, since reset links open the client).

Option 1 or 2 is simpler and keeps everything on one origin.

## First run

Run these once against the new production database. On Render use the service Shell; with Compose use `docker compose exec app ...`.

1. **Schema.** Applied automatically on deploy/start. To run it by hand: `npm run db:setup`.
2. **First administrator.** A new database has no users, demo seeding is blocked, and registering staff needs an administrator, so create the first one from the command line:

   ```bash
   npm run admin:create
   ```

   It prompts for email, name and a hidden password. For scripts, set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_FIRST_NAME`, `ADMIN_LAST_NAME` in the environment (never `--password` on the command line; it is rejected). The password must satisfy the staff password policy. The command refuses to run if an active administrator already exists, unless you pass `--allow-additional`.
3. **Interaction dataset.** `npm run db:interactions -- --file <your-file>.csv --name "<source name>" --version <version>`. Until this is done the server will not start in production.
4. **Turn on MFA** for the administrator from the profile menu, and set `MFA_REQUIRED_ROLES=admin,doctor` once those staff have enrolled.
5. **Add staff** from the Users screen, then provision patient portal PINs where the portal or kiosk check-in is used.

Never run `npm run db:seed` against production. It loads demo patients with a known password.

## Verify the deployment

Replace `https://hms.example.org` with your address.

```bash
curl -si https://hms.example.org/api/health | head -n 12
```

Expect `HTTP/2 200`, `{"status":"OK",...}` and a `strict-transport-security` header.

- [ ] `http://` redirects to `https://` (Caddy and Render both do this).
- [ ] The login page loads, and a deep link such as `/patients` also loads.
- [ ] You can sign in as the administrator, and a wrong password is rejected.
- [ ] `admin@hospital.com` / `password123` is **rejected** (no demo accounts exist).
- [ ] A password-reset email arrives.
- [ ] `npm run db:backup -- --label first-deploy --require` succeeds and `--verify <file>` reports the backup valid.
- [ ] The backup was restored into a scratch database and the data checked. An untested backup is not a backup.
- [ ] The startup log has no `DRUG-INTERACTION DATA IS NOT CLINICAL` banner.

## Environment variables

See `server/.env.example` for the full annotated list. The ones that matter for production:

| Variable | Notes |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | Render sets it; the Docker image uses 5000 |
| `DATABASE_URL` | `mysql://user:password@host:3306/database` (URL-encode special characters in the password) |
| `DATABASE_SSL` | `true`; required in production |
| `DATABASE_SSL_CA` | Path to the CA file when the certificate is not from a public CA |
| `JWT_SECRET` | 32+ random characters |
| `PUBLIC_URL` | `https://...`, no trailing slash |
| `CORS_ORIGINS` | Exact `https://` origins, comma-separated; same as `PUBLIC_URL` for a single origin |
| `TRUST_PROXY` | `true` behind Render or Caddy (production already trusts one proxy hop) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Password-reset mail |
| `BACKUP_ENCRYPTION_KEY` | 16+ characters; stored outside the repository |
| `APP_TIMEZONE` | Defaults to `Africa/Kigali` |
| `MFA_REQUIRED_ROLES` | e.g. `admin,doctor` |
| `MOBILE_MONEY_ENABLED` | Keep `false` until a Rwandan provider is integrated and tested |
| `ALLOW_SIMULATED_PAYMENTS`, `ALLOW_DEMO_SEED`, `ALLOW_DEMO_INTERACTIONS` | Keep `false` or unset |

## Troubleshooting

- **`Refusing to start with incomplete production configuration`**: the message lists exactly which settings are missing or malformed.
- **`DATABASE_SSL=true is required for MySQL connections in production`**: set it, and check the database actually offers TLS.
- **`unable to verify the first certificate` / `self-signed certificate`**: the database's certificate is not from a public CA. Provide its CA via `DATABASE_SSL_CA`.
- **`Refusing to start in production with demonstration drug-interaction data`**: load a licensed dataset (First run, step 3).
- **No way to sign in**: run `npm run admin:create` (First run, step 2).
- **Caddy cannot obtain a certificate**: DNS not pointing at the machine, or ports 80/443 blocked.
