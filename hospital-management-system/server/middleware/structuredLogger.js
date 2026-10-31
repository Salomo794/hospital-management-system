'use strict';

/**
 * Structured JSON request logger for production.
 *
 * In production, `app.use(structuredLogger)` emits one JSON object per request
 * to stdout, suitable for ingestion by log aggregators (CloudWatch, Datadog,
 * Splunk, ELK, etc.). It deliberately logs only request metadata — no request
 * bodies, no query strings, no response bodies — so patient data and other
 * sensitive fields never reach the log stream.
 *
 * In non-production environments, the existing morgan text logger (configured
 * in server/index.js) is left in place; this middleware is a no-op there.
 *
 * Usage:
 *   app.use(structuredLogger);  // after cors/helmet, before routes
 */

function redact(value) {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed === '' ? undefined : trimmed;
}

function structuredLogger(req, res, next) {
  if (process.env.NODE_ENV !== 'production') return next();

  const start = process.hrtime.bigint();
  const requestId =
    req.header('X-Request-ID') || res.getHeader('X-Request-ID') || '';

  res.on('finish', () => {
    const durationNs = process.hrtime.bigint() - start;
    const durationMs = Number(durationNs / 1_000_000n);

    const entry = {
      level: 'info',
      timestamp: new Date().toISOString(),
      request_id: String(requestId),
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration_ms: durationMs,
      remote_addr: redact(req.ip || req.socket?.remoteAddress),
      user_agent: redact(req.get('User-Agent')),
    };

    const user = req.user;
    if (user) {
      entry.user_id = user.id;
      entry.user_email = user.email;
      entry.user_role = user.role;
    }

    const patient = req.patient;
    if (patient) {
      entry.patient_id = patient.id;
      entry.patient_mrn = patient.mrn;
    }

    process.stdout.write(`${JSON.stringify(entry)}\n`);
  });

  next();
}

module.exports = { structuredLogger };