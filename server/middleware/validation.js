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
  // optional() only skips `undefined` by default — the client sends '' for
  // blank fields, which would fail isMobilePhone and block legitimate saves.
  // Use 'falsy' and keep the format check lenient (landlines / local formats).
  body('phone')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 30 })
    .matches(/^[\d\s()+.-]*$/)
    .withMessage('Phone must be at most 30 characters and contain only digits, spaces, and + ( ) . -'),
  handleValidation
];

const validateAppointment = [
  body('patient_id').isInt(),
  body('doctor_id').isInt(),
  body('appointment_date').isDate(),
  body('appointment_time')
    .matches(/^([01]\d|2[0-3]):[0-5]\d$/)
    .withMessage('appointment_time must be a valid 24-hour time (HH:MM)'),
  handleValidation
];

module.exports = { validateRegistration, validatePatient, validateAppointment, handleValidation };
