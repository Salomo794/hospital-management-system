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

  try {
    const [rows] = await pool.query(
      'SELECT id, uuid, email, role, first_name, last_name, is_active FROM users WHERE id = ?',
      [decoded.id]
    );
    if (rows.length === 0 || !rows[0].is_active) {
      return res.status(401).json({ message: 'Invalid token or user deactivated.' });
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
    const [rows] = await pool.query(
      `SELECT id, uuid, mrn, first_name, last_name, date_of_birth, gender, phone, email,
              blood_type, insurance_provider, allergies, chronic_conditions, status
       FROM patients WHERE id = ? AND status = 'active'`,
      [decoded.pid]
    );
    if (rows.length === 0) {
      return res.status(401).json({ message: 'Patient record not found or inactive.' });
    }
    req.patient = rows[0];
    return next();
  } catch (error) {
    return next(error);
  }
};

module.exports = { authenticate, authorize, authenticatePortal, readBearerToken };
