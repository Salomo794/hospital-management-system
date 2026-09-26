const { FixedWindowRateLimiter } = require('../utils/rateLimiter');

// The application throttled sign-in, password reset and the AI chat, but not a
// single endpoint that reads patient data. Combined with a staff token that
// lives for a week, that meant a leaked or borrowed token could walk the entire
// patient database - every record, every chart, every bill - unthrottled, and
// with nothing to notice it happening.
//
// These limits are not about a user clicking quickly. They are about a rate that
// a person cannot produce by working, so that bulk access is throttled, rate
// limited and, because the audit trail records reads as well as writes, visible.
//
// The budgets are deliberately generous for genuine clinical work: a doctor
// moving through a ward list is nowhere near them. The bulk budget is the
// tight one, because that is where a list endpoint turns into an export.

const WINDOW_MS = 60 * 1000;

// Exported so the limits can be inspected, documented and asserted against
// without reaching into a limiter's internal bookkeeping.
const LIMITS = {
  read: 240,
  bulk: 30,
  write: 60
};

// The address budget is deliberately a large multiple of the per-person one.
// Staff share terminals and a hospital sits behind a single NAT, so an address
// budget at the same size as the personal one means one person being throttled
// locks out everyone else working at that desk. At a multiple it stays a
// backstop against one host spraying many different stolen tokens, without
// letting one account's exhaustion reach its colleagues.
const IP_MULTIPLE = 10;

function buildLimiters(scope, max) {
  return {
    byUser: new FixedWindowRateLimiter({ windowMs: WINDOW_MS, max }),
    byIp: new FixedWindowRateLimiter({ windowMs: WINDOW_MS, max: max * IP_MULTIPLE })
  };
}

const LIMITERS = {
  read: buildLimiters('read', LIMITS.read),
  bulk: buildLimiters('bulk', LIMITS.bulk),
  write: buildLimiters('write', LIMITS.write)
};

function clientKey(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function accountKey(req) {
  // A portal session is a patient, a staff session is a user; both are
  // identified by their own id, which is what makes the budget per-person
  // rather than per-connection.
  const id = req.user?.id ?? req.patient?.id;
  return id === undefined || id === null ? null : String(id);
}

// Two budgets are charged per request, with very different sizes. The personal
// one is the limit that actually applies; the address one is a backstop set
// well above it, so a shared desk never throttles its colleagues but a single
// host still cannot spray many accounts.
function limit(scope) {
  return (req, res, next) => {
    const { byUser, byIp } = LIMITERS[scope];
    const who = accountKey(req);
    const where = clientKey(req);

    let blocked = null;
    const byAddress = byIp.consume(`ip:${where}:${scope}`);
    if (!byAddress.allowed) blocked = byAddress;
    if (!blocked && who) {
      const byPerson = byUser.consume(`u:${who}:${scope}`);
      if (!byPerson.allowed) blocked = byPerson;
    }

    if (blocked) {
      res.setHeader('Retry-After', String(blocked.retryAfterSeconds));
      return res.status(429).json({
        message: 'Too many requests for patient data. Please slow down and try again shortly.',
        retry_after_seconds: blocked.retryAfterSeconds,
      });
    }

    return next();
  };
}

const readPatientData = limit('read');
const readPatientDataInBulk = limit('bulk');
const writePatientData = limit('write');

// The test suite runs many requests from one loopback address, so it has to be
// able to reset the budgets between cases without knowing which keys it burned.
function clearAll() {
  for (const pair of Object.values(LIMITERS)) {
    pair.byUser.clear();
    pair.byIp.clear();
  }
}

module.exports = {
  readPatientData,
  readPatientDataInBulk,
  writePatientData,
  clearAll,
  LIMITS,
  LIMITERS,
};
