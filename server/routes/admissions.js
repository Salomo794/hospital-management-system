const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

// Ward configuration: name -> total bed capacity
const WARDS = {
  'General Medicine': 20,
  'Surgery': 12,
  'ICU': 8,
  'Pediatrics': 10,
  'Maternity': 14
};

const pad = n => String(n).padStart(2, '0');

// Helper: which wards have they configured capacity for
const wardList = () => Object.entries(WARDS).map(([ward, total]) => ({ ward, total }));

// Helper: resolve a free bed number inside a ward, honor existing occupied beds
async function findFreeBed(conn, ward) {
  const total = WARDS[ward];
  if (!total) return null;
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
    let query = `
      SELECT a.*, p.first_name as patient_first_name, p.last_name as patient_last_name,
        p.mrn, u.first_name as doctor_first_name, u.last_name as doctor_last_name
      FROM admissions a
      JOIN patients p ON a.patient_id = p.id
      JOIN users u ON a.doctor_id = u.id
      WHERE 1=1`;
    const params = [];
    if (status) { query += ' AND a.status = ?'; params.push(status); }
    if (ward) { query += ' AND a.ward = ?'; params.push(ward); }
    if (search) {
      query += ' AND (p.first_name LIKE ? OR p.last_name LIKE ? OR p.mrn LIKE ? OR a.admission_number LIKE ? OR a.bed_number LIKE ?)';
      const like = `%${search}%`;
      params.push(like, like, like, like, like);
    }
    const [countRes] = await pool.query(query.replace(/SELECT a\.\*.*FROM admissions/, 'SELECT COUNT(*) as total FROM admissions'), params);
    query += ' ORDER BY a.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    const [rows] = await pool.query(query, params);
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

    const wards = wardList().map(({ ward, total }) => {
      const occupied = occupiedByWard[ward] ? occupiedByWard[ward].length : 0;
      const beds = [];
      for (let i = 1; i <= total; i++) {
        const bed = pad(i);
        const adm = (occupiedByWard[ward] || []).find(a => a.bed_number === bed);
        beds.push(adm ? { bed, status: 'occupied', admissionId: adm.id, patientId: adm.patient_id, diagnosis: adm.diagnosis } : { bed, status: 'available' });
      }
      return { ward, total, occupied, available: total - occupied, percentage: Math.round((occupied / total) * 100), beds };
    });

    // Track wards present in the data but not configured (safety)
    const seen = new Set(wards.map(w => w.ward));
    Object.keys(occupiedByWard).forEach(ward => {
      if (!seen.has(ward)) {
        const occupied = occupiedByWard[ward].length;
        wards.push({ ward, total: occupied, occupied, available: 0, percentage: 100, beds: [] });
      }
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
    if (!WARDS[ward]) {
      return res.status(400).json({ message: `Unknown ward "${ward}".` });
    }

    const conn = await pool.getConnection();
    try {
      const [activeInWard] = await conn.query(
        "SELECT COUNT(*) as count FROM admissions WHERE ward = ? AND status = 'admitted'",
        [ward]
      );
      const capacity = WARDS[ward];
      if (activeInWard[0].count >= capacity) {
        return res.status(409).json({ message: `${ward} ward is full (${capacity}/${capacity} beds).` });
      }
      const freeBed = bed_number || await findFreeBed(conn, ward);
      if (!freeBed) {
        return res.status(409).json({ message: `${ward} ward is full (${capacity}/${capacity} beds).` });
      }

      const uuid = uuidv4();
      const admNum = `ADM-${Date.now().toString(36).toUpperCase()}`;
      const [result] = await conn.query(
        `INSERT INTO admissions (uuid, admission_number, patient_id, doctor_id, ward, bed_number, diagnosis, treatment_plan, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'admitted', ?)`,
        [uuid, admNum, patient_id, doctor_id, ward, freeBed, diagnosis || null, treatment_plan || null, notes || null]
      );

      // Notify nursing staff for the ward
      const [nurses] = await conn.query(
        "SELECT id FROM users WHERE role = 'nurse' AND is_active = TRUE"
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
      res.status(201).json(created[0]);
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

    if (ward && WARDS[ward] === undefined) {
      return res.status(400).json({ message: `Unknown ward "${ward}".` });
    }
    const targetWard = ward || adm.ward;
    const targetBed = bed_number || adm.bed_number;

    // If the ward/bed is changing, verify capacity and bed availability
    if (ward !== undefined && ward !== adm.ward) {
      const [activeInTarget] = await pool.query(
        "SELECT COUNT(*) as count FROM admissions WHERE ward = ? AND status = 'admitted' AND id != ?",
        [targetWard, adm.id]
      );
      if (activeInTarget[0].count >= WARDS[targetWard]) {
        return res.status(409).json({ message: `${targetWard} ward is full (${WARDS[targetWard]}/${WARDS[targetWard]} beds).` });
      }
      let newBed = bed_number;
      if (!newBed) {
        newBed = await findFreeBed(pool, targetWard);
        if (!newBed) return res.status(409).json({ message: `${targetWard} ward is full.` });
      }
      updates.push('ward = ?'); values.push(targetWard);
      updates.push('bed_number = ?'); values.push(newBed);
    } else if (bed_number !== undefined && bed_number !== adm.bed_number) {
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
      updates.push(status === 'discharged' ? "discharge_date = datetime('now')" : 'discharge_date = NULL');
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