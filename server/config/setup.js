const { loadEnvironment } = require('./environment');
loadEnvironment();

const pool = require('./database');
const { paymentMethodConstraint } = require('./paymentMethods');

async function setup() {
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();
    await conn.query(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','doctor','nurse','receptionist','pharmacist','lab_technician')),
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      phone TEXT,
      avatar TEXT,
      is_active INTEGER DEFAULT 1,
      last_login TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`);

    await conn.query(`CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE NOT NULL,
      mrn TEXT UNIQUE NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      date_of_birth TEXT NOT NULL,
      gender TEXT NOT NULL CHECK(gender IN ('male','female','other')),
      blood_type TEXT CHECK(blood_type IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
      phone TEXT,
      email TEXT,
      address TEXT,
      emergency_contact_name TEXT,
      emergency_contact_phone TEXT,
      insurance_provider TEXT,
      insurance_number TEXT,
      allergies TEXT,
      chronic_conditions TEXT,
      portal_pin TEXT,
      portal_session_version INTEGER NOT NULL DEFAULT 1,
      access_code TEXT UNIQUE,
      photo TEXT,
      status TEXT DEFAULT 'active' CHECK(status IN ('active','inactive','deceased')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`);

    await conn.query(`CREATE TABLE IF NOT EXISTS specialties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`);

    await conn.query(`CREATE TABLE IF NOT EXISTS doctor_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      specialty_id INTEGER,
      license_number TEXT UNIQUE NOT NULL,
      qualification TEXT,
      years_of_experience INTEGER,
      consultation_fee REAL DEFAULT 0,
      bio TEXT,
      schedule TEXT,
      is_available INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (specialty_id) REFERENCES specialties(id) ON DELETE SET NULL
    )`);

    await conn.query(`CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE NOT NULL,
      appointment_number TEXT UNIQUE NOT NULL,
      patient_id INTEGER NOT NULL,
      doctor_id INTEGER NOT NULL,
      appointment_date TEXT NOT NULL,
      appointment_time TEXT NOT NULL,
      end_time TEXT,
      type TEXT NOT NULL DEFAULT 'consultation' CHECK(type IN ('consultation','follow_up','emergency','procedure','vaccination','other')),
      status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','in_progress','completed','cancelled','no_show')),
      reason TEXT,
      notes TEXT,
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (doctor_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id)
    )`);

    await conn.query(`CREATE TABLE IF NOT EXISTS medical_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE NOT NULL,
      patient_id INTEGER NOT NULL,
      doctor_id INTEGER NOT NULL,
      appointment_id INTEGER,
      record_date TEXT DEFAULT (datetime('now')),
      chief_complaint TEXT,
      history_of_present_illness TEXT,
      vital_signs TEXT,
      physical_examination TEXT,
      diagnosis TEXT,
      treatment_plan TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','final','amended')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (doctor_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL
    )`);

    await conn.query(`CREATE TABLE IF NOT EXISTS medicines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      generic_name TEXT,
      category TEXT,
      manufacturer TEXT,
      unit_price REAL NOT NULL CHECK(unit_price >= 0),
      cost_price REAL CHECK(cost_price IS NULL OR cost_price >= 0),
      stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK(stock_quantity >= 0),
      min_stock_level INTEGER NOT NULL DEFAULT 10 CHECK(min_stock_level >= 0),
      max_stock_level INTEGER NOT NULL DEFAULT 1000 CHECK(max_stock_level >= min_stock_level),
      unit TEXT DEFAULT 'tablet',
      expiry_date TEXT,
      batch_number TEXT,
      requires_prescription INTEGER DEFAULT 1,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`);

    await conn.query(`CREATE TABLE IF NOT EXISTS prescriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE NOT NULL,
      prescription_number TEXT UNIQUE NOT NULL,
      medical_record_id INTEGER,
      patient_id INTEGER NOT NULL,
      doctor_id INTEGER NOT NULL,
      prescribed_date TEXT DEFAULT (date('now')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','cancelled')),
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (medical_record_id) REFERENCES medical_records(id) ON DELETE SET NULL,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (doctor_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

    await conn.query(`CREATE TABLE IF NOT EXISTS prescription_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prescription_id INTEGER NOT NULL,
      medicine_id INTEGER NOT NULL,
      dosage TEXT NOT NULL,
      frequency TEXT NOT NULL,
      duration TEXT,
      instructions TEXT,
      quantity INTEGER NOT NULL CHECK(quantity > 0),
      dispensed_quantity INTEGER NOT NULL DEFAULT 0 CHECK(dispensed_quantity >= 0 AND dispensed_quantity <= quantity),
      dispensed INTEGER NOT NULL DEFAULT 0 CHECK(dispensed IN (0,1)),
      dispensed_date TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (prescription_id) REFERENCES prescriptions(id) ON DELETE CASCADE,
      FOREIGN KEY (medicine_id) REFERENCES medicines(id) ON DELETE CASCADE
    )`);

    await conn.query(`CREATE TABLE IF NOT EXISTS lab_tests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT,
      description TEXT,
      normal_range TEXT,
      unit TEXT,
      price REAL NOT NULL DEFAULT 0 CHECK(price >= 0),
      turnaround_time TEXT DEFAULT '24 hours',
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )`);

    await conn.query(`CREATE TABLE IF NOT EXISTS lab_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE NOT NULL,
      order_number TEXT UNIQUE NOT NULL,
      patient_id INTEGER NOT NULL,
      doctor_id INTEGER NOT NULL,
      medical_record_id INTEGER,
      order_date TEXT DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'ordered' CHECK(status IN ('ordered','in_progress','completed','cancelled')),
      priority TEXT NOT NULL DEFAULT 'routine' CHECK(priority IN ('routine','urgent','stat')),
      clinical_notes TEXT,
      completed_date TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (doctor_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (medical_record_id) REFERENCES medical_records(id) ON DELETE SET NULL
    )`);

    await conn.query(`CREATE TABLE IF NOT EXISTS lab_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lab_order_id INTEGER NOT NULL,
      lab_test_id INTEGER NOT NULL,
      result_value TEXT,
      result_unit TEXT,
      reference_range TEXT,
      is_abnormal INTEGER DEFAULT 0,
      notes TEXT,
      technician_id INTEGER,
      result_date TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (lab_order_id) REFERENCES lab_orders(id) ON DELETE CASCADE,
      FOREIGN KEY (lab_test_id) REFERENCES lab_tests(id) ON DELETE CASCADE,
      FOREIGN KEY (technician_id) REFERENCES users(id)
    )`);

    await conn.query(`CREATE TABLE IF NOT EXISTS bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE NOT NULL,
      bill_number TEXT UNIQUE NOT NULL,
      patient_id INTEGER NOT NULL,
      appointment_id INTEGER,
      total_amount REAL NOT NULL DEFAULT 0 CHECK(total_amount >= 0),
      discount REAL NOT NULL DEFAULT 0 CHECK(discount >= 0),
      tax REAL NOT NULL DEFAULT 0 CHECK(tax >= 0),
      net_amount REAL NOT NULL DEFAULT 0 CHECK(net_amount >= 0),
      paid_amount REAL NOT NULL DEFAULT 0 CHECK(paid_amount >= 0),
      payment_status TEXT NOT NULL DEFAULT 'pending' CHECK(payment_status IN ('pending','partial','paid','cancelled')),
      payment_method TEXT,
      insurance_claim_amount REAL DEFAULT 0,
      due_date TEXT,
      notes TEXT,
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL,
      FOREIGN KEY (created_by) REFERENCES users(id)
    )`);

    await conn.query(`CREATE TABLE IF NOT EXISTS bill_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_id INTEGER NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      reference_id INTEGER,
      quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity > 0),
      unit_price REAL NOT NULL CHECK(unit_price >= 0),
      total REAL NOT NULL CHECK(total >= 0),
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE
    )`);

    await conn.query(`CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE NOT NULL,
      payment_number TEXT UNIQUE NOT NULL,
      bill_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,
      amount REAL NOT NULL CHECK(amount > 0),
      payment_method TEXT NOT NULL ${paymentMethodConstraint()},
      transaction_reference TEXT,
      received_by INTEGER,
      payment_date TEXT DEFAULT (datetime('now')),
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (received_by) REFERENCES users(id)
    )`);

    await conn.query(`CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      type TEXT DEFAULT 'system',
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      link TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

    await conn.query(`CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      table_name TEXT,
      record_id INTEGER,
      old_values TEXT,
      new_values TEXT,
      ip_address TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )`);

    await conn.query(`CREATE TABLE IF NOT EXISTS inventory_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      medicine_id INTEGER NOT NULL,
      prescription_item_id INTEGER,
      transaction_type TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      reference_number TEXT,
      notes TEXT,
      performed_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (medicine_id) REFERENCES medicines(id) ON DELETE CASCADE,
      FOREIGN KEY (prescription_item_id) REFERENCES prescription_items(id) ON DELETE SET NULL,
      FOREIGN KEY (performed_by) REFERENCES users(id)
    )`);

    await conn.query(`CREATE TABLE IF NOT EXISTS admissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE NOT NULL,
      admission_number TEXT UNIQUE NOT NULL,
      patient_id INTEGER NOT NULL,
      doctor_id INTEGER NOT NULL,
      ward TEXT,
      bed_number TEXT,
      admission_date TEXT DEFAULT (datetime('now')),
      discharge_date TEXT,
      diagnosis TEXT,
      treatment_plan TEXT,
      chief_complaint TEXT,
      triage_severity TEXT CHECK(triage_severity IS NULL OR triage_severity IN ('low','moderate','high','critical')),
      status TEXT NOT NULL DEFAULT 'admitted' CHECK(status IN ('admitted','discharged')),
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (doctor_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

    await conn.query(`CREATE TABLE IF NOT EXISTS drug_interactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      medicine_a_id INTEGER NOT NULL,
      medicine_b_id INTEGER NOT NULL,
      severity TEXT NOT NULL CHECK(severity IN ('mild','moderate','severe','contraindicated')),
      description TEXT,
      clinical_management TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (medicine_a_id) REFERENCES medicines(id) ON DELETE CASCADE,
      FOREIGN KEY (medicine_b_id) REFERENCES medicines(id) ON DELETE CASCADE
    )`);

    await conn.query(`CREATE TABLE IF NOT EXISTS checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE NOT NULL,
      patient_id INTEGER NOT NULL,
      appointment_id INTEGER,
      checkin_time TEXT DEFAULT (datetime('now')),
      checkin_date TEXT NOT NULL DEFAULT (date('now')),
      purpose TEXT,
      status TEXT DEFAULT 'waiting' CHECK(status IN ('waiting','in_consultation','completed','no_show','cancelled')),
      qr_token TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL
    )`);

    const [checkinColumns] = await conn.query('PRAGMA table_info(checkins)');
    if (!checkinColumns.some(column => column.name === 'checkin_date')) {
      await conn.query('ALTER TABLE checkins ADD COLUMN checkin_date TEXT');
    }
    await conn.query(`
      UPDATE checkins
      SET checkin_date = COALESCE(date(checkin_time), date(created_at), date('now'))
      WHERE checkin_date IS NULL OR TRIM(checkin_date) = ''
    `);

    const [duplicateCheckins] = await conn.query(`
      SELECT patient_id, checkin_date, COUNT(*) AS duplicate_count
      FROM checkins
      WHERE status IN ('waiting', 'in_consultation')
      GROUP BY patient_id, checkin_date
      HAVING COUNT(*) > 1
      ORDER BY patient_id, checkin_date
      LIMIT 10
    `);
    if (duplicateCheckins.length > 0) {
      const summary = duplicateCheckins
        .map(row => `patient ${row.patient_id} on ${row.checkin_date || 'an unknown date'} (${row.duplicate_count} rows)`)
        .join('; ');
      throw new Error(
        'Cannot create the active check-in index because duplicate legacy check-ins remain '
        + `(${summary}). Resolve them and rerun setup.`
      );
    }
    const [undatedCheckins] = await conn.query(`
      SELECT id FROM checkins
      WHERE status IN ('waiting', 'in_consultation') AND checkin_date IS NULL
      ORDER BY id LIMIT 10
    `);
    if (undatedCheckins.length > 0) {
      throw new Error(
        'Cannot create the active check-in index because legacy check-ins have no valid checkin_date '
        + `(check-in IDs: ${undatedCheckins.map(row => row.id).join(', ')}). Repair them and rerun setup.`
      );
    }
    await conn.query('DROP TRIGGER IF EXISTS checkins_require_date_before_insert');
    await conn.query('DROP TRIGGER IF EXISTS checkins_require_date_before_update');
    await conn.query(`
      CREATE TRIGGER checkins_require_date_before_insert
      BEFORE INSERT ON checkins
      WHEN NEW.checkin_date IS NULL OR TRIM(NEW.checkin_date) = ''
      BEGIN
        SELECT RAISE(ABORT, 'checkin_date is required');
      END
    `);
    await conn.query(`
      CREATE TRIGGER checkins_require_date_before_update
      BEFORE UPDATE OF checkin_date, checkin_time ON checkins
      WHEN NEW.checkin_date IS NULL OR TRIM(NEW.checkin_date) = ''
      BEGIN
        SELECT RAISE(ABORT, 'checkin_date is required');
      END
    `);

    const [duplicateAdmissions] = await conn.query(`
      SELECT patient_id, COUNT(*) AS duplicate_count
      FROM admissions
      WHERE status = 'admitted'
      GROUP BY patient_id
      HAVING COUNT(*) > 1
      ORDER BY patient_id
      LIMIT 10
    `);
    if (duplicateAdmissions.length > 0) {
      const summary = duplicateAdmissions
        .map(row => `patient ${row.patient_id} (${row.duplicate_count} rows)`)
        .join('; ');
      throw new Error(
        'Cannot create the active admission index because duplicate legacy admissions remain '
        + `(${summary}). Resolve them and rerun setup.`
      );
    }

    await conn.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_doctor_profiles_user ON doctor_profiles(user_id)');
    await conn.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_active_appointment_slot
      ON appointments(doctor_id, appointment_date, appointment_time)
      WHERE status IN ('scheduled','in_progress','completed')`);
    await conn.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_active_admission_patient
      ON admissions(patient_id)
      WHERE status = 'admitted'`);
    await conn.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_active_checkin_patient_date
      ON checkins(patient_id, checkin_date)
      WHERE status IN ('waiting', 'in_consultation')`);
    await conn.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_active_admission_bed
      ON admissions(ward, bed_number)
      WHERE status = 'admitted' AND ward IS NOT NULL AND bed_number IS NOT NULL`);
    await conn.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_transaction_reference
      ON payments(transaction_reference)
      WHERE transaction_reference IS NOT NULL AND transaction_reference != ''`);
    await conn.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_reference_number
      ON inventory_transactions(reference_number)
      WHERE reference_number IS NOT NULL AND reference_number != ''`);
    await conn.query('CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id)');
    await conn.query('CREATE INDEX IF NOT EXISTS idx_appointments_doctor_date ON appointments(doctor_id, appointment_date)');
    await conn.query('CREATE INDEX IF NOT EXISTS idx_medical_records_patient ON medical_records(patient_id)');
    await conn.query('CREATE INDEX IF NOT EXISTS idx_lab_orders_patient ON lab_orders(patient_id)');
    await conn.query('CREATE INDEX IF NOT EXISTS idx_bills_patient ON bills(patient_id)');
    await conn.query('CREATE INDEX IF NOT EXISTS idx_admissions_ward_status ON admissions(ward, status)');
    await conn.query('CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read)');
    await conn.query('CREATE INDEX IF NOT EXISTS idx_prescription_items_medicine ON prescription_items(medicine_id)');

    for (const table of ['users', 'patients', 'appointments', 'medical_records', 'medicines', 'bills', 'admissions']) {
      const trigger = `${table}_set_updated_at`;
      await conn.query(`DROP TRIGGER IF EXISTS ${trigger}`);
      await conn.query(`CREATE TRIGGER ${trigger}
        AFTER UPDATE ON ${table}
        FOR EACH ROW
        WHEN NEW.updated_at = OLD.updated_at
        BEGIN
          UPDATE ${table} SET updated_at = datetime('now') WHERE id = NEW.id;
        END`);
    }

    await pool.isReady();
    await conn.commit();
    console.log('All tables and indexes created successfully (SQLite)!');
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* preserve original error */ }
    console.error('Error creating tables:', error);
    throw error;
  } finally {
    conn.release();
  }
}

if (require.main === module) {
  setup().catch(() => {
    process.exitCode = 1;
  });
}

module.exports = setup;
