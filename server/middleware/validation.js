const { body, param, validationResult } = require('express-validator');

const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

const validateRegistration = [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('first_name').trim().notEmpty(),
  body('last_name').trim().notEmpty(),
  body('role').isIn(['admin','doctor','nurse','receptionist','pharmacist','lab_technician']),
  handleValidation
];

const validatePatient = [
  body('first_name').trim().notEmpty(),
  body('last_name').trim().notEmpty(),
  body('date_of_birth').isDate(),
  body('gender').isIn(['male','female','other']),
  body('phone').optional().isMobilePhone(),
  handleValidation
];

const validateAppointment = [
  body('patient_id').isInt(),
  body('doctor_id').isInt(),
  body('appointment_date').isDate(),
  body('appointment_time').matches(/^\d{2}:\d{2}$/),
  handleValidation
];

module.exports = { validateRegistration, validatePatient, validateAppointment, handleValidation };
