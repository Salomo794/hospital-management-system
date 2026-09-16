const pool = require('../config/database');

// Audit logging utility backed by the audit_log table.
// Records who did what, on which record, with before/after values.
async function logAudit({ user_id, action, table_name, record_id, old_values = null, new_values = null, ip_address = null }) {
  try {
    await pool.query(
      `INSERT INTO audit_log (user_id, action, table_name, record_id, old_values, new_values, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [user_id || null, action, table_name, record_id || null,
        old_values ? JSON.stringify(old_values) : null,
        new_values ? JSON.stringify(new_values) : null,
        ip_address || null]
    );
  } catch (error) {
    console.error('Audit log error:', error.message);
  }
}

// Convenience helpers
const audit = {
  async create(user_id, table_name, record_id, values, ip_address) {
    await logAudit({ user_id, action: 'CREATE', table_name, record_id, new_values: values, ip_address });
  },
  async update(user_id, table_name, record_id, old_values, new_values, ip_address) {
    await logAudit({ user_id, action: 'UPDATE', table_name, record_id, old_values, new_values, ip_address });
  },
  async delete(user_id, table_name, record_id, old_values, ip_address) {
    await logAudit({ user_id, action: 'DELETE', table_name, record_id, old_values, ip_address });
  },
  async login(user_id, ip_address) {
    await logAudit({ user_id, action: 'LOGIN', table_name: 'users', record_id: user_id, ip_address });
  },
  async loginFailed(email, ip_address) {
    await logAudit({ user_id: null, action: 'LOGIN_FAILED', table_name: 'users', new_values: { email }, ip_address });
  },
  async custom(user_id, action, table_name, record_id, details, ip_address) {
    await logAudit({ user_id, action, table_name, record_id, new_values: details, ip_address });
  }
};

module.exports = audit;