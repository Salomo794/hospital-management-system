const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { ApiError, asyncHandler, getPagination, isDateOnly, parseFiniteNumber, parseInteger } = require('../utils/http');

const SCHEDULE_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const CLINICAL_ROLES = ['admin', 'receptionist', 'doctor', 'nurse'];

function normalizeSchedule(value) {
  if (value === undefined || value === null || value === '') return null;
  let schedule = value;
  if (typeof schedule === 'string') {
    try {
      schedule = JSON.parse(schedule);
    } catch (_) {
      throw new ApiError(400, 'schedule must be valid JSON');
    }
  }
  if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) {
    throw new ApiError(400, 'schedule must be an object keyed by weekday');
  }
  for (const [day, ranges] of Object.entries(schedule)) {
    if (!SCHEDULE_DAYS.includes(day) || !Array.isArray(ranges)) {
      throw new ApiError(400, 'schedule contains an invalid weekday or range list');
    }
    for (const range of ranges) {
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d-(?:[01]\d|2[0-3]):[0-5]\d$/.test(range)) {
        throw new ApiError(400, `Invalid schedule range for ${day}`);
      }
      const [start, end] = range.split('-');
      if (start >= end) throw new ApiError(400, `Schedule range must end after it starts for ${day}`);
    }
  }
  return JSON.stringify(schedule);
}

router.get('/specialties/all', authenticate, asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM specialties ORDER BY name');
  res.json(rows);
}));

router.get('/', authenticate, asyncHandler(async (req, res) => {
  const { page, limit, offset } = getPagination(req.query);
  const { specialty_id, search } = req.query;
  const baseQuery = `FROM users u
    LEFT JOIN doctor_profiles dp ON u.id = dp.user_id
    LEFT JOIN specialties s ON dp.specialty_id = s.id
    WHERE u.role = 'doctor' AND u.is_active = 1`;
  let where = '';
  const params = [];
  if (specialty_id) {
    where += ' AND dp.specialty_id = ?';
    params.push(parseInteger(specialty_id, 'specialty_id', { min: 1 }));
  }
  if (search) {
    where += ' AND (u.first_name LIKE ? OR u.last_name LIKE ? OR dp.license_number LIKE ?)';
    const term = `%${String(search).trim().slice(0, 100)}%`;
    params.push(term, term, term);
  }

  const [countRows] = await pool.query(`SELECT COUNT(*) as total ${baseQuery}${where}`, params);
  const [rows] = await pool.query(
    `SELECT u.id, u.uuid, u.first_name, u.last_name, u.email, u.phone,
            dp.specialty_id, s.name as specialty_name, dp.license_number, dp.qualification,
            dp.years_of_experience, dp.consultation_fee, dp.bio, dp.is_available, dp.schedule
     ${baseQuery}${where} ORDER BY u.first_name LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ doctors: rows, total: countRows[0].total, page, limit });
}));

router.post('/profile', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const {
    user_id, specialty_id, license_number, qualification, years_of_experience,
    consultation_fee, bio, schedule, is_available,
  } = req.body;
  const doctorUserId = parseInteger(user_id, 'user_id', { min: 1 });
  const [doctor] = await pool.query("SELECT id FROM users WHERE id = ? AND role = 'doctor' AND is_active = 1", [doctorUserId]);
  if (doctor.length === 0) throw new ApiError(400, 'user_id must identify an active doctor');

  let normalizedSpecialtyId = null;
  if (specialty_id !== undefined && specialty_id !== null && specialty_id !== '') {
    normalizedSpecialtyId = parseInteger(specialty_id, 'specialty_id', { min: 1 });
    const [specialty] = await pool.query('SELECT id FROM specialties WHERE id = ?', [normalizedSpecialtyId]);
    if (specialty.length === 0) throw new ApiError(400, 'Specialty not found');
  }
  if (license_number !== undefined && (!String(license_number).trim())) throw new ApiError(400, 'license_number cannot be empty');
  const years = years_of_experience === undefined || years_of_experience === null || years_of_experience === ''
    ? null
    : parseInteger(years_of_experience, 'years_of_experience', { min: 0, max: 80 });
  const fee = consultation_fee === undefined || consultation_fee === null || consultation_fee === ''
    ? 0
    : parseFiniteNumber(consultation_fee, 'consultation_fee', { min: 0 });
  if (is_available !== undefined && typeof is_available !== 'boolean') {
    throw new ApiError(400, 'is_available must be a boolean');
  }
  const scheduleJson = normalizeSchedule(schedule);

  const [existing] = await pool.query('SELECT * FROM doctor_profiles WHERE user_id = ?', [doctorUserId]);
  if (existing.length === 0 && (license_number === undefined || license_number === null || !String(license_number).trim())) {
    throw new ApiError(400, 'license_number is required');
  }
  if (existing.length > 0) {
    await pool.query(
      `UPDATE doctor_profiles
       SET specialty_id=?, license_number=?, qualification=?, years_of_experience=?,
           consultation_fee=?, bio=?, schedule=COALESCE(?, schedule), is_available=COALESCE(?, is_available)
       WHERE user_id=?`,
      [
        specialty_id === undefined ? existing.specialty_id : normalizedSpecialtyId,
         license_number === undefined ? existing.license_number : String(license_number).trim(),
         qualification === undefined ? existing.qualification : (qualification || null),
         years === undefined ? existing.years_of_experience : years,
         fee === undefined ? existing.consultation_fee : fee,
         bio === undefined ? existing.bio : (bio || null),
        scheduleJson === null ? existing.schedule : scheduleJson,
         is_available === undefined ? existing.is_available : is_available, doctorUserId,
      ]
    );
  } else {
    await pool.query(
      `INSERT INTO doctor_profiles
       (user_id, specialty_id, license_number, qualification, years_of_experience,
        consultation_fee, bio, schedule, is_available)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        doctorUserId, specialty_id || null, String(license_number).trim(), qualification || null,
        years, fee, bio || null, scheduleJson, is_available === undefined ? 1 : is_available,
      ]
    );
  }
  res.json({ message: 'Doctor profile saved' });
}));

router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const id = parseInteger(req.params.id, 'id', { min: 1 });
  const [rows] = await pool.query(
    `SELECT u.id, u.uuid, u.first_name, u.last_name, u.email, u.phone, u.avatar,
            dp.specialty_id, s.name as specialty_name, dp.license_number, dp.qualification,
            dp.years_of_experience, dp.consultation_fee, dp.bio, dp.is_available, dp.schedule
     FROM users u LEFT JOIN doctor_profiles dp ON u.id = dp.user_id
     LEFT JOIN specialties s ON dp.specialty_id = s.id
     WHERE u.id = ? AND u.role = 'doctor' AND u.is_active = 1`,
    [id]
  );
  if (rows.length === 0) throw new ApiError(404, 'Doctor not found');
  res.json(rows[0]);
}));

router.get('/:id/schedule', authenticate, authorize(...CLINICAL_ROLES), asyncHandler(async (req, res) => {
  const id = parseInteger(req.params.id, 'id', { min: 1 });
  const { date, week } = req.query;
  if (date && !isDateOnly(date)) throw new ApiError(400, 'date must use YYYY-MM-DD');
  if (week && !isDateOnly(week)) throw new ApiError(400, 'week must use YYYY-MM-DD');

  let query = `SELECT a.*, p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn
    FROM appointments a JOIN patients p ON a.patient_id = p.id WHERE a.doctor_id = ?`;
  const params = [id];
  if (date) {
    query += ' AND a.appointment_date = ?';
    params.push(date);
  } else if (week) {
    query += " AND a.appointment_date BETWEEN date(?, '-7 days') AND ?";
    params.push(week, week);
  }
  query += ' ORDER BY a.appointment_date, a.appointment_time';
  const [rows] = await pool.query(query, params);
  res.json(rows);
}));

module.exports = router;
module.exports.normalizeSchedule = normalizeSchedule;
