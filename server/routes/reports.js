const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

// Dashboard stats
router.get('/dashboard', authenticate, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const [totalPatients] = await pool.query("SELECT COUNT(*) as count FROM patients WHERE status = 'active'");
    const [totalDoctors] = await pool.query("SELECT COUNT(*) as count FROM users WHERE role = 'doctor' AND is_active = TRUE");
    const [todayAppointments] = await pool.query('SELECT COUNT(*) as count FROM appointments WHERE appointment_date = ?', [today]);
    const [pendingAppointments] = await pool.query("SELECT COUNT(*) as count FROM appointments WHERE status = 'scheduled' AND appointment_date >= ?", [today]);
    const [todayRevenue] = await pool.query("SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE DATE(payment_date) = ?", [today]);
    const [monthlyRevenue] = await pool.query(
      "SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE CAST(strftime('%m', payment_date) AS INTEGER) = CAST(strftime('%m', 'now') AS INTEGER) AND CAST(strftime('%Y', payment_date) AS INTEGER) = CAST(strftime('%Y', 'now') AS INTEGER)"
    );
    const [pendingBills] = await pool.query("SELECT COUNT(*) as count, COALESCE(SUM(net_amount - paid_amount), 0) as amount FROM bills WHERE payment_status IN ('pending','partial')");
    const [lowStockMeds] = await pool.query("SELECT COUNT(*) as count FROM medicines WHERE stock_quantity <= min_stock_level AND is_active = TRUE");
    const [pendingLabOrders] = await pool.query("SELECT COUNT(*) as count FROM lab_orders WHERE status IN ('ordered','in_progress')");
    const [recentAppointments] = await pool.query(
      `SELECT a.*, p.first_name as patient_first_name, p.last_name as patient_last_name,
        u.first_name as doctor_first_name, u.last_name as doctor_last_name
        FROM appointments a JOIN patients p ON a.patient_id = p.id JOIN users u ON a.doctor_id = u.id
        WHERE a.appointment_date >= ? ORDER BY a.appointment_date, a.appointment_time LIMIT 10`, [today]
    );
    const [recentPatients] = await pool.query(
      'SELECT * FROM patients ORDER BY created_at DESC LIMIT 5'
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
        totalPatients: totalPatients[0].count,
        totalDoctors: totalDoctors[0].count,
        todayAppointments: todayAppointments[0].count,
        pendingAppointments: pendingAppointments[0].count,
        todayRevenue: todayRevenue[0].total,
        monthlyRevenue: monthlyRevenue[0].total,
        pendingBills: pendingBills[0].count,
        pendingBillAmount: pendingBills[0].amount,
        lowStockMedications: lowStockMeds[0].count,
        pendingLabOrders: pendingLabOrders[0].count
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

// Financial reports
router.get('/financial', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { period = 'monthly', year = new Date().getFullYear() } = req.query;
    let groupBy, dateFormat, expenseGroupBy;
    if (period === 'daily') {
      groupBy = 'DATE(payment_date)';
      expenseGroupBy = 'DATE(it.created_at)';
      dateFormat = '%Y-%m-%d';
    } else if (period === 'weekly') {
      groupBy = "strftime('%Y%W', payment_date)";
      expenseGroupBy = "strftime('%Y%W', it.created_at)";
      dateFormat = '%x-W%v';
    } else {
      groupBy = "strftime('%Y-%m', payment_date)";
      expenseGroupBy = "strftime('%Y-%m', it.created_at)";
      dateFormat = '%Y-%m';
    }
    const [revenue] = await pool.query(
      `SELECT ${groupBy} as period, SUM(amount) as revenue, payment_method,
        COUNT(*) as transaction_count
        FROM payments WHERE CAST(strftime('%Y', payment_date) AS INTEGER) = ?
        GROUP BY ${groupBy}, payment_method ORDER BY period`,
      [year]
    );

    const [expenses] = await pool.query(
      `SELECT ${expenseGroupBy} as period, SUM(it.quantity * m.cost_price) as expenses, m.category
        FROM inventory_transactions it JOIN medicines m ON it.medicine_id = m.id
        WHERE it.transaction_type = 'purchase' AND CAST(strftime('%Y', it.created_at) AS INTEGER) = ?
        GROUP BY ${expenseGroupBy}, m.category ORDER BY period`,
      [year]
    );
    const [topServices] = await pool.query(
      `SELECT category, SUM(total) as total_revenue, COUNT(*) as count
        FROM bill_items bi JOIN bills b ON bi.bill_id = b.id
        WHERE CAST(strftime('%Y', b.created_at) AS INTEGER) = ?
        GROUP BY category ORDER BY total_revenue DESC`,
      [year]
    );
    res.json({ revenue, expenses, topServices });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Patient statistics
router.get('/patients', authenticate, async (req, res) => {
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
