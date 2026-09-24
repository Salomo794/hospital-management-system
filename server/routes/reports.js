const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { WARDS: WARD_CAPACITY, wardCapacityOrDefault } = require('../config/wards');

// Dashboard stats
router.get('/dashboard', authenticate, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const canViewClinical = ['admin', 'receptionist', 'doctor', 'nurse'].includes(req.user.role);
    const canViewRevenue = ['admin', 'receptionist'].includes(req.user.role);
    const [totalPatients] = await pool.query("SELECT COUNT(*) as count FROM patients WHERE status = 'active'");
    const [totalDoctors] = await pool.query("SELECT COUNT(*) as count FROM users WHERE role = 'doctor' AND is_active = 1");
    const [todayAppointments] = await pool.query('SELECT COUNT(*) as count FROM appointments WHERE appointment_date = ?', [today]);
    const [pendingAppointments] = await pool.query("SELECT COUNT(*) as count FROM appointments WHERE status = 'scheduled' AND appointment_date >= ?", [today]);
    const [todayRevenue] = await pool.query("SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE DATE(payment_date) = ?", [today]);
    const [monthlyRevenue] = await pool.query(
      "SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE CAST(strftime('%m', payment_date) AS INTEGER) = CAST(strftime('%m', 'now') AS INTEGER) AND CAST(strftime('%Y', payment_date) AS INTEGER) = CAST(strftime('%Y', 'now') AS INTEGER)"
    );
    const [pendingBills] = await pool.query("SELECT COUNT(*) as count, COALESCE(SUM(net_amount - paid_amount), 0) as amount FROM bills WHERE payment_status IN ('pending','partial')");
    const [lowStockMeds] = await pool.query("SELECT COUNT(*) as count FROM medicines WHERE stock_quantity <= min_stock_level AND is_active = 1");
    const [pendingLabOrders] = await pool.query("SELECT COUNT(*) as count FROM lab_orders WHERE status IN ('ordered','in_progress')");
    const [recentAppointments] = await pool.query(
      `SELECT a.*, p.first_name as patient_first_name, p.last_name as patient_last_name,
        u.first_name as doctor_first_name, u.last_name as doctor_last_name
        FROM appointments a JOIN patients p ON a.patient_id = p.id JOIN users u ON a.doctor_id = u.id
        WHERE a.appointment_date = ? ORDER BY a.appointment_time LIMIT 10`, [today]
    );
    const [recentPatients] = await pool.query(
      `SELECT id, mrn, first_name, last_name, phone, status, created_at
       FROM patients ORDER BY created_at DESC LIMIT 5`
    );
    // Weekly appointment stats
    const [weeklyStats] = await pool.query(
      `SELECT DATE(appointment_date) as date, COUNT(*) as count,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled
        FROM appointments WHERE appointment_date >= date('now', '-7 days')
        GROUP BY DATE(appointment_date) ORDER BY date`
    );
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
        lowStockMedications: lowStockMeds[0].count,
        pendingLabOrders: pendingLabOrders[0].count
      },
      recentAppointments: canViewClinical ? recentAppointments : [],
      recentPatients: canViewClinical ? recentPatients : [],
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

    // 1. Bed occupancy
    const [admissions] = await pool.query(
      "SELECT ward, COUNT(*) as count FROM admissions WHERE status = 'admitted' GROUP BY ward"
    );
    const wardCap = ward => WARD_CAPACITY[ward] || 20;
    const allWards = new Set([...Object.keys(WARD_CAPACITY), ...admissions.map(a => a.ward)]);
    const totalBeds = [...allWards].reduce((s, w) => s + wardCap(w), 0);
    const occupiedBeds = admissions.reduce((s, a) => s + Math.min(a.count, wardCap(a.ward)), 0);
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

    // Highest-pressure ward
    if (admissions.length) {
      const pressured = admissions
        .filter(a => WARD_CAPACITY[a.ward])
        .map(a => ({ ward: a.ward, pct: Math.round((Math.min(a.count, WARD_CAPACITY[a.ward]) / WARD_CAPACITY[a.ward]) * 100) }))
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

    // 2. Medicines expiring soon
    const [expiring] = await pool.query(
      "SELECT COUNT(*) as count FROM medicines WHERE expiry_date >= date('now') AND expiry_date <= date('now', '+30 days') AND is_active = 1"
    );
    if (expiring[0].count > 0) {
      insights.push({
        severity: 'warning',
        icon: '⏳',
        title: 'Medicines expiring within 30 days',
        message: `${expiring[0].count} medicine(s) expire within the next month. Plan restocking or rotation.`,
        link: '/pharmacy'
      });
    }

    // 3. Low stock
    const [lowStock] = await pool.query(
      "SELECT COUNT(*) as count FROM medicines WHERE stock_quantity <= min_stock_level AND is_active = 1"
    );
    if (lowStock[0].count > 0) {
      insights.push({
        severity: lowStock[0].count > 3 ? 'danger' : 'warning',
        icon: '⚠️',
        title: 'Medicines below minimum stock',
        message: `${lowStock[0].count} medicine(s) are at or below their minimum stock level and need reordering.`,
        link: '/pharmacy'
      });
    }

    // 4. No-show risk (patients with cancellations + upcoming appointment)
    const [noShowRisk] = await pool.query(`
      SELECT COUNT(DISTINCT p.id) as count
      FROM patients p
      WHERE EXISTS (
        SELECT 1 FROM appointments c
        WHERE c.patient_id = p.id AND c.status = 'cancelled' AND c.appointment_date >= date('now', '-90 days')
      )
      AND EXISTS (
        SELECT 1 FROM appointments a
        WHERE a.patient_id = p.id AND a.status = 'scheduled' AND a.appointment_date >= date('now')
      )`);
    if (noShowRisk[0].count > 0) {
      insights.push({
        severity: 'info',
        icon: '📅',
        title: 'Patients at no-show risk',
        message: `${noShowRisk[0].count} patient(s) have recent cancellations and an upcoming appointment. Consider sending reminders to reduce no-shows.`,
        link: '/appointments'
      });
    }

    // 5. Overdue / pending bills
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

    // 6. Pending lab orders
    const [pendingLab] = await pool.query(
      "SELECT COUNT(*) as count FROM lab_orders WHERE status IN ('ordered','in_progress')"
    );
    if (pendingLab[0].count > 0) {
      insights.push({
        severity: 'info',
        icon: '🧪',
        title: 'Lab orders awaiting results',
        message: `${pendingLab[0].count} lab orders are in progress and await result entry.`,
        link: '/laboratory'
      });
    }

    // 7. Revenue pulse (today vs yesterday)
    const [todayRev] = await pool.query(
      "SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE DATE(payment_date) = ?", [today]
    );
    const [yesterdayRev] = await pool.query(
      "SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE DATE(payment_date) = date('now', '-1 day')"
    );
    const delta = yesterdayRev[0].total > 0 ? Math.round(((todayRev[0].total - yesterdayRev[0].total) / yesterdayRev[0].total) * 100) : null;
    if (delta !== null) {
      insights.push({
        severity: delta < 0 ? 'warning' : 'success',
        icon: '📈',
        title: delta < 0 ? 'Revenue below yesterday' : 'Revenue tracking above yesterday',
        message: `Today's collections are ${delta < 0 ? delta * -1 : delta}% ${delta < 0 ? 'below' : 'above'} yesterday${delta < 0 ? ` (gap of ${(yesterdayRev[0].total - todayRev[0].total).toLocaleString()} units)` : ''}.`,
        link: '/reports'
      });
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
    const [revenue] = await pool.query(
      `SELECT ${groupBy} as period, SUM(amount) as revenue, payment_method,
        COUNT(*) as transaction_count
        FROM payments WHERE CAST(strftime('%Y', payment_date) AS INTEGER) = ?
        GROUP BY ${groupBy}, payment_method ORDER BY period`,
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
      `SELECT CASE
        WHEN (julianday('now') - julianday(date_of_birth)) / 365.25 < 18 THEN 'Under 18'
        WHEN (julianday('now') - julianday(date_of_birth)) / 365.25 BETWEEN 18 AND 35 THEN '18-35'
        WHEN (julianday('now') - julianday(date_of_birth)) / 365.25 BETWEEN 36 AND 55 THEN '36-55'
        WHEN (julianday('now') - julianday(date_of_birth)) / 365.25 BETWEEN 56 AND 75 THEN '56-75'
        ELSE '75+'
      END as age_group, COUNT(*) as count FROM patients GROUP BY age_group ORDER BY age_group`
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
