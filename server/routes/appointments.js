const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { validateAppointment, validateAppointmentStatus } = require('../middleware/validation');
const audit = require('../utils/audit');

function generateAppointmentNumber() {
  const prefix = 'APT';
  const d = new Date();
  const datePart = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${datePart}-${rand}`;
}

// Get all appointments
router.get('/', authenticate, async (req, res) => {
  try {
    const { status, doctor_id, patient_id, date, from_date, to_date, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    let query = `SELECT a.*, p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn, p.phone as patient_phone,
      u.first_name as doctor_first_name, u.last_name as doctor_last_name, s.name as specialty_name
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      JOIN users u ON a.doctor_id = u.id
      LEFT JOIN doctor_profiles dp ON u.id = dp.user_id
      LEFT JOIN specialties s ON dp.specialty_id = s.id WHERE 1=1`;
    const params = [];
    if (status) { query += ' AND a.status = ?'; params.push(status); }
    if (doctor_id) { query += ' AND a.doctor_id = ?'; params.push(doctor_id); }
    if (patient_id) { query += ' AND a.patient_id = ?'; params.push(patient_id); }
    if (date) { query += ' AND a.appointment_date = ?'; params.push(date); }
    if (from_date) { query += ' AND a.appointment_date >= ?'; params.push(from_date); }
    if (to_date) { query += ' AND a.appointment_date <= ?'; params.push(to_date); }
    // Role-based filtering: doctors only ever see their own appointments
    if (req.user.role === 'doctor') {
      query += ' AND a.doctor_id = ?';
      params.push(req.user.id);
    }
    const countQuery = query.replace(/SELECT a\.[\s\S]*?FROM appointments a/, 'SELECT COUNT(*) as total FROM appointments a');
    const [countRes] = await pool.query(countQuery, params);
    query += ' ORDER BY a.appointment_date DESC, a.appointment_time DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    const [rows] = await pool.query(query, params);
    res.json({ appointments: rows, total: countRes[0].total, page: parseInt(page), limit: parseInt(limit) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get available time slots for a doctor on a date
router.get('/slots/:doctorId', authenticate, async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ message: 'Date query parameter is required' });
    const allSlots = ['09:00','09:30','10:00','10:30','11:00','11:30','12:00','14:00','14:30','15:00','15:30','16:00','16:30'];
    const [booked] = await pool.query(
      `SELECT appointment_time FROM appointments WHERE doctor_id = ? AND appointment_date = ? AND status NOT IN ('cancelled','no_show')`,
      [req.params.doctorId, date]
    );
    const bookedTimes = booked.map(b => b.appointment_time.substring(0, 5));
    const available = allSlots.filter(s => !bookedTimes.includes(s));
    res.json({ date, slots: available });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Get single appointment
router.get('/:id', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT a.*, p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn, p.phone as patient_phone, p.email as patient_email,
        p.date_of_birth as patient_dob, p.gender as patient_gender, p.blood_type as patient_blood_type,
        u.first_name as doctor_first_name, u.last_name as doctor_last_name, s.name as specialty_name
        FROM appointments a
        JOIN patients p ON a.patient_id = p.id
        JOIN users u ON a.doctor_id = u.id
        LEFT JOIN doctor_profiles dp ON u.id = dp.user_id
        LEFT JOIN specialties s ON dp.specialty_id = s.id WHERE a.id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Appointment not found' });
    if (req.user.role === 'doctor' && rows[0].doctor_id !== req.user.id) {
      return res.status(403).json({ message: 'You can only view your own appointments' });
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Create appointment
router.post('/', authenticate, authorize('admin', 'receptionist', 'doctor', 'nurse'), validateAppointment, async (req, res) => {
  try {
    const { patient_id, doctor_id, appointment_date, appointment_time, type, reason, notes } = req.body;
    // Check for conflicts
    const [conflicts] = await pool.query(
      `SELECT id FROM appointments WHERE doctor_id = ? AND appointment_date = ? AND appointment_time = ? AND status NOT IN ('cancelled')`,
      [doctor_id, appointment_date, appointment_time]
    );
    if (conflicts.length > 0) {
      return res.status(409).json({ message: 'Time slot already booked' });
    }
    const uuid = uuidv4();
    const appointment_number = generateAppointmentNumber();
    const [result] = await pool.query(
      `INSERT INTO appointments (uuid, appointment_number, patient_id, doctor_id, appointment_date, appointment_time, type, reason, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuid, appointment_number, patient_id, doctor_id, appointment_date, appointment_time, type || 'consultation', reason, notes, req.user.id]
    );
    // Create notification
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, message, link) VALUES (?, 'appointment', 'New Appointment', ?, ?)`,
      [doctor_id, `New ${type || 'consultation'} appointment booked for ${appointment_date}`, `/appointments/${result.insertId}`]
    );
    await audit.create(req.user.id, 'appointments', result.insertId, { appointment_number, patient_id, doctor_id, appointment_date }, req.ip);
    const [newAppt] = await pool.query('SELECT * FROM appointments WHERE id = ?', [result.insertId]);
    res.status(201).json(newAppt[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update appointment status
router.put('/:id', authenticate, authorize('admin', 'receptionist', 'doctor', 'nurse'), validateAppointmentStatus, async (req, res) => {
  try {
    const [target] = await pool.query('SELECT * FROM appointments WHERE id = ?', [req.params.id]);
    if (target.length === 0) return res.status(404).json({ message: 'Appointment not found' });
    // Doctors can only update their own appointments
    if (req.user.role === 'doctor' && target[0].doctor_id !== req.user.id) {
      return res.status(403).json({ message: 'You can only update your own appointments' });
    }
    const { status, notes } = req.body;
    const updates = [];
    const values = [];
    if (status) { updates.push('status = ?'); values.push(status); }
    if (notes !== undefined) { updates.push('notes = ?'); values.push(notes); }
    if (updates.length === 0) return res.status(400).json({ message: 'Nothing to update' });
    values.push(req.params.id);
    await pool.query(`UPDATE appointments SET ${updates.join(', ')} WHERE id = ?`, values);
    await audit.update(req.user.id, 'appointments', req.params.id, { status: target[0].status }, { status }, req.ip);
    const [updated] = await pool.query('SELECT * FROM appointments WHERE id = ?', [req.params.id]);
    res.json(updated[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Cancel appointment
router.put('/:id/cancel', authenticate, authorize('admin', 'receptionist', 'doctor', 'nurse'), async (req, res) => {
  try {
    const [target] = await pool.query('SELECT * FROM appointments WHERE id = ?', [req.params.id]);
    if (target.length === 0) return res.status(404).json({ message: 'Appointment not found' });
    if (req.user.role === 'doctor' && target[0].doctor_id !== req.user.id) {
      return res.status(403).json({ message: 'You can only cancel your own appointments' });
    }
    await pool.query("UPDATE appointments SET status = 'cancelled' WHERE id = ?", [req.params.id]);
    await audit.delete(req.user.id, 'appointments', req.params.id, { status: target[0].status }, req.ip);
    res.json({ message: 'Appointment cancelled' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;