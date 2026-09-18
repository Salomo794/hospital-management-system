const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

// Get pending (undispensed) prescription items
router.get('/pending-items', authenticate, authorize('admin', 'pharmacist'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT pi.id, pi.prescription_id, pi.quantity as quantity_prescribed, pi.dispensed,
        pi.medicine_id, pi.dosage, pi.frequency,
        m.name as medicine_name, m.generic_name as medicine_generic,
        pr.patient_id,
        p.first_name || ' ' || p.last_name as patient_name,
        p.mrn as patient_mrn, p.allergies as patient_allergies
       FROM prescription_items pi
       JOIN medicines m ON pi.medicine_id = m.id
       JOIN prescriptions pr ON pi.prescription_id = pr.id
       JOIN patients p ON pr.patient_id = p.id
       WHERE pi.dispensed = 0 AND pr.status = 'active'
       ORDER BY pr.prescribed_date DESC`
    );
    res.json({ items: rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
