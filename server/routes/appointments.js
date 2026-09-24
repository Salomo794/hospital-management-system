const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { validateAppointment } = require('../middleware/validation');
const { ApiError, asyncHandler, getPagination, isDateOnly, isTodayOrFuture, parseInteger, withTransaction } = require('../utils/http');
const { randomUUID, generateRecordNumber } = require('../utils/ids');
const { buildSlots } = require('../utils/schedule');

const APPOINTMENT_ROLES = ['admin', 'receptionist', 'doctor', 'nurse'];
const APPOINTMENT_STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'];
const BOOKED_STATUSES = ['scheduled', 'in_progress', 'completed'];

function normalizeTime(value) {
  return String(value).slice(0, 5);
}

router.get('/', authenticate, authorize(...APPOINTMENT_ROLES), asyncHandler(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const { status, doctor_id, patient_id, date, from_date, to_date } = req.query;
  if (status && !APPOINTMENT_STATUSES.includes(status)) throw new ApiError(400, 'Invalid appointment status');
  for (const [name, value] of Object.entries({ date, from_date, to_date })) {
    if (value && !isDateOnly(value)) throw new ApiError(400, `${name} must use YYYY-MM-DD`);
  }

  let where = 'WHERE 1=1';
  const params = [];
  if (status) { where += ' AND a.status = ?'; params.push(status); }
  if (doctor_id) { where += ' AND a.doctor_id = ?'; params.push(parseInteger(doctor_id, 'doctor_id', { min: 1 })); }
  if (patient_id) { where += ' AND a.patient_id = ?'; params.push(parseInteger(patient_id, 'patient_id', { min: 1 })); }
  if (date) { where += ' AND a.appointment_date = ?'; params.push(date); }
  if (from_date) { where += ' AND a.appointment_date >= ?'; params.push(from_date); }
  if (to_date) { where += ' AND a.appointment_date <= ?'; params.push(to_date); }
  if (req.user.role === 'doctor') {
    where += ' AND a.doctor_id = ?';
    params.push(req.user.id);
  }

  const [countRows] = await pool.query(
    `SELECT COUNT(*) as total FROM appointments a
     JOIN patients p ON a.patient_id = p.id
     JOIN users u ON a.doctor_id = u.id ${where}`,
    params
  );
  const [rows] = await pool.query(
    `SELECT a.*, p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn,
            p.phone as patient_phone, u.first_name as doctor_first_name, u.last_name as doctor_last_name,
            s.name as specialty_name
     FROM appointments a
     JOIN patients p ON a.patient_id = p.id
     JOIN users u ON a.doctor_id = u.id
     LEFT JOIN doctor_profiles dp ON u.id = dp.user_id
     LEFT JOIN specialties s ON dp.specialty_id = s.id
     ${where} ORDER BY a.appointment_date DESC, a.appointment_time DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ appointments: rows, total: countRows[0].total, page, limit });
}));

router.get('/slots/:doctorId', authenticate, authorize(...APPOINTMENT_ROLES), asyncHandler(async (req, res) => {
  const doctorId = parseInteger(req.params.doctorId, 'doctorId', { min: 1 });
  const date = req.query.date;
  if (!isDateOnly(date)) throw new ApiError(400, 'date is required and must use YYYY-MM-DD');
  if (!isTodayOrFuture(date)) throw new ApiError(400, 'Slots cannot be requested for a past date');

  const [doctors] = await pool.query(
    `SELECT u.id, dp.schedule, dp.is_available
     FROM users u LEFT JOIN doctor_profiles dp ON u.id = dp.user_id
     WHERE u.id = ? AND u.role = 'doctor' AND u.is_active = 1`,
    [doctorId]
  );
  if (doctors.length === 0) throw new ApiError(404, 'Doctor not found');
  if (!doctors[0].is_available) {
    return res.json({ date, slots: [], available: false, message: 'This doctor is not currently accepting appointments.' });
  }

  const scheduleSlots = buildSlots(doctors[0].schedule, date);
  const [booked] = await pool.query(
    `SELECT appointment_time FROM appointments
     WHERE doctor_id = ? AND appointment_date = ? AND status IN (${BOOKED_STATUSES.map(() => '?').join(',')})`,
    [doctorId, date, ...BOOKED_STATUSES]
  );
  const bookedTimes = new Set(booked.map(row => normalizeTime(row.appointment_time)));
  res.json({ date, slots: scheduleSlots.filter(slot => !bookedTimes.has(slot)), available: true });
}));

router.get('/:id', authenticate, authorize(...APPOINTMENT_ROLES), asyncHandler(async (req, res) => {
  const id = parseInteger(req.params.id, 'id', { min: 1 });
  const [rows] = await pool.query(
    `SELECT a.*, p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn,
            p.phone as patient_phone, p.email as patient_email, p.date_of_birth as patient_dob,
            p.gender as patient_gender, p.blood_type as patient_blood_type,
            u.first_name as doctor_first_name, u.last_name as doctor_last_name, s.name as specialty_name
     FROM appointments a
     JOIN patients p ON a.patient_id = p.id
     JOIN users u ON a.doctor_id = u.id
     LEFT JOIN doctor_profiles dp ON u.id = dp.user_id
     LEFT JOIN specialties s ON dp.specialty_id = s.id
     WHERE a.id = ?`,
    [id]
  );
  if (rows.length === 0) throw new ApiError(404, 'Appointment not found');
  if (req.user.role === 'doctor' && rows[0].doctor_id !== req.user.id) {
    throw new ApiError(403, 'You may only view your own appointments.');
  }
  res.json(rows[0]);
}));

router.post('/', authenticate, authorize(...APPOINTMENT_ROLES), validateAppointment, asyncHandler(async (req, res) => {
  const { patient_id, doctor_id, appointment_date, appointment_time, type, reason, notes } = req.body;
  if (!isDateOnly(appointment_date)) throw new ApiError(400, 'appointment_date must use YYYY-MM-DD');
  const patientId = parseInteger(patient_id, 'patient_id', { min: 1 });
  let doctorId = parseInteger(doctor_id, 'doctor_id', { min: 1 });
  if (req.user.role === 'doctor' && doctorId !== req.user.id) {
    throw new ApiError(403, 'Doctors may only create appointments for themselves.');
  }

  const [[patient], [doctor]] = await Promise.all([
    pool.query('SELECT id FROM patients WHERE id = ? AND status = ?', [patientId, 'active']),
    pool.query("SELECT id, dp.schedule, dp.is_available FROM users u LEFT JOIN doctor_profiles dp ON dp.user_id = u.id WHERE u.id = ? AND u.role = 'doctor' AND u.is_active = 1", [doctorId]),
  ]);
  if (patient.length === 0) throw new ApiError(400, 'Patient not found or inactive');
  if (doctor.length === 0) throw new ApiError(400, 'Doctor not found or inactive');
  if (!doctor[0].is_available) throw new ApiError(409, 'This doctor is not currently accepting appointments');
  const time = normalizeTime(appointment_time);
  if (!buildSlots(doctor[0].schedule, appointment_date).includes(time)) {
    throw new ApiError(400, 'The requested time is outside the doctor’s schedule');
  }

  try {
    const appointment = await withTransaction(pool, async connection => {
      const [conflicts] = await connection.query(
        `SELECT id FROM appointments
         WHERE doctor_id = ? AND appointment_date = ? AND substr(appointment_time, 1, 5) = ?
           AND status IN (${BOOKED_STATUSES.map(() => '?').join(',')})`,
        [doctorId, appointment_date, time, ...BOOKED_STATUSES]
      );
      if (conflicts.length > 0) throw new ApiError(409, 'Time slot already booked');

      const uuid = randomUUID();
      const appointmentNumber = generateRecordNumber('APT');
      const [result] = await connection.query(
        `INSERT INTO appointments
         (uuid, appointment_number, patient_id, doctor_id, appointment_date, appointment_time, type, reason, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuid, appointmentNumber, patientId, doctorId, appointment_date, time, type || 'consultation', reason || null, notes || null, req.user.id]
      );
      await connection.query(
        `INSERT INTO notifications (user_id, type, title, message, link)
         VALUES (?, 'appointment', 'New Appointment', ?, ?)`,
        [doctorId, `New ${type || 'consultation'} appointment booked for ${appointment_date}`, `/appointments?appointment_id=${result.insertId}`]
      );
      const [created] = await connection.query('SELECT * FROM appointments WHERE id = ?', [result.insertId]);
      return created[0];
    });
    res.status(201).json(appointment);
  } catch (error) {
    if (String(error.code || '').startsWith('SQLITE_CONSTRAINT')) {
      throw new ApiError(409, 'Time slot already booked');
    }
    throw error;
  }
}));

router.put('/:id', authenticate, authorize(...APPOINTMENT_ROLES), asyncHandler(async (req, res) => {
  const id = parseInteger(req.params.id, 'id', { min: 1 });
  const { status, notes } = req.body;
  if (status !== undefined && !APPOINTMENT_STATUSES.includes(status)) throw new ApiError(400, 'Invalid appointment status');
  if (status === undefined && notes === undefined) throw new ApiError(400, 'Nothing to update');

  const [existing] = await pool.query('SELECT * FROM appointments WHERE id = ?', [id]);
  if (existing.length === 0) throw new ApiError(404, 'Appointment not found');
  if (req.user.role === 'doctor' && existing[0].doctor_id !== req.user.id) {
    throw new ApiError(403, 'You may only update your own appointments.');
  }

  const updates = [];
  const values = [];
  if (status !== undefined) { updates.push('status = ?'); values.push(status); }
  if (notes !== undefined) { updates.push('notes = ?'); values.push(notes); }
  values.push(id);
  const [result] = await pool.query(`UPDATE appointments SET ${updates.join(', ')} WHERE id = ?`, values);
  if (result.affectedRows === 0) throw new ApiError(404, 'Appointment not found');
  const [updated] = await pool.query('SELECT * FROM appointments WHERE id = ?', [id]);
  res.json(updated[0]);
}));

router.put('/:id/cancel', authenticate, authorize('admin', 'receptionist', 'doctor'), asyncHandler(async (req, res) => {
  const id = parseInteger(req.params.id, 'id', { min: 1 });
  const [existing] = await pool.query('SELECT * FROM appointments WHERE id = ?', [id]);
  if (existing.length === 0) throw new ApiError(404, 'Appointment not found');
  if (req.user.role === 'doctor' && existing[0].doctor_id !== req.user.id) {
    throw new ApiError(403, 'You may only cancel your own appointments.');
  }
  if (existing[0].status === 'cancelled') throw new ApiError(409, 'Appointment is already cancelled');
  await pool.query("UPDATE appointments SET status = 'cancelled' WHERE id = ?", [id]);
  res.json({ message: 'Appointment cancelled' });
}));

module.exports = router;
