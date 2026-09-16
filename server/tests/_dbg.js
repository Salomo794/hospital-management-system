const express = require('express');
const app = express();
const admissionRoutes = require('../routes/admissions');
const auditRoutes = require('../routes/audit');
const authRoutes = require('../routes/auth');

console.log('admissions:', typeof admissionRoutes, 'stack:', admissionRoutes.stack ? admissionRoutes.stack.length : 0);
console.log('audit:', typeof auditRoutes, 'stack:', auditRoutes.stack ? auditRoutes.stack.length : 0);
console.log('auth:', typeof authRoutes, 'stack:', authRoutes.stack ? authRoutes.stack.length : 0);

const http = require('http');
const server = http.createServer(app);
app.use('/api/admissions', admissionRoutes);
app.use('/api/audit', auditRoutes);

server.listen(5010, () => {
  http.get('http://127.0.0.1:5010/api/admissions', (res) => {
    let data = '';
    res.on('data', d => data += d);
    res.on('end', () => { console.log('admissions status:', res.statusCode, data); server.close(); });
  });
});