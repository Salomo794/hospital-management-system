# Deployment Guide (Render + Vercel or single Render)

## Option 1: Single Render service (Recommended - same-origin, simplest)
The server serves the built client from `client/dist`. No CORS needed between client and API.

1. Push this repo to GitHub.
2. Create a new Render Web Service pointing to the repo.
3. Use the following settings (or use render.yaml):
   - Build Command: `npm run install:all && npm run build`
   - Pre Deploy Command: `npm run db:setup` (idempotent)
   - Start Command: `npm run start` (or `npm run start:prod`)
4. Configure a managed MySQL 8 database and set its connection URL as a secret environment variable.
5. Set environment variables:
   - NODE_ENV=production
   - PORT=10000 (Render sets this automatically; set explicitly if needed)
   - JWT_SECRET=generate a secure random >=32 chars
   - CORS_ORIGINS=leave empty for same-origin
   - DATABASE_URL=mysql://<user>:<password>@<host>:3306/<database>
   - PUBLIC_URL=https://your-render-app.onrender.com
   - APP_TIMEZONE=Africa/Kigali
   - SMTP_* as needed for password resets
   - BACKUP_ENCRYPTION_KEY=set for encrypted backups (store securely, not in repo)
   - TRUST_PROXY=true
6. Deploy. Initial deploy will build, setup DB, start server. Health: https://your-app/api/health.

Notes:
- Seed is blocked in production; only seed with ALLOW_DEMO_SEED=true on an isolated DB.
- DB backups: `npm run db:backup` can run as a cron job or manually. Consider offsite copy.

## Option 2: Vercel frontend + Render backend (split)
Client uses relative `/api` paths; so Vercel must rewrite `/api/*` to Render backend.

1. Deploy backend on Render as above. Get its public URL (e.g. https://your-backend.onrender.com).
2. On Vercel, import the repo. Build command: `npm run build --prefix client`. Output: `client/dist`.
3. Update `vercel.json`: replace `https://YOUR-RENDER-APP.onrender.com` with your backend URL.
4. Set frontend env vars if needed: `VITE_API_BASE_URL` is NOT currently used; rewrites handle it. If you want to keep client using base URL, you can inject it - but current code is fine with rewrites.
5. CORS on Render: add frontend origin to CORS_ORIGINS (e.g., https://your-frontend.vercel.app).

## Environment variables required
See README.md and server/.env.example. Critical: JWT_SECRET (>=32), DATABASE_URL, PUBLIC_URL (https in prod), CORS_ORIGINS (if split), SMTP for password resets in prod.

## First run checklist
- [ ] Set strong JWT_SECRET
- [ ] Set DATABASE_URL to the managed MySQL instance
- [ ] Configure PUBLIC_URL to your app URL
- [ ] Ensure HTTPS (Render/Vercel provide)
- [ ] Run `npm run db:setup` (done by preDeployCommand)
- [ ] Do NOT run `npm run db:seed` in production unless explicitly for demo
