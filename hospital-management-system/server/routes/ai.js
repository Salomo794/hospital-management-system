const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { FixedWindowRateLimiter } = require('../utils/rateLimiter');
const { WARDS: WARD_CAPACITY } = require('../config/wards');
const { zonedDate, zonedDayRange } = require('../config/time');

const MAX_MESSAGE_LENGTH = 500;
const CLINICAL_ROLES = ['admin', 'receptionist', 'doctor', 'nurse'];
const OPERATIONS_ROLES = ['admin', 'receptionist', 'doctor', 'nurse'];
const PHARMACY_ROLES = ['admin', 'pharmacist'];
const MEDICATION_ROLES = ['admin', 'doctor', 'nurse', 'pharmacist'];
const LAB_ROLES = ['admin', 'doctor', 'nurse', 'lab_technician'];
const BILLING_ROLES = ['admin', 'receptionist'];

// Authenticated users get an independent bucket so a shared proxy/NAT cannot
// make the assistant unavailable to an entire hospital at once.
const chatByUser = new FixedWindowRateLimiter({ windowMs: 60 * 1000, max: 20 });

function cleanSearchTerm(value) {
  return String(value || '').trim().replace(/[?!.,;]+\s*$/g, '').trim();
}

function escapeLike(value) {
  return String(value).replace(/[!%_]/g, character => `!${character}`);
}

function containsLike(value) {
  return `%${escapeLike(value)}%`;
}

function tooShortForSearch(value) {
  return cleanSearchTerm(value).length < 2;
}

function extractMedicineSearchTerm(message) {
  const explicitMatch = message.match(/\b(?:current\s+|available\s+)?(?:stock|inventory)\s+(?:of|for)\s+(.+)/i)
    || message.match(/\b(?:medicine|medicines)\s+(?:named\s+)?(.+)/i);
  return cleanSearchTerm((explicitMatch?.[1] || message)
    .replace(/^(?:please\s+)?(?:show|check|get|view|display)(?:\s+me)?\s+/i, '')
    .replace(/^(?:the\s+)?(?:current|available|remaining)\s+/i, '')
    .replace(/^(?:the\s+)?(?:stock|inventory|medicine|medicines)(?:\s+(?:level|levels|status))?\s*(?:of|for)?\s*/i, '')
    .replace(/^(?:list|show)\s+/i, ''));
}

function isGenericInventoryQuery(searchTerm) {
  return !searchTerm || /^(?:please\s+)?(?:show|check|get|view|display|list)(?:\s+me)?$/i.test(searchTerm)
    || /^(?:the\s+)?(?:current\s+|available\s+|remaining\s+)?(?:stock|inventory|medicine|medicines|pharmacy)(?:\s+(?:level|levels|status|overview))?$/i.test(searchTerm);
}

function helpResponse(role) {
  const items = [];
  if (CLINICAL_ROLES.includes(role)) {
    items.push('**Find patients** - "find patient John"');
    items.push('**Patient summary** - "patient record 5"');
    items.push('**Allergies** - "allergies of Maria Garcia"');
  }
  items.push('**Find doctors** - "find doctor cardiologist"');
  if (OPERATIONS_ROLES.includes(role)) {
    items.push("**Today's schedule** - \"show today's appointments\"");
    items.push('**Pending tasks** - "show pending items relevant to my role"');
    items.push('**Ward status** - "ward status" or "bed occupancy"');
    items.push('**Live overview** - "hospital status" or "command center"');
    items.push('**Smart forecast** - "forecast next week" or "predict patient load"');
  }
  if (role === 'admin') {
    items.push('**Revenue** - "show revenue this month"');
  }
  if (PHARMACY_ROLES.includes(role)) {
    items.push('**Medicines** - "low stock medicines" or "stock of Amoxicillin"');
  }
  if (MEDICATION_ROLES.includes(role)) {
    items.push('**Drug interactions** - "interaction between Warfarin and Aspirin"');
  }
  if (LAB_ROLES.includes(role)) {
    items.push('**Lab results** - "abnormal lab results"');
  }
  return `I can help you with:\n\n${items.map((item, index) => `${index + 1}. ${item}`).join('\n')}\n\nJust type your question and I'll help you find the information.`;
}

// AI Assistant endpoint - processes natural language queries
router.post('/chat', authenticate, async (req, res) => {
  try {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message) {
      return res.status(400).json({ response: 'Please enter a question.', data: null });
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ response: `Messages must be ${MAX_MESSAGE_LENGTH} characters or fewer.`, data: null });
    }

    const userLimit = chatByUser.consume(`user:${req.user.id}`);
    if (!userLimit.allowed) {
      res.setHeader('Retry-After', userLimit.retryAfterSeconds);
      return res.status(429).json({ response: 'Too many AI requests. Please try again later.', data: null });
    }

    const lowerMsg = message.toLowerCase();
    const hospitalOverviewRequested = lowerMsg.includes('overview') || lowerMsg.includes('command center') || lowerMsg.includes('live status') || lowerMsg.includes('hospital status');
    let response = '';
    let data = null;

    // Patient search
    if (lowerMsg.includes('find patient') || lowerMsg.includes('search patient') || lowerMsg.includes('patient named')) {
      if (!CLINICAL_ROLES.includes(req.user.role)) {
        return res.status(403).json({ response: 'You do not have permission to search patient records.', data: null });
      }
      const nameMatch = message.match(/(?:find|search)\s+patient(?:\s+named)?\s+(.+)|patient\s+named?\s+(.+)/i);
      const searchName = cleanSearchTerm(nameMatch?.[1] || nameMatch?.[2] || message.replace(/find|search|patient|named/gi, ''));
      if (tooShortForSearch(searchName)) {
        return res.status(400).json({ response: 'Please enter at least 2 characters to search for a patient.', data: null });
      }
      const patientSearch = containsLike(searchName);
      const [patients] = await pool.query(
        `SELECT id, mrn, first_name, last_name, date_of_birth, gender, phone, blood_type, status
         FROM patients
         WHERE first_name LIKE ? ESCAPE '!' OR last_name LIKE ? ESCAPE '!'
            OR first_name || ' ' || last_name LIKE ? ESCAPE '!' OR mrn LIKE ? ESCAPE '!'
         LIMIT 5`,
        [patientSearch, patientSearch, patientSearch, patientSearch]
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
      const nameMatch = message.match(
        /(?:find|search)\s+doctor(?:\s+named)?\s+(.+)|(?:which|what)\s+doctor(?:\s+(?:is|are|handles|specializes in))?\s+(.+)|doctor\s+named?\s+(.+)/i
      );
      const searchName = cleanSearchTerm(nameMatch?.[1] || nameMatch?.[2] || nameMatch?.[3]);
      if (tooShortForSearch(searchName)) {
        return res.status(400).json({ response: 'Please enter at least 2 characters to search for a doctor.', data: null });
      }
      const doctorSearch = containsLike(searchName);
      const [doctors] = await pool.query(
        `SELECT u.first_name, u.last_name, s.name as specialty, dp.license_number, dp.consultation_fee
         FROM users u LEFT JOIN doctor_profiles dp ON u.id = dp.user_id
         LEFT JOIN specialties s ON dp.specialty_id = s.id
         WHERE u.role = 'doctor' AND u.is_active = 1
         AND (u.first_name LIKE ? ESCAPE '!' OR u.last_name LIKE ? ESCAPE '!' OR s.name LIKE ? ESCAPE '!')
         LIMIT 5`,
        [doctorSearch, doctorSearch, doctorSearch]
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
      if (!OPERATIONS_ROLES.includes(req.user.role)) {
        return res.status(403).json({ response: 'You do not have permission to view appointment schedules.', data: null });
      }
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
      if (!CLINICAL_ROLES.includes(req.user.role)) {
        return res.status(403).json({ response: 'You do not have permission to view patient summaries.', data: null });
      }
      const idMatch = message.match(/\d+/);
      if (idMatch) {
        const patientId = parseInt(idMatch[0]);
        let patientQuery =
          `SELECT id, mrn, first_name, last_name, date_of_birth, gender, blood_type, phone,
                  allergies, chronic_conditions, insurance_provider
           FROM patients WHERE id = ?`;
        const patientParams = [patientId];
        if (req.user.role === 'doctor') {
          patientQuery += `
             AND (
               EXISTS (
                 SELECT 1 FROM appointments a
                 WHERE a.patient_id = patients.id AND a.doctor_id = ?
               )
               OR EXISTS (
                 SELECT 1 FROM medical_records mr
                 WHERE mr.patient_id = patients.id AND mr.doctor_id = ?
               )
             )`;
          patientParams.push(req.user.id, req.user.id);
        }
        const [patient] = await pool.query(patientQuery, patientParams);
        if (patient.length === 0 && req.user.role === 'doctor') {
          return res.status(403).json({ response: 'You are not assigned to this patient.', data: null });
        }
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
      if (!OPERATIONS_ROLES.includes(req.user.role)) {
        return res.status(403).json({ response: 'You do not have permission to view operational tasks.', data: null });
      }
      const today = new Date().toISOString().split('T')[0];
      let appointmentCountQuery = "SELECT COUNT(*) as count FROM appointments WHERE status = 'scheduled' AND appointment_date >= ?";
      const appointmentCountParams = [today];
      if (req.user.role === 'doctor') {
        appointmentCountQuery += ' AND doctor_id = ?';
        appointmentCountParams.push(req.user.id);
      }
      const [pendingAppts] = await pool.query(appointmentCountQuery, appointmentCountParams);
      data = { pending_appointments: pendingAppts[0].count };

      if (BILLING_ROLES.includes(req.user.role)) {
        const [pendingBills] = await pool.query("SELECT COUNT(*) as count FROM bills WHERE payment_status IN ('pending','partial')");
        data.unpaid_bills = pendingBills[0].count;
      }
      if (LAB_ROLES.includes(req.user.role)) {
        let labCountQuery = "SELECT COUNT(*) as count FROM lab_orders WHERE status IN ('ordered','in_progress')";
        const labCountParams = [];
        if (req.user.role === 'doctor') {
          labCountQuery += ' AND doctor_id = ?';
          labCountParams.push(req.user.id);
        }
        const [pendingLab] = await pool.query(labCountQuery, labCountParams);
        data.pending_lab_orders = pendingLab[0].count;
      }
      response = 'Current pending items relevant to your role:';
    }
    // Revenue query
    else if (lowerMsg.includes('revenue') || lowerMsg.includes('income') || lowerMsg.includes('earnings')) {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ response: 'Only administrators can view revenue data.', data: null });
      }
      // Net of refunds and bounded by the hospital's calendar, so the figures
      // here agree with the billing summary and the reports.
      const todayRange = zonedDayRange(zonedDate());
      const monthRange = zonedDayRange(`${zonedDate().slice(0, 7)}-01`);
      const [today] = await pool.query(
        `SELECT COALESCE((SELECT SUM(amount) FROM payments WHERE payment_date >= ? AND payment_date < ?), 0)
                - COALESCE((SELECT SUM(amount) FROM payment_refunds WHERE refund_date >= ? AND refund_date < ?), 0) AS total`,
        [todayRange.start, todayRange.end, todayRange.start, todayRange.end]
      );
      const [month] = await pool.query(
        `SELECT COALESCE((SELECT SUM(amount) FROM payments WHERE payment_date >= ? AND payment_date < ?), 0)
                - COALESCE((SELECT SUM(amount) FROM payment_refunds WHERE refund_date >= ? AND refund_date < ?), 0) AS total`,
        [monthRange.start, todayRange.end, monthRange.start, todayRange.end]
      );
      response = 'Revenue summary:';
      data = {
        today: today[0].total,
        this_month: month[0].total
      };
    }
    // Bed / ward status
    else if (lowerMsg.includes('ward') || lowerMsg.includes('occupancy') || lowerMsg.includes('bed')) {
      if (!OPERATIONS_ROLES.includes(req.user.role)) {
        return res.status(403).json({ response: 'You do not have permission to view ward occupancy.', data: null });
      }
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
      if (!PHARMACY_ROLES.includes(req.user.role)) {
        return res.status(403).json({ response: 'You do not have permission to view detailed pharmacy stock.', data: null });
      }
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
      if (!PHARMACY_ROLES.includes(req.user.role)) {
        return res.status(403).json({ response: 'You do not have permission to view detailed pharmacy stock.', data: null });
      }
      const searchTerm = extractMedicineSearchTerm(message);
      const genericQuery = isGenericInventoryQuery(searchTerm);
      if (!genericQuery) {
        const medicineSearch = containsLike(searchTerm);
        const [med] = await pool.query(
          `SELECT name, generic_name, stock_quantity, min_stock_level, expiry_date, unit
           FROM medicines
           WHERE is_active = 1 AND (name LIKE ? ESCAPE '!' OR generic_name LIKE ? ESCAPE '!')
           LIMIT 5`,
          [medicineSearch, medicineSearch]
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
      if (!MEDICATION_ROLES.includes(req.user.role)) {
        return res.status(403).json({ response: 'You do not have permission to view medication interaction data.', data: null });
      }
      const pairMatch = message.match(/between\s+(.+?)\s+and\s+(.+)/i);
      if (pairMatch) {
        const a = cleanSearchTerm(pairMatch[1]);
        const b = cleanSearchTerm(pairMatch[2]);
        const aLike = containsLike(a);
        const bLike = containsLike(b);
        const [interactions] = await pool.query(
          `SELECT di.severity, di.description, di.clinical_management,
             ma.name as medicine_a, mb.name as medicine_b
           FROM drug_interactions di
           JOIN medicines ma ON di.medicine_a_id = ma.id
           JOIN medicines mb ON di.medicine_b_id = mb.id
           WHERE ((ma.name LIKE ? ESCAPE '!' OR ma.generic_name LIKE ? ESCAPE '!')
             AND (mb.name LIKE ? ESCAPE '!' OR mb.generic_name LIKE ? ESCAPE '!'))
              OR ((mb.name LIKE ? ESCAPE '!' OR mb.generic_name LIKE ? ESCAPE '!')
             AND (ma.name LIKE ? ESCAPE '!' OR ma.generic_name LIKE ? ESCAPE '!'))
           ORDER BY CASE LOWER(di.severity)
             WHEN 'contraindicated' THEN 0
             WHEN 'severe' THEN 1
             WHEN 'moderate' THEN 2
             WHEN 'mild' THEN 3
             ELSE 4
           END, di.id
           LIMIT 5`,
          [aLike, aLike, bLike, bLike, aLike, aLike, bLike, bLike]
        );
        if (interactions.length > 0) {
          const interaction = interactions[0];
          response = `⚠️ Interaction found between **${interaction.medicine_a}** and **${interaction.medicine_b}** (${interaction.severity}):`;
          data = {
            severity: interaction.severity,
            description: interaction.description,
            clinical_management: interaction.clinical_management
          };
        } else {
          response = `No known interaction between "${a}" and "${b}" in the formulary. Always verify with a clinical reference.`;
        }
      } else {
        response = 'Please phrase it like: "interaction between Warfarin and Aspirin".';
      }
    }
    // Patient allergies
    else if (lowerMsg.includes('allergy') || lowerMsg.includes('allergies')) {
      if (!CLINICAL_ROLES.includes(req.user.role)) {
        return res.status(403).json({ response: 'You do not have permission to view allergy profiles.', data: null });
      }
      const nameMatch = message.match(/allerg(?:y|ies)\s*(?:of|for)?\s+(.+)/i);
      const searchName = cleanSearchTerm(nameMatch?.[1]);
      if (tooShortForSearch(searchName)) {
        if (!searchName) {
          response = 'Please include a patient name, e.g. "allergies of Maria Garcia".';
        } else {
          return res.status(400).json({ response: 'Please enter at least 2 characters to search for allergies.', data: null });
        }
      } else {
        const patientSearch = containsLike(searchName);
        const [patients] = await pool.query(
          `SELECT first_name, last_name, mrn, allergies FROM patients
           WHERE first_name LIKE ? ESCAPE '!' OR last_name LIKE ? ESCAPE '!'
              OR first_name || ' ' || last_name LIKE ? ESCAPE '!' OR mrn LIKE ? ESCAPE '!'
           LIMIT 5`,
          [patientSearch, patientSearch, patientSearch, patientSearch]
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
      }
    }
    // Abnormal / critical lab results
    else if (lowerMsg.includes('abnormal') || lowerMsg.includes('critical result') || lowerMsg.includes('critical lab')) {
      if (!LAB_ROLES.includes(req.user.role)) {
        return res.status(403).json({ response: 'You do not have permission to view lab results.', data: null });
      }
      let labWhere = "WHERE li.is_abnormal = TRUE AND lo.status = 'completed'";
      const labParams = [];
      if (req.user.role === 'doctor') {
        labWhere += ' AND lo.doctor_id = ?';
        labParams.push(req.user.id);
      }
      const [rows] = await pool.query(
        `SELECT li.result_value, li.reference_range, li.notes, li.result_date,
           lt.name as test_name, p.first_name, p.last_name, p.mrn
         FROM lab_order_items li
         JOIN lab_tests lt ON li.lab_test_id = lt.id
         JOIN lab_orders lo ON li.lab_order_id = lo.id
         JOIN patients p ON lo.patient_id = p.id
         ${labWhere}
         ORDER BY li.result_date DESC LIMIT 10`,
        labParams
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
      if (!OPERATIONS_ROLES.includes(req.user.role)) {
        return res.status(403).json({ response: 'You do not have permission to view the live hospital overview.', data: null });
      }
      const today = new Date().toISOString().split('T')[0];
      let appointmentsTodayQuery = 'SELECT COUNT(*) as count FROM appointments WHERE appointment_date = ?';
      const appointmentsTodayParams = [today];
      if (req.user.role === 'doctor') {
        appointmentsTodayQuery += ' AND doctor_id = ?';
        appointmentsTodayParams.push(req.user.id);
      }
      const [apptsToday] = await pool.query(appointmentsTodayQuery, appointmentsTodayParams);
      const [waiting] = await pool.query("SELECT COUNT(*) as count FROM checkins WHERE checkin_date = date('now') AND status IN ('waiting','in_consultation')");
      const [admissions] = await pool.query("SELECT COUNT(*) as count FROM admissions WHERE status = 'admitted'");
      const overview = {
        appointments_today: apptsToday[0].count,
        patients_waiting: waiting[0].count,
        inpatients: admissions[0].count
      };
      if (req.user.role === 'admin') {
        const [lowStock] = await pool.query('SELECT COUNT(*) as count FROM medicines WHERE stock_quantity <= min_stock_level AND is_active = TRUE');
        overview.low_stock_items = lowStock[0].count;
      }
      if (BILLING_ROLES.includes(req.user.role)) {
        const [pendingBills] = await pool.query("SELECT COUNT(*) as count FROM bills WHERE payment_status IN ('pending','partial')");
        overview.unpaid_bills = pendingBills[0].count;
      }
      overview.tip = 'Use "forecast" for the next 7 days outlook, or "bed occupancy" for ward detail.';
      response = 'Live hospital overview:';
      data = overview;
    }
    // Predictive forecast
    else if (lowerMsg.includes('forecast') || lowerMsg.includes('predict') || lowerMsg.includes('outlook') || lowerMsg.includes('trend')) {
      if (!OPERATIONS_ROLES.includes(req.user.role)) {
        return res.status(403).json({ response: 'You do not have permission to view operational forecasts.', data: null });
      }
      let historyQuery = `SELECT appointment_date, COUNT(*) as count FROM appointments
        WHERE appointment_date >= date('now', '-42 days') AND appointment_date < date('now')`;
      const historyParams = [];
      if (req.user.role === 'doctor') {
        historyQuery += ' AND doctor_id = ?';
        historyParams.push(req.user.id);
      }
      historyQuery += ' GROUP BY appointment_date';
      const [history] = await pool.query(historyQuery, historyParams);
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
      const forecast = {
        outlook: days.map(d => `${d.day}: ${d.predicted}`),
        peak_day: peak.day,
        peak_date: peak.date,
        beds_in_use: beds[0].count
      };
      let summary = `Plan extra staff for ${peak.day}.`;
      if (req.user.role === 'admin') {
        const [lowStock] = await pool.query('SELECT COUNT(*) as count FROM medicines WHERE stock_quantity <= min_stock_level AND is_active = TRUE');
        forecast.low_stock_items = lowStock[0].count;
        summary += ` Ensure reorders are placed for the ${lowStock[0].count} low-stock items.`;
      }
      response = `Next 7 days forecast — busiest is ${peak.day} (${peak.date}) with ~${peak.predicted} expected visits:`;
      data = forecast;
      data.summary = summary;
    }
    // Help / Default
    else {
      response = helpResponse(req.user.role);
    }

    res.json({ response, data });
  } catch (error) {
    console.error('AI Error:', error);
    res.status(500).json({ response: 'Sorry, I encountered an error processing your request. Please try again.', data: null });
  }
});

module.exports = router;
