const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const patientRoutes = require('./routes/patients');
const doctorRoutes = require('./routes/doctors');
const appointmentRoutes = require('./routes/appointments');
const emrRoutes = require('./routes/emr');
const prescriptionRoutes = require('./routes/prescriptions');
const pharmacyRoutes = require('./routes/pharmacy');
const laboratoryRoutes = require('./routes/laboratory');
const billingRoutes = require('./routes/billing');
const reportRoutes = require('./routes/reports');
const notificationRoutes = require('./routes/notifications');
const admissionRoutes = require('./routes/admissions');
const aiRoutes = require('./routes/ai');
const smartRoutes = require('./routes/smart');
const portalRoutes = require('./routes/portal');

const app = express();
const PORT = process.env.PORT || 5000;

// Fail loudly in development if the JWT secret is missing or still the
// placeholder from .env.example — otherwise every token is forgeable.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'change_this_to_a_secure_random_string') {
  console.warn(
    '[security] JWT_SECRET is missing or still the .env.example placeholder. ' +
    'Set a long random value in server/.env before deploying.'
  );
}

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/doctors', doctorRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/emr', emrRoutes);
app.use('/api/prescriptions', prescriptionRoutes);
app.use('/api/pharmacy', pharmacyRoutes);
app.use('/api/laboratory', laboratoryRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admissions', admissionRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/smart', smartRoutes);
app.use('/api/portal', portalRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// JSON 404 for unknown API routes
app.use('/api', (req, res) => {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
});

// Serve Vue.js frontend in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Hospital Management System API running on port ${PORT}`);
});

module.exports = app;
