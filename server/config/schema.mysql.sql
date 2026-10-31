-- MySQL schema for HMS (generated from config/setup.js)
-- Engine InnoDB, utf8mb4. Applied idempotently by config/setup.js.

CREATE TABLE IF NOT EXISTS users (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      uuid VARCHAR(255) UNIQUE NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','doctor','nurse','receptionist','pharmacist','lab_technician')),
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      phone TEXT,
      avatar TEXT,
      is_active INT DEFAULT 1,
      last_login TEXT,
      -- Stamped whenever the password changes. Session tokens carry the value
      -- they were issued against, so a reset or a forced change can end every
      -- session that predates it - including one held by whoever prompted the
      -- reset. Without this a password reset would not actually lock anyone out.
      password_changed_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      uuid VARCHAR(255) UNIQUE NOT NULL,
      user_id INT NOT NULL,
      token_hash VARCHAR(255) UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      ip_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS patients (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      uuid VARCHAR(255) UNIQUE NOT NULL,
      mrn VARCHAR(255) UNIQUE NOT NULL,
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
      portal_session_version INT NOT NULL DEFAULT 1,
      access_code VARCHAR(255) UNIQUE,
      photo TEXT,
      status VARCHAR(64) DEFAULT 'active' CHECK(status IN ('active','inactive','deceased')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS specialties (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS doctor_profiles (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL UNIQUE,
      specialty_id INT,
      license_number VARCHAR(255) UNIQUE NOT NULL,
      qualification TEXT,
      years_of_experience INT,
      consultation_fee DECIMAL(14,2) DEFAULT 0,
      bio TEXT,
      schedule TEXT,
      is_available INT DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (specialty_id) REFERENCES specialties(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS appointments (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      uuid VARCHAR(255) UNIQUE NOT NULL,
      appointment_number VARCHAR(255) UNIQUE NOT NULL,
      patient_id INT NOT NULL,
      doctor_id INT NOT NULL,
      appointment_date TEXT NOT NULL,
      appointment_time TEXT NOT NULL,
      end_time TEXT,
      type VARCHAR(64) NOT NULL DEFAULT 'consultation' CHECK(type IN ('consultation','follow_up','emergency','procedure','vaccination','other')),
      status VARCHAR(64) NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','in_progress','completed','cancelled','no_show')),
      reason TEXT,
      notes TEXT,
      created_by INT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (doctor_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS medical_records (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      uuid VARCHAR(255) UNIQUE NOT NULL,
      patient_id INT NOT NULL,
      doctor_id INT NOT NULL,
      appointment_id INT,
      record_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      chief_complaint TEXT,
      history_of_present_illness TEXT,
      vital_signs TEXT,
      physical_examination TEXT,
      diagnosis TEXT,
      treatment_plan TEXT,
      notes TEXT,
      status VARCHAR(64) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','final','amended')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (doctor_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS medicines (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name TEXT NOT NULL,
      generic_name TEXT,
      category TEXT,
      manufacturer TEXT,
      unit_price DECIMAL(14,2) NOT NULL CHECK(unit_price >= 0),
      cost_price DECIMAL(14,2) CHECK(cost_price IS NULL OR cost_price >= 0),
      stock_quantity INT NOT NULL DEFAULT 0 CHECK(stock_quantity >= 0),
      min_stock_level INT NOT NULL DEFAULT 10 CHECK(min_stock_level >= 0),
      max_stock_level INT NOT NULL DEFAULT 1000 CHECK(max_stock_level >= min_stock_level),
      unit VARCHAR(64) DEFAULT 'tablet',
      expiry_date TEXT,
      batch_number TEXT,
      requires_prescription INT DEFAULT 1,
      is_active INT DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS prescriptions (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      uuid VARCHAR(255) UNIQUE NOT NULL,
      prescription_number VARCHAR(255) UNIQUE NOT NULL,
      medical_record_id INT,
      patient_id INT NOT NULL,
      doctor_id INT NOT NULL,
      prescribed_date DATE DEFAULT (CURRENT_DATE),
      status VARCHAR(64) NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','cancelled')),
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (medical_record_id) REFERENCES medical_records(id) ON DELETE SET NULL,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (doctor_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS prescription_items (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      prescription_id INT NOT NULL,
      medicine_id INT NOT NULL,
      dosage TEXT NOT NULL,
      frequency TEXT NOT NULL,
      duration TEXT,
      instructions TEXT,
      quantity INT NOT NULL CHECK(quantity > 0),
      dispensed_quantity INT NOT NULL DEFAULT 0 CHECK(dispensed_quantity >= 0 AND dispensed_quantity <= quantity),
      dispensed INT NOT NULL DEFAULT 0 CHECK(dispensed IN (0,1)),
      dispensed_date TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (prescription_id) REFERENCES prescriptions(id) ON DELETE CASCADE,
      FOREIGN KEY (medicine_id) REFERENCES medicines(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lab_tests (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      description TEXT,
      normal_range TEXT,
      unit TEXT,
      price DECIMAL(14,2) NOT NULL DEFAULT 0 CHECK(price >= 0),
      turnaround_time VARCHAR(64) DEFAULT '24 hours',
      is_active INT DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lab_orders (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      uuid VARCHAR(255) UNIQUE NOT NULL,
      order_number VARCHAR(255) UNIQUE NOT NULL,
      patient_id INT NOT NULL,
      doctor_id INT NOT NULL,
      medical_record_id INT,
      order_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      status VARCHAR(64) NOT NULL DEFAULT 'ordered' CHECK(status IN ('ordered','in_progress','completed','cancelled')),
      priority VARCHAR(64) NOT NULL DEFAULT 'routine' CHECK(priority IN ('routine','urgent','stat')),
      clinical_notes TEXT,
      completed_date TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (doctor_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (medical_record_id) REFERENCES medical_records(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lab_order_items (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      lab_order_id INT NOT NULL,
      lab_test_id INT NOT NULL,
      result_value TEXT,
      result_unit TEXT,
      reference_range TEXT,
      is_abnormal INT DEFAULT 0,
      notes TEXT,
      technician_id INT,
      result_date TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (lab_order_id) REFERENCES lab_orders(id) ON DELETE CASCADE,
      FOREIGN KEY (lab_test_id) REFERENCES lab_tests(id) ON DELETE CASCADE,
      FOREIGN KEY (technician_id) REFERENCES users(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bills (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      uuid VARCHAR(255) UNIQUE NOT NULL,
      bill_number VARCHAR(255) UNIQUE NOT NULL,
      patient_id INT NOT NULL,
      appointment_id INT,
      total_amount DECIMAL(14,2) NOT NULL DEFAULT 0 CHECK(total_amount >= 0),
      discount DECIMAL(14,2) NOT NULL DEFAULT 0 CHECK(discount >= 0),
      tax DECIMAL(14,2) NOT NULL DEFAULT 0 CHECK(tax >= 0),
      net_amount DECIMAL(14,2) NOT NULL DEFAULT 0 CHECK(net_amount >= 0),
      paid_amount DECIMAL(14,2) NOT NULL DEFAULT 0 CHECK(paid_amount >= 0),
      payment_status VARCHAR(64) NOT NULL DEFAULT 'pending' CHECK(payment_status IN ('pending','partial','paid','cancelled')),
      payment_method TEXT,
      insurance_claim_amount DECIMAL(14,2) DEFAULT 0,
      due_date TEXT,
      notes TEXT,
      created_by INT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bill_items (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      bill_id INT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      reference_id INT,
      quantity INT NOT NULL DEFAULT 1 CHECK(quantity > 0),
      unit_price DECIMAL(14,2) NOT NULL CHECK(unit_price >= 0),
      total DECIMAL(14,2) NOT NULL CHECK(total >= 0),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payments (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      uuid VARCHAR(255) UNIQUE NOT NULL,
      payment_number VARCHAR(255) UNIQUE NOT NULL,
      bill_id INT NOT NULL,
      patient_id INT NOT NULL,
      amount DECIMAL(14,2) NOT NULL CHECK(amount > 0),
      payment_method TEXT NOT NULL CHECK(payment_method IN ('cash','card','credit_card','mobile_wallet','mobile_money','upi','online','bank_transfer','cheque','insurance','other')),
      status VARCHAR(64) NOT NULL DEFAULT 'completed' CHECK(status IN ('pending','completed','failed','cancelled')),
      transaction_reference TEXT,
      provider TEXT,
      provider_reference TEXT,
      failure_reason TEXT,
      received_by INT,
      payment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (received_by) REFERENCES users(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_refunds (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      uuid VARCHAR(255) UNIQUE NOT NULL,
      refund_number VARCHAR(255) UNIQUE NOT NULL,
      payment_id INT NOT NULL,
      bill_id INT NOT NULL,
      patient_id INT NOT NULL,
      amount DECIMAL(14,2) NOT NULL CHECK(amount > 0),
      payment_method TEXT NOT NULL CHECK(payment_method IN ('cash','card','credit_card','mobile_wallet','mobile_money','upi','online','bank_transfer','cheque','insurance','other')),
      reason TEXT NOT NULL,
      refunded_by INT NOT NULL,
      refund_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE,
      FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (refunded_by) REFERENCES users(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id INT,
      type VARCHAR(64) DEFAULT 'system',
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read INT DEFAULT 0,
      link TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_log (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id INT,
      actor_type VARCHAR(64) NOT NULL DEFAULT 'staff',
      actor_label TEXT,
      action TEXT NOT NULL,
      summary TEXT,
      table_name TEXT,
      record_id INT,
      old_values TEXT,
      new_values TEXT,
      ip_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inventory_transactions (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      medicine_id INT NOT NULL,
      prescription_item_id INT,
      transaction_type TEXT NOT NULL,
      quantity INT NOT NULL,
      reference_number TEXT,
      notes TEXT,
      performed_by INT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (medicine_id) REFERENCES medicines(id) ON DELETE CASCADE,
      FOREIGN KEY (prescription_item_id) REFERENCES prescription_items(id) ON DELETE SET NULL,
      FOREIGN KEY (performed_by) REFERENCES users(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS suppliers (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      contact_name TEXT,
      email TEXT,
      phone TEXT,
      address TEXT,
      lead_time_days INT NOT NULL DEFAULT 7 CHECK(lead_time_days >= 0),
      notes TEXT,
      is_active INT NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS purchase_orders (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      uuid VARCHAR(255) UNIQUE NOT NULL,
      order_number VARCHAR(255) UNIQUE NOT NULL,
      supplier_id INT NOT NULL,
      status VARCHAR(64) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','partially_received','received','cancelled')),
      total_amount DECIMAL(14,2) NOT NULL DEFAULT 0 CHECK(total_amount >= 0),
      ordered_by INT,
      approved_by INT,
      expected_date TEXT,
      notes TEXT,
      cancellation_reason TEXT,
      submitted_at TEXT,
      approved_at TEXT,
      received_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT,
      FOREIGN KEY (ordered_by) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS purchase_order_items (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      purchase_order_id INT NOT NULL,
      medicine_id INT NOT NULL,
      quantity INT NOT NULL CHECK(quantity > 0),
      unit_cost DECIMAL(14,2) NOT NULL DEFAULT 0 CHECK(unit_cost >= 0),
      quantity_received INT NOT NULL DEFAULT 0 CHECK(quantity_received >= 0),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
      FOREIGN KEY (medicine_id) REFERENCES medicines(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admissions (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      uuid VARCHAR(255) UNIQUE NOT NULL,
      admission_number VARCHAR(255) UNIQUE NOT NULL,
      patient_id INT NOT NULL,
      doctor_id INT NOT NULL,
      ward TEXT,
      bed_number TEXT,
      admission_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      discharge_date TEXT,
      diagnosis TEXT,
      treatment_plan TEXT,
      chief_complaint TEXT,
      triage_severity TEXT CHECK(triage_severity IS NULL OR triage_severity IN ('low','moderate','high','critical')),
      status VARCHAR(64) NOT NULL DEFAULT 'admitted' CHECK(status IN ('admitted','discharged')),
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (doctor_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS drug_interactions (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      medicine_a_id INT NOT NULL,
      medicine_b_id INT NOT NULL,
      severity TEXT NOT NULL CHECK(severity IN ('mild','moderate','severe','contraindicated')),
      description TEXT,
      clinical_management TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (medicine_a_id) REFERENCES medicines(id) ON DELETE CASCADE,
      FOREIGN KEY (medicine_b_id) REFERENCES medicines(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS checkins (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      uuid VARCHAR(255) UNIQUE NOT NULL,
      patient_id INT NOT NULL,
      appointment_id INT,
      checkin_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      checkin_date DATE NOT NULL DEFAULT (CURRENT_DATE),
      purpose TEXT,
      status VARCHAR(64) DEFAULT 'waiting' CHECK(status IN ('waiting','in_consultation','completed','no_show','cancelled')),
      qr_token TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS checkin_tokens (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      patient_id INT NOT NULL,
      appointment_id INT,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      revoked_at TEXT,
      created_by INT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
      FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tracks which curated drug-interaction reference dataset is loaded. This table
-- used to be created only by the old SQLite migrate(); it is part of the schema
-- of record now. The CHECK keeps it a genuine single-row settings table.
CREATE TABLE IF NOT EXISTS safety_reference (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY CHECK(id = 1),
      source TEXT NOT NULL,
      description TEXT,
      reference_name TEXT,
      reference_version TEXT,
      loaded_at TEXT,
      loaded_by INT,
      interaction_count INT NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
