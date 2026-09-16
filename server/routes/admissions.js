const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const audit = require('../utils/audit');

function generateAdmissionNumber() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `ADM-${date}-${String(Math.floor(100 + Math.random() * 900))}`;
}

router.get('/', authenticate, async (req, res) => {
  try {
    const { search, status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    let query = `SELECT a.*, p.first_name as patient_first_name, p.last_name as patient_last_name,
      p.mrn, u.first_name as doctor_first_name, u.last_name as doctor_last_name
      FROM admissions a
      JOIN patients p ON a.patient_id = p.id
      JOIN users u ON a.doctor_id = u.id
      WHERE 1=1`;
    const params = [];
    if (search) {
      query += ' AND (p.first_name LIKE ? OR p.last_name LIKE ? OR p.mrn LIKE ? OR a.admission_number LIKE ? OR a.ward LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s, s);
    }
    if (status) { query += ' AND a.status = ?'; params.push(status); }
    const [countRes] = await pool.query(query.replace('SELECT a.*', 'SELECT COUNT(*) as total'), params);
    query += ' ORDER BY CASE a.status WHEN \'admitted\' THEN 0 ELSE 1 END, a.admission_date DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    const [rows] = await pool.query(query, params);
    res.json({ admissions: rows, total: countRes[0].total, page: parseInt(page), limit: parseInt(limit) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/stats', authenticate, async (req, res) => {
  try {
    const [total] = await pool.query('SELECT COUNT(*) as count FROM admissions');
    const [admitted] = await pool.query("SELECT COUNT(*) as count FROM admissions WHERE status = 'admitted'");
    const [transferred] = await pool.query("SELECT COUNT(*) as count FROM admissions WHERE status = 'transferred'");
    const [discharged] = await pool.query("SELECT COUNT(*) as count FROM admissions WHERE status = 'discharged'");
    const [occupied] = await pool.query("SELECT SUM(bed_number IS NOT NULL) as count FROM admissions WHERE status = 'admitted'");
    res.json({
      total: total[0].count,
      admitted: admitted[0].count,
      transferred: transferred[0].count,
      discharged: discharged[0].count,
      occupiedBeds: occupied[0].count
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT a.*, p.first_name as patient_first_name, p.last_name as patient_last_name,
        p.mrn, p.gender, p.date_of_birth, p.phone, p.insurance_provider,
        u.first_name as doctor_first_name, u.last_name as doctor_last_name
        FROM admissions a
        JOIN patients p ON a.patient_id = p.id
        JOIN users u ON a.doctor_id = u.id
        WHERE a.id = ?`, [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Admission not found' });
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/', authenticate, authorize('admin', 'doctor', 'receptionist', 'nurse'), async (req, res) => {
  try {
    const { patient_id, doctor_id, ward, bed_number, diagnosis, treatment_plan, notes } = req.body;
    if (!patient_id || !doctor_id) {
      return res.status(400).json({ message: 'Patient and doctor are required' });
    }
    const uuid = uuidv4();
    const admissionNumber = generateAdmissionNumber();
    const [result] = await pool.query(
      `INSERT INTO admissions (uuid, admission_number, patient_id, doctor_id, ward, bed_number, diagnosis, treatment_plan, notes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'admitted')`,
      [uuid, admissionNumber, patient_id, doctor_id, ward, bed_number, diagnosis, treatment_plan, notes]
    );
    const [newAdmission] = await pool.query('SELECT * FROM admissions WHERE id = ?', [result.insertId]);
    await audit.create(req.user.id, 'admissions', result.insertId, newAdmission[0], req.ip);
    res.status(201).json(newAdmission[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/:id', authenticate, authorize('admin', 'doctor', 'receptionist', 'nurse'), async (req, res) => {
  try {
    const [existing] = await pool.query('SELECT * FROM admissions WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ message: 'Admission not found' });
    const fields = ['patient_id', 'doctor_id', 'ward', 'bed_number', 'diagnosis', 'treatment_plan', 'notes'];
    const updates = [];
    const values = [];
    fields.forEach(f => {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); }
    });
    if (updates.length === 0) return res.status(400).json({ message: 'No fields to update' });
    values.push(req.params.id);
    await pool.query(`UPDATE admissions SET ${updates.join(', ')} WHERE id = ?`, values);
    const [updated] = await pool.query('SELECT * FROM admissions WHERE id = ?', [req.params.id]);
    await audit.update(req.user.id, 'admissions', req.params.id, existing[0], updated[0], req.ip);
    res.json(updated[0]);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/:id/discharge', authenticate, authorize('admin', 'doctor', 'nurse'), async (req, res) => {
  try {
    const [existing] = await pool.query('SELECT * FROM admissions WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ message: 'Admission not found' });
    await pool.query(
      "UPDATE admissions SET status = 'discharged', discharge_date = datetime('now') WHERE id = ?",
      [req.params.id]
    );
    const [updated] = await pool.query('SELECT * FROM admissions WHERE id = ?', [req.params.id]);
    await audit.custom(req.user.id, 'DISCHARGE', 'admissions', req.params.id, updated[0], req.ip);
    res.json(updated[0]);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/:id/transfer', authenticate, authorize('admin', 'doctor', 'nurse', 'receptionist'), async (req, res) => {
  try {
    const [existing] = await pool.query('SELECT * FROM admissions WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ message: 'Admission not found' });
    const { ward, bed_number } = req.body;
    await pool.query(
      "UPDATE admissions SET ward = COALESCE(?, ward), bed_number = COALESCE(?, bed_number), status = 'transferred' WHERE id = ?",
      [ward || null, bed_number || null, req.params.id]
    );
    const [updated] = await pool.query('SELECT * FROM admissions WHERE id = ?', [req.params.id]);
    await audit.custom(req.user.id, 'TRANSFER', 'admissions', req.params.id, updated[0], req.ip);
    res.json(updated[0]);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const [existing] = await pool.query('SELECT * FROM admissions WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ message: 'Admission not found' });
    await pool.query('DELETE FROM admissions WHERE id = ?', [req.params.id]);
    await audit.delete(req.user.id, 'admissions', req.params.id, existing[0], req.ip);
    res.json({ message: 'Admission deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;