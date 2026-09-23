const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { validatePatient } = require('../middleware/validation');

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateMRN() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `MRN-${timestamp.slice(-4)}${random}`;
}

/**
 * Generates a human-readable unique access code the patient carries.
 * Format: HMS-XXXX-YYYYY  (4 chars from MRN suffix + 5 random alphanum)
 * Example: HMS-L9XQ-R4A2B
 */
function generateAccessCode(mrn) {
  const mrnPart = mrn.replace('MRN-', '').substring(0, 4).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `HMS-${mrnPart}-${rand}`;
}

/** Default portal PIN: 6-digit numeric string, e.g. "482031" */
function generatePortalPin() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET / — list with search + pagination
router.get('/', authenticate, async (req, res) => {
  try {
    const { search, status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    let query = 'SELECT * FROM patients WHERE 1=1';
    const params = [];
    if (search) {
      query += ' AND (first_name LIKE ? OR last_name LIKE ? OR mrn LIKE ? OR phone LIKE ? OR email LIKE ? OR access_code LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s, s, s);
    }
    if (status) { query += ' AND status = ?'; params.push(status); }
    const [countRes] = await pool.query(query.replace('SELECT *', 'SELECT COUNT(*) as total'), params);
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    const [rows] = await pool.query(query, params);
    // Never expose portal_pin in list responses
    const safe = rows.map(({ portal_pin, ...rest }) => rest);
    res.json({ patients: safe, total: countRes[0].total, page: parseInt(page), limit: parseInt(limit) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /lookup/:code — doctor looks up a patient by their access code
router.get('/lookup/:code', authenticate, async (req, res) => {
  try {
    const code = (req.params.code || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ message: 'Access code is required.' });

    const [rows] = await pool.query(
      `SELECT p.*,
              (SELECT COUNT(*) FROM appointments WHERE patient_id = p.id) as total_appointments,
              (SELECT COUNT(*) FROM medical_records WHERE patient_id = p.id) as total_records,
              (SELECT COUNT(*) FROM prescriptions WHERE patient_id = p.id) as total_prescriptions
       FROM patients p
       WHERE UPPER(p.access_code) = ? AND p.status = 'active'`,
      [code]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'No active patient found for this access code.' });
    }
    const { portal_pin, ...patient } = rows[0];
    res.json({ patient });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /:id — single patient
router.get('/:id', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM patients WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Patient not found' });
    const { portal_pin, ...patient } = rows[0];
    res.json(patient);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// POST / — register new patient
router.post('/', authenticate, authorize('admin', 'receptionist', 'doctor', 'nurse'), validatePatient, async (req, res) => {
  try {
    const {
      first_name, last_name, date_of_birth, gender, blood_type, phone, email, address,
      emergency_contact_name, emergency_contact_phone, insurance_provider, insurance_number,
      allergies, chronic_conditions
    } = req.body;

    const uuid        = uuidv4();
    const mrn         = generateMRN();
    const accessCode  = generateAccessCode(mrn);
    const plainPin    = generatePortalPin();                   // 6-digit PIN shown to admin
    const hashedPin   = await bcrypt.hash(plainPin, 10);       // stored securely

    const [result] = await pool.query(
      `INSERT INTO patients
        (uuid, mrn, access_code, portal_pin,
         first_name, last_name, date_of_birth, gender, blood_type,
         phone, email, address,
         emergency_contact_name, emergency_contact_phone,
         insurance_provider, insurance_number,
         allergies, chronic_conditions)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        uuid, mrn, accessCode, hashedPin,
        first_name, last_name, date_of_birth, gender, blood_type || null,
        phone   || null, email   || null, address || null,
        emergency_contact_name   || null, emergency_contact_phone || null,
        insurance_provider       || null, insurance_number        || null,
        allergies                || null, chronic_conditions      || null,
      ]
    );

    const [newPatient] = await pool.query('SELECT * FROM patients WHERE id = ?', [result.insertId]);
    const { portal_pin, ...patient } = newPatient[0];

    // Return the plain PIN once — it is never stored in plaintext again
    res.status(201).json({ patient, plain_pin: plainPin });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /:id — update patient
router.put('/:id', authenticate, authorize('admin', 'receptionist', 'doctor', 'nurse'), async (req, res) => {
  try {
    const allowed = [
      'first_name','last_name','date_of_birth','gender','blood_type',
      'phone','email','address',
      'emergency_contact_name','emergency_contact_phone',
      'insurance_provider','insurance_number',
      'allergies','chronic_conditions','status'
    ];
    const updates = [];
    const values = [];
    allowed.forEach(f => {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f] || null); }
    });
    if (updates.length === 0) return res.status(400).json({ message: 'No fields to update' });
    values.push(req.params.id);
    await pool.query(`UPDATE patients SET ${updates.join(', ')} WHERE id = ?`, values);
    const [updated] = await pool.query('SELECT * FROM patients WHERE id = ?', [req.params.id]);
    const { portal_pin, ...patient } = updated[0];
    res.json(patient);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /:id — soft-deactivate
router.delete('/:id', authenticate, authorize('admin', 'receptionist'), async (req, res) => {
  try {
    const [result] = await pool.query("UPDATE patients SET status = 'inactive' WHERE id = ?", [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Patient not found' });
    res.json({ message: 'Patient deactivated' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /:id/history — medical history
router.get('/:id/history', authenticate, async (req, res) => {
  try {
    const [appointments] = await pool.query(
      `SELECT a.*, u.first_name as doctor_first_name, u.last_name as doctor_last_name
       FROM appointments a JOIN users u ON a.doctor_id = u.id
       WHERE a.patient_id = ? ORDER BY a.appointment_date DESC`, [req.params.id]
    );
    const [records] = await pool.query(
      `SELECT mr.*, u.first_name as doctor_first_name, u.last_name as doctor_last_name
       FROM medical_records mr JOIN users u ON mr.doctor_id = u.id
       WHERE mr.patient_id = ? ORDER BY mr.record_date DESC`, [req.params.id]
    );
    const [prescriptions] = await pool.query(
      `SELECT p.*, u.first_name as doctor_first_name, u.last_name as doctor_last_name
       FROM prescriptions p JOIN users u ON p.doctor_id = u.id
       WHERE p.patient_id = ? ORDER BY p.prescribed_date DESC`, [req.params.id]
    );
    const [bills] = await pool.query(
      'SELECT * FROM bills WHERE patient_id = ? ORDER BY created_at DESC', [req.params.id]
    );
    res.json({ appointments, medical_records: records, prescriptions, bills });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
