# Deployment Guide (Render + Vercel or single Render)

## Runtime requirement: Node.js >= 22 (hard requirement)

This application **must** run on Node.js 22 or newer. `server/package.json` declares
`"engines": { "node": ">=22" }`, and `better-sqlite3` is a **native addon** compiled
against the Node ABI.

Running on Node 20 or older does **not** produce a clean "unsupported version" error — the
database driver **segfaults the process** (`SIGSEGV`), which looks like a random crash loop
and is easy to misdiagnose as an application bug. When the server suite is run on Node 20 it
reports ~16/60 failures with no useful stack trace.

- On Node 22: native module loads, all tests pass.
- On Node 20: `SIGSEGV`, process aborts.

Pin the runtime explicitly on your host (e.g. `NODE_VERSION=22` on Render/Vercel, or a
`node:22` base image for Docker) and verify with `node --version` at startup.

## Option 1: Single Render service (Recommended - same-origin, simplest)
The server serves the built client from `client/dist`. No CORS needed between client and API.

1. Push this repo to GitHub.
2. Create a new Render Web Service pointing to the repo.
3. Use the following settings (or use render.yaml):
   - Build Command: `npm run install:all && npm run build`
   - Pre Deploy Command: `npm run db:setup` (idempotent)
   - Start Command: `npm run start` (or `npm run start:prod`)
4. Add a Persistent Disk: name `hms-data`, mount path `/var/data`, size 1GB (or more). This is required for SQLite persistence; ephemeral disk will lose data on restarts/deploys.
5. Set environment variables:
   - NODE_ENV=production
   - PORT=10000 (Render sets this automatically; set explicitly if needed)
   - JWT_SECRET=generate a secure random >=32 chars
   - CORS_ORIGINS=leave empty for same-origin
   - DB_PATH=/var/data/hospital.db
   - PUBLIC_URL=https://your-render-app.onrender.com
   - APP_TIMEZONE=Africa/Kigali
   - SMTP_* as needed for password resets
   - BACKUP_ENCRYPTION_KEY=set for encrypted backups (store securely, not in repo)
   - TRUST_PROXY=true
6. Deploy. Initial deploy will build, setup DB, start server. Health: https://your-app/api/health.

Notes:
- Seed is blocked in production; only seed with ALLOW_DEMO_SEED=true on an isolated DB.
- DB backups: `npm run db:backup` can run as a cron job or manually. Consider offsite copy.
- Better-sqlite3 needs native build (Render Node 22 will handle).

## Option 2: Vercel frontend + Render backend (split)
Client uses relative `/api` paths; so Vercel must rewrite `/api/*` to Render backend.

1. Deploy backend on Render as above. Get its public URL (e.g. https://your-backend.onrender.com).
2. On Vercel, import the repo. Build command: `npm run build --prefix client`. Output: `client/dist`.
3. Update `vercel.json`: replace `https://YOUR-RENDER-APP.onrender.com` with your backend URL.
4. Set frontend env vars if needed: `VITE_API_BASE_URL` is NOT currently used; rewrites handle it. If you want to keep client using base URL, you can inject it - but current code is fine with rewrites.
5. CORS on Render: add frontend origin to CORS_ORIGINS (e.g., https://your-frontend.vercel.app).

## Important: SQLite persistence on Render
Render free tier has ephemeral filesystem. To persist data, you MUST attach a Render Persistent Disk to the web service and set DB_PATH to the mount path (e.g. /var/data/hospital.db). Disk is a paid add-on for persistent storage. Backups are still recommended.

## Environment variables required
See README.md and server/.env.example. Critical: JWT_SECRET (>=32), DB_PATH, PUBLIC_URL (https in prod), CORS_ORIGINS (if split), SMTP for password resets in prod.

## First run checklist
- [ ] Set strong JWT_SECRET
- [ ] Set DB_PATH to persistent location
- [ ] Configure PUBLIC_URL to your app URL
- [ ] Ensure HTTPS (Render/Vercel provide)
- [ ] Run `npm run db:setup` (done by preDeployCommand)
- [ ] Do NOT run `npm run db:seed` in production unless explicitly for demo
