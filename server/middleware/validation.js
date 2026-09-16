const { body, param, validationResult } = require('express-validator');

const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// Authentication
const validateRegistration = [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('first_name').trim().notEmpty(),
  body('last_name').trim().notEmpty(),
  body('role').isIn(['admin','doctor','nurse','receptionist','pharmacist','lab_technician']),
  handleValidation
];

const validateLogin = [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  handleValidation
];

const validateChangePassword = [
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 6 }),
  handleValidation
];

// Patients
const validatePatient = [
  body('first_name').trim().notEmpty(),
  body('last_name').trim().notEmpty(),
  body('date_of_birth').isDate(),
  body('gender').isIn(['male','female','other']),
  body('phone').optional().isMobilePhone(),
  handleValidation
];

// Appointments
const validateAppointment = [
  body('patient_id').isInt(),
  body('doctor_id').isInt(),
  body('appointment_date').isDate(),
  body('appointment_time').matches(/^\d{2}:\d{2}$/),
  handleValidation
];

const validateAppointmentStatus = [
  body('status').isIn(['scheduled','confirmed','in_progress','completed','cancelled','no_show']),
  handleValidation
];

// Billing
const validateBilling = [
  body('patient_id').isInt(),
  body('items').isArray({ min: 1 }),
  body('items.*.description').trim().notEmpty(),
  body('items.*.unit_price').isFloat({ min: 0 }),
  handleValidation
];

const validatePayment = [
  body('amount').isFloat({ min: 0.01 }).toFloat(),
  body('payment_method').isIn(['cash','card','bank_transfer','insurance','mobile_money','other']),
  handleValidation
];

// Laboratory
const validateLabOrder = [
  body('patient_id').isInt(),
  body('test_ids').isArray({ min: 1 }),
  body('test_ids.*').isInt(),
  handleValidation
];

const validateLabResults = [
  body('items').isArray({ min: 1 }),
  body('items.*.id').isInt(),
  body('items.*.result_value').notEmpty(),
  handleValidation
];

const validateLabTest = [
  body('name').trim().notEmpty(),
  body('price').optional().isFloat({ min: 0 }),
  handleValidation
];

// Pharmacy
const validateMedicine = [
  body('name').trim().notEmpty(),
  body('unit_price').isFloat({ min: 0 }),
  handleValidation
];

const validateDispense = [
  body('prescription_item_id').isInt(),
  body('quantity').isInt({ min: 1 }),
  handleValidation
];

// EMR
const validateEMR = [
  body('patient_id').isInt(),
  body('chief_complaint').trim().notEmpty(),
  handleValidation
];

const validatePrescription = [
  body('medical_record_id').optional().isInt(),
  body('patient_id').isInt(),
  body('items').isArray({ min: 1 }),
  body('items.*.medicine_id').isInt(),
  body('items.*.dosage').trim().notEmpty(),
  handleValidation
];

// Users
const validateUserUpdate = [
  body('role').optional().isIn(['admin','doctor','nurse','receptionist','pharmacist','lab_technician']),
  handleValidation
];

// Doctor profile
const validateDoctorProfile = [
  body('user_id').isInt(),
  body('license_number').trim().notEmpty(),
  handleValidation
];

// IDs
const validateIdParam = [
  param('id').isInt(),
  handleValidation
];

// AI
const validateAiMessage = [
  body('message').trim().notEmpty().isLength({ max: 2000 }),
  handleValidation
];

module.exports = {
  handleValidation,
  validateRegistration, validateLogin, validateChangePassword,
  validatePatient, validateAppointment, validateAppointmentStatus,
  validateBilling, validatePayment,
  validateLabOrder, validateLabResults, validateLabTest,
  validateMedicine, validateDispense,
  validateEMR, validatePrescription,
  validateUserUpdate, validateIdParam, validateAiMessage,
  validateDoctorProfile
};