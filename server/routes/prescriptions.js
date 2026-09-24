const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { asyncHandler } = require('../utils/http');

router.get('/pending-items', authenticate, authorize('admin', 'pharmacist'), asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT pi.id, pi.prescription_id, pi.quantity AS quantity_prescribed,
            COALESCE(pi.dispensed_quantity, 0) AS dispensed_quantity,
            pi.quantity - COALESCE(pi.dispensed_quantity, 0) AS quantity_remaining,
            pi.dispensed, pi.medicine_id, pi.dosage, pi.frequency,
            m.name AS medicine_name, m.generic_name AS medicine_generic,
            pr.patient_id, p.first_name || ' ' || p.last_name AS patient_name,
            p.mrn AS patient_mrn, p.allergies AS patient_allergies
     FROM prescription_items pi
     JOIN medicines m ON pi.medicine_id = m.id
     JOIN prescriptions pr ON pi.prescription_id = pr.id
     JOIN patients p ON pr.patient_id = p.id
     WHERE COALESCE(pi.dispensed_quantity, 0) < pi.quantity AND pr.status = 'active'
     ORDER BY pr.prescribed_date DESC`
  );
  res.json({ items: rows });
}));

module.exports = router;
