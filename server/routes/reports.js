const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { WARDS: WARD_CAPACITY, wardCapacityOrDefault } = require('../config/wards');

const CLINICAL_ROLES = ['admin', 'receptionist', 'doctor', 'nurse'];
const BILLING_ROLES = ['admin', 'receptionist'];
const PHARMACY_DASHBOARD_ROLES = ['admin', 'pharmacist'];
const LAB_DASHBOARD_ROLES = ['admin', 'doctor', 'nurse', 'lab_technician'];
const INSIGHT_LAB_ROLES = ['admin', 'doctor', 'nurse'];

// Dashboard stats
router.get('/dashboard', authenticate, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const canViewClinical = CLINICAL_ROLES.includes(req.user.role);
    const canViewRevenue = BILLING_ROLES.includes(req.user.role);
    const canViewPharmacy = PHARMACY_DASHBOARD_ROLES.includes(req.user.role);
    const canViewLab = LAB_DASHBOARD_ROLES.includes(req.user.role);

    const [totalDoctors] = await pool.query("SELECT COUNT(*) as count FROM users WHERE role = 'doctor' AND is_active = 1");
    let totalPatients = [{ count: 0 }];
    let todayAppointments = [{ count: 0 }];
    let pendingAppointments = [{ count: 0 }];
    let recentAppointments = [];
    let recentPatients = [];
    let weeklyStats = [];

    if (canViewClinical) {
      const weekStartDate = new Date(`${today}T00:00:00.000Z`);
      weekStartDate.setUTCDate(weekStartDate.getUTCDate() - 6);
      const weekStart = weekStartDate.toISOString().slice(0, 10);

      let todayQuery = 'SELECT COUNT(*) as count FROM appointments WHERE appointment_date = ?';
      let pendingQuery = "SELECT COUNT(*) as count FROM appointments WHERE status = 'scheduled' AND appointment_date >= ?";
      let recentQuery = `SELECT a.*, p.first_name as patient_first_name, p.last_name as patient_last_name,
          u.first_name as doctor_first_name, u.last_name as doctor_last_name
        FROM appointments a JOIN patients p ON a.patient_id = p.id JOIN users u ON a.doctor_id = u.id
        WHERE a.appointment_date = ?`;
      let weeklyQuery = `SELECT DATE(appointment_date) as date, COUNT(*) as count,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled
        FROM appointments WHERE appointment_date >= ? AND appointment_date <= ?`;
      const todayParams = [today];
      const pendingParams = [today];
      const recentParams = [today];
      const weeklyParams = [weekStart, today];
      if (req.user.role === 'doctor') {
        todayQuery += ' AND doctor_id = ?';
        pendingQuery += ' AND doctor_id = ?';
        recentQuery += ' AND a.doctor_id = ?';
        weeklyQuery += ' AND doctor_id = ?';
        todayParams.push(req.user.id);
        pendingParams.push(req.user.id);
        recentParams.push(req.user.id);
        weeklyParams.push(req.user.id);
      }
      recentQuery += ' ORDER BY a.appointment_time LIMIT 10';
      weeklyQuery += ' GROUP BY DATE(appointment_date) ORDER BY date';

      const [[patientRows], [todayRows], [pendingRows], [recentRows], [weeklyRows], [patientList]] = await Promise.all([
        pool.query("SELECT COUNT(*) as count FROM patients WHERE status = 'active'"),
        pool.query(todayQuery, todayParams),
        pool.query(pendingQuery, pendingParams),
        pool.query(recentQuery, recentParams),
        pool.query(weeklyQuery, weeklyParams),
        pool.query(`SELECT id, mrn, first_name, last_name, phone, status, created_at
          FROM patients ORDER BY created_at DESC LIMIT 5`),
      ]);
      totalPatients = patientRows;
      todayAppointments = todayRows;
      pendingAppointments = pendingRows;
      recentAppointments = recentRows;
      recentPatients = patientList;

      const weeklyByDate = new Map(weeklyRows.map(row => [String(row.date), row]));
      weeklyStats = Array.from({ length: 7 }, (_, index) => {
        const date = new Date(`${today}T00:00:00.000Z`);
        date.setUTCDate(date.getUTCDate() - (6 - index));
        const dateKey = date.toISOString().slice(0, 10);
        const row = weeklyByDate.get(dateKey);
        return {
          date: dateKey,
          count: Number(row?.count || 0),
          completed: Number(row?.completed || 0),
          cancelled: Number(row?.cancelled || 0),
        };
      });
    }

    let todayRevenue = [{ total: 0 }];
    let monthlyRevenue = [{ total: 0 }];
    let pendingBills = [{ count: 0, amount: 0 }];
    if (canViewRevenue) {
      // Revenue is reported net of refunds, so a reversed payment reduces the
      // period it was originally collected in rather than being ignored.
      const [[todayRows], [monthRows], [billRows]] = await Promise.all([
        pool.query(
          `SELECT COALESCE((SELECT SUM(amount) FROM payments WHERE DATE(payment_date) = ?), 0)
                  - COALESCE((SELECT SUM(amount) FROM payment_refunds WHERE DATE(refund_date) = ?), 0) AS total`,
          [today, today]
        ),
        pool.query(
          `SELECT COALESCE((SELECT SUM(amount) FROM payments
                    WHERE CAST(strftime('%m', payment_date) AS INTEGER) = CAST(strftime('%m', 'now') AS INTEGER)
                      AND CAST(strftime('%Y', payment_date) AS INTEGER) = CAST(strftime('%Y', 'now') AS INTEGER)), 0)
                  - COALESCE((SELECT SUM(amount) FROM payment_refunds
                    WHERE CAST(strftime('%m', refund_date) AS INTEGER) = CAST(strftime('%m', 'now') AS INTEGER)
                      AND CAST(strftime('%Y', refund_date) AS INTEGER) = CAST(strftime('%Y', 'now') AS INTEGER)), 0) AS total`
        ),
        pool.query("SELECT COUNT(*) as count, COALESCE(SUM(net_amount - paid_amount), 0) as amount FROM bills WHERE payment_status IN ('pending','partial')"),
      ]);
      todayRevenue = todayRows;
      monthlyRevenue = monthRows;
      pendingBills = billRows;
    }

    let lowStockMeds = [{ count: 0 }];
    if (canViewPharmacy) {
      const [rows] = await pool.query("SELECT COUNT(*) as count FROM medicines WHERE stock_quantity <= min_stock_level AND is_active = 1");
      lowStockMeds = rows;
    }

    let pendingLabOrders = [{ count: 0 }];
    if (canViewLab) {
      let labQuery = "SELECT COUNT(*) as count FROM lab_orders WHERE status IN ('ordered','in_progress')";
      const labParams = [];
      if (req.user.role === 'doctor') {
        labQuery += ' AND doctor_id = ?';
        labParams.push(req.user.id);
      }
      const [rows] = await pool.query(labQuery, labParams);
      pendingLabOrders = rows;
    }

    res.json({
      stats: {
        totalPatients: canViewClinical ? totalPatients[0].count : null,
        totalDoctors: totalDoctors[0].count,
        todayAppointments: canViewClinical ? todayAppointments[0].count : null,
        pendingAppointments: canViewClinical ? pendingAppointments[0].count : null,
        todayRevenue: canViewRevenue ? todayRevenue[0].total : null,
        monthlyRevenue: canViewRevenue ? monthlyRevenue[0].total : null,
        pendingBills: canViewRevenue ? pendingBills[0].count : null,
        pendingBillAmount: canViewRevenue ? pendingBills[0].amount : null,
        lowStockMedications: canViewPharmacy ? lowStockMeds[0].count : null,
        pendingLabOrders: canViewLab ? pendingLabOrders[0].count : null
      },
      recentAppointments,
      recentPatients,
      weeklyStats
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Smart insights - rule-based operational intelligence for the dashboard
router.get('/insights', authenticate, authorize('admin', 'receptionist', 'doctor', 'nurse'), async (req, res) => {
  try {
    const insights = [];
    const today = new Date().toISOString().split('T')[0];
    const canViewOperational = CLINICAL_ROLES.includes(req.user.role);
    const canViewBilling = BILLING_ROLES.includes(req.user.role);
    const canViewLab = INSIGHT_LAB_ROLES.includes(req.user.role);
    const canViewPharmacy = req.user.role === 'admin';

    // Bed occupancy
    if (canViewOperational) {
      const [admissions] = await pool.query(
        "SELECT ward, COUNT(*) as count FROM admissions WHERE status = 'admitted' GROUP BY ward"
      );
      const wardCap = ward => wardCapacityOrDefault(ward);
      const allWards = new Set([...Object.keys(WARD_CAPACITY), ...admissions.map(a => a.ward)]);
      const totalBeds = [...allWards].reduce((sum, ward) => sum + wardCap(ward), 0);
      const occupiedBeds = admissions.reduce((sum, admission) => sum + Math.min(admission.count, wardCap(admission.ward)), 0);
      const occupancyPct = totalBeds ? Math.round((occupiedBeds / totalBeds) * 100) : 0;
      if (occupancyPct >= 85) {
        insights.push({
          severity: 'danger',
          icon: '🏥',
          title: 'Hospital at high occupancy',
          message: `Bed occupancy is at ${occupancyPct}% (${occupiedBeds}/${totalBeds}). Consider managing elective admissions or preparing surge capacity.`,
          link: '/ward'
        });
      } else if (occupancyPct >= 60) {
        insights.push({
          severity: 'warning',
          icon: '🏥',
          title: 'Bed occupancy rising',
          message: `Occupancy is at ${occupancyPct}% (${occupiedBeds}/${totalBeds}). Review ward capacity in the ward dashboard.`,
          link: '/ward'
        });
      } else {
        insights.push({
          severity: 'success',
          icon: '🏥',
          title: 'Bed availability is healthy',
          message: `Occupancy is at ${occupancyPct}% with ${totalBeds - occupiedBeds} of ${totalBeds} beds available.`,
          link: '/ward'
        });
      }

      if (admissions.length) {
        const pressured = admissions
          .filter(admission => WARD_CAPACITY[admission.ward])
          .map(admission => ({
            ward: admission.ward,
            pct: Math.round((Math.min(admission.count, WARD_CAPACITY[admission.ward]) / WARD_CAPACITY[admission.ward]) * 100),
          }))
          .sort((a, b) => b.pct - a.pct)[0];
        if (pressured && pressured.pct >= 80) {
          insights.push({
            severity: 'warning',
            icon: '🚨',
            title: `${pressured.ward} ward near full`,
            message: `${pressured.ward} is at ${pressured.pct}% capacity. Check bed assignments immediately.`,
            link: '/ward'
          });
        }
      }
    }

    // Pharmacy inventory
    if (canViewPharmacy) {
      const [[expiring], [lowStock]] = await Promise.all([
        pool.query("SELECT COUNT(*) as count FROM medicines WHERE expiry_date >= date('now') AND expiry_date <= date('now', '+30 days') AND is_active = 1"),
        pool.query("SELECT COUNT(*) as count FROM medicines WHERE stock_quantity <= min_stock_level AND is_active = 1"),
      ]);
      if (expiring[0].count > 0) {
        insights.push({
          severity: 'warning',
          icon: '⏳',
          title: 'Medicines expiring within 30 days',
          message: `${expiring[0].count} medicine(s) expire within the next month. Plan restocking or rotation.`,
          link: '/pharmacy'
        });
      }
      if (lowStock[0].count > 0) {
        insights.push({
          severity: lowStock[0].count > 3 ? 'danger' : 'warning',
          icon: '⚠️',
          title: 'Medicines below minimum stock',
          message: `${lowStock[0].count} medicine(s) are at or below their minimum stock level and need reordering.`,
          link: '/pharmacy'
        });
      }
    }

    // No-show risk (patients with cancellations and an upcoming appointment)
    if (canViewOperational) {
      let noShowQuery = `SELECT COUNT(DISTINCT p.id) as count
        FROM patients p
        WHERE EXISTS (
          SELECT 1 FROM appointments c
          WHERE c.patient_id = p.id AND c.status = 'cancelled' AND c.appointment_date >= date('now', '-90 days')`;
      const noShowParams = [];
      if (req.user.role === 'doctor') {
        noShowQuery += ' AND c.doctor_id = ?';
        noShowParams.push(req.user.id);
      }
      noShowQuery += `)
        AND EXISTS (
          SELECT 1 FROM appointments a
          WHERE a.patient_id = p.id AND a.status = 'scheduled' AND a.appointment_date >= date('now')`;
      if (req.user.role === 'doctor') {
        noShowQuery += ' AND a.doctor_id = ?';
        noShowParams.push(req.user.id);
      }
      noShowQuery += ')';
      const [noShowRisk] = await pool.query(noShowQuery, noShowParams);
      if (noShowRisk[0].count > 0) {
        insights.push({
          severity: 'info',
          icon: '📅',
          title: 'Patients at no-show risk',
          message: `${noShowRisk[0].count} patient(s) have recent cancellations and an upcoming appointment. Consider sending reminders to reduce no-shows.`,
          link: '/appointments'
        });
      }
    }

    // Billing
    if (canViewBilling) {
      const [pendingBills] = await pool.query(
        "SELECT COUNT(*) as count, COALESCE(SUM(net_amount - paid_amount), 0) as amount FROM bills WHERE payment_status IN ('pending','partial')"
      );
      if (pendingBills[0].count > 0) {
        insights.push({
          severity: 'warning',
          icon: '💰',
          title: 'Unpaid bills outstanding',
          message: `${pendingBills[0].count} bill(s) totaling ${pendingBills[0].amount.toLocaleString()} currency units are pending or partially paid.`,
          link: '/billing'
        });
      }
    }

    // Laboratory
    if (canViewLab) {
      let labQuery = "SELECT COUNT(*) as count FROM lab_orders WHERE status IN ('ordered','in_progress')";
      const labParams = [];
      if (req.user.role === 'doctor') {
        labQuery += ' AND doctor_id = ?';
        labParams.push(req.user.id);
      }
      const [pendingLab] = await pool.query(labQuery, labParams);
      if (pendingLab[0].count > 0) {
        insights.push({
          severity: 'info',
          icon: '🧪',
          title: 'Lab orders awaiting results',
          message: `${pendingLab[0].count} lab orders are in progress and await result entry.`,
          link: '/laboratory'
        });
      }
    }

    // Revenue pulse (today vs yesterday)
    if (canViewBilling) {
      const [[todayRev], [yesterdayRev]] = await Promise.all([
        pool.query(
          `SELECT COALESCE((SELECT SUM(amount) FROM payments WHERE DATE(payment_date) = ?), 0)
                  - COALESCE((SELECT SUM(amount) FROM payment_refunds WHERE DATE(refund_date) = ?), 0) AS total`,
          [today, today]
        ),
        pool.query(
          `SELECT COALESCE((SELECT SUM(amount) FROM payments WHERE DATE(payment_date) = date('now', '-1 day')), 0)
                  - COALESCE((SELECT SUM(amount) FROM payment_refunds WHERE DATE(refund_date) = date('now', '-1 day')), 0) AS total`
        ),
      ]);
      const delta = yesterdayRev[0].total > 0
        ? Math.round(((todayRev[0].total - yesterdayRev[0].total) / yesterdayRev[0].total) * 100)
        : null;
      if (delta !== null) {
        insights.push({
          severity: delta < 0 ? 'warning' : 'success',
          icon: '📈',
          title: delta < 0 ? 'Revenue below yesterday' : 'Revenue tracking above yesterday',
          message: `Today's collections are ${delta < 0 ? delta * -1 : delta}% ${delta < 0 ? 'below' : 'above'} yesterday${delta < 0 ? ` (gap of ${(yesterdayRev[0].total - todayRev[0].total).toLocaleString()} units)` : ''}.`,
          link: '/reports'
        });
      }
    }

    res.json({ insights, generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Financial reports
router.get('/financial', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { period = 'monthly', year = new Date().getFullYear() } = req.query;
    const reportYear = Number(year);
    if (!Number.isInteger(reportYear) || reportYear < 2000 || reportYear > 2100) {
      return res.status(400).json({ message: 'year must be an integer between 2000 and 2100' });
    }
    let groupBy, dateFormat;
    if (period === 'daily') {
      groupBy = 'DATE(payment_date)';
      dateFormat = '%Y-%m-%d';
    } else if (period === 'weekly') {
      groupBy = "strftime('%Y%W', payment_date)";
      dateFormat = '%x-W%v';
    } else {
      groupBy = "strftime('%Y-%m', payment_date)";
      dateFormat = '%Y-%m';
    }
    const expenseGroupBy = groupBy.replace(/payment_date/g, 'it.created_at');
    // Payments and refunds are unioned into one signed cash stream so a refund
    // nets off the period the money was originally collected in.
    const cashGroupBy = groupBy.replace(/payment_date/g, 'event_date');
    const [revenue] = await pool.query(
      `SELECT ${cashGroupBy} as period, SUM(movement) as revenue, payment_method,
        SUM(direction) as transaction_count
        FROM (
          SELECT payment_date AS event_date, payment_method, amount AS movement, 1 AS direction
            FROM payments
          UNION ALL
          SELECT refund_date AS event_date, payment_method, -amount AS movement, -1 AS direction
            FROM payment_refunds
        )
        WHERE CAST(strftime('%Y', event_date) AS INTEGER) = ?
        GROUP BY ${cashGroupBy}, payment_method ORDER BY period`,
      [reportYear]
    );
    const [expenses] = await pool.query(
      `SELECT ${expenseGroupBy} as period, SUM(it.quantity * m.cost_price) as expenses, category
        FROM inventory_transactions it JOIN medicines m ON it.medicine_id = m.id
        WHERE it.transaction_type = 'purchase' AND CAST(strftime('%Y', it.created_at) AS INTEGER) = ?
        GROUP BY ${expenseGroupBy}, category ORDER BY period`,
      [reportYear]
    );
    const [topServices] = await pool.query(
      `SELECT bi.category,
              ROUND(SUM(
                bi.total * CASE
                  WHEN b.net_amount <= 0 THEN 0
                  ELSE MIN(1.0, MAX(0.0, b.paid_amount / b.net_amount))
                END
              ), 2) AS collected_revenue,
              COUNT(*) AS count
       FROM bill_items bi JOIN bills b ON bi.bill_id = b.id
       WHERE CAST(strftime('%Y', b.created_at) AS INTEGER) = ?
       GROUP BY bi.category ORDER BY collected_revenue DESC`,
      [reportYear]
    );
    res.json({ revenue, expenses, topServices });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Patient statistics
router.get('/patients', authenticate, authorize('admin', 'receptionist', 'doctor', 'nurse'), async (req, res) => {
  try {
    const [byGender] = await pool.query('SELECT gender, COUNT(*) as count FROM patients GROUP BY gender');
    const [byAge] = await pool.query(
      `WITH patient_ages AS (
        SELECT CAST(strftime('%Y', 'now') AS INTEGER) - CAST(strftime('%Y', date_of_birth) AS INTEGER)
          - CASE WHEN strftime('%m-%d', 'now') < strftime('%m-%d', date_of_birth) THEN 1 ELSE 0 END AS age
        FROM patients
      )
      SELECT CASE
        WHEN age < 18 THEN 'Under 18'
        WHEN age <= 35 THEN '18-35'
        WHEN age <= 55 THEN '36-55'
        WHEN age <= 75 THEN '56-75'
        ELSE '75+'
      END AS age_group, COUNT(*) AS count
      FROM patient_ages GROUP BY age_group ORDER BY age_group`
    );
    const [byBloodType] = await pool.query('SELECT blood_type, COUNT(*) as count FROM patients WHERE blood_type IS NOT NULL GROUP BY blood_type');
    const [monthlyAdmissions] = await pool.query(
      `SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as count
        FROM patients GROUP BY month ORDER BY month DESC LIMIT 12`
    );
    const [topDiagnoses] = await pool.query(
      `SELECT diagnosis, COUNT(*) as count FROM medical_records
        WHERE diagnosis IS NOT NULL GROUP BY diagnosis ORDER BY count DESC LIMIT 10`
    );
    res.json({ byGender, byAge, byBloodType, monthlyAdmissions, topDiagnoses });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
