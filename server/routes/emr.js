const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { validateEMR, validatePrescription } = require('../middleware/validation');
const audit = require('../utils/audit');

// Get medical records for a patient
router.get('/patient/:patientId', authenticate, async (req, res) => {
  try {
    // Role-based access: doctors/nurses can view; receptionist/pharmacist restrictions are business rules left open
    const [rows] = await pool.query(
      `SELECT mr.*, u.first_name as doctor_first_name, u.last_name as doctor_last_name, s.name as specialty_name
       FROM medical_records mr
       JOIN users u ON mr.doctor_id = u.id
       LEFT JOIN doctor_profiles dp ON u.id = dp.user_id
       LEFT JOIN specialties s ON dp.specialty_id = s.id
       WHERE mr.patient_id = ? ORDER BY mr.record_date DESC`,
      [req.params.patientId]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ============ PRESCRIPTIONS ============
router.get('/prescriptions/:medicalRecordId', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.*, u.first_name as doctor_first_name, u.last_name as doctor_last_name,
        GROUP_CONCAT(m.name || ' - ' || pi.dosage || ' ' || pi.frequency || ' for ' || pi.duration || ' x' || pi.quantity, '\n') as items
       FROM prescriptions p
       JOIN users u ON p.doctor_id = u.id
       LEFT JOIN prescription_items pi ON p.id = pi.prescription_id
       LEFT JOIN medicines m ON pi.medicine_id = m.id
       WHERE p.medical_record_id = ? GROUP BY p.id`,
      [req.params.medicalRecordId]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Create prescription (atomic - prescription + items)
router.post('/prescriptions', authenticate, authorize('doctor', 'admin'), validatePrescription, async (req, res) => {
  let conn;
  try {
    const { medical_record_id, patient_id, items, notes } = req.body;
    const uuid = uuidv4();
    const prescription_number = `RX-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)}`;

    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [result] = await conn.query(
      'INSERT INTO prescriptions (uuid, prescription_number, medical_record_id, patient_id, doctor_id, notes) VALUES (?,?,?,?,?,?)',
      [uuid, prescription_number, medical_record_id, patient_id, req.user.id, notes]
    );
    for (const item of items) {
      await conn.query(
        'INSERT INTO prescription_items (prescription_id, medicine_id, dosage, frequency, duration, quantity, instructions) VALUES (?,?,?,?,?,?,?)',
        [result.insertId, item.medicine_id, item.dosage, item.frequency, item.duration, item.quantity, item.instructions]
      );
    }
    await conn.commit();
    conn.release();
    conn = null;

    await audit.create(req.user.id, 'prescriptions', result.insertId, { prescription_number, patient_id }, req.ip);
    const [newRx] = await pool.query('SELECT * FROM prescriptions WHERE id = ?', [result.insertId]);
    res.status(201).json(newRx[0]);
  } catch (error) {
    if (conn) {
      try { await conn.rollback(); conn = null; } catch (e) { /* ignore */ }
    }
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get single medical record with prescriptions
router.get('/:id', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT mr.*, u.first_name as doctor_first_name, u.last_name as doctor_last_name,
        p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn
        FROM medical_records mr
        JOIN users u ON mr.doctor_id = u.id
        JOIN patients p ON mr.patient_id = p.id
        WHERE mr.id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Record not found' });
    const [prescriptions] = await pool.query(
      `SELECT pr.*, GROUP_CONCAT(pi.dosage || ' ' || pi.frequency || ' for ' || pi.duration, '; ') as medication_summary
       FROM prescriptions pr
       LEFT JOIN prescription_items pi ON pr.id = pi.prescription_id
       WHERE pr.medical_record_id = ? GROUP BY pr.id`, [req.params.id]
    );
    for (const pr of prescriptions) {
      const [items] = await pool.query(
        `SELECT pi.id, pi.dosage, pi.frequency, pi.duration, pi.quantity, pi.instructions,
          m.name as medicine_name
         FROM prescription_items pi
         LEFT JOIN medicines m ON pi.medicine_id = m.id
         WHERE pi.prescription_id = ? ORDER BY pi.id`, [pr.id]
      );
      pr.items = items;
    }
    const [labOrders] = await pool.query(
      `SELECT lo.*, GROUP_CONCAT(lt.name, ', ') as test_names
       FROM lab_orders lo
       LEFT JOIN lab_order_items loi ON lo.id = loi.lab_order_id
       LEFT JOIN lab_tests lt ON loi.lab_test_id = lt.id
       WHERE lo.medical_record_id = ? GROUP BY lo.id`, [req.params.id]
    );
    for (const lo of labOrders) {
      const [tests] = await pool.query(
        `SELECT lt.id, lt.name, lt.category, loi.result_value, loi.result_unit,
          loi.reference_range, loi.is_abnormal
         FROM lab_order_items loi
         JOIN lab_tests lt ON loi.lab_test_id = lt.id
         WHERE loi.lab_order_id = ? ORDER BY loi.id`, [lo.id]
      );
      lo.tests = tests;
    }
    res.json({ ...rows[0], prescriptions, lab_orders: labOrders });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Create medical record
router.post('/', authenticate, authorize('doctor', 'admin'), validateEMR, async (req, res) => {
  try {
    const { patient_id, appointment_id, chief_complaint, history_of_present_illness,
      vital_signs, physical_examination, diagnosis, treatment_plan, notes } = req.body;
    const uuid = uuidv4();
    const [result] = await pool.query(
      `INSERT INTO medical_records (uuid, patient_id, doctor_id, appointment_id, chief_complaint,
        history_of_present_illness, vital_signs, physical_examination, diagnosis, treatment_plan, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuid, patient_id, req.user.id, appointment_id || null, chief_complaint,
        history_of_present_illness, JSON.stringify(vital_signs), physical_examination,
        diagnosis, treatment_plan, notes]
    );
    if (appointment_id) {
      await pool.query("UPDATE appointments SET status = 'completed' WHERE id = ?", [appointment_id]);
    }
    await audit.create(req.user.id, 'medical_records', result.insertId, { patient_id, chief_complaint }, req.ip);
    const [newRecord] = await pool.query('SELECT * FROM medical_records WHERE id = ?', [result.insertId]);
    res.status(201).json(newRecord[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update medical record
router.put('/:id', authenticate, authorize('doctor', 'admin'), async (req, res) => {
  try {
    const fields = ['chief_complaint','history_of_present_illness','vital_signs','physical_examination','diagnosis','treatment_plan','notes','status'];
    const updates = [];
    const values = [];
    fields.forEach(f => {
      let val = req.body[f];
      if (val !== undefined) {
        if (f === 'vital_signs') val = JSON.stringify(val);
        updates.push(`${f} = ?`);
        values.push(val);
      }
    });
    if (updates.length === 0) return res.status(400).json({ message: 'Nothing to update' });
    const [old] = await pool.query('SELECT * FROM medical_records WHERE id = ?', [req.params.id]);
    if (old.length === 0) return res.status(404).json({ message: 'Record not found' });
    // Doctors can only edit their own records
    if (req.user.role === 'doctor' && old[0].doctor_id !== req.user.id) {
      return res.status(403).json({ message: 'You can only edit your own medical records' });
    }
    values.push(req.params.id);
    await pool.query(`UPDATE medical_records SET ${updates.join(', ')} WHERE id = ?`, values);
    await audit.update(req.user.id, 'medical_records', req.params.id, old[0], req.body, req.ip);
    const [updated] = await pool.query('SELECT * FROM medical_records WHERE id = ?', [req.params.id]);
    res.json(updated[0]);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;