const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { validateDoctorProfile } = require('../middleware/validation');
const audit = require('../utils/audit');

// Get specialties - MUST be before /:id routes
router.get('/specialties/all', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM specialties ORDER BY name');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all doctors
router.get('/', authenticate, async (req, res) => {
  try {
    const { specialty_id, search, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const baseQuery = `FROM users u LEFT JOIN doctor_profiles dp ON u.id = dp.user_id
      LEFT JOIN specialties s ON dp.specialty_id = s.id WHERE u.role = 'doctor' AND u.is_active = TRUE`;
    let whereClause = '';
    const params = [];
    if (specialty_id) { whereClause += ' AND dp.specialty_id = ?'; params.push(specialty_id); }
    if (search) {
      whereClause += ' AND (u.first_name LIKE ? OR u.last_name LIKE ? OR dp.license_number LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    const [countRes] = await pool.query(`SELECT COUNT(*) as total ${baseQuery}${whereClause}`, params);
    const dataQuery = `SELECT u.id, u.uuid, u.first_name, u.last_name, u.email, u.phone,
      dp.specialty_id, s.name as specialty_name, dp.license_number, dp.qualification,
      dp.years_of_experience, dp.consultation_fee, dp.bio, dp.is_available, dp.schedule
      ${baseQuery}${whereClause} ORDER BY u.first_name LIMIT ? OFFSET ?`;
    const dataParams = [...params, parseInt(limit), parseInt(offset)];
    const [rows] = await pool.query(dataQuery, dataParams);
    res.json({ doctors: rows, total: countRes[0].total, page: parseInt(page), limit: parseInt(limit) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create or update doctor profile - MUST be before /:id
router.post('/profile', authenticate, authorize('admin'), validateDoctorProfile, async (req, res) => {
  try {
    const { user_id, specialty_id, license_number, qualification, years_of_experience, consultation_fee, bio, schedule } = req.body;
    const [existing] = await pool.query('SELECT id FROM doctor_profiles WHERE user_id = ?', [user_id]);
    if (existing.length > 0) {
      await pool.query(
        `UPDATE doctor_profiles SET specialty_id=?, license_number=?, qualification=?, years_of_experience=?, consultation_fee=?, bio=?, schedule=? WHERE user_id=?`,
        [specialty_id, license_number, qualification, years_of_experience, consultation_fee, bio, JSON.stringify(schedule), user_id]
      );
      await audit.update(req.user.id, 'doctor_profiles', existing[0].id, null, { user_id, license_number }, req.ip);
    } else {
      await pool.query(
        `INSERT INTO doctor_profiles (user_id, specialty_id, license_number, qualification, years_of_experience, consultation_fee, bio, schedule) VALUES (?,?,?,?,?,?,?,?)`,
        [user_id, specialty_id, license_number, qualification, years_of_experience, consultation_fee, bio, JSON.stringify(schedule)]
      );
      const [row] = await pool.query('SELECT id FROM doctor_profiles WHERE user_id = ?', [user_id]);
      await audit.create(req.user.id, 'doctor_profiles', row[0]?.id, { user_id, license_number }, req.ip);
    }
    res.json({ message: 'Doctor profile saved' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get single doctor profile
router.get('/:id', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.uuid, u.first_name, u.last_name, u.email, u.phone, u.avatar,
        dp.specialty_id, s.name as specialty_name, dp.license_number, dp.qualification,
        dp.years_of_experience, dp.consultation_fee, dp.bio, dp.is_available, dp.schedule
        FROM users u LEFT JOIN doctor_profiles dp ON u.id = dp.user_id
        LEFT JOIN specialties s ON dp.specialty_id = s.id WHERE u.id = ? AND u.role = 'doctor'`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Doctor not found' });
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Get doctor schedule
router.get('/:id/schedule', authenticate, async (req, res) => {
  try {
    const { date, week } = req.query;
    let query = `SELECT a.*, p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn
      FROM appointments a JOIN patients p ON a.patient_id = p.id
      WHERE a.doctor_id = ?`;
    const params = [req.params.id];
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
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
