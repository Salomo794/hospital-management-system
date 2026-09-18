const pool = require('./database');

async function setup() {
  const conn = await pool.getConnection();

  try {
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
      user_id INTEGER NOT NULL,
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
      type TEXT DEFAULT 'consultation',
      status TEXT DEFAULT 'scheduled',
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
      status TEXT DEFAULT 'draft',
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
      unit_price REAL NOT NULL,
      cost_price REAL,
      stock_quantity INTEGER DEFAULT 0,
      min_stock_level INTEGER DEFAULT 10,
      max_stock_level INTEGER DEFAULT 1000,
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
      status TEXT DEFAULT 'active',
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
      quantity INTEGER NOT NULL,
      instructions TEXT,
      dispensed INTEGER DEFAULT 0,
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
      price REAL DEFAULT 0,
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
      status TEXT DEFAULT 'ordered',
      priority TEXT DEFAULT 'routine',
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
      total_amount REAL NOT NULL DEFAULT 0,
      discount REAL DEFAULT 0,
      tax REAL DEFAULT 0,
      net_amount REAL NOT NULL DEFAULT 0,
      paid_amount REAL DEFAULT 0,
      payment_status TEXT DEFAULT 'pending',
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
      quantity INTEGER DEFAULT 1,
      unit_price REAL NOT NULL,
      total REAL NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE
    )`);

    await conn.query(`CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE NOT NULL,
      payment_number TEXT UNIQUE NOT NULL,
      bill_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL,
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
      transaction_type TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      reference_number TEXT,
      notes TEXT,
      performed_by INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (medicine_id) REFERENCES medicines(id) ON DELETE CASCADE,
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
      status TEXT DEFAULT 'admitted',
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (doctor_id) REFERENCES users(id) ON DELETE CASCADE
    )`);

    await conn.query(`CREATE TABLE IF NOT EXISTS drug_interactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      medicine_a_id INTEGER NOT NULL,
      medicine_b_id INTEGER NOT NULL,
      severity TEXT NOT NULL CHECK(severity IN ('mild','moderate','severe','contraindicated')),
      description TEXT NOT NULL,
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
      purpose TEXT,
      status TEXT DEFAULT 'waiting' CHECK(status IN ('waiting','in_consultation','completed','no_show','cancelled')),
      qr_token TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL
    )`);

    console.log('All tables created successfully (SQLite)!');
  } catch (error) {
    console.error('Error creating tables:', error);
  } finally {
    conn.release();
    process.exit();
  }
}

setup();
