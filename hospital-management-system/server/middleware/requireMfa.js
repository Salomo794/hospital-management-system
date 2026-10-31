'use strict';

const { ApiError } = require('../utils/http');

/**
 * requireMfa — middleware that rejects requests from staff accounts that have
 * not completed multi-factor authentication setup.
 *
 * This is intentionally scoped to high-sensitivity roles (admin by default,
 * configurable through `MFA_REQUIRED_ROLES`). It does not apply to the patient
 * portal, which authenticates with its own session PIN/token.
 *
 * Routes that need MFA should place this after `authenticate` and after
 * `authorize(...)`:
 *
 *   router.get('/api/admin/audit', authenticate, authorize('admin'), requireMfa(), ...);
 *
 * It allows the MFA setup and verification endpoints themselves (they live
 * under /api/auth/mfa/*) so a user who is not yet enrolled can still complete
 * enrollment without being locked out.
 */
function requireMfa(options = {}) {
  const requiredRoles = new Set(
    (options.roles || process.env.MFA_REQUIRED_ROLES || '')
      .split(',')
      .map(role => role.trim())
      .filter(Boolean)
  );

  return function requireMfaMiddleware(req, res, next) {
    const user = req.user;

    if (!user) {
      // `authenticate` runs first; if it is absent this is a configuration error.
      return next(new ApiError(500, 'requireMfa used without authentication middleware.'));
    }

    // Never require MFA on the MFA setup/verify/disable endpoints themselves:
    // they are the only way to enroll or un-enroll.
    if (
      req.path.startsWith('/api/auth/mfa/') ||
      req.path === '/api/auth/me'
    ) {
      return next();
    }

    if (!requiredRoles.has(user.role)) return next();

    if (Number(user.mfa_enabled) === 1 && user.mfa_secret) {
      return next();
    }

    return res.status(403).json({
      message:
        'Multi-factor authentication is required for this role. Set it up at /api/auth/mfa/setup.',
      mfa_required: true,
    });
  };
}

module.exports = { requireMfa };