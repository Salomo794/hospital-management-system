const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { WARDS: WARD_CAPACITY } = require('../config/wards');

// AI Assistant endpoint - processes natural language queries
router.post('/chat', authenticate, async (req, res) => {
  try {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message) {
      return res.status(400).json({ response: 'Please enter a question.', data: null });
    }
    const lowerMsg = message.toLowerCase();
    const hospitalOverviewRequested = lowerMsg.includes('overview') || lowerMsg.includes('command center') || lowerMsg.includes('live status') || lowerMsg.includes('hospital status');
    const clinicalRoles = ['admin', 'doctor', 'nurse', 'receptionist', 'lab_technician'];
    let response = '';
    let data = null;

    // Patient search
    if (lowerMsg.includes('find patient') || lowerMsg.includes('search patient') || lowerMsg.includes('patient named')) {
      if (!clinicalRoles.includes(req.user.role)) {
        return res.status(403).json({ response: 'You do not have permission to search patient records.', data: null });
      }
      const nameMatch = message.match(/(?:find|search)\s+patient(?:\s+named)?\s+(.+)|patient\s+named?\s+(.+)/i);
      const searchName = (nameMatch?.[1] || nameMatch?.[2] || message.replace(/find|search|patient|named/gi, '')).trim();
      const [patients] = await pool.query(
        `SELECT id, mrn, first_name, last_name, date_of_birth, gender, phone, blood_type, status
         FROM patients WHERE first_name LIKE ? OR last_name LIKE ? OR first_name || ' ' || last_name LIKE ? OR mrn LIKE ? LIMIT 5`,
        [`%${searchName}%`, `%${searchName}%`, `%${searchName}%`, `%${searchName}%`]
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
      const nameMatch = message.match(/(?:find|search)\s+doctor(?:\s+named)?\s+(.+)|doctor\s+named?\s+(.+)/i);
      const searchName = (nameMatch?.[1] || nameMatch?.[2] || message.replace(/find|search|doctor|named/gi, '')).trim();
      const [doctors] = await pool.query(
        `SELECT u.first_name, u.last_name, s.name as specialty, dp.license_number, dp.consultation_fee
         FROM users u LEFT JOIN doctor_profiles dp ON u.id = dp.user_id
         LEFT JOIN specialties s ON dp.specialty_id = s.id
         WHERE u.role = 'doctor' AND u.is_active = 1
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
    else if (!hospitalOverviewRequested && (lowerMsg.includes('summary') || lowerMsg.includes('overview') || lowerMsg.includes('patient record'))) {
      if (!clinicalRoles.includes(req.user.role)) {
        return res.status(403).json({ response: 'You do not have permission to view patient summaries.', data: null });
      }
      const idMatch = message.match(/\d+/);
      if (idMatch) {
        const patientId = parseInt(idMatch[0]);
        const [patient] = await pool.query(
          `SELECT id, mrn, first_name, last_name, date_of_birth, gender, blood_type, phone,
                  allergies, chronic_conditions, insurance_provider
           FROM patients WHERE id = ?`,
          [patientId]
        );
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
      if (req.user.role !== 'admin') {
        return res.status(403).json({ response: 'Only administrators can view revenue data.', data: null });
      }
      const [today] = await pool.query("SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE DATE(payment_date) = date('now')");
      const [month] = await pool.query("SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE CAST(strftime('%m', payment_date) AS INTEGER) = CAST(strftime('%m', 'now') AS INTEGER) AND CAST(strftime('%Y', payment_date) AS INTEGER) = CAST(strftime('%Y', 'now') AS INTEGER)");
      response = 'Revenue summary:';
      data = {
        today: today[0].total,
        this_month: month[0].total
      };
    }
    // Bed / ward status
    else if (lowerMsg.includes('ward') || lowerMsg.includes('occupancy') || lowerMsg.includes('bed')) {
      const [admissions] = await pool.query("SELECT ward, COUNT(*) as count FROM admissions WHERE status = 'admitted' GROUP BY ward");
      const byWard = {};
      admissions.forEach(a => { byWard[a.ward] = a.count; });
      const allWards = new Set([...Object.keys(WARD_CAPACITY), ...Object.keys(byWard)]);
      const seatRows = [...allWards].map(ward => {
        const total = WARD_CAPACITY[ward] || 20;
        const occupied = byWard[ward] || 0;
        return {
          ward,
          occupied,
          available: Math.max(total - occupied, 0),
          total,
          utilization: `${Math.round((Math.min(occupied, total) / total) * 100)}%`
        };
      }).sort((a, b) => a.ward.localeCompare(b.ward));
      const totalBeds = seatRows.reduce((s, w) => s + w.total, 0);
      const totalOccupied = seatRows.reduce((s, w) => s + w.occupied, 0);
      response = `Hospital occupancy: ${totalOccupied}/${totalBeds} beds in use (${Math.round((totalOccupied / totalBeds) * 100)}%):`;
      data = seatRows;
    }
    // Medicine stock checks (specific + low stock)
    else if (lowerMsg.includes('low stock') || lowerMsg.includes('stock alert') || lowerMsg.includes('stock alerts')) {
      const [low] = await pool.query(
        "SELECT name, generic_name, stock_quantity, min_stock_level, unit FROM medicines WHERE stock_quantity <= min_stock_level AND is_active = 1 ORDER BY stock_quantity ASC"
      );
      if (low.length > 0) {
        response = `Found ${low.length} medicine(s) at or below minimum stock:`;
        data = low.map(m => ({
          medicine: m.name,
          stock: `${m.stock_quantity} ${m.unit}`,
          minimum: m.min_stock_level
        }));
      } else {
        response = 'All medicines are above their minimum stock levels.';
      }
    }
    else if (lowerMsg.includes('stock') || lowerMsg.includes('inventory')) {
      const medMatch = message.match(/(?:stock\s+of\s+|stock\s+for\s+)?(.+)/i);
      const raw = medMatch && medMatch[1] ? medMatch[1] : '';
      const searchTerm = raw
        .replace(/^(?:current\s+)?(?:stock|inventory|medicine|medicines|list|status|level|levels)\s*/i, '')
        .replace(/[?.!]\s*$/, '')
        .trim();
      const genericQuery = !searchTerm || /^(medicine|medicines|inventory|stock|list|status|level|levels)$/i.test(searchTerm);
      if (!genericQuery) {
        const [med] = await pool.query(
          `SELECT name, generic_name, stock_quantity, min_stock_level, expiry_date, unit
           FROM medicines WHERE name LIKE ? OR generic_name LIKE ? LIMIT 5`,
          [`%${searchTerm}%`, `%${searchTerm}%`]
        );
        if (med.length > 0) {
          response = `Stock status for "${searchTerm}":`;
          data = med.map(m => ({
            medicine: m.name,
            available: `${m.stock_quantity} ${m.unit}`,
            status: m.stock_quantity <= m.min_stock_level ? 'Low stock' : 'OK',
            expires: m.expiry_date || 'n/a'
          }));
        } else {
          response = `No medicine matches "${searchTerm}".`;
        }
      } else {
        const [meds] = await pool.query(
          "SELECT COUNT(*) as count FROM medicines WHERE is_active = 1"
        );
        const [low] = await pool.query(
          "SELECT COUNT(*) as count FROM medicines WHERE stock_quantity <= min_stock_level AND is_active = 1"
        );
        const [expiring] = await pool.query(
          "SELECT COUNT(*) as count FROM medicines WHERE expiry_date >= date('now') AND expiry_date <= date('now', '+30 days') AND is_active = 1"
        );
        response = 'Pharmacy inventory overview:';
        data = {
          total_medicines: meds[0].count,
          low_stock_items: low[0].count,
          expiring_within_30_days: expiring[0].count
        };
      }
    }
    // Drug interaction check
    else if (lowerMsg.includes('interaction') && lowerMsg.includes('between')) {
      const pairMatch = message.match(/between\s+(.+?)\s+and\s+(.+)/i);
      if (pairMatch) {
        const a = pairMatch[1].trim();
        const b = pairMatch[2].trim().replace(/[?.!]\s*$/, '');
        const [res] = await pool.query(
          `SELECT di.severity, di.description, di.clinical_management,
             ma.name as medicine_a, mb.name as medicine_b
           FROM drug_interactions di
           JOIN medicines ma ON di.medicine_a_id = ma.id
           JOIN medicines mb ON di.medicine_b_id = mb.id
           WHERE (ma.name LIKE ? OR ma.generic_name LIKE ?) AND (mb.name LIKE ? OR mb.generic_name LIKE ?)
              OR (mb.name LIKE ? OR mb.generic_name LIKE ?) AND (ma.name LIKE ? OR ma.generic_name LIKE ?) LIMIT 5`,
          [`%${a}%`, `%${a}%`, `%${b}%`, `%${b}%`, `%${a}%`, `%${a}%`, `%${b}%`, `%${b}%`]
        );
        if (res.length > 0) {
          const r = res[0];
          response = `⚠️ Interaction found between **${r.medicine_a}** and **${r.medicine_b}** (${r.severity}):`;
          data = { severity: r.severity, description: r.description, clinical_management: r.clinical_management };
        } else {
          response = `No known interaction between "${a}" and "${b}" in the formulary. Always verify with a clinical reference.`;
        }
      } else {
        response = 'Please phrase it like: "interaction between Warfarin and Aspirin".';
      }
    }
    // Patient allergies
    else if (lowerMsg.includes('allergy') || lowerMsg.includes('allergies')) {
      if (!clinicalRoles.includes(req.user.role)) {
        return res.status(403).json({ response: 'You do not have permission to view allergy profiles.', data: null });
      }
      const nameMatch = message.match(/allerg(?:y|ies)\s*(?:of|for)?\s+(.+)/i);
      const searchName = nameMatch ? nameMatch[1].trim() : '';
      if (searchName) {
        const [patients] = await pool.query(
          `SELECT first_name, last_name, mrn, allergies FROM patients
           WHERE first_name LIKE ? OR last_name LIKE ? OR first_name || ' ' || last_name LIKE ? OR mrn LIKE ? LIMIT 5`,
          [`%${searchName}%`, `%${searchName}%`, `%${searchName}%`, `%${searchName}%`]
        );
        if (patients.length > 0) {
          response = 'Allergy profiles:';
          data = patients.map(p => ({
            patient: `${p.first_name} ${p.last_name}`,
            mrn: p.mrn,
            allergies: p.allergies || 'None recorded'
          }));
        } else {
          response = `No patient found matching "${searchName}".`;
        }
      } else {
        response = 'Please include a patient name, e.g. "allergies of Maria Garcia".';
      }
    }
    // Abnormal / critical lab results
    else if (lowerMsg.includes('abnormal') || lowerMsg.includes('critical result') || lowerMsg.includes('critical lab')) {
      if (!clinicalRoles.includes(req.user.role)) {
        return res.status(403).json({ response: 'You do not have permission to view lab results.', data: null });
      }
      const [rows] = await pool.query(
        `SELECT li.result_value, li.reference_range, li.notes, li.result_date,
           lt.name as test_name, p.first_name, p.last_name, p.mrn
         FROM lab_order_items li
         JOIN lab_tests lt ON li.lab_test_id = lt.id
         JOIN lab_orders lo ON li.lab_order_id = lo.id
         JOIN patients p ON lo.patient_id = p.id
         WHERE li.is_abnormal = TRUE
         ORDER BY li.result_date DESC LIMIT 10`
      );
      if (rows.length > 0) {
        response = `Found ${rows.length} abnormal lab result(s):`;
        data = rows.map(r => ({
          patient: `${r.first_name} ${r.last_name}`,
          mrn: r.mrn,
          test: r.test_name,
          result: r.result_value || 'n/a',
          reference: r.reference_range || 'n/a',
          date: r.result_date ? r.result_date.substring(0, 10) : 'n/a'
        }));
      } else {
        response = 'No abnormal lab results recorded.';
      }
    }
    // Live hospital overview
    else if (lowerMsg.includes('overview') || lowerMsg.includes('command center') || lowerMsg.includes('live status') || lowerMsg.includes('hospital status')) {
      const today = new Date().toISOString().split('T')[0];
      const [apptsToday] = await pool.query('SELECT COUNT(*) as count FROM appointments WHERE appointment_date = ?', [today]);
      const [waiting] = await pool.query("SELECT COUNT(*) as count FROM checkins WHERE date(checkin_time) = date('now') AND status IN ('waiting','in_consultation')");
      const [admissions] = await pool.query("SELECT COUNT(*) as count FROM admissions WHERE status = 'admitted'");
      const [lowStock] = await pool.query('SELECT COUNT(*) as count FROM medicines WHERE stock_quantity <= min_stock_level AND is_active = TRUE');
      const [pendingBills] = await pool.query("SELECT COUNT(*) as count FROM bills WHERE payment_status IN ('pending','partial')");
      response = 'Live hospital overview:';
      data = {
        appointments_today: apptsToday[0].count,
        patients_waiting: waiting[0].count,
        inpatients: admissions[0].count,
        low_stock_items: lowStock[0].count,
        unpaid_bills: pendingBills[0].count,
        tip: 'Use "forecast" for the next 7 days outlook, or "bed occupancy" for ward detail.'
      };
    }
    // Predictive forecast
    else if (lowerMsg.includes('forecast') || lowerMsg.includes('predict') || lowerMsg.includes('outlook') || lowerMsg.includes('trend')) {
      const [history] = await pool.query(
        `SELECT appointment_date, COUNT(*) as count FROM appointments
         WHERE appointment_date >= date('now', '-42 days') AND appointment_date < date('now')
         GROUP BY appointment_date`
      );
      const wdTotals = {}, wdCount = {};
      history.forEach(({ appointment_date, count }) => {
        const wd = new Date(appointment_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' });
        wdTotals[wd] = (wdTotals[wd] || 0) + count;
        wdCount[wd] = (wdCount[wd] || 0) + 1;
      });
      const days = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(); d.setDate(d.getDate() + i);
        const date = d.toISOString().split('T')[0];
        const wd = new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' });
        const pred = wdCount[wd] ? Math.max(1, Math.round(wdTotals[wd] / wdCount[wd])) : 2;
        days.push({ date, day: wd, predicted: pred });
      }
      const peak = [...days].sort((a, b) => b.predicted - a.predicted)[0];
      const [beds] = await pool.query("SELECT COUNT(*) as count FROM admissions WHERE status = 'admitted'");
      const [lowStock] = await pool.query('SELECT COUNT(*) as count FROM medicines WHERE stock_quantity <= min_stock_level AND is_active = TRUE');
      response = `Next 7 days forecast — busiest is ${peak.day} (${peak.date}) with ~${peak.predicted} expected visits:`;
      data = {
        outlook: days.map(d => `${d.day}: ${d.predicted}`),
        peak_day: peak.day,
        peak_date: peak.date,
        beds_in_use: beds[0].count,
        low_stock_items: lowStock[0].count,
        summary: `Plan extra staff for ${peak.day}. Ensure reorders are placed for the ${lowStock[0].count} low-stock items.`
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
7. **Ward status** - "ward status" or "bed occupancy"
8. **Medicines** - "low stock medicines" or "stock of Amoxicillin"
9. **Drug interactions** - "interaction between Warfarin and Aspirin"
10. **Allergies** - "allergies of Maria Garcia"
11. **Lab results** - "abnormal lab results"
12. **Live overview** - "hospital status" or "command center"
13. **Smart forecast** - "forecast next week" or "predict patient load"

Just type your question and I'll help you find the information.`;
    }

    res.json({ response, data });
  } catch (error) {
    console.error('AI Error:', error);
    res.status(500).json({ response: 'Sorry, I encountered an error processing your request. Please try again.', data: null });
  }
});

module.exports = router;
