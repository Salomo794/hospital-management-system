const pool = require('../config/database');

// The audit_log table was created by setup.js but nothing ever wrote to it.
// This module is the single place that does.
//
// Two rules matter here:
//
// 1. Auditing must never break a clinical or financial request. Every insert
//    is best-effort; failures are logged and swallowed.
//
// 2. Never call the shared pool from inside an open transaction. pool.query()
//    waits for the active transaction to finish committing, so an audit write
//    issued mid-transaction would deadlock against the commit that is waiting
//    on it. Pass the transaction's `connection` whenever the audited change
//    happens inside one.

const REDACTED = '[redacted]';
const SENSITIVE_KEYS = new Set([
  'password', 'new_password', 'current_password', 'password_hash', 'plain_pin',
  'portal_pin', 'access_code', 'token', 'authorization', 'secret', 'jwt_secret',
]);

const MAX_STRING_LENGTH = 2000;
const MAX_DEPTH = 4;
const MAX_ARRAY_ITEMS = 50;

function sanitize(value, depth = 0) {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...[truncated]` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return REDACTED;
  if (depth >= MAX_DEPTH) return '[truncated]';

  if (Array.isArray(value)) {
    const kept = value.slice(0, MAX_ARRAY_ITEMS).map(item => sanitize(item, depth + 1));
    return value.length > MAX_ARRAY_ITEMS ? [...kept, `...[${value.length - MAX_ARRAY_ITEMS} more]`] : kept;
  }

  if (typeof value === 'object') {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? REDACTED : sanitize(item, depth + 1);
    }
    return output;
  }

  return String(value);
}

function serialize(value) {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(sanitize(value));
  } catch (_) {
    return JSON.stringify('[unserializable]');
  }
}

function resolveActor(req, override) {
  // Callers that already know who acted can say so directly. Login is the case
  // that needs this: the handler identifies the user itself, because the
  // authenticate middleware has not run yet on that route.
  if (override && (override.userId || override.type)) {
    return {
      userId: override.userId ?? null,
      type: override.type || 'staff',
      label: override.label ?? null,
    };
  }
  if (req?.user?.id) {
    return { userId: req.user.id, type: 'staff', label: req.user.email || null };
  }
  // Patient ids share a namespace with user ids, so a portal actor must never
  // be written to audit_log.user_id. The type and label carry the identity.
  if (req?.patient?.id) {
    return { userId: null, type: 'patient', label: req.patient.email || req.patient.mrn || null };
  }
  return { userId: null, type: 'anonymous', label: null };
}

function clientIp(req) {
  if (!req) return null;
  return req.ip || req.socket?.remoteAddress || null;
}

// Best-effort. Never rejects, so callers can `await` it without a try/catch.
function recordAudit({
  req, action, table, recordId, before, after, summary, connection, actor,
}) {
  if (!action) throw new Error('recordAudit requires an action');
  const resolved = resolveActor(req, actor);
  const target = connection || pool;
  return Promise.resolve(
    target.query(
      `INSERT INTO audit_log
         (user_id, actor_type, actor_label, action, summary, table_name, record_id, old_values, new_values, ip_address)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        resolved.userId,
        resolved.type,
        resolved.label,
        action,
        summary ? String(summary).slice(0, 500) : null,
        table || null,
        recordId === undefined || recordId === null ? null : Number(recordId) || null,
        serialize(before),
        serialize(after),
        clientIp(req),
      ]
    )
  ).catch(error => {
    console.warn(`[audit] Could not record "${action}": ${error.message}`);
    return null;
  });
}

// Restricts an audited row to the columns worth keeping, so a full-table dump
// of patient or user records never lands in the audit log.
function pick(row, fields) {
  if (!row) return null;
  const output = {};
  for (const field of fields) {
    if (row[field] !== undefined) output[field] = row[field];
  }
  return output;
}

module.exports = { recordAudit, pick, sanitize, serialize };
