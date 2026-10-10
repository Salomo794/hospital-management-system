const { body, param, validationResult } = require('express-validator');
const { validatePassword } = require('../utils/passwordPolicy');
const { PHONE_MIN_DIGITS, PHONE_MAX_DIGITS, phoneDigitsOnly, phoneProblem } = require('../utils/phone');

const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// One phone rule for every field that holds a phone number, so a staff account,
// a patient and a self-service profile cannot drift apart. Digits only: a phone
// number is dialled, not formatted, and the punctuation people add for their own
// readability ("+250 788 123 456") is ambiguous enough to be worth refusing
// rather than storing two spellings of one number.
//
// optional({ values: 'falsy' }) is required because the client sends '' for a
// blank field, and undefined-only skipping would let that through as a failure.
const phoneField = (field = 'phone') =>
  body(field)
    .optional({ values: 'falsy' })
    .trim()
    .custom(phoneDigitsOnly)
    .withMessage(phoneProblem)
    .isLength({ min: PHONE_MIN_DIGITS, max: PHONE_MAX_DIGITS })
    .withMessage(`Phone must be between ${PHONE_MIN_DIGITS} and ${PHONE_MAX_DIGITS} digits`);

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
  phoneField('phone'),
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
  // One phone rule for the patient and for the emergency contact, applied by the
  // shared helper so neither can accept something the other refuses.
  phoneField('phone'),
  phoneField('emergency_contact_phone'),
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
