const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { evaluateSafety } = require('../utils/safety');
const { ApiError, asyncHandler, parseInteger, withTransaction } = require('../utils/http');
const { randomUUID, generateRecordNumber } = require('../utils/ids');
const { recordAudit } = require('../utils/audit');
const { readPatientData, readPatientDataInBulk, writePatientData } = require('../middleware/rateLimit');

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

router.get('/patient/:patientId', authenticate, authorize(...EMR_ROLES), readPatientDataInBulk, asyncHandler(async (req, res) => {
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

router.get('/prescriptions/:medicalRecordId', authenticate, authorize(...EMR_ROLES), readPatientData, asyncHandler(async (req, res) => {
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

router.post('/prescriptions', authenticate, authorize('doctor', 'admin'), writePatientData, asyncHandler(async (req, res) => {
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

  const outcome = await withTransaction(pool, async connection => {
    const safety = await evaluateSafety(patientId, medicineIds, connection);
    if (safety.blocking && acknowledge_warnings !== true) {
      return {
        status: 409,
        body: {
          message: 'Safety alert: this prescription conflicts with a recorded allergy or a contraindicated interaction.',
          warnings: safety.warnings,
          requires_acknowledgement: true,
        },
      };
    }

    const uuid = randomUUID();
    const prescriptionNumber = generateRecordNumber('RX');
    const [result] = await connection.query(
      `INSERT INTO prescriptions
       (uuid, prescription_number, medical_record_id, patient_id, doctor_id, notes)
       VALUES (?,?,?,?,?,?)`,
      [uuid, prescriptionNumber, recordId, patientId, records[0].doctor_id, notes || null]
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
    return { status: 201, prescription: created[0], safety };
  });

  if (outcome.status === 409) return res.status(409).json(outcome.body);
  res.status(201).json({
    ...outcome.prescription,
    warnings: outcome.safety.warnings,
    acknowledged: acknowledge_warnings === true,
  });
}));

router.get('/:id', authenticate, authorize(...EMR_ROLES), readPatientData, asyncHandler(async (req, res) => {
  const id = parseInteger(req.params.id, 'id', { min: 1 });
  const [rows] = await pool.query(
    `SELECT mr.*, u.first_name as doctor_first_name, u.last_name as doctor_last_name,
            s.name as specialty_name,
            p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn,
            p.allergies as patient_allergies
     FROM medical_records mr
     JOIN users u ON mr.doctor_id = u.id
     JOIN patients p ON mr.patient_id = p.id
     LEFT JOIN doctor_profiles dp ON dp.user_id = u.id
     LEFT JOIN specialties s ON s.id = dp.specialty_id
     WHERE mr.id = ?`,
    [id]
  );
  if (rows.length === 0) throw new ApiError(404, 'Record not found');
  if (req.user.role === 'doctor' && rows[0].doctor_id !== req.user.id) {
    throw new ApiError(403, 'You may only view your own medical records.');
  }

  // A clinical note is the most sensitive record in the system, so opening one
  // is logged. The patient's identity is recorded; the note's contents are not,
  // so the access log never becomes a second copy of the clinical data.
  await recordAudit({
    req,
    action: 'emr.record.viewed',
    table: 'medical_records',
    recordId: id,
    summary: `${req.user.role} opened the medical record for ${rows[0].mrn}`,
  });

  const [prescriptionRows] = await pool.query(
    `SELECT pr.*
     FROM prescriptions pr
     WHERE pr.medical_record_id = ?
     ORDER BY pr.created_at DESC, pr.id DESC`,
    [id]
  );
  const [prescriptionItemRows] = await pool.query(
    `SELECT pi.id, pi.prescription_id, pi.medicine_id,
            m.name as medicine_name, m.generic_name as medicine_generic_name,
            pi.dosage, pi.frequency, pi.duration, pi.instructions, pi.quantity,
            pi.dispensed_quantity, pi.dispensed, pi.dispensed_date
     FROM prescription_items pi
     JOIN prescriptions pr ON pr.id = pi.prescription_id
     JOIN medicines m ON m.id = pi.medicine_id
     WHERE pr.medical_record_id = ?
     ORDER BY pi.id`,
    [id]
  );
  const prescriptionItems = new Map(prescriptionRows.map(prescription => [prescription.id, []]));
  for (const item of prescriptionItemRows) {
    if (!prescriptionItems.has(item.prescription_id)) continue;
    prescriptionItems.get(item.prescription_id).push(item);
  }
  const prescriptions = prescriptionRows.map(prescription => {
    const items = prescriptionItems.get(prescription.id) || [];
    const medicationSummary = items.map(item => [
      item.medicine_name,
      item.dosage,
      item.frequency,
      item.duration ? `for ${item.duration}` : null,
      `x${item.quantity}`,
    ].filter(Boolean).join(' ')).join('; ');
    return { ...prescription, medication_summary: medicationSummary || null, items };
  });

  const [labOrderRows] = await pool.query(
    `SELECT lo.*, GROUP_CONCAT(lt.name, ', ') AS test_names
     FROM lab_orders lo
     LEFT JOIN lab_order_items loi ON lo.id = loi.lab_order_id
     LEFT JOIN lab_tests lt ON loi.lab_test_id = lt.id
     WHERE lo.medical_record_id = ?
     GROUP BY lo.id
     ORDER BY lo.created_at DESC, lo.id DESC`,
    [id]
  );
  const [labTestRows] = await pool.query(
    `SELECT lt.id, loi.id as order_item_id, loi.lab_order_id, loi.lab_test_id,
            lt.name, lt.category, lo.status,
            loi.result_value, loi.result_value as result, loi.result_unit,
            loi.reference_range, loi.is_abnormal, loi.result_date, loi.notes
     FROM lab_orders lo
     JOIN lab_order_items loi ON loi.lab_order_id = lo.id
     JOIN lab_tests lt ON lt.id = loi.lab_test_id
     WHERE lo.medical_record_id = ?
     ORDER BY loi.id`,
    [id]
  );
  const labTests = new Map(labOrderRows.map(order => [order.id, []]));
  for (const test of labTestRows) {
    if (!labTests.has(test.lab_order_id)) continue;
    labTests.get(test.lab_order_id).push(test);
  }
  const labOrders = labOrderRows.map(order => ({
    ...order,
    tests: labTests.get(order.id) || [],
  }));

  res.json({ ...rows[0], prescriptions, lab_orders: labOrders });
}));

router.post('/', authenticate, authorize('doctor', 'admin'), writePatientData, asyncHandler(async (req, res) => {
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
    const [treatingDoctors] = await pool.query(
      "SELECT id FROM users WHERE id = ? AND role = 'doctor' AND is_active = 1",
      [appointment.doctor_id]
    );
    if (treatingDoctors.length === 0) {
      throw new ApiError(409, 'The assigned treating doctor is missing or inactive.');
    }
  }
  const serializedVitals = serializeVitalSigns(vital_signs);
  const recordDoctorId = appointment ? Number(appointment.doctor_id) : Number(req.user.id);

  const record = await withTransaction(pool, async connection => {
    const uuid = randomUUID();
    const [result] = await connection.query(
      `INSERT INTO medical_records
       (uuid, patient_id, doctor_id, appointment_id, chief_complaint, history_of_present_illness,
        vital_signs, physical_examination, diagnosis, treatment_plan, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        uuid, patientId, recordDoctorId, appointment?.id || null, chief_complaint || null,
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

router.put('/:id', authenticate, authorize('doctor', 'admin'), writePatientData, asyncHandler(async (req, res) => {
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
