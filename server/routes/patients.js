const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

// Generate MRN
function generateMRN() {
  const prefix = 'MRN';
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${timestamp.slice(-4)}${random}`;
}

// Get all patients with search, filter, pagination
router.get('/', authenticate, async (req, res) => {
  try {
    const { search, status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    let query = 'SELECT * FROM patients WHERE 1=1';
    const params = [];
    if (search) {
      query += ' AND (first_name LIKE ? OR last_name LIKE ? OR mrn LIKE ? OR phone LIKE ? OR email LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s, s);
    }
    if (status) { query += ' AND status = ?'; params.push(status); }
    const [countRes] = await pool.query(query.replace('SELECT *', 'SELECT COUNT(*) as total'), params);
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    const [rows] = await pool.query(query, params);
    res.json({ patients: rows, total: countRes[0].total, page: parseInt(page), limit: parseInt(limit) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get patient by ID
router.get('/:id', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM patients WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Patient not found' });
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Create patient
router.post('/', authenticate, authorize('admin', 'receptionist', 'doctor', 'nurse'), async (req, res) => {
  try {
    const { first_name, last_name, date_of_birth, gender, blood_type, phone, email, address,
      emergency_contact_name, emergency_contact_phone, insurance_provider, insurance_number,
      allergies, chronic_conditions } = req.body;
    const uuid = uuidv4();
    const mrn = generateMRN();
    const [result] = await pool.query(
      `INSERT INTO patients (uuid, mrn, first_name, last_name, date_of_birth, gender, blood_type,
        phone, email, address, emergency_contact_name, emergency_contact_phone,
        insurance_provider, insurance_number, allergies, chronic_conditions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuid, mrn, first_name, last_name, date_of_birth, gender, blood_type, phone, email, address,
        emergency_contact_name, emergency_contact_phone, insurance_provider, insurance_number,
        allergies, chronic_conditions]
    );
    const [newPatient] = await pool.query('SELECT * FROM patients WHERE id = ?', [result.insertId]);
    res.status(201).json(newPatient[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update patient
router.put('/:id', authenticate, authorize('admin', 'receptionist', 'doctor', 'nurse'), async (req, res) => {
  try {
    const fields = ['first_name','last_name','date_of_birth','gender','blood_type','phone','email','address',
      'emergency_contact_name','emergency_contact_phone','insurance_provider','insurance_number',
      'allergies','chronic_conditions','status'];
    const updates = [];
    const values = [];
    fields.forEach(f => {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); }
    });
    if (updates.length === 0) return res.status(400).json({ message: 'No fields to update' });
    values.push(req.params.id);
    await pool.query(`UPDATE patients SET ${updates.join(', ')} WHERE id = ?`, values);
    const [updated] = await pool.query('SELECT * FROM patients WHERE id = ?', [req.params.id]);
    res.json(updated[0]);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete (deactivate) patient
router.delete('/:id', authenticate, authorize('admin', 'receptionist'), async (req, res) => {
  try {
    const [result] = await pool.query('UPDATE patients SET status = ? WHERE id = ?', ['inactive', req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'Patient not found' });
    res.json({ message: 'Patient deactivated' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Get patient medical history
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
