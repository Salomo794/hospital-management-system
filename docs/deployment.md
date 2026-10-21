# Deployment Guide (Render + Vercel or single Render)

## Before you start: the production startup guard

When `NODE_ENV=production`, the API refuses to start until the deployment
settings below are in place. It reports every missing item at once rather than
failing on the first one:

| Variable | Requirement |
| --- | --- |
| `PUBLIC_URL` | An absolute `https://` address with no trailing slash, query or credentials |
| `CORS_ORIGINS` | Optional. Every entry, if any, must be an exact `https://` origin |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` | All set, so password resets can be delivered |
| `BACKUP_ENCRYPTION_KEY` | A non-placeholder secret of at least 16 characters |
| `DB_PATH` | A persistent file path, not `:memory:` |
| `JWT_SECRET` | A unique random value of at least 32 characters |

`CORS_ORIGINS` may be left empty. The API always allows the application's own
origin — the one in `PUBLIC_URL` — so a deployment that serves the client and
the API from the same address needs no extra origins. Set it only when the
client is hosted somewhere else, and list that origin exactly, without a path
or a trailing slash.

## Option 1: Single Render service (Recommended - same-origin, simplest)
The server serves the built client from `client/dist`. The client and the API
share one origin, so no cross-origin request is ever made.

1. Push this repo to GitHub.
2. Create a new Render Web Service pointing to the repo.
3. Use the following settings (or use render.yaml):
   - Build Command: `npm run install:all && npm run build`
   - Pre Deploy Command: `npm run db:setup` (idempotent)
   - Start Command: `npm run start` (or `npm run start:prod`)
4. Add a Persistent Disk: name `hms-data`, mount path `/var/data`, size 1GB (or more). This is required for SQLite persistence; ephemeral disk will lose data on restarts/deploys. A Persistent Disk needs a paid Render plan, so the service cannot stay on the free tier.
5. Set environment variables:
   - NODE_ENV=production
   - PORT=10000 (Render sets this automatically; set explicitly if needed)
   - JWT_SECRET=generate a secure random >=32 chars
   - CORS_ORIGINS=leave empty; the app's own origin is allowed automatically
   - DB_PATH=/var/data/hospital.db
   - PUBLIC_URL=https://your-render-app.onrender.com
   - APP_TIMEZONE=Africa/Kigali
   - SMTP_HOST, SMTP_USER, SMTP_PASS as needed for password resets
   - BACKUP_ENCRYPTION_KEY=set for encrypted backups (store securely, not in repo)
   - TRUST_PROXY=true
6. Deploy. Initial deploy will build, setup DB, start server. Health: https://your-app/api/health.

Notes:
- Seed is blocked in production; only seed with ALLOW_DEMO_SEED=true on an isolated DB.
- DB backups: `npm run db:backup` can run as a cron job or manually. Consider offsite copy.
- Better-sqlite3 needs native build (Render Node 22 will handle).

## Option 2: Vercel frontend + Render backend (split)
The client calls relative `/api` paths, so Vercel rewrites `/api/*` to the Render backend. The rewrite happens at the edge, so the browser still sees a same-origin request, but the API receives the frontend's `Origin` header and has to be allowed it.

1. Deploy backend on Render as above. Get its public URL (e.g. https://your-backend.onrender.com).
2. On Vercel, import the repo. Build command: `npm run build --prefix client`. Output: `client/dist`.
3. Update `vercel.json`: replace `https://YOUR-RENDER-APP.onrender.com` with your backend URL.
4. On Render, set `CORS_ORIGINS` to the Vercel origin, for example `https://your-frontend.vercel.app`. Without it the API refuses every request that carries that origin.
5. There is no `VITE_API_BASE_URL`: the client always calls relative `/api` paths and the rewrite resolves them. `VITE_API_PROXY_TARGET` exists, but it is only read by the Vite dev server, so it changes nothing in a production build.

## Important: SQLite persistence on Render
Render free tier has ephemeral filesystem. To persist data, you MUST attach a Render Persistent Disk to the web service and set DB_PATH to the mount path (e.g. /var/data/hospital.db). Disk is a paid add-on for persistent storage, so the service must be on a paid plan. Backups are still recommended.

## Environment variables required
See README.md and server/.env.example. Critical: JWT_SECRET (>=32), DB_PATH, PUBLIC_URL (https in prod), SMTP for password resets in prod.

## First run checklist
- [ ] Set strong JWT_SECRET
- [ ] Set DB_PATH to persistent location
- [ ] Configure PUBLIC_URL to your app URL
- [ ] Set SMTP_HOST, SMTP_USER and SMTP_PASS (password resets are refused without them)
- [ ] Set BACKUP_ENCRYPTION_KEY, and keep a copy of it away from the server
- [ ] Add CORS_ORIGINS only if the client is hosted separately from the API
- [ ] Ensure HTTPS (Render/Vercel provide)
- [ ] Run `npm run db:setup` (done by preDeployCommand)
- [ ] Do NOT run `npm run db:seed` in production unless explicitly for demo
