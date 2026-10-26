const Database = require('better-sqlite3');
const crypto = require('crypto');
const db = new Database(process.env.DB_PATH);
db.pragma('foreign_keys = ON');
const u = () => crypto.randomUUID();
const p = db.prepare(`INSERT INTO patients (uuid, mrn, first_name, last_name, date_of_birth, gender, phone, email, status)
  VALUES (?,?,?,?,?,?,?,?,?)`).run(u(), 'MRN-RESTORE-1', 'Restore', 'Probe', '1990-01-01', 'female', '+250700000001', 'r@example.test', 'active');
const pid = p.lastInsertRowid;
db.prepare(`INSERT INTO bills (uuid, bill_number, patient_id, total_amount, net_amount, payment_status)
  VALUES (?,?,?,?,?,?)`).run(u(), 'BILL-RESTORE-1', pid, 12345.67, 12345.67, 'pending');
db.prepare(`INSERT INTO patients (uuid, mrn, first_name, last_name, date_of_birth, gender, status)
  VALUES (?,?,?,?,?,?,?)`).run(u(), 'MRN-RESTORE-2', 'Second', 'Probe', '1985-02-02', 'male', 'active');
const counts = {};
for (const t of ['patients', 'bills']) counts[t] = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
console.log('seeded', JSON.stringify(counts), 'patient id', pid);
db.close();
