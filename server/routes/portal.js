const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { authenticatePortal } = require('../middleware/auth');

async function findPatientByIdentifier(identifier) {
  const value = String(identifier || '').trim();
  if (!value) return null;
  const isQrToken = value.startsWith('HMS:CHECKIN:');
  const lookup = isQrToken ? value.replace('HMS:CHECKIN:', '') : value;
  const q = isQrToken
    ? 'SELECT * FROM patients WHERE uuid = ?'
    : 'SELECT * FROM patients WHERE mrn = ? OR email = ? OR phone = ? OR uuid = ?';
  const params = isQrToken ? [lookup] : [value, value, value, value];
  const [rows] = await pool.query(q, params);
  return rows[0] || null;
}

// Patient self-service login (identifier = MRN / email / phone, pin = portal_pin)
router.post('/login', async (req, res) => {
  try {
    const { identifier, portal_pin } = req.body;
    const patient = await findPatientByIdentifier(identifier);
    if (!patient) {
      return res.status(401).json({ message: 'Patient not found. Check your MRN, phone or email.' });
    }
    if (patient.status !== 'active') {
      return res.status(403).json({ message: 'This patient record is inactive.' });
    }
    const ok = patient.portal_pin && (await bcrypt.compare(String(portal_pin || ''), patient.portal_pin));
    if (!ok) {
      return res.status(401).json({ message: 'Incorrect portal PIN.' });
    }
    const token = jwt.sign({ pid: patient.id, portal: true }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE || '24h' });
    res.json({
      token,
      patient: {
        id: patient.id,
        uuid: patient.uuid,
        mrn: patient.mrn,
        first_name: patient.first_name,
        last_name: patient.last_name,
        date_of_birth: patient.date_of_birth,
        gender: patient.gender,
        blood_type: patient.blood_type,
        phone: patient.phone,
        email: patient.email
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Kiosk check-in (no login required — patient just scans MRN/QR or types identifier)
router.post('/checkin', async (req, res) => {
  try {
    const { identifier, purpose } = req.body;
    const patient = await findPatientByIdentifier(identifier);
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found. Please check your MRN or QR code.' });
    }
    const today = new Date().toISOString().split('T')[0];

    const [todayAppt] = await pool.query(
      `SELECT id, appointment_time, type, reason FROM appointments
       WHERE patient_id = ? AND appointment_date = ? AND status = 'scheduled'
       ORDER BY appointment_time ASC LIMIT 1`,
      [patient.id, today]
    );

    const [recentCheckin] = await pool.query(
      "SELECT * FROM checkins WHERE patient_id = ? AND date(checkin_time) = ? ORDER BY id DESC LIMIT 1",
      [patient.id, today]
    );

    let checkin;
    if (recentCheckin.length > 0) {
      checkin = recentCheckin[0];
      await pool.query("UPDATE checkins SET purpose = COALESCE(?, purpose), status = 'waiting' WHERE id = ?", [purpose || null, checkin.id]);
    } else {
      const uuid = uuidv4();
      const [result] = await pool.query(
        `INSERT INTO checkins (uuid, patient_id, appointment_id, checkin_time, purpose, status, qr_token)
         VALUES (?, ?, ?, datetime('now'), ?, 'waiting', ?)`,
        [uuid, patient.id, todayAppt.length > 0 ? todayAppt[0].id : null, purpose || (todayAppt.length > 0 ? todayAppt[0].type : 'visit'), identifier]
      );
      checkin = { id: result.insertId, status: 'waiting' };
    }

    res.json({
      success: true,
      checked_in: true,
      queue_position: checkin.id,
      status: checkin.status,
      patient: {
        id: patient.id,
        name: `${patient.first_name} ${patient.last_name}`,
        mrn: patient.mrn,
        dob: patient.date_of_birth,
        gender: patient.gender
      },
      appointment: todayAppt[0]
        ? { time: todayAppt[0].appointment_time.substring(0, 5), type: todayAppt[0].type, reason: todayAppt[0].reason }
        : null,
      message: todayAppt[0]
        ? `Checked in for your ${todayAppt[0].appointment_time.substring(0, 5)} ${todayAppt[0].type} appointment. Please take a seat and we will call you.`
        : 'Checked in successfully. Please take a seat. A staff member will assist you shortly.'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Current patient profile + live queue position
router.get('/me', authenticatePortal, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, uuid, mrn, first_name, last_name, date_of_birth, gender, phone, email,
              blood_type, insurance_provider, insurance_number, allergies, chronic_conditions, address
       FROM patients WHERE id = ?`,
      [req.patient.id]
    );
    const [todayCheckin] = await pool.query(
      "SELECT * FROM checkins WHERE patient_id = ? AND date(checkin_time) = date('now') ORDER BY id DESC LIMIT 1",
      [req.patient.id]
    );
    const [waitingAhead] = await pool.query(
      "SELECT COUNT(*) as count FROM checkins WHERE date(checkin_time) = date('now') AND status IN ('waiting','in_consultation') AND id < ?",
      [todayCheckin.length > 0 ? todayCheckin[0].id : 0]
    );
    res.json({
      patient: rows[0],
      checkin: todayCheckin[0] || null,
      ahead_in_queue: waitingAhead[0].count
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/appointments', authenticatePortal, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT a.id, a.appointment_date, a.appointment_time, a.type, a.status, a.reason, a.notes,
              u.first_name || ' ' || u.last_name as doctor_name,
              d.name || '' as specialty
       FROM appointments a
       JOIN users u ON a.doctor_id = u.id
       LEFT JOIN doctor_profiles dp ON u.id = dp.user_id
       LEFT JOIN specialties d ON dp.specialty_id = d.id
       WHERE a.patient_id = ?
       ORDER BY a.appointment_date DESC, a.appointment_time DESC LIMIT 30`,
      [req.patient.id]
    );
    res.json({ appointments: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/lab-results', authenticatePortal, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT lo.order_number, lo.order_date, lo.status, lo.priority,
              li.result_value, li.result_unit, li.reference_range, li.is_abnormal, li.result_date,
              lt.name as test_name
       FROM lab_orders lo
       JOIN lab_order_items li ON li.lab_order_id = lo.id
       JOIN lab_tests lt ON lt.id = li.lab_test_id
       WHERE lo.patient_id = ?
       ORDER BY lo.order_date DESC LIMIT 40`,
      [req.patient.id]
    );
    res.json({ results: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/prescriptions', authenticatePortal, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT pr.prescription_number, pr.prescribed_date, pr.status,
              u.first_name || ' ' || u.last_name as doctor_name,
              pi.dosage, pi.frequency, pi.duration, pi.quantity, pi.instructions, pi.dispensed,
              m.name as medicine_name
       FROM prescriptions pr
       JOIN users u ON pr.doctor_id = u.id
       LEFT JOIN prescription_items pi ON pi.prescription_id = pr.id
       LEFT JOIN medicines m ON m.id = pi.medicine_id
       WHERE pr.patient_id = ?
       ORDER BY pr.prescribed_date DESC LIMIT 40`,
      [req.patient.id]
    );
    res.json({ prescriptions: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/bills', authenticatePortal, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT b.id, b.bill_number, b.total_amount, b.discount, b.tax, b.net_amount,
              b.paid_amount, b.payment_status, b.payment_method, b.due_date, b.created_at
       FROM bills b
       WHERE b.patient_id = ?
       ORDER BY b.created_at DESC LIMIT 30`,
      [req.patient.id]
    );
    res.json({ bills: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Simulated patient self-payment
router.post('/bills/:id/pay', authenticatePortal, async (req, res) => {
  try {
    const { amount, payment_method = 'card' } = req.body;
    const [billRows] = await pool.query(
      'SELECT * FROM bills WHERE id = ? AND patient_id = ?',
      [req.params.id, req.patient.id]
    );
    if (billRows.length === 0) {
      return res.status(404).json({ message: 'Bill not found.' });
    }
    const bill = billRows[0];
    const outstanding = bill.net_amount - bill.paid_amount;
    const payAmount = Math.min(Number(amount) || outstanding, outstanding);
    if (payAmount <= 0) {
      return res.status(400).json({ message: 'This bill has no outstanding balance.' });
    }

    const uuid = uuidv4();
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const count = Math.floor(Math.random() * 9000) + 1000;
    const [result] = await pool.query(
      `INSERT INTO payments (uuid, payment_number, bill_id, patient_id, amount, payment_method, transaction_reference, received_by, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      [uuid, `PAY-PTL-${today}-${count}`, bill.id, req.patient.id, payAmount, payment_method, `TXN-${Math.random().toString(36).slice(2, 10).toUpperCase()}`, 'Portal self-service payment']
    );
    await pool.query(
      'UPDATE bills SET paid_amount = paid_amount + ?, payment_status = CASE WHEN paid_amount + ? >= net_amount THEN ? ELSE ? END, payment_method = COALESCE(payment_method, ?) WHERE id = ?',
      [payAmount, payAmount, 'paid', 'partial', payment_method, bill.id]
    );
    res.json({
      success: true,
      amount: payAmount,
      balance_remaining: Math.max(bill.net_amount - (bill.paid_amount + payAmount), 0),
      message: 'Payment recorded successfully. Thank you!'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;