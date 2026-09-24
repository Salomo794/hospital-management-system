const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { WARDS, wardCapacity, wardCapacityOrDefault } = require('../config/wards');
const { ApiError, asyncHandler, getPagination, parseInteger, withTransaction } = require('../utils/http');
const { randomUUID, randomToken } = require('../utils/ids');

const ADMISSION_ROLES = ['admin', 'doctor', 'nurse', 'receptionist'];
const TRIAGE_LEVELS = ['low', 'moderate', 'high', 'critical'];
const ADMISSION_STATUSES = ['admitted', 'discharged'];

const pad = number => String(number).padStart(2, '0');

function parseBedNumber(value, total) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const text = String(value).trim();
  if (!/^\d{1,2}$/.test(text)) return undefined;
  const number = Number(text);
  if (!Number.isInteger(number) || number < 1 || number > total) return undefined;
  return pad(number);
}

async function findFreeBed(connection, ward) {
  const total = wardCapacityOrDefault(ward);
  const [rows] = await connection.query(
    "SELECT bed_number FROM admissions WHERE ward = ? AND status = 'admitted' ORDER BY bed_number",
    [ward]
  );
  const used = new Set(rows.map(row => row.bed_number));
  for (let index = 1; index <= total; index += 1) {
    const bed = pad(index);
    if (!used.has(bed)) return bed;
  }
  return null;
}

router.get('/', authenticate, authorize(...ADMISSION_ROLES), asyncHandler(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query, 50);
  const { status, ward, search } = req.query;
  if (status && !ADMISSION_STATUSES.includes(status)) throw new ApiError(400, 'Invalid admission status');
  if (ward && WARDS[ward] === undefined) throw new ApiError(400, 'Invalid ward');

  let where = 'WHERE 1=1';
  const params = [];
  if (status) { where += ' AND a.status = ?'; params.push(status); }
  if (ward) { where += ' AND a.ward = ?'; params.push(ward); }
  if (search) {
    where += ' AND (p.first_name LIKE ? OR p.last_name LIKE ? OR p.mrn LIKE ? OR a.admission_number LIKE ? OR a.bed_number LIKE ?)';
    const term = `%${String(search).trim().slice(0, 100)}%`;
    params.push(term, term, term, term, term);
  }

  const [countRows] = await pool.query(
    `SELECT COUNT(*) as total FROM admissions a
     JOIN patients p ON a.patient_id = p.id JOIN users u ON a.doctor_id = u.id ${where}`,
    params
  );
  const [rows] = await pool.query(
    `SELECT a.*, p.first_name as patient_first_name, p.last_name as patient_last_name,
            p.mrn, u.first_name as doctor_first_name, u.last_name as doctor_last_name
     FROM admissions a JOIN patients p ON a.patient_id = p.id JOIN users u ON a.doctor_id = u.id
     ${where} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ admissions: rows, total: countRows[0].total, page, limit });
}));

router.get('/wards', authenticate, authorize(...ADMISSION_ROLES), asyncHandler(async (req, res) => {
  const [admitted] = await pool.query(
    "SELECT ward, bed_number, patient_id, diagnosis FROM admissions WHERE status = 'admitted'"
  );
  const occupiedByWard = {};
  admitted.forEach(admission => {
    if (!occupiedByWard[admission.ward]) occupiedByWard[admission.ward] = [];
    occupiedByWard[admission.ward].push(admission);
  });
  const wardTotals = {};
  [...Object.keys(WARDS), ...Object.keys(occupiedByWard)].forEach(ward => {
    wardTotals[ward] = wardCapacityOrDefault(ward);
  });

  const wards = Object.entries(wardTotals).map(([ward, total]) => {
    const occupied = occupiedByWard[ward] || [];
    const beds = [];
    for (let index = 1; index <= Math.min(total, 40); index += 1) {
      const bed = pad(index);
      const admission = occupied.find(item => item.bed_number === bed);
      beds.push(admission
        ? { bed, status: 'occupied', admissionId: admission.id, patientId: admission.patient_id, diagnosis: admission.diagnosis }
        : { bed, status: 'available' });
    }
    return {
      ward,
      total,
      occupied: occupied.length,
      available: total - occupied.length,
      percentage: total ? Math.round((occupied.length / total) * 100) : 0,
      beds,
    };
  });

  const totalBeds = wards.reduce((sum, ward) => sum + ward.total, 0);
  const totalOccupied = wards.reduce((sum, ward) => sum + ward.occupied, 0);
  res.json({
    wards,
    totals: {
      totalBeds,
      totalOccupied,
      totalAvailable: totalBeds - totalOccupied,
      percentage: totalBeds ? Math.round((totalOccupied / totalBeds) * 100) : 0,
    },
  });
}));

router.post('/', authenticate, authorize(...ADMISSION_ROLES), asyncHandler(async (req, res) => {
  const {
    patient_id, doctor_id, ward, bed_number, diagnosis, treatment_plan,
    chief_complaint, triage_severity, notes,
  } = req.body;
  const patientId = parseInteger(patient_id, 'patient_id', { min: 1 });
  const doctorId = parseInteger(doctor_id, 'doctor_id', { min: 1 });
  if (!ward || WARDS[ward] === undefined) {
    throw new ApiError(400, `Unknown ward "${ward}". Valid wards: ${Object.keys(WARDS).join(', ')}`);
  }
  if (triage_severity && !TRIAGE_LEVELS.includes(triage_severity)) throw new ApiError(400, 'Invalid triage severity');

  const [[patient], [doctor]] = await Promise.all([
    pool.query('SELECT id FROM patients WHERE id = ? AND status = ?', [patientId, 'active']),
    pool.query("SELECT id FROM users WHERE id = ? AND role = 'doctor' AND is_active = 1", [doctorId]),
  ]);
  if (patient.length === 0) throw new ApiError(400, 'Patient not found or inactive');
  if (doctor.length === 0) throw new ApiError(400, 'Doctor not found or inactive');

  const created = await withTransaction(pool, async connection => {
    const capacity = wardCapacity(ward);
    const requestedBed = parseBedNumber(bed_number, capacity);
    if (requestedBed === undefined) throw new ApiError(400, `Bed must be a number from 01 to ${pad(capacity)}.`);

    const [occupiedRows] = await connection.query(
      "SELECT bed_number FROM admissions WHERE ward = ? AND status = 'admitted'",
      [ward]
    );
    if (occupiedRows.length >= capacity) throw new ApiError(409, `${ward} ward is full (${capacity}/${capacity} beds).`);
    if (requestedBed) {
      const [occupied] = await connection.query(
        "SELECT id FROM admissions WHERE ward = ? AND bed_number = ? AND status = 'admitted'",
        [ward, requestedBed]
      );
      if (occupied.length > 0) throw new ApiError(409, `Bed ${requestedBed} in ${ward} is already occupied.`);
    }
    const freeBed = requestedBed || await findFreeBed(connection, ward);
    if (!freeBed) throw new ApiError(409, `${ward} ward is full.`);

    const [result] = await connection.query(
      `INSERT INTO admissions
       (uuid, admission_number, patient_id, doctor_id, ward, bed_number, diagnosis,
        treatment_plan, chief_complaint, triage_severity, status, notes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admitted', ?, datetime('now'))`,
      [
        randomUUID(), `ADM-${Date.now().toString(36).toUpperCase()}-${randomToken(5)}`,
        patientId, doctorId, ward, freeBed, diagnosis || null, treatment_plan || null,
        chief_complaint || null, triage_severity || null, notes || null,
      ]
    );
    const [nurses] = await connection.query("SELECT id FROM users WHERE role = 'nurse' AND is_active = 1");
    const [patientDetails] = await connection.query('SELECT first_name, last_name FROM patients WHERE id = ?', [patientId]);
    const [doctorDetails] = await connection.query('SELECT first_name, last_name FROM users WHERE id = ?', [doctorId]);
    for (const nurse of nurses) {
      await connection.query(
        `INSERT INTO notifications (user_id, type, title, message, link)
         VALUES (?, 'admission', 'New admission', ?, '/ward')`,
        [nurse.id, `${patientDetails[0].first_name} ${patientDetails[0].last_name} admitted to ${ward} (Bed ${freeBed}) under Dr. ${doctorDetails[0].first_name} ${doctorDetails[0].last_name}.`]
      );
    }
    const [admission] = await connection.query(
      `SELECT a.*, p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn
       FROM admissions a JOIN patients p ON a.patient_id = p.id WHERE a.id = ?`,
      [result.insertId]
    );
    return admission[0];
  });
  res.status(201).json(created);
}));

router.put('/:id', authenticate, authorize(...ADMISSION_ROLES), asyncHandler(async (req, res) => {
  const id = parseInteger(req.params.id, 'id', { min: 1 });
  const updated = await withTransaction(pool, async connection => {
    const [existingRows] = await connection.query('SELECT * FROM admissions WHERE id = ?', [id]);
    if (existingRows.length === 0) throw new ApiError(404, 'Admission not found');
    const admission = existingRows[0];
    if (req.user.role === 'doctor' && admission.doctor_id !== req.user.id) {
      throw new ApiError(403, 'You may only update admissions assigned to you.');
    }
    if (admission.status === 'discharged' && req.body.status === 'admitted') {
      throw new ApiError(409, 'A discharged admission cannot be reopened');
    }

    const { ward, bed_number, diagnosis, treatment_plan, chief_complaint, triage_severity, notes, status } = req.body;
    if (status !== undefined && !ADMISSION_STATUSES.includes(status)) {
      throw new ApiError(400, 'Invalid admission status');
    }
    if (triage_severity !== undefined && triage_severity !== null && !TRIAGE_LEVELS.includes(triage_severity)) {
      throw new ApiError(400, 'Invalid triage severity');
    }

    if (ward !== undefined && (ward === null || ward === '' || WARDS[ward] === undefined)) {
      throw new ApiError(400, `Unknown ward "${ward}". Valid wards: ${Object.keys(WARDS).join(', ')}`);
    }
    const targetWard = ward || admission.ward;
    if (WARDS[targetWard] === undefined) {
      throw new ApiError(400, `Unknown ward "${targetWard}". Valid wards: ${Object.keys(WARDS).join(', ')}`);
    }
    const targetCapacity = wardCapacity(targetWard);
    const requestedBed = parseBedNumber(bed_number, targetCapacity);
    if (requestedBed === undefined) throw new ApiError(400, `Bed must be a number from 01 to ${pad(targetCapacity)}.`);

    let targetBed = requestedBed || admission.bed_number;
    if (ward !== undefined && ward !== admission.ward && !requestedBed) {
      targetBed = await findFreeBed(connection, targetWard);
      if (!targetBed) throw new ApiError(409, `${targetWard} ward is full.`);
    }
    if (targetBed && (targetWard !== admission.ward || targetBed !== admission.bed_number)) {
      const [occupied] = await connection.query(
        `SELECT id FROM admissions WHERE ward = ? AND bed_number = ? AND status = 'admitted' AND id != ?`,
        [targetWard, targetBed, id]
      );
      if (occupied.length > 0) throw new ApiError(409, `Bed ${targetBed} in ${targetWard} is already occupied.`);
    }

    const updates = [];
    const values = [];
    for (const [field, value] of Object.entries({ ward: targetWard, bed_number: targetBed, diagnosis, treatment_plan, chief_complaint, triage_severity, notes })) {
      if (value !== undefined) {
        updates.push(`${field} = ?`);
        values.push(value === '' ? null : value);
      }
    }
    if (status !== undefined) {
      updates.push('status = ?');
      values.push(status);
      updates.push(`discharge_date = ${status === 'discharged' ? "datetime('now')" : 'NULL'}`);
    }
    if (updates.length === 0) throw new ApiError(400, 'Nothing to update');
    values.push(id);
    const [result] = await connection.query(`UPDATE admissions SET ${updates.join(', ')} WHERE id = ?`, values);
    if (result.affectedRows !== 1) throw new ApiError(404, 'Admission not found');
    const [rows] = await connection.query(
      `SELECT a.*, p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn
       FROM admissions a JOIN patients p ON a.patient_id = p.id WHERE a.id = ?`,
      [id]
    );
    return rows[0];
  });
  res.json(updated);
}));

router.post('/:id/discharge', authenticate, authorize(...ADMISSION_ROLES), asyncHandler(async (req, res) => {
  const id = parseInteger(req.params.id, 'id', { min: 1 });
  const [existing] = await pool.query('SELECT * FROM admissions WHERE id = ?', [id]);
  if (existing.length === 0) throw new ApiError(404, 'Admission not found');
  if (req.user.role === 'doctor' && existing[0].doctor_id !== req.user.id) {
    throw new ApiError(403, 'You may only discharge admissions assigned to you.');
  }
  if (existing[0].status === 'discharged') throw new ApiError(409, 'Patient is already discharged');
  await pool.query("UPDATE admissions SET status = 'discharged', discharge_date = datetime('now') WHERE id = ?", [id]);
  res.json({ message: 'Patient discharged successfully', id });
}));

module.exports = router;
module.exports.WARD_CAPACITY = WARDS;
