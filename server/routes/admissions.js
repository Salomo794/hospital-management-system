const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { WARDS, wardCapacity, wardCapacityOrDefault } = require('../config/wards');

const pad = n => String(n).padStart(2, '0');

// Returns null when no bed was supplied, or undefined when the supplied value
// is not a valid bed for the selected ward.
function parseBedNumber(value, total) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const text = String(value).trim();
  if (!/^\d{1,2}$/.test(text)) return undefined;
  const number = Number(text);
  if (!Number.isInteger(number) || number < 1 || number > total) return undefined;
  return pad(number);
}

// Helper: resolve a free bed number inside a ward, honoring existing occupied beds.
// Accepts either a pool or a connection object — both expose .query().
async function findFreeBed(conn, ward) {
  const total = wardCapacityOrDefault(ward);
  const [rows] = await conn.query(
    "SELECT bed_number FROM admissions WHERE ward = ? AND status = 'admitted' ORDER BY bed_number",
    [ward]
  );
  const used = new Set(rows.map(r => r.bed_number));
  for (let i = 1; i <= total; i++) {
    const bed = pad(i);
    if (!used.has(bed)) return bed;
  }
  return null;
}

// List admissions (filters: status, ward, search)
router.get('/', authenticate, async (req, res) => {
  try {
    const { status, ward, search, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;
    const params = [];
    let where = 'WHERE 1=1';
    if (status) { where += ' AND a.status = ?'; params.push(status); }
    if (ward) { where += ' AND a.ward = ?'; params.push(ward); }
    if (search) {
      where += ' AND (p.first_name LIKE ? OR p.last_name LIKE ? OR p.mrn LIKE ? OR a.admission_number LIKE ? OR a.bed_number LIKE ?)';
      const like = `%${search}%`;
      params.push(like, like, like, like, like);
    }
    const [countRes] = await pool.query(
      `SELECT COUNT(*) as total FROM admissions a
       JOIN patients p ON a.patient_id = p.id
       JOIN users u ON a.doctor_id = u.id
       ${where}`,
      params
    );
    const [rows] = await pool.query(
      `SELECT a.*, p.first_name as patient_first_name, p.last_name as patient_last_name,
        p.mrn, u.first_name as doctor_first_name, u.last_name as doctor_last_name
       FROM admissions a
       JOIN patients p ON a.patient_id = p.id
       JOIN users u ON a.doctor_id = u.id
       ${where} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), parseInt(offset)]
    );
    res.json({
      admissions: rows,
      total: countRes[0].total,
      page: parseInt(page),
      limit: parseInt(limit)
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Ward occupancy overview (live bed tracking)
router.get('/wards', authenticate, async (req, res) => {
  try {
    const [admitted] = await pool.query(
      "SELECT ward, bed_number, patient_id, diagnosis FROM admissions WHERE status = 'admitted'"
    );
    const occupiedByWard = {};
    admitted.forEach(a => {
      if (!occupiedByWard[a.ward]) occupiedByWard[a.ward] = [];
      occupiedByWard[a.ward].push(a);
    });

    // Combine configured wards with any ward discovered in live data
    const wardTotals = {};
    [...Object.keys(WARDS), ...Object.keys(occupiedByWard)].forEach(w => {
      wardTotals[w] = wardCapacityOrDefault(w);
    });

    const wards = Object.entries(wardTotals).map(([ward, total]) => {
      const occupied = occupiedByWard[ward] ? occupiedByWard[ward].length : 0;
      const beds = [];
      for (let i = 1; i <= Math.min(total, 40); i++) {
        const bed = pad(i);
        const adm = (occupiedByWard[ward] || []).find(a => a.bed_number === bed);
        beds.push(adm
          ? { bed, status: 'occupied', admissionId: adm.id, patientId: adm.patient_id, diagnosis: adm.diagnosis }
          : { bed, status: 'available' });
      }
      return { ward, total, occupied, available: total - occupied, percentage: Math.round((occupied / total) * 100), beds };
    });

    const totalBeds = wards.reduce((s, w) => s + w.total, 0);
    const totalOccupied = wards.reduce((s, w) => s + w.occupied, 0);

    res.json({
      wards,
      totals: {
        totalBeds,
        totalOccupied,
        totalAvailable: totalBeds - totalOccupied,
        percentage: totalBeds ? Math.round((totalOccupied / totalBeds) * 100) : 0
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Admit a patient (auto-assigns bed if not provided)
router.post('/', authenticate, authorize('admin', 'doctor', 'nurse', 'receptionist'), async (req, res) => {
  try {
    const { patient_id, doctor_id, ward, bed_number, diagnosis, treatment_plan, notes } = req.body;
    if (!patient_id || !doctor_id || !ward) {
      return res.status(400).json({ message: 'patient_id, doctor_id and ward are required' });
    }
    // FIX: use WARDS directly so unknown wards are properly rejected
    if (WARDS[ward] === undefined) {
      return res.status(400).json({ message: `Unknown ward "${ward}". Valid wards: ${Object.keys(WARDS).join(', ')}` });
    }

    const conn = await pool.getConnection();
    let transactionOpen = false;
    try {
      await conn.beginTransaction();
      transactionOpen = true;

      const [activeInWard] = await conn.query(
        "SELECT COUNT(*) as count FROM admissions WHERE ward = ? AND status = 'admitted'",
        [ward]
      );
      const capacity = wardCapacity(ward);
      if (activeInWard[0].count >= capacity) {
        await conn.rollback(); transactionOpen = false;
        return res.status(409).json({ message: `${ward} ward is full (${capacity}/${capacity} beds).` });
      }

      const requestedBed = parseBedNumber(bed_number, capacity);
      if (requestedBed === undefined) {
        await conn.rollback(); transactionOpen = false;
        return res.status(400).json({ message: `Bed must be a number from 01 to ${pad(capacity)}.` });
      }
      if (requestedBed) {
        const [occupied] = await conn.query(
          "SELECT id FROM admissions WHERE ward = ? AND bed_number = ? AND status = 'admitted'",
          [ward, requestedBed]
        );
        if (occupied.length > 0) {
          await conn.rollback(); transactionOpen = false;
          return res.status(409).json({ message: `Bed ${requestedBed} in ${ward} is already occupied.` });
        }
      }

      // Pass conn (not pool) so findFreeBed sees the same connection context.
      const freeBed = requestedBed || await findFreeBed(conn, ward);
      if (!freeBed) {
        await conn.rollback(); transactionOpen = false;
        return res.status(409).json({ message: `${ward} ward is full (${capacity}/${capacity} beds).` });
      }

      const uuid = uuidv4();
      const admNum = `ADM-${Date.now().toString(36).toUpperCase()}`;
      const [result] = await conn.query(
        `INSERT INTO admissions (uuid, admission_number, patient_id, doctor_id, ward, bed_number, diagnosis, treatment_plan, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'admitted', ?)`,
        [uuid, admNum, patient_id, doctor_id, ward, freeBed, diagnosis || null, treatment_plan || null, notes || null]
      );

      // Notify nursing staff
      const [nurses] = await conn.query(
        "SELECT id FROM users WHERE role = 'nurse' AND is_active = 1"
      );
      const [patient] = await conn.query('SELECT first_name, last_name FROM patients WHERE id = ?', [patient_id]);
      const [doctor] = await conn.query('SELECT first_name, last_name FROM users WHERE id = ?', [doctor_id]);
      for (const nurse of nurses) {
        await conn.query(
          `INSERT INTO notifications (user_id, type, title, message, link)
           VALUES (?, 'admission', 'New admission', ?, '/ward')`,
          [nurse.id, `${patient[0].first_name} ${patient[0].last_name} admitted to ${ward} (Bed ${freeBed}) under Dr. ${doctor[0].first_name} ${doctor[0].last_name}.`]
        );
      }

      const [created] = await conn.query(
        `SELECT a.*, p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn
         FROM admissions a JOIN patients p ON a.patient_id = p.id WHERE a.id = ?`,
        [result.insertId]
      );
      await conn.commit();
      transactionOpen = false;
      res.status(201).json(created[0]);
    } catch (error) {
      if (transactionOpen) {
        try { await conn.rollback(); } catch (_) { /* preserve original error */ }
      }
      throw error;
    } finally {
      conn.release();
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update admission (transfer ward/bed, update diagnosis, discharge via status)
router.put('/:id', authenticate, authorize('admin', 'doctor', 'nurse', 'receptionist'), async (req, res) => {
  try {
    const [existing] = await pool.query('SELECT * FROM admissions WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ message: 'Admission not found' });
    const adm = existing[0];

    const { ward, bed_number, diagnosis, treatment_plan, notes, status } = req.body;
    const updates = [];
    const values = [];

    // FIX: use WARDS directly instead of wardCapacity() which always returns a number
    if (ward !== undefined && WARDS[ward] === undefined) {
      return res.status(400).json({ message: `Unknown ward "${ward}". Valid wards: ${Object.keys(WARDS).join(', ')}` });
    }
    const targetWard = ward || adm.ward;
    const targetCapacity = wardCapacity(targetWard);
    const requestedBed = parseBedNumber(bed_number, targetCapacity);
    if (requestedBed === undefined) {
      return res.status(400).json({ message: `Bed must be a number from 01 to ${pad(targetCapacity)}.` });
    }
    const targetBed = requestedBed || adm.bed_number;

    // If the ward is changing, verify capacity and find a free bed
    if (ward !== undefined && ward !== adm.ward) {
      const [activeInTarget] = await pool.query(
        "SELECT COUNT(*) as count FROM admissions WHERE ward = ? AND status = 'admitted' AND id != ?",
        [targetWard, adm.id]
      );
      if (activeInTarget[0].count >= wardCapacity(targetWard)) {
        return res.status(409).json({ message: `${targetWard} ward is full (${wardCapacity(targetWard)}/${wardCapacity(targetWard)} beds).` });
      }
      let newBed = requestedBed;
      if (!newBed) {
        // FIX: pass pool.query-compatible shim — consistent with findFreeBed interface
        newBed = await findFreeBed(pool, targetWard);
        if (!newBed) return res.status(409).json({ message: `${targetWard} ward is full.` });
      }
      updates.push('ward = ?'); values.push(targetWard);
      updates.push('bed_number = ?'); values.push(newBed);
    } else if (requestedBed && requestedBed !== adm.bed_number) {
      const [conflict] = await pool.query(
        "SELECT id FROM admissions WHERE ward = ? AND bed_number = ? AND status = 'admitted' AND id != ?",
        [targetWard, targetBed, adm.id]
      );
      if (conflict.length > 0) {
        return res.status(409).json({ message: `Bed ${targetBed} in ${targetWard} is already occupied.` });
      }
      updates.push('bed_number = ?'); values.push(targetBed);
    }

    if (diagnosis !== undefined) { updates.push('diagnosis = ?'); values.push(diagnosis); }
    if (treatment_plan !== undefined) { updates.push('treatment_plan = ?'); values.push(treatment_plan); }
    if (notes !== undefined) { updates.push('notes = ?'); values.push(notes); }

    if (status) {
      if (!['admitted', 'discharged'].includes(status)) {
        return res.status(400).json({ message: 'Invalid status. Allowed: admitted, discharged' });
      }
      updates.push('status = ?');
      values.push(status);
      // FIX: push the SQL expression as a literal column=expression fragment, NOT as a parameterized value.
      // We use a dedicated column expression string that does not add a ? placeholder.
      if (status === 'discharged') {
        updates.push("discharge_date = datetime('now')");
      } else {
        updates.push('discharge_date = NULL');
      }
    }

    if (updates.length === 0) return res.status(400).json({ message: 'Nothing to update' });

    values.push(req.params.id);
    await pool.query(`UPDATE admissions SET ${updates.join(', ')} WHERE id = ?`, values);

    const [updated] = await pool.query(
      `SELECT a.*, p.first_name as patient_first_name, p.last_name as patient_last_name, p.mrn
       FROM admissions a JOIN patients p ON a.patient_id = p.id WHERE a.id = ?`,
      [req.params.id]
    );
    res.json(updated[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Quick discharge
router.post('/:id/discharge', authenticate, authorize('admin', 'doctor', 'nurse', 'receptionist'), async (req, res) => {
  try {
    const [existing] = await pool.query('SELECT * FROM admissions WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ message: 'Admission not found' });
    if (existing[0].status === 'discharged') {
      return res.status(400).json({ message: 'Patient is already discharged' });
    }
    await pool.query("UPDATE admissions SET status = 'discharged', discharge_date = datetime('now') WHERE id = ?", [req.params.id]);
    res.json({ message: 'Patient discharged successfully', id: req.params.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
module.exports.WARD_CAPACITY = WARDS;
