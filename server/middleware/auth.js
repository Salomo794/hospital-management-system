const jwt = require('jsonwebtoken');
const pool = require('../config/database');

const authenticate = async (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ message: 'Access denied. No token provided.' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const [rows] = await pool.query('SELECT id, uuid, email, role, first_name, last_name, is_active FROM users WHERE id = ?', [decoded.id]);
    if (rows.length === 0 || !rows[0].is_active) {
      return res.status(401).json({ message: 'Invalid token or user deactivated.' });
    }
    req.user = rows[0];
    next();
  } catch (error) {
    res.status(401).json({ message: 'Invalid token.' });
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Insufficient permissions.' });
    }
    next();
  };
};

// Patient portal guard — validates a portal JWT and loads the patient
const authenticatePortal = async (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ message: 'Access denied. No token provided.' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.portal || !decoded.pid) {
      return res.status(401).json({ message: 'Access denied. Portal session required.' });
    }
    const [rows] = await pool.query(
      'SELECT id, uuid, mrn, first_name, last_name, date_of_birth, gender, phone, email, blood_type, insurance_provider, allergies, chronic_conditions, status FROM patients WHERE id = ? AND status = ?',
      [decoded.pid, 'active']
    );
    if (rows.length === 0) {
      return res.status(401).json({ message: 'Patient record not found or inactive.' });
    }
    req.patient = rows[0];
    next();
  } catch (error) {
    res.status(401).json({ message: 'Invalid token.' });
  }
};

module.exports = { authenticate, authorize, authenticatePortal };
