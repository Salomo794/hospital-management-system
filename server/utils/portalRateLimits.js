const { FixedWindowRateLimiter } = require('./rateLimiter');

/**
 * Rate-limit buckets for the public patient portal.
 *
 * These live in their own module so the test suite can clear a bucket between
 * cases without reaching into the route file. Every test originates from the
 * same loopback address, so without an explicit reset one case would inherit
 * the previous case's budget and the suite would pass or fail depending on
 * order.
 */

// 8 attempts / 15 min / (ip, identifier). Keyed by identifier as well as IP so
// one shared kiosk or NAT cannot lock out patients on other devices.
const portalLoginLimiter = new FixedWindowRateLimiter({ windowMs: 15 * 60 * 1000, max: 8 });

// 20 check-in attempts / 5 min / IP. Generous for a kiosk queue, tight enough
// that guessing tokens is hopeless (a 256-bit token space and 20 tries per
// 5 minutes is not an attack surface).
const checkinLimiter = new FixedWindowRateLimiter({ windowMs: 5 * 60 * 1000, max: 20 });

// Issuing tokens is a staff-only action, but it mints credentials, so it gets a
// ceiling too.
const checkinTokenIssueLimiter = new FixedWindowRateLimiter({ windowMs: 60 * 60 * 1000, max: 200 });

function clearPortalRateLimits() {
  portalLoginLimiter.clear();
  checkinLimiter.clear();
  checkinTokenIssueLimiter.clear();
}

module.exports = {
  portalLoginLimiter,
  checkinLimiter,
  checkinTokenIssueLimiter,
  clearPortalRateLimits,
};
