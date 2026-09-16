// Automated alerting service.
// Periodically scans the database and creates in-app notifications for:
//  - Pharmacy stock below minimum threshold
//  - Medicines expiring within 30 days or already expired
//  - Overdue bills (past due_date, not fully paid)
// Started from index.js via startAutoAlerts(). Safe to run repeatedly;
// alerts are de-duplicated per day using the notifications table.

const pool = require('../config/database');

const INTERVAL_MS = Number(process.env.ALERT_INTERVAL_MS) || 30 * 60 * 1000; // every 30 min

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function alreadySent(userId, type, ref) {
  const [rows] = await pool.query(
    'SELECT id FROM notifications WHERE user_id = ? AND type = ? AND message LIKE ? AND created_at >= date("now") LIMIT 1',
    [userId, type, `%${ref}%`]
  );
  return rows.length > 0;
}

async function notify(userId, type, title, message, link) {
  if (await alreadySent(userId, type, message)) return;
  await pool.query(
    'INSERT INTO notifications (user_id, type, title, message, link) VALUES (?, ?, ?, ?, ?)',
    [userId, type, title, message, link]
  );
}

async function runAlerts() {
  try {
    const day = todayKey();

    // 1. Low stock alerts to admins + pharmacists
    const [lowStock] = await pool.query(
      `SELECT id, name, stock_quantity, min_stock_level FROM medicines
       WHERE stock_quantity <= min_stock_level AND is_active = TRUE`
    );

    // 2. Expiring / expired medicines
    const [expiring] = await pool.query(
      `SELECT id, name, expiry_date FROM medicines
       WHERE expiry_date IS NOT NULL AND expiry_date <= date('now', '+30 days') AND is_active = TRUE`
    );

    const [staff] = await pool.query(
      "SELECT id FROM users WHERE role IN ('admin','pharmacist') AND is_active = TRUE"
    );

    for (const s of staff) {
      for (const m of lowStock) {
        await notify(s.id, 'stock', 'Low Stock Alert', `${m.name}: ${m.stock_quantity} left (min ${m.min_stock_level})`, '/pharmacy');
      }
      for (const m of expiring) {
        const status = m.expiry_date < day ? 'EXPIRED' : 'Expires soon';
        await notify(s.id, 'stock', `${status} Alert`, `${m.name} (batch expiry ${m.expiry_date})`, '/pharmacy');
      }
    }

    // 3. Overdue bills to admin + receptionists
    const [overdue] = await pool.query(
      `SELECT b.id, b.bill_number, b.net_amount, b.paid_amount, b.due_date, p.first_name, p.last_name
       FROM bills b JOIN patients p ON b.patient_id = p.id
       WHERE b.due_date IS NOT NULL AND b.due_date < date('now') AND b.payment_status IN ('pending','partial')`
    );

    const [billingStaff] = await pool.query(
      "SELECT id FROM users WHERE role IN ('admin','receptionist') AND is_active = TRUE"
    );

    for (const s of billingStaff) {
      for (const b of overdue) {
        const due = parseFloat(b.net_amount) - parseFloat(b.paid_amount);
        await notify(s.id, 'billing', 'Overdue Bill', `Bill ${b.bill_number} for ${b.first_name} ${b.last_name} is overdue (${due.toFixed(2)} due)`, `/billing/${b.id}`);
      }
    }

    console.log(`[auto-alerts] ${new Date().toISOString()} processed ${lowStock.length} low-stock, ${expiring.length} expiring, ${overdue.length} overdue items`);
  } catch (error) {
    console.error('[auto-alerts] error:', error.message);
  }
}

function startAutoAlerts() {
  runAlerts();
  const timer = setInterval(runAlerts, INTERVAL_MS);
  timer.unref();
  console.log(`[auto-alerts] scheduled every ${Math.round(INTERVAL_MS / 60000)} minutes`);
  return timer;
}

module.exports = { startAutoAlerts };