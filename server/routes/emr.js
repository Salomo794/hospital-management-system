const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { evaluateSafety } = require('../utils/safety');
const { ApiError, asyncHandler, parseInteger, withTransaction } = require('../utils/http');
const { randomUUID, generateRecordNumber } = require('../utils/ids');

const EMR_ROLES = ['admin', 'doctor', 'nurse'];
const RECORD_STATUSES = ['draft', 'final', 'amended'];

function serializeVitalSigns(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('not an object');
      }
      return value;
    } catch (_) {
      throw new ApiError(400, 'vital_signs must be a JSON object');
    }
  }
  if (typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'vital_signs must be a JSON object');
  return JSON.stringify(value);
}

function canModifyRecord(req, record) {
  return req.user.role === 'admin' || record.doctor_id === req.user.id;
}

router.get('/patient/:patientId', authenticate, authorize(...EMR_ROLES), asyncHandler(async (req, res) => {
  const patientId = parseInteger(req.params.patientId, 'patientId', { min: 1 });
  const [rows] = await pool.query(
    `SELECT mr.*, u.first_name as doctor_first_name, u.last_name as doctor_last_name, s.name as specialty_name
     FROM medical_records mr JOIN users u ON mr.doctor_id = u.id
     LEFT JOIN doctor_profiles dp ON u.id = dp.user_id
     LEFT JOIN specialties s ON dp.specialty_id = s.id
     WHERE mr.patient_id = ? ORDER BY mr.record_date DESC`,
    [patientId]
  );
  const visibleRows = req.user.role === 'doctor'
    ? rows.filter(record => record.doctor_id === req.user.id)
    : rows;
  res.json(visibleRows);
}));

router.get('/prescriptions/:medicalRecordId', authenticate, authorize(...EMR_ROLES), asyncHandler(async (req, res) => {
  const recordId = parseInteger(req.params.medicalRecordId, 'medicalRecordId', { min: 1 });
  const [recordRows] = await pool.query('SELECT id, doctor_id FROM medical_records WHERE id = ?', [recordId]);
  if (recordRows.length === 0) throw new ApiError(404, 'Medical record not found');
  if (req.user.role === 'doctor' && recordRows[0].doctor_id !== req.user.id) {
    throw new ApiError(403, 'You may only view prescriptions for your own medical records.');
  }
  const [rows] = await pool.query(
    `SELECT p.*, u.first_name as doctor_first_name, u.last_name as doctor_last_name,
            GROUP_CONCAT(m.name || ' - ' || pi.dosage || ' ' || pi.frequency || ' for ' || pi.duration || ' x' || pi.quantity, '\n') AS items
     FROM prescriptions p JOIN users u ON p.doctor_id = u.id
     LEFT JOIN prescription_items pi ON p.id = pi.prescription_id
     LEFT JOIN medicines m ON pi.medicine_id = m.id
     WHERE p.medical_record_id = ? GROUP BY p.id`,
    [recordId]
  );
  res.json(rows);
}));

router.post('/prescriptions', authenticate, authorize('doctor', 'admin'), asyncHandler(async (req, res) => {
  const { medical_record_id, patient_id, items, notes, acknowledge_warnings } = req.body;
  const recordId = parseInteger(medical_record_id, 'medical_record_id', { min: 1 });
  const patientId = parseInteger(patient_id, 'patient_id', { min: 1 });
  if (!Array.isArray(items) || items.length === 0) throw new ApiError(400, 'At least one medication is required');

  const normalizedItems = items.map((item, index) => {
    if (!item || typeof item !== 'object') throw new ApiError(400, `Medication ${index + 1} is invalid`);
    const medicineId = parseInteger(item.medicine_id, `medication ${index + 1} medicine_id`, { min: 1 });
    const dosage = typeof item.dosage === 'string' ? item.dosage.trim() : '';
    const frequency = typeof item.frequency === 'string' ? item.frequency.trim() : '';
    const quantity = parseInteger(item.quantity, `medication ${index + 1} quantity`, { min: 1 });
    if (!dosage || !frequency) throw new ApiError(400, `Medication ${index + 1} requires dosage and frequency`);
    return {
      medicineId,
      dosage,
      frequency,
      duration: item.duration || null,
      quantity,
      instructions: item.instructions || null,
    };
  });

  const [records] = await pool.query('SELECT * FROM medical_records WHERE id = ?', [recordId]);
  if (records.length === 0) throw new ApiError(404, 'Medical record not found');
  if (records[0].patient_id !== patientId) throw new ApiError(400, 'Medical record does not belong to the selected patient');
  if (!canModifyRecord(req, records[0])) throw new ApiError(403, 'You may only prescribe for your own medical record');
  const medicineIds = [...new Set(normalizedItems.map(item => item.medicineId))];
  const placeholders = medicineIds.map(() => '?').join(',');
  const [medicines] = await pool.query(
    `SELECT id FROM medicines WHERE id IN (${placeholders}) AND is_active = 1`,
    medicineIds
  );
  if (medicines.length !== medicineIds.length) throw new ApiError(400, 'One or more medicines do not exist or are inactive');

  const safety = await evaluateSafety(patientId, medicineIds);
  if (safety.blocking && acknowledge_warnings !== true) {
    return res.status(409).json({
      message: 'Safety alert: this prescription conflicts with a recorded allergy or a contraindicated interaction.',
      warnings: safety.warnings,
      requires_acknowledgement: true,
    });
  }

  const prescription = await withTransaction(pool, async connection => {
    const uuid = randomUUID();
    const prescriptionNumber = generateRecordNumber('RX');
    const [result] = await connection.query(
      `INSERT INTO prescriptions
       (uuid, prescription_number, medical_record_id, patient_id, doctor_id, notes)
       VALUES (?,?,?,?,?,?)`,
      [uuid, prescriptionNumber, recordId, patientId, req.user.id, notes || null]
    );
    for (const item of normalizedItems) {
      await connection.query(
        `INSERT INTO prescription_items
         (prescription_id, medicine_id, dosage, frequency, duration, quantity, instructions)
         VALUES (?,?,?,?,?,?,?)`,
        [result.insertId, item.medicineId, item.dosage, item.frequency, item.duration, item.quantity, item.instructions]
      );
    }
    const [created] = await connection.query('SELECT * FROM prescriptions WHERE id = ?', [result.insertId]);
    return created[0];
  });
  res.status(201).json({ ...prescription, warnings: safety.warnings, acknowledged: acknowledge_warnings === true });
}));

router.get('/:id', authenticate, authorize(...EMR_ROLES), asyncHandler(async (req, res) => {
  const id = parseInteger(req.params.id, 'id', { min: 1 });
  const [rows] = await pool.query(
    `SELECT mr.*, u.first_name as doctor_first_name, u.last_name as doctor_last_name,
            p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn,
            p.allergies as patient_allergies
     FROM medical_records mr JOIN users u ON mr.doctor_id = u.id JOIN patients p ON mr.patient_id = p.id
     WHERE mr.id = ?`,
    [id]
  );
  if (rows.length === 0) throw new ApiError(404, 'Record not found');
  if (req.user.role === 'doctor' && rows[0].doctor_id !== req.user.id) {
    throw new ApiError(403, 'You may only view your own medical records.');
  }
  const [prescriptions] = await pool.query(
    `SELECT pr.*, GROUP_CONCAT(pi.dosage || ' ' || pi.frequency || ' for ' || pi.duration, '; ') AS medication_summary
     FROM prescriptions pr LEFT JOIN prescription_items pi ON pr.id = pi.prescription_id
     WHERE pr.medical_record_id = ? GROUP BY pr.id`,
    [id]
  );
  const [labOrders] = await pool.query(
    `SELECT lo.*, GROUP_CONCAT(lt.name, ', ') AS test_names
     FROM lab_orders lo LEFT JOIN lab_order_items loi ON lo.id = loi.lab_order_id
     LEFT JOIN lab_tests lt ON loi.lab_test_id = lt.id
     WHERE lo.medical_record_id = ? GROUP BY lo.id`,
    [id]
  );
  res.json({ ...rows[0], prescriptions, lab_orders: labOrders });
}));

router.post('/', authenticate, authorize('doctor', 'admin'), asyncHandler(async (req, res) => {
  const {
    patient_id, appointment_id, chief_complaint, history_of_present_illness,
    vital_signs, physical_examination, diagnosis, treatment_plan, notes,
  } = req.body;
  const patientId = parseInteger(patient_id, 'patient_id', { min: 1 });
  const [patients] = await pool.query('SELECT id FROM patients WHERE id = ? AND status = ?', [patientId, 'active']);
  if (patients.length === 0) throw new ApiError(400, 'Patient not found or inactive');

  let appointment = null;
  if (appointment_id !== undefined && appointment_id !== null && appointment_id !== '') {
    const appointmentId = parseInteger(appointment_id, 'appointment_id', { min: 1 });
    const [rows] = await pool.query('SELECT * FROM appointments WHERE id = ?', [appointmentId]);
    if (rows.length === 0) throw new ApiError(400, 'Appointment not found');
    appointment = rows[0];
    if (appointment.patient_id !== patientId) throw new ApiError(400, 'Appointment does not belong to the selected patient');
    if (req.user.role === 'doctor' && appointment.doctor_id !== req.user.id) {
      throw new ApiError(403, 'You may only complete your own appointments.');
    }
  }
  const serializedVitals = serializeVitalSigns(vital_signs);

  const record = await withTransaction(pool, async connection => {
    const uuid = randomUUID();
    const [result] = await connection.query(
      `INSERT INTO medical_records
       (uuid, patient_id, doctor_id, appointment_id, chief_complaint, history_of_present_illness,
        vital_signs, physical_examination, diagnosis, treatment_plan, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        uuid, patientId, req.user.id, appointment?.id || null, chief_complaint || null,
        history_of_present_illness || null, serializedVitals, physical_examination || null,
        diagnosis || null, treatment_plan || null, notes || null,
      ]
    );
    if (appointment) {
      const [updated] = await connection.query(
        "UPDATE appointments SET status = 'completed' WHERE id = ? AND status IN ('scheduled','in_progress')",
        [appointment.id]
      );
      if (updated.affectedRows !== 1) throw new ApiError(409, 'Appointment is no longer eligible for completion');
    }
    const [created] = await connection.query('SELECT * FROM medical_records WHERE id = ?', [result.insertId]);
    return created[0];
  });
  res.status(201).json(record);
}));

router.put('/:id', authenticate, authorize('doctor', 'admin'), asyncHandler(async (req, res) => {
  const id = parseInteger(req.params.id, 'id', { min: 1 });
  const [existingRows] = await pool.query('SELECT * FROM medical_records WHERE id = ?', [id]);
  if (existingRows.length === 0) throw new ApiError(404, 'Record not found');
  if (!canModifyRecord(req, existingRows[0])) throw new ApiError(403, 'You may only update your own medical records');

  const fields = [
    'chief_complaint', 'history_of_present_illness', 'vital_signs',
    'physical_examination', 'diagnosis', 'treatment_plan', 'notes', 'status',
  ];
  const updates = [];
  const values = [];
  for (const field of fields) {
    if (req.body[field] === undefined) continue;
    if (field === 'status' && !RECORD_STATUSES.includes(req.body[field])) {
      throw new ApiError(400, 'Invalid medical record status');
    }
    updates.push(`${field} = ?`);
    values.push(field === 'vital_signs' ? serializeVitalSigns(req.body[field]) : req.body[field]);
  }
  if (updates.length === 0) throw new ApiError(400, 'Nothing to update');
  values.push(id);
  const [result] = await pool.query(`UPDATE medical_records SET ${updates.join(', ')} WHERE id = ?`, values);
  if (result.affectedRows !== 1) throw new ApiError(404, 'Record not found');
  const [updated] = await pool.query('SELECT * FROM medical_records WHERE id = ?', [id]);
  res.json(updated[0]);
}));

module.exports = router;
