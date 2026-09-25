const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { validatePatient } = require('../middleware/validation');
const { ApiError, asyncHandler, getPagination, isDateOnly, parseInteger } = require('../utils/http');
const { randomUUID, generateMrn, generateAccessCode, generatePortalPin } = require('../utils/ids');

const CLINICAL_ROLES = ['admin', 'receptionist', 'doctor', 'nurse'];
const GENDERS = ['male', 'female', 'other'];
const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const PATIENT_STATUSES = ['active', 'inactive', 'deceased'];

function withoutPortalPin(patient) {
  const { portal_pin, portal_session_version, ...safePatient } = patient;
  return {
    ...safePatient,
    portal_pin_provisioned: !!portal_pin,
  };
}

function validatePatientUpdates(body, currentRole) {
  const allowed = [
    'first_name', 'last_name', 'date_of_birth', 'gender', 'blood_type',
    'phone', 'email', 'address', 'emergency_contact_name', 'emergency_contact_phone',
    'insurance_provider', 'insurance_number', 'allergies', 'chronic_conditions', 'status',
  ];
  const updates = {};
  for (const field of allowed) {
    if (body[field] === undefined) continue;
    const value = typeof body[field] === 'string' ? body[field].trim() : body[field];
    if (['first_name', 'last_name'].includes(field) && !value) {
      throw new ApiError(400, `${field} cannot be empty`);
    }
    if (field === 'date_of_birth' && (!isDateOnly(value) || value > new Date().toISOString().slice(0, 10))) {
      throw new ApiError(400, 'date_of_birth must be a valid date that is not in the future');
    }
    if (field === 'gender' && !GENDERS.includes(value)) throw new ApiError(400, 'Invalid gender');
    if (field === 'blood_type' && value && !BLOOD_TYPES.includes(value)) throw new ApiError(400, 'Invalid blood type');
    if (field === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      throw new ApiError(400, 'Invalid email address');
    }
    if (field === 'status') {
      if (!['admin', 'receptionist'].includes(currentRole)) {
        throw new ApiError(403, 'Only administrators or receptionists can change patient status.');
      }
      if (!PATIENT_STATUSES.includes(value)) throw new ApiError(400, 'Invalid patient status');
    }
    updates[field] = value || null;
  }
  if (Object.keys(updates).length === 0) throw new ApiError(400, 'No fields to update');
  return updates;
}

router.get('/', authenticate, authorize(...CLINICAL_ROLES), asyncHandler(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const { search, status } = req.query;
  if (status && !PATIENT_STATUSES.includes(status)) throw new ApiError(400, 'Invalid patient status');

  let where = 'WHERE 1=1';
  const params = [];
  if (search) {
    where += ' AND (first_name LIKE ? OR last_name LIKE ? OR mrn LIKE ? OR phone LIKE ? OR email LIKE ? OR access_code LIKE ?)';
    const term = `%${String(search).trim().slice(0, 100)}%`;
    params.push(term, term, term, term, term, term);
  }
  if (status) {
    where += ' AND status = ?';
    params.push(status);
  }

  const [countRows] = await pool.query(`SELECT COUNT(*) as total FROM patients ${where}`, params);
  const [rows] = await pool.query(
    `SELECT * FROM patients ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({
    patients: rows.map(withoutPortalPin),
    total: countRows[0].total,
    page,
    limit,
  });
}));

router.get('/lookup/:code', authenticate, authorize(...CLINICAL_ROLES), asyncHandler(async (req, res) => {
  const code = String(req.params.code || '').trim().toUpperCase();
  if (!code || code.length > 40) throw new ApiError(400, 'A valid access code is required');
  const [rows] = await pool.query(
    `SELECT p.*,
            (SELECT COUNT(*) FROM appointments WHERE patient_id = p.id) as total_appointments,
            (SELECT COUNT(*) FROM medical_records WHERE patient_id = p.id) as total_records,
            (SELECT COUNT(*) FROM prescriptions WHERE patient_id = p.id) as total_prescriptions
     FROM patients p WHERE UPPER(p.access_code) = ? AND p.status = 'active'`,
    [code]
  );
  if (rows.length === 0) throw new ApiError(404, 'No active patient found for this access code');
  res.json({ patient: withoutPortalPin(rows[0]) });
}));

router.get('/:id', authenticate, authorize(...CLINICAL_ROLES), asyncHandler(async (req, res) => {
  const id = parseInteger(req.params.id, 'id', { min: 1 });
  const [rows] = await pool.query('SELECT * FROM patients WHERE id = ?', [id]);
  if (rows.length === 0) throw new ApiError(404, 'Patient not found');
  res.json(withoutPortalPin(rows[0]));
}));

router.post('/', authenticate, authorize(...CLINICAL_ROLES), validatePatient, asyncHandler(async (req, res) => {
  const {
    first_name, last_name, date_of_birth, gender, blood_type, phone, email, address,
    emergency_contact_name, emergency_contact_phone, insurance_provider, insurance_number,
    allergies, chronic_conditions,
  } = req.body;

  const uuid = randomUUID();
  const mrn = generateMrn();
  const accessCode = generateAccessCode(mrn);
  const plainPin = generatePortalPin();
  const hashedPin = await bcrypt.hash(plainPin, 12);
  const [result] = await pool.query(
    `INSERT INTO patients
      (uuid, mrn, access_code, portal_pin, first_name, last_name, date_of_birth, gender, blood_type,
       phone, email, address, emergency_contact_name, emergency_contact_phone,
       insurance_provider, insurance_number, allergies, chronic_conditions)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      uuid, mrn, accessCode, hashedPin, first_name.trim(), last_name.trim(), date_of_birth, gender,
      blood_type || null, phone || null, email || null, address || null,
      emergency_contact_name || null, emergency_contact_phone || null,
      insurance_provider || null, insurance_number || null, allergies || null, chronic_conditions || null,
    ]
  );
  const [newPatient] = await pool.query('SELECT * FROM patients WHERE id = ?', [result.insertId]);
  res.status(201).json({ patient: withoutPortalPin(newPatient[0]), plain_pin: plainPin });
}));

router.post('/:id/portal-pin', authenticate, authorize('admin', 'receptionist'), asyncHandler(async (req, res) => {
  const id = parseInteger(req.params.id, 'id', { min: 1 });
  const [patient] = await pool.query('SELECT id FROM patients WHERE id = ? AND status = ?', [id, 'active']);
  if (patient.length === 0) throw new ApiError(404, 'Active patient not found');
  const plainPin = generatePortalPin();
  const hashedPin = await bcrypt.hash(plainPin, 12);
  await pool.query(
    `UPDATE patients
     SET portal_pin = ?, portal_session_version = portal_session_version + 1
     WHERE id = ?`,
    [hashedPin, id]
  );
  res.json({ message: 'Portal PIN reset successfully', plain_pin: plainPin });
}));

router.put('/:id', authenticate, authorize(...CLINICAL_ROLES), asyncHandler(async (req, res) => {
  const id = parseInteger(req.params.id, 'id', { min: 1 });
  const [existing] = await pool.query('SELECT id FROM patients WHERE id = ?', [id]);
  if (existing.length === 0) throw new ApiError(404, 'Patient not found');
  const updates = validatePatientUpdates(req.body, req.user.role);
  const fields = Object.keys(updates);
  const values = fields.map(field => updates[field]);
  values.push(id);
  await pool.query(`UPDATE patients SET ${fields.map(field => `${field} = ?`).join(', ')} WHERE id = ?`, values);
  const [updated] = await pool.query('SELECT * FROM patients WHERE id = ?', [id]);
  res.json(withoutPortalPin(updated[0]));
}));

router.delete('/:id', authenticate, authorize('admin', 'receptionist'), asyncHandler(async (req, res) => {
  const id = parseInteger(req.params.id, 'id', { min: 1 });
  const [result] = await pool.query("UPDATE patients SET status = 'inactive' WHERE id = ?", [id]);
  if (result.affectedRows === 0) throw new ApiError(404, 'Patient not found');
  res.json({ message: 'Patient deactivated' });
}));

router.get('/:id/history', authenticate, authorize(...CLINICAL_ROLES), asyncHandler(async (req, res) => {
  const id = parseInteger(req.params.id, 'id', { min: 1 });
  const [patient] = await pool.query('SELECT id FROM patients WHERE id = ?', [id]);
  if (patient.length === 0) throw new ApiError(404, 'Patient not found');

  const [appointments] = await pool.query(
    `SELECT a.*, u.first_name as doctor_first_name, u.last_name as doctor_last_name
     FROM appointments a JOIN users u ON a.doctor_id = u.id
     WHERE a.patient_id = ? ORDER BY a.appointment_date DESC`,
    [id]
  );
  const [records] = await pool.query(
    `SELECT mr.*, u.first_name as doctor_first_name, u.last_name as doctor_last_name
     FROM medical_records mr JOIN users u ON mr.doctor_id = u.id
     WHERE mr.patient_id = ? ORDER BY mr.record_date DESC`,
    [id]
  );
  const [prescriptions] = await pool.query(
    `SELECT p.*, u.first_name as doctor_first_name, u.last_name as doctor_last_name
     FROM prescriptions p JOIN users u ON p.doctor_id = u.id
     WHERE p.patient_id = ? ORDER BY p.prescribed_date DESC`,
    [id]
  );
  const [bills] = await pool.query(
    `SELECT id, uuid, bill_number, total_amount, discount, tax, net_amount, paid_amount,
            payment_status, due_date, created_at
     FROM bills WHERE patient_id = ? ORDER BY created_at DESC`,
    [id]
  );
  res.json({ appointments, medical_records: records, prescriptions, bills });
}));

module.exports = router;
