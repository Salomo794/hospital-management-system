const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const pool = require('./config/database');

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
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();
const DEFAULT_PORT = 5000;
const JWT_PLACEHOLDER = 'change_this_to_a_secure_random_string';

if (!process.env.JWT_SECRET || process.env.JWT_SECRET === JWT_PLACEHOLDER || process.env.JWT_SECRET.length < 32) {
  throw new Error('[security] JWT_SECRET must be set to a unique random value of at least 32 characters.');
}

const developmentOrigins = new Set(['http://localhost:3000', 'http://127.0.0.1:3000']);
const configuredOrigins = new Set(
  String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
);
const allowedOrigins = process.env.NODE_ENV === 'production'
  ? configuredOrigins
  : new Set([...developmentOrigins, ...configuredOrigins]);

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed by CORS'));
  },
  credentials: false,
}));

morgan.token('safe-url', req => req.path);
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(':method :safe-url :status :res[content-length] - :response-time ms'));
}
app.use(express.json({ limit: process.env.JSON_LIMIT || '1mb' }));
app.use(express.urlencoded({ extended: true, limit: process.env.JSON_LIMIT || '1mb' }));
app.use((req, res, next) => {
  req.requestId = req.header('X-Request-ID') || crypto.randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  next();
});

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

app.get('/api/health', async (req, res, next) => {
  try {
    await pool.isReady();
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
  } catch (error) {
    next(error);
  }
});

app.use('/api', notFound);

if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '../client/dist');
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    res.sendFile(path.join(clientDist, 'index.html'), error => {
      if (error) next(error);
    });
  });
}

app.use(errorHandler);

function startServer({ port = process.env.PORT || DEFAULT_PORT } = {}) {
  const server = app.listen(port, () => {
    console.log(`Hospital Management System API running on port ${port}`);
  });

  server.on('error', error => {
    if (error.code === 'EADDRINUSE') {
      console.error(`[startup] Port ${port} is already in use. Stop the existing server or set PORT to a free port.`);
    } else {
      console.error('[startup] Unable to start server:', error.message);
    }
    process.exitCode = 1;
  });

  return server;
}

if (require.main === module) {
  pool.isReady()
    .then(() => startServer())
    .catch(error => {
      console.error(`[startup] ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = app;
module.exports.startServer = startServer;
module.exports.pool = pool;
