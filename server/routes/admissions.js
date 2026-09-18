const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const audit = require('../utils/audit');
const { classifyTriage } = require('../utils/triage');

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
    const [bySeverity] = await pool.query(
      `SELECT triage_severity, COUNT(*) as count FROM admissions
       WHERE status IN ('admitted','transferred')
       GROUP BY triage_severity`
    );
    const [critical] = await pool.query(
      "SELECT COUNT(*) as count FROM admissions WHERE status IN ('admitted','transferred') AND triage_severity = 'critical'"
    );
    res.json({
      total: total[0].count,
      admitted: admitted[0].count,
      transferred: transferred[0].count,
      discharged: discharged[0].count,
      occupiedBeds: occupied[0].count,
      critical: critical[0].count,
      bySeverity
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Live triage queue - active (admitted/transferred) patients ranked by urgency.
// A simple priority score composes the clinical triage score with the time the
// patient has already spent waiting so older critical cases rise to the top.
router.get('/queue', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT a.id, a.admission_number, a.status, a.ward, a.bed_number, a.admission_date,
        a.chief_complaint, a.diagnosis, a.triage_severity, a.triage_score,
        p.id as patient_id, p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn,
        u.first_name as doctor_first_name, u.last_name as doctor_last_name
        FROM admissions a
        JOIN patients p ON a.patient_id = p.id
        JOIN users u ON a.doctor_id = u.id
        WHERE a.status IN ('admitted','transferred')
        ORDER BY CASE a.triage_severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'moderate' THEN 2 ELSE 3 END,
          a.triage_score DESC, a.admission_date ASC`
    );
    const now = Date.now();
    const queue = rows.map((row, index) => {
      const ageHours = (now - new Date(row.admission_date).getTime()) / 3600000;
      // Weighted priority: 70% clinical urgency, 30% time already waiting.
      const priority = Math.min(100, Math.round(row.triage_score * 0.7 + Math.min(ageHours, 48) * 0.625));
      return {
        ...row,
        queue_position: index + 1,
        wait_hours: Math.max(0, Math.round(ageHours * 10) / 10),
        priority
      };
    });
    res.json({ queue });
  } catch (error) {
    console.error(error);
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
    const { patient_id, doctor_id, ward, bed_number, diagnosis, treatment_plan, notes, chief_complaint, triage_severity, triage_score } = req.body;
    if (!patient_id || !doctor_id) {
      return res.status(400).json({ message: 'Patient and doctor are required' });
    }
    // Auto-classify severity when a manual value isn't supplied.
    const triage = classifyTriage(chief_complaint, diagnosis);
    const severity = triage_severity || triage.triageSeverity;
    const score = triage_score !== undefined ? triage_score : triage.triageScore;
    const uuid = uuidv4();
    const admissionNumber = generateAdmissionNumber();
    const [result] = await pool.query(
      `INSERT INTO admissions (uuid, admission_number, patient_id, doctor_id, ward, bed_number, diagnosis, treatment_plan, notes, status, chief_complaint, triage_severity, triage_score)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'admitted', ?, ?, ?)`,
      [uuid, admissionNumber, patient_id, doctor_id, ward, bed_number, diagnosis, treatment_plan, notes, chief_complaint, severity, score]
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
    const fields = ['patient_id', 'doctor_id', 'ward', 'bed_number', 'diagnosis', 'treatment_plan', 'notes', 'chief_complaint', 'triage_severity', 'triage_score'];
    const updates = [];
    const values = [];
    const body = { ...req.body };
    // Re-classify urgency when the clinical picture changed but no manual
    // severity was sent through.
    if (body.chief_complaint !== undefined && body.triage_severity === undefined && body.triage_score === undefined) {
      const triage = classifyTriage(body.chief_complaint, body.diagnosis || existing[0].diagnosis);
      updates.push('triage_severity = ?', 'triage_score = ?');
      values.push(triage.triageSeverity, triage.triageScore);
    }
    fields.forEach(f => {
      if (body[f] !== undefined) { updates.push(`${f} = ?`); values.push(body[f]); }
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