# Dockerfile for Hospital Management System
#
# Multi-stage build:
#   1. Build the Vue 3 client with Vite.
#   2. Run the Express API, serving the built client from `client/dist`.
#
# Build:
#   docker build -t hospital-management-system .
#
# Run (example, values must be replaced for your deployment):
#   docker run --rm -p 5000:5000 \
#     -e NODE_ENV=production \
#     -e DATABASE_URL=mysql://... \
#     -e JWT_SECRET=... \
#     -e CORS_ORIGINS=https://... \
#     -e PUBLIC_URL=https://... \
#     -e SMTP_HOST=... SMTP_USER=... SMTP_PASS=... \
#     -e BACKUP_ENCRYPTION_KEY=... \
#     hospital-management-system
#
# The container expects an external MySQL database (managed or sidecar). It does
# not run MySQL itself.
#
# For TLS termination, run Caddy (or another reverse proxy) in front of this
# container and set PUBLIC_URL/CORS_ORIGINS to HTTPS origins.

# ---------------------------------------------------------------
# Stage 1: Build the client
# ---------------------------------------------------------------
FROM node:22-alpine AS client-builder

WORKDIR /app/client

# Install client dependencies first (layer caching).
COPY client/package.json client/package-lock.json ./
RUN npm ci --include=dev

COPY client/ ./
RUN npm run build

# ---------------------------------------------------------------
# Stage 2: Run the API server
# ---------------------------------------------------------------
FROM node:22-alpine

WORKDIR /app

# Install production server dependencies.
COPY package.json package-lock.json ./
COPY server/package.json server/package-lock.json ./server/
RUN npm ci --omit=dev && npm --prefix server ci --omit=dev

# Copy the application source.
COPY server/ ./server/
COPY client/dist ./client/dist

# Create a non-root user for the runtime process.
RUN addgroup -S hms && adduser -S hms -G hms
RUN mkdir -p /app/server/backups/mysql && chown -R hms:hms /app

USER hms

EXPOSE 5000

# Health check: the /api/health endpoint answers when the database is reachable.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:5000/api/health', r => { const ok = r.statusCode === 200 || r.statusCode === 503; process.exit(ok ? 0 : 1); }).on('error', () => process.exit(1))"

ENV NODE_ENV=production
ENV PORT=5000

CMD ["node", "server/index.js"]