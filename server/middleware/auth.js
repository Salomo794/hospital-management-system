const jwt = require('jsonwebtoken');
const pool = require('../config/database');

function readBearerToken(req) {
  const authorization = req.header('Authorization') || '';
  const match = authorization.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : null;
}

const authenticate = async (req, res, next) => {
  const token = readBearerToken(req);
  if (!token) {
    return res.status(401).json({ message: 'Access denied. A valid Bearer token is required.' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (_) {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }

  // A patient portal token is a different kind of credential and must never be
  // accepted here. Today it would fail anyway because it carries `pid` instead
  // of `id`, but relying on that coincidence means a future rename could
  // silently promote every patient session to a staff session.
  if (decoded.portal === true || !decoded.id) {
    return res.status(401).json({ message: 'Access denied. Staff credentials are required for this endpoint.' });
  }

  try {
    const [rows] = await pool.query(
      'SELECT id, uuid, email, role, first_name, last_name, is_active, password_changed_at FROM users WHERE id = ?',
      [decoded.id]
    );
    if (rows.length === 0 || !rows[0].is_active) {
      return res.status(401).json({ message: 'Invalid token or user deactivated.' });
    }
    // A token issued before the current password is no longer valid. This is
    // what makes a password reset mean anything: without it, whoever prompted
    // the reset keeps their session and never has to sign in again.
    //
    // Tokens minted before this claim existed carry no `pwd`, so they are
    // accepted only while the account has still never changed its password.
    const currentStamp = rows[0].password_changed_at || '0';
    const tokenStamp = decoded.pwd || '0';
    if (tokenStamp !== currentStamp) {
      return res.status(401).json({
        message: 'Your session has ended because your password changed. Please sign in again.',
      });
    }
    req.user = rows[0];
    return next();
  } catch (error) {
    return next(error);
  }
};

const authorize = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ message: 'Insufficient permissions.' });
  }
  return next();
};

const PORTAL_PATIENT_COLUMNS = `id, uuid, mrn, first_name, last_name, date_of_birth, gender, phone, email,
        blood_type, insurance_provider, allergies, chronic_conditions, status,
        portal_session_version`;

/**
 * Resolves a verified portal JWT to a live patient row.
 * Returns { patient } or { error: 'missing' | 'revoked' } so callers can choose
 * between responding with a 401 and quietly falling back to anonymous access.
 */
async function loadPortalSession(decoded) {
  const [rows] = await pool.query(
    `SELECT ${PORTAL_PATIENT_COLUMNS}
     FROM patients WHERE id = ? AND status = 'active'`,
    [decoded.pid]
  );
  if (rows.length === 0) return { error: 'missing' };
  if (Number(decoded.psv) !== Number(rows[0].portal_session_version)) return { error: 'revoked' };
  return { patient: rows[0] };
}

const authenticatePortal = async (req, res, next) => {
  const token = readBearerToken(req);
  if (!token) {
    return res.status(401).json({ message: 'Access denied. A valid Bearer token is required.' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (_) {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
  if (!decoded.portal || !decoded.pid) {
    return res.status(401).json({ message: 'Access denied. Portal session required.' });
  }

  try {
    const session = await loadPortalSession(decoded);
    if (session.error === 'missing') {
      return res.status(401).json({ message: 'Patient record not found or inactive.' });
    }
    if (session.error === 'revoked') {
      return res.status(401).json({ message: 'This portal session has been revoked. Please sign in again.' });
    }
    req.patient = session.patient;
    return next();
  } catch (error) {
    return next(error);
  }
};

/**
 * Attaches req.patient when a valid portal session is present, and otherwise
 * continues anonymously. Used by endpoints that are legitimately reachable both
 * by an authenticated patient (from their own phone) and by an unauthenticated
 * kiosk holding a single-use check-in token.
 */
const optionalPortalAuth = async (req, res, next) => {
  if (!readBearerToken(req)) return next();
  let decoded;
  try {
    decoded = jwt.verify(readBearerToken(req), process.env.JWT_SECRET);
  } catch (_) {
    return next(); // invalid/expired session is simply "not signed in" here
  }
  if (!decoded.portal || !decoded.pid) return next();
  try {
    const session = await loadPortalSession(decoded);
    if (session.patient) req.patient = session.patient;
    return next();
  } catch (error) {
    return next(error);
  }
};

module.exports = { authenticate, authorize, authenticatePortal, optionalPortalAuth, readBearerToken };
