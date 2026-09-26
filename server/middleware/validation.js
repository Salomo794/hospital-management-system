const { body, param, validationResult } = require('express-validator');
const { validatePassword } = require('../utils/passwordPolicy');

const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// The password rules live in utils/passwordPolicy so registration, the password
// change endpoint and the client all apply the same policy. express-validator
// gives a clean field-level error; every problem is reported at once so the
// person is not walked through one failure at a time.
const validateNewPassword = (field = 'password') => (req, res, next) => {
  const problems = validatePassword(req.body?.[field], {
    email: req.body?.email,
    firstName: req.body?.first_name,
    lastName: req.body?.last_name,
  });
  if (problems.length > 0) {
    return res.status(400).json({ message: problems[0], errors: problems.map(message => ({ msg: message, path: field })) });
  }
  return next();
};

const validateRegistration = [
  body('email').isEmail().normalizeEmail(),
  body('first_name').trim().notEmpty(),
  body('last_name').trim().notEmpty(),
  body('role').isIn(['admin','doctor','nurse','receptionist','pharmacist','lab_technician']),
  validateNewPassword(),
  handleValidation
];

const validatePatient = [
  body('first_name').trim().notEmpty(),
  body('last_name').trim().notEmpty(),
  body('date_of_birth').isDate(),
  body('gender').isIn(['male','female','other']),
  body('blood_type')
    .optional({ values: 'falsy' })
    .isIn(['A+','A-','B+','B-','AB+','AB-','O+','O-']),
  body('email').optional({ values: 'falsy' }).isEmail(),
  body('date_of_birth').custom(value => {
    if (new Date(`${value}T00:00:00Z`) > new Date()) throw new Error('date_of_birth cannot be in the future');
    return true;
  }),
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
  body('appointment_date')
    .isDate()
    .custom(value => {
      if (value < new Date().toISOString().slice(0, 10)) throw new Error('appointment_date cannot be in the past');
      return true;
    }),
  body('type').optional({ values: 'falsy' }).isIn(['consultation','follow_up','emergency','procedure','vaccination','other']),
  body('appointment_time')
    .matches(/^([01]\d|2[0-3]):[0-5]\d$/)
    .withMessage('appointment_time must be a valid 24-hour time (HH:MM)'),
  handleValidation
];

module.exports = {
  validateRegistration, validatePatient, validateAppointment, handleValidation, validateNewPassword,
};
