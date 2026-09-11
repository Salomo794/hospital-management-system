const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

// Get pending (undispensed) prescription items
router.get('/pending-items', authenticate, authorize('admin', 'pharmacist'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT pi.id, pi.prescription_id, pi.quantity as quantity_prescribed, pi.dispensed,
        m.name as medicine_name,
        p.first_name || ' ' || p.last_name as patient_name,
        p.mrn as patient_mrn
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
