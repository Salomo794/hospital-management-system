const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { WARDS: WARD_CAPACITY, wardCapacityOrDefault } = require('../config/wards');

function isoDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split('T')[0];
}

function weekDayName(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short' });
}

// ---- Predictive / Smart Hospital intelligence ----
router.get('/forecast', authenticate, async (req, res) => {
  try {
    const today = isoDate(0);

    // 1) Next 7 day appointment load, predicted from weekday history over last 6 weeks
    const [history] = await pool.query(
      `SELECT appointment_date, COUNT(*) as count FROM appointments
       WHERE appointment_date >= date(?, '-42 days') AND appointment_date < ?
       GROUP BY appointment_date`,
      [today, today]
    );
    const weekdayTotals = {};
    const weekdayCounts = {};
    history.forEach(({ appointment_date, count }) => {
      const wd = weekDayName(appointment_date);
      weekdayTotals[wd] = (weekdayTotals[wd] || 0) + count;
      weekdayCounts[wd] = (weekdayCounts[wd] || 0) + 1;
    });

    const days = [];
    for (let i = 0; i < 7; i++) {
      const date = isoDate(i);
      const wd = weekDayName(date);
      const base = weekdayCounts[wd] ? Math.round(weekdayTotals[wd] / weekdayCounts[wd]) : 2;
      const forecast = Math.max(1, Math.round(base * (0.85 + Math.random() * 0.3)));
      const [scheduled] = await pool.query(
        'SELECT COUNT(*) as count FROM appointments WHERE appointment_date = ?',
        [date]
      );
      days.push({
        date,
        day: wd,
        predicted: forecast,
        scheduled: scheduled[0].count,
        load: Math.min(100, Math.round((Math.max(scheduled[0].count, forecast) / 30) * 100))
      });
    }

    const peak = [...days].sort((a, b) => b.predicted - a.predicted)[0];
    const slack = [...days].sort((a, b) => a.predicted - b.predicted)[0];

    // 2) Bed occupancy forecast (today + trend)
    const [admissions] = await pool.query(
      "SELECT ward, COUNT(*) as occupied FROM admissions WHERE status = 'admitted' GROUP BY ward"
    );
    const byWard = {};
    admissions.forEach(a => { byWard[a.ward] = a.occupied; });
    const allWards = new Set([...Object.keys(WARD_CAPACITY), ...Object.keys(byWard)]);
    const wardRows = [...allWards].map((ward) => {
      const total = WARD_CAPACITY[ward] || 20;
      const occupied = Math.min(byWard[ward] || 0, total);
      return { ward, occupied, total, available: Math.max(total - occupied, 0), pct: Math.round((occupied / total) * 100) };
    });
    const totalBeds = wardRows.reduce((s, w) => s + w.total, 0);
    const totalOccupied = wardRows.reduce((s, w) => s + w.occupied, 0);
    const [discharged7] = await pool.query(
      'SELECT COUNT(*) as count FROM admissions WHERE status = ? AND discharge_date >= date(?, \'-7 days\')',
      ['discharged', today]
    );
    const [admitted7] = await pool.query(
      'SELECT COUNT(*) as count FROM admissions WHERE status = ?',
      ['admitted']
    );
    const bedForecast = {
      occupied: totalOccupied,
      total: totalBeds,
      pct: Math.round((totalOccupied / totalBeds) * 100),
      trend: (admitted7[0].count - discharged7[0].count) > 0 ? 'rising' : 'steady',
      byWard: wardRows
    };

    // 3) Stock forecasting — days of supply + reorder suggestions
    const [stock] = await pool.query(
      `SELECT m.id, m.name, m.generic_name, m.stock_quantity, m.min_stock_level, m.max_stock_level, m.unit, m.cost_price,
         COALESCE(SUM(pi.quantity), 0) as dispensed_30d
       FROM medicines m
       LEFT JOIN prescription_items pi ON pi.medicine_id = m.id AND pi.dispensed = 1 AND pi.dispensed_date >= date('now', '-30 days')
       WHERE m.is_active = TRUE
       GROUP BY m.id ORDER BY m.stock_quantity ASC LIMIT 12`
    );
    const stockForecast = stock.map(s => {
      const dailyConsumption = s.dispensed_30d / 30;
      const daysLeft = dailyConsumption > 0 ? Math.floor(s.stock_quantity / dailyConsumption) : 999;
      const low = s.stock_quantity <= s.min_stock_level;
      return {
        id: s.id,
        name: s.name,
        unit: s.unit,
        stock: s.stock_quantity,
        minimum: s.min_stock_level,
        dispensed30d: s.dispensed_30d,
        daysLeft,
        low,
        suggestedReorder: low ? Math.max(s.max_stock_level - s.stock_quantity, s.min_stock_level) : 0,
        estimatedCost: low ? Math.round((Math.max(s.max_stock_level - s.stock_quantity, s.min_stock_level)) * s.cost_price * 100) / 100 : 0
      };
    });

    // 4) Staffing suggestion based on peak load
    const [doctors] = await pool.query(
      "SELECT COUNT(*) as count FROM users WHERE role = 'doctor' AND is_active = 1"
    );
    const [nurses] = await pool.query(
      "SELECT COUNT(*) as count FROM users WHERE role = 'nurse' AND is_active = 1"
    );
    const avgPredicted = days.reduce((s, d) => s + d.predicted, 0) / days.length;
    const staffing = {
      doctors: doctors[0].count,
      nurses: nurses[0].count,
      suggestedRooms: Math.ceil(avgPredicted / 6),
      suggestion: avgPredicted > 24
        ? `High load expected — consider adding ${Math.ceil((avgPredicted - 24) / 8)} extra clinician shift(s).`
        : avgPredicted > 14
          ? 'Moderate load — regular staffing is sufficient.'
          : 'Low load — excellent opportunity for training, maintenance and preventive outreach.'
    };

    const summary = `Peak day will likely be ${peak.day}, ${peak.date} (≈${peak.predicted} visits). ${slack.day} looks lightest (≈${slack.predicted}).`;

    res.json({
      generated_at: new Date().toISOString(),
      days,
      peak,
      slack,
      summary,
      bedForecast,
      stockForecast,
      lowStockCount: stockForecast.filter(s => s.low).length,
      staffing
    });
  } catch (error) {
    console.error('Forecast error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ---- Unified Command Center (live operational overview) ----
router.get('/command-center', authenticate, async (req, res) => {
  try {
    const today = isoDate(0);
    const now = new Date().toISOString();

    // Waiting queue from kiosk check-ins
    const [queues] = await pool.query(
      `SELECT c.status, COUNT(*) as count FROM checkins c
       WHERE date(c.checkin_time) = ?
       GROUP BY c.status`,
      [today]
    );
    const queueCounts = {};
    queues.forEach(q => { queueCounts[q.status] = q.count; });

    // Department wait list (people checked in but not seen)
    const [waiting] = await pool.query(
      `SELECT c.id, c.checkin_time, c.status, c.purpose,
         p.first_name, p.last_name, p.mrn, p.uuid as patient_uuid, p.id as patient_id
       FROM checkins c JOIN patients p ON c.patient_id = p.id
       WHERE c.status IN ('waiting','in_consultation') AND date(c.checkin_time) = ?
       ORDER BY c.checkin_time ASC LIMIT 30`,
      [today]
    );

    // Today's appointment timeline
    const [timeline] = await pool.query(
      `SELECT a.id, a.appointment_time, a.status, a.type, a.reason,
         p.first_name || ' ' || p.last_name as patient_name, p.mrn,
         u.first_name || ' ' || u.last_name as doctor_name
       FROM appointments a
       JOIN patients p ON a.patient_id = p.id
       JOIN users u ON a.doctor_id = u.id
       WHERE a.appointment_date = ?
       ORDER BY a.appointment_time ASC LIMIT 40`,
      [today]
    );

    // Bed occupancy per ward
    const [admissions] = await pool.query(
      "SELECT ward, COUNT(*) as occupied FROM admissions WHERE status = 'admitted' GROUP BY ward"
    );
    const byWard = {};
    admissions.forEach(a => { byWard[a.ward] = a.occupied; });
    const allWards = new Set([...Object.keys(WARD_CAPACITY), ...Object.keys(byWard)]);
    const beds = [...allWards].map((ward) => {
      const total = WARD_CAPACITY[ward] || 20;
      const occupied = byWard[ward] || 0;
      return { ward, occupied: Math.min(occupied, total), total, available: Math.max(total - occupied, 0), pct: Math.round((Math.min(occupied, total) / total) * 100) };
    });

    // Live alerts
    const [lowStock] = await pool.query(
      "SELECT name, stock_quantity, min_stock_level FROM medicines WHERE stock_quantity <= min_stock_level AND is_active = 1 ORDER BY stock_quantity ASC LIMIT 8"
    );
    const [abnormalLabs] = await pool.query(
      `SELECT li.result_value, lt.name as test_name, p.first_name, p.last_name, p.mrn
       FROM lab_order_items li
       JOIN lab_tests lt ON li.lab_test_id = lt.id
       JOIN lab_orders lo ON li.lab_order_id = lo.id
       JOIN patients p ON lo.patient_id = p.id
       WHERE li.is_abnormal = 1 ORDER BY li.id DESC LIMIT 8`
    );
    const [overdueBills] = await pool.query(
      `SELECT b.id, b.bill_number, b.net_amount, b.paid_amount, b.due_date,
         p.first_name, p.last_name
       FROM bills b JOIN patients p ON b.patient_id = p.id
       WHERE b.payment_status IN ('pending','partial')
       ORDER BY b.due_date ASC LIMIT 8`
    );

    const alerts = [
      ...lowStock.map(m => ({ type: 'warning', icon: 'stock', title: 'Low stock', message: `${m.name} — ${m.stock_quantity} left (min ${m.min_stock_level})` })),
      ...abnormalLabs.map(l => ({ type: 'danger', icon: 'lab', title: 'Abnormal lab', message: `${l.first_name} ${l.last_name}: ${l.test_name} = ${l.result_value || 'n/a'}` })),
      ...overdueBills.map(b => ({ type: 'danger', icon: 'billing', title: 'Unpaid bill', message: `${b.first_name} ${b.last_name} owes $${((b.net_amount - b.paid_amount)).toFixed(2)}` }))
    ].slice(0, 12);

    // Staff on duty today (from scheduling window approximation)
    const [staff] = await pool.query(
      "SELECT role, COUNT(*) as on_duty FROM users WHERE is_active = 1 AND role IN ('doctor','nurse','receptionist','pharmacist','lab_technician') GROUP BY role"
    );

    const statusCounts = {};
    timeline.forEach(t => { statusCounts[t.status] = (statusCounts[t.status] || 0) + 1; });

    res.json({
      server_time: now,
      date: today,
      waiting: waiting,
      queueSummary: { waiting: queueCounts['waiting'] || 0, in_consultation: queueCounts['in_consultation'] || 0, completed: queueCounts['completed'] || 0 },
      timeline,
      appointmentStats: statusCounts,
      beds,
      bedTotal: beds.reduce((s, b) => s + b.total, 0),
      bedOccupied: beds.reduce((s, b) => s + b.occupied, 0),
      alerts,
      lowStockCount: lowStock.length,
      abnormalLabCount: abnormalLabs.length,
      overdueBillCount: overdueBills.length,
      staff
    });
  } catch (error) {
    console.error('Command-center error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;