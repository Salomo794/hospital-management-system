const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');

// AI Assistant endpoint - processes natural language queries
router.post('/chat', authenticate, async (req, res) => {
  try {
    const { message } = req.body;
    const lowerMsg = message.toLowerCase();
    let response = '';
    let data = null;

    // Patient search
    if (lowerMsg.includes('find patient') || lowerMsg.includes('search patient') || lowerMsg.includes('patient named')) {
      const nameMatch = message.match(/(?:patient\s+named?\s+|find\s+patient\s+)?(.+)/i);
      const searchName = nameMatch ? nameMatch[1].trim() : message.replace(/find|search|patient|named/gi, '').trim();
      const [patients] = await pool.query(
        `SELECT id, mrn, first_name, last_name, date_of_birth, gender, phone, blood_type, status
         FROM patients WHERE first_name LIKE ? OR last_name LIKE ? OR mrn LIKE ? LIMIT 5`,
        [`%${searchName}%`, `%${searchName}%`, `%${searchName}%`]
      );
      if (patients.length > 0) {
        response = `Found ${patients.length} patient(s):`;
        data = patients.map(p => ({
          name: `${p.first_name} ${p.last_name}`,
          mrn: p.mrn,
          dob: p.date_of_birth,
          gender: p.gender,
          phone: p.phone,
          blood_type: p.blood_type
        }));
      } else {
        response = `No patients found matching "${searchName}". Try a different name or MRN.`;
      }
    }
    // Doctor search
    else if (lowerMsg.includes('find doctor') || lowerMsg.includes('which doctor') || lowerMsg.includes('doctor named')) {
      const nameMatch = message.match(/(?:doctor\s+named?\s+|find\s+doctor\s+)?(.+)/i);
      const searchName = nameMatch ? nameMatch[1].trim() : message.replace(/find|search|doctor|named/gi, '').trim();
      const [doctors] = await pool.query(
        `SELECT u.first_name, u.last_name, s.name as specialty, dp.license_number, dp.consultation_fee
         FROM users u LEFT JOIN doctor_profiles dp ON u.id = dp.user_id
         LEFT JOIN specialties s ON dp.specialty_id = s.id
         WHERE u.role = 'doctor' AND u.is_active = TRUE
         AND (u.first_name LIKE ? OR u.last_name LIKE ? OR s.name LIKE ?) LIMIT 5`,
        [`%${searchName}%`, `%${searchName}%`, `%${searchName}%`]
      );
      if (doctors.length > 0) {
        response = `Found ${doctors.length} doctor(s):`;
        data = doctors.map(d => ({
          name: `${d.first_name} ${d.last_name}`,
          specialty: d.specialty || 'General',
          license: d.license_number,
          fee: d.consultation_fee
        }));
      } else {
        response = `No doctors found matching "${searchName}".`;
      }
    }
    // Today's appointments
    else if (lowerMsg.includes('today') && (lowerMsg.includes('appointment') || lowerMsg.includes('schedule'))) {
      const today = new Date().toISOString().split('T')[0];
      let query = `SELECT a.appointment_time, a.status, a.type,
        p.first_name || ' ' || p.last_name as patient_name,
        u.first_name || ' ' || u.last_name as doctor_name
        FROM appointments a JOIN patients p ON a.patient_id = p.id JOIN users u ON a.doctor_id = u.id
        WHERE a.appointment_date = ?`;
      const params = [today];
      if (req.user.role === 'doctor') {
        query += ' AND a.doctor_id = ?';
        params.push(req.user.id);
      }
      query += ' ORDER BY a.appointment_time';
      const [appts] = await pool.query(query, params);
      if (appts.length > 0) {
        response = `You have ${appts.length} appointment(s) today:`;
        data = appts.map(a => ({
          time: a.appointment_time.substring(0, 5),
          patient: a.patient_name,
          doctor: a.doctor_name,
          type: a.type,
          status: a.status
        }));
      } else {
        response = 'No appointments scheduled for today.';
      }
    }
    // Patient summary
    else if (lowerMsg.includes('summary') || lowerMsg.includes('overview') || lowerMsg.includes('patient record')) {
      const idMatch = message.match(/\d+/);
      if (idMatch) {
        const patientId = parseInt(idMatch[0]);
        const [patient] = await pool.query('SELECT * FROM patients WHERE id = ?', [patientId]);
        if (patient.length > 0) {
          const p = patient[0];
          const [records] = await pool.query('SELECT COUNT(*) as count FROM medical_records WHERE patient_id = ?', [patientId]);
          const [appointments] = await pool.query('SELECT COUNT(*) as count FROM appointments WHERE patient_id = ?', [patientId]);
          const [prescriptions] = await pool.query('SELECT COUNT(*) as count FROM prescriptions WHERE patient_id = ?', [patientId]);
          response = `Patient Summary for ${p.first_name} ${p.last_name} (${p.mrn})`;
          data = {
            name: `${p.first_name} ${p.last_name}`,
            dob: p.date_of_birth,
            gender: p.gender,
            blood_type: p.blood_type,
            phone: p.phone,
            allergies: p.allergies || 'None recorded',
            chronic_conditions: p.chronic_conditions || 'None recorded',
            insurance: p.insurance_provider || 'None',
            total_records: records[0].count,
            total_appointments: appointments[0].count,
            total_prescriptions: prescriptions[0].count
          };
        } else {
          response = `No patient found with ID ${patientId}.`;
        }
      } else {
        response = 'Please provide a patient ID number. Example: "patient record 5"';
      }
    }
    // Pending tasks
    else if (lowerMsg.includes('pending') || lowerMsg.includes('overdue') || lowerMsg.includes('tasks')) {
      const [pendingAppts] = await pool.query("SELECT COUNT(*) as count FROM appointments WHERE status = 'scheduled'");
      const [pendingBills] = await pool.query("SELECT COUNT(*) as count FROM bills WHERE payment_status IN ('pending','partial')");
      const [pendingLab] = await pool.query("SELECT COUNT(*) as count FROM lab_orders WHERE status IN ('ordered','in_progress')");
      response = 'Current pending items:';
      data = {
        pending_appointments: pendingAppts[0].count,
        unpaid_bills: pendingBills[0].count,
        pending_lab_orders: pendingLab[0].count
      };
    }
    // Revenue query
    else if (lowerMsg.includes('revenue') || lowerMsg.includes('income') || lowerMsg.includes('earnings')) {
      const [today] = await pool.query("SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE DATE(payment_date) = date('now')");
      const [month] = await pool.query("SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE CAST(strftime('%m', payment_date) AS INTEGER) = CAST(strftime('%m', 'now') AS INTEGER) AND CAST(strftime('%Y', payment_date) AS INTEGER) = CAST(strftime('%Y', 'now') AS INTEGER)");
      response = 'Revenue summary:';
      data = {
        today: today[0].total,
        this_month: month[0].total
      };
    }
    // Help / Default
    else {
      response = `I can help you with:

1. **Find patients** - "find patient John"
2. **Find doctors** - "find doctor cardiologist"
3. **Today's schedule** - "show today's appointments"
4. **Patient summary** - "patient record 5"
5. **Pending tasks** - "show pending items"
6. **Revenue** - "show revenue this month"

Just type your question and I'll help you find the information.`;
    }

    res.json({ response, data });
  } catch (error) {
    console.error('AI Error:', error);
    res.status(500).json({ response: 'Sorry, I encountered an error processing your request. Please try again.', data: null });
  }
});

module.exports = router;
