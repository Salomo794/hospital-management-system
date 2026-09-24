const bcrypt = require('bcryptjs');
const pool = require('./database');
const { randomUUID, generateAccessCode, generatePortalPin } = require('../utils/ids');

async function seed() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'true') {
    throw new Error('Demo seeding is disabled in production. Set ALLOW_DEMO_SEED=true only for an isolated demo database.');
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const demoPortalCredentials = [];
    console.log('Seeding database (SQLite)...');

    const hashedPassword = await bcrypt.hash('password123', 10);

    // --- Specialties ---
    const [specRows] = await conn.query('SELECT id FROM specialties LIMIT 1');
    let cardiologyId, neurologyId, generalId;
    if (specRows.length === 0) {
      const [c] = await conn.query("INSERT INTO specialties (name, description) VALUES ('Cardiology', 'Heart and cardiovascular system')");
      const [n] = await conn.query("INSERT INTO specialties (name, description) VALUES ('Neurology', 'Nervous system disorders')");
      const [g] = await conn.query("INSERT INTO specialties (name, description) VALUES ('General Practice', 'General medical care')");
      cardiologyId = c.insertId;
      neurologyId = n.insertId;
      generalId = g.insertId;
    } else {
      const [allSpecs] = await conn.query('SELECT id FROM specialties LIMIT 3');
      cardiologyId = allSpecs[0]?.id || 1;
      neurologyId = allSpecs[1]?.id || 1;
      generalId = allSpecs[2]?.id || 1;
    }
    console.log('  Specialties seeded');

    // --- Users ---
    const [existingUsers] = await conn.query('SELECT COUNT(*) as count FROM users');
    let userIds = [];
    let doctorUserId1, doctorUserId2;
    if (existingUsers[0].count === 0) {
      const users = [
        { first_name: 'Admin', last_name: 'User', email: 'admin@hospital.com', role: 'admin' },
        { first_name: 'Sarah', last_name: 'Johnson', email: 'doctor@hospital.com', role: 'doctor' },
        { first_name: 'Michael', last_name: 'Chen', email: 'dr.chen@hospital.com', role: 'doctor' },
        { first_name: 'Emily', last_name: 'Williams', email: 'nurse@hospital.com', role: 'nurse' },
        { first_name: 'David', last_name: 'Martinez', email: 'receptionist@hospital.com', role: 'receptionist' },
        { first_name: 'Lisa', last_name: 'Brown', email: 'pharmacist@hospital.com', role: 'pharmacist' },
        { first_name: 'Tom', last_name: 'Wilson', email: 'labtech@hospital.com', role: 'lab_technician' },
      ];
      for (const u of users) {
        const uuid = randomUUID();
        const [result] = await conn.query(
          `INSERT INTO users (uuid, email, password, role, first_name, last_name, phone, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
          [uuid, u.email, hashedPassword, u.role, u.first_name, u.last_name, `555-${String(Math.floor(1000 + Math.random() * 9000))}`]
        );
        userIds.push(result.insertId);
      }
      doctorUserId1 = userIds[1];
      doctorUserId2 = userIds[2];
    } else {
      const [rows] = await conn.query('SELECT id, role FROM users ORDER BY id');
      userIds = rows.map(r => r.id);
      const doctors = rows.filter(r => r.role === 'doctor');
      doctorUserId1 = doctors[0] ? doctors[0].id : userIds[0];
      doctorUserId2 = doctors[1] ? doctors[1].id : userIds[0];
    }
    console.log('  Users seeded');

    // --- Doctor Profiles ---
    const [existingProfiles] = await conn.query('SELECT COUNT(*) as count FROM doctor_profiles');
    if (existingProfiles[0].count === 0) {
      const schedule = JSON.stringify({
        monday: ['09:00-12:00', '14:00-17:00'],
        tuesday: ['09:00-12:00', '14:00-17:00'],
        wednesday: ['09:00-12:00'],
        thursday: ['09:00-12:00', '14:00-17:00'],
        friday: ['09:00-12:00']
      });
      await conn.query(
        `INSERT INTO doctor_profiles (user_id, specialty_id, license_number, qualification, years_of_experience, consultation_fee, bio, schedule, is_available)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [doctorUserId1, cardiologyId, 'MD-2018-4521', 'MD, FACC', 12, 250.00, 'Board-certified cardiologist with expertise in interventional cardiology.', schedule]
      );
      await conn.query(
        `INSERT INTO doctor_profiles (user_id, specialty_id, license_number, qualification, years_of_experience, consultation_fee, bio, schedule, is_available)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [doctorUserId2, neurologyId, 'MD-2019-7834', 'MD, PhD Neurology', 8, 275.00, 'Specialist in neurological disorders including epilepsy and stroke recovery.', schedule]
      );
    }
    console.log('  Doctor profiles seeded');

    // --- Patients ---
    const [existingPatients] = await conn.query('SELECT COUNT(*) as count FROM patients');
    let patientIds = [];
    if (existingPatients[0].count === 0) {
      const patients = [
        { first_name: 'James', last_name: 'Anderson', dob: '1965-03-15', gender: 'male', phone: '555-0101', blood: 'O+', insurance: 'BlueCross', allergies: 'Penicillin', conditions: 'Hypertension' },
        { first_name: 'Maria', last_name: 'Garcia', dob: '1978-07-22', gender: 'female', phone: '555-0102', blood: 'A+', insurance: 'Aetna', allergies: 'None', conditions: 'Type 2 Diabetes' },
        { first_name: 'Robert', last_name: 'Taylor', dob: '1952-11-08', gender: 'male', phone: '555-0103', blood: 'B-', insurance: 'UnitedHealth', allergies: 'Sulfa drugs', conditions: 'COPD, Coronary Artery Disease' },
        { first_name: 'Jennifer', last_name: 'Thomas', dob: '1990-01-30', gender: 'female', phone: '555-0104', blood: 'AB+', insurance: 'Cigna', allergies: 'Latex', conditions: '' },
        { first_name: 'William', last_name: 'Jackson', dob: '1945-06-12', gender: 'male', phone: '555-0105', blood: 'O-', insurance: 'Medicare', allergies: 'Aspirin, Ibuprofen', conditions: 'Atrial Fibrillation, Hypertension' },
        { first_name: 'Patricia', last_name: 'White', dob: '1983-09-05', gender: 'female', phone: '555-0106', blood: 'A-', insurance: 'BlueCross', allergies: 'None', conditions: 'Asthma' },
        { first_name: 'Daniel', last_name: 'Harris', dob: '1971-12-18', gender: 'male', phone: '555-0107', blood: 'B+', insurance: 'Kaiser', allergies: 'Codeine', conditions: 'Chronic Back Pain' },
        { first_name: 'Susan', last_name: 'Martin', dob: '1960-04-25', gender: 'female', phone: '555-0108', blood: 'O+', insurance: 'Medicaid', allergies: 'Shellfish', conditions: 'Hypothyroidism' },
        { first_name: 'Christopher', last_name: 'Lopez', dob: '1995-08-03', gender: 'male', phone: '555-0109', blood: 'AB-', insurance: 'Aetna', allergies: 'None', conditions: '' },
        { first_name: 'Margaret', last_name: 'Clark', dob: '1940-02-14', gender: 'female', phone: '555-0110', blood: 'A+', insurance: 'Medicare', allergies: 'Penicillin, Morphine', conditions: 'Heart Failure, Diabetes Type 2' },
      ];
      for (const p of patients) {
        const uuid = randomUUID();
        const mrn = `MRN-${uuid.substring(0, 8).toUpperCase()}`;
        const accessCode = generateAccessCode(mrn);
        const [result] = await conn.query(
          `INSERT INTO patients (uuid, mrn, access_code, first_name, last_name, date_of_birth, gender, phone, blood_type, address, insurance_provider, allergies, chronic_conditions, emergency_contact_name, emergency_contact_phone, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
          [uuid, mrn, accessCode, p.first_name, p.last_name, p.dob, p.gender, p.phone, p.blood,
           `${Math.floor(100 + Math.random() * 9900)} Medical Center Dr`,
           p.insurance, p.allergies, p.conditions,
           `${p.first_name} ${p.last_name === 'Anderson' ? 'Jr.' : 'Sr.'}`,
           `555-${String(Math.floor(2000 + Math.random() * 8000))}`]
        );
        patientIds.push(result.insertId);
      }
    } else {
      const [rows] = await conn.query('SELECT id FROM patients ORDER BY id LIMIT 10');
      patientIds = rows.map(r => r.id);
    }
    console.log('  Patients seeded');

    // --- Portal self-service PINs ---
    const [patientsWithoutPins] = await conn.query(
      'SELECT id, mrn FROM patients WHERE portal_pin IS NULL OR portal_pin = ? ORDER BY id',
      ['']
    );
    for (const patient of patientsWithoutPins) {
      const pin = generatePortalPin();
      const hashedPin = await bcrypt.hash(pin, 12);
      await conn.query('UPDATE patients SET portal_pin = ? WHERE id = ?', [hashedPin, patient.id]);
      demoPortalCredentials.push({ mrn: patient.mrn, pin });
    }
    console.log('  Portal PINs seeded');

    // --- Appointments ---
    const [existingAppts] = await conn.query('SELECT COUNT(*) as count FROM appointments');
    if (existingAppts[0].count === 0) {
      const types = ['consultation', 'follow_up', 'emergency', 'procedure', 'other'];
      const statuses = ['scheduled', 'completed', 'cancelled'];
      const reasons = ['Annual checkup', 'Chest pain evaluation', 'Follow-up medication review', 'Routine blood work review', 'New patient consultation'];
      const today = new Date();
      for (let i = 0; i < 15; i++) {
        const dayOffset = Math.floor(i / 3) - 2;
        const apptDate = new Date(today);
        apptDate.setUTCDate(apptDate.getUTCDate() + dayOffset);
        const dateStr = apptDate.toISOString().split('T')[0];
        const hour = 9 + (i % 8);
        const minute = i % 2 === 0 ? '00' : '30';
        const uuid = randomUUID();
        const apptNum = `APT-${dateStr.replace(/-/g, '')}-${String(i + 1).padStart(3, '0')}`;
        const doctorId = i % 2 === 0 ? doctorUserId1 : doctorUserId2;
        const statusIdx = dayOffset < 0 ? 1 : (dayOffset === 0 ? 0 : 2);
        const patientIdx = i % patientIds.length;

        await conn.query(
          `INSERT INTO appointments (uuid, appointment_number, patient_id, doctor_id, appointment_date, appointment_time, type, status, reason, notes, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [uuid, apptNum, patientIds[patientIdx % patientIds.length], doctorId, dateStr, `${hour}:${minute}:00`,
           types[i % types.length], statuses[statusIdx], reasons[i % reasons.length],
           i % 3 === 0 ? 'Patient requested morning appointment' : null, userIds[4]]
        );
      }
    }
    console.log('  Appointments seeded');

    // --- Medical Records ---
    const [existingRecords] = await conn.query('SELECT COUNT(*) as count FROM medical_records');
    if (existingRecords[0].count === 0) {
      const records = [
        { patientIdx: 0, complaint: 'Chest tightness and shortness of breath', diagnosis: 'Hypertension Stage 1', treatment: 'Lisinopril 10mg daily', vitals: { bp: '142/88', temp: '98.6F', pulse: '78', weight: '82kg' } },
        { patientIdx: 1, complaint: 'Routine diabetes follow-up', diagnosis: 'Type 2 Diabetes Mellitus - well controlled', treatment: 'Continue Metformin, dietary counseling', vitals: { bp: '128/82', temp: '98.4F', pulse: '72', weight: '68kg' } },
        { patientIdx: 4, complaint: 'Irregular heartbeat, dizziness', diagnosis: 'Atrial Fibrillation', treatment: 'Warfarin 5mg, Metoprolol 50mg BID', vitals: { bp: '136/86', temp: '98.7F', pulse: '92 irregular', weight: '78kg' } },
        { patientIdx: 6, complaint: 'Lower back pain radiating to left leg', diagnosis: 'Lumbar Radiculopathy', treatment: 'Gabapentin 300mg TID, physical therapy', vitals: { bp: '130/80', temp: '98.5F', pulse: '74', weight: '88kg' } },
        { patientIdx: 7, complaint: 'Fatigue, weight gain, cold intolerance', diagnosis: 'Hypothyroidism', treatment: 'Levothyroxine 50mcg daily', vitals: { bp: '124/78', temp: '97.8F', pulse: '62', weight: '72kg' } },
      ];
      for (const r of records) {
        const uuid = randomUUID();
        await conn.query(
          `INSERT INTO medical_records (uuid, patient_id, doctor_id, chief_complaint, vital_signs, diagnosis, treatment_plan, status, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'final', ?)`,
          [uuid, patientIds[r.patientIdx % patientIds.length], r.patientIdx % 2 === 0 ? doctorUserId1 : doctorUserId2,
           r.complaint, JSON.stringify(r.vitals), r.diagnosis, r.treatment,
           'Patient responds well to treatment. Follow up in 4 weeks.']
        );
      }
    }
    console.log('  Medical records seeded');

    // --- Medicines ---
    const [existingMeds] = await conn.query('SELECT COUNT(*) as count FROM medicines');
    if (existingMeds[0].count === 0) {
      const medicines = [
        { name: 'Lisinopril 10mg', generic: 'Lisinopril', category: 'Cardiovascular', price: 0.85, cost: 0.30, stock: 500, min: 100, unit: 'tablet' },
        { name: 'Metformin 500mg', generic: 'Metformin HCl', category: 'Diabetes', price: 0.45, cost: 0.15, stock: 800, min: 150, unit: 'tablet' },
        { name: 'Aspirin 81mg', generic: 'Acetylsalicylic Acid', category: 'Cardiovascular', price: 0.10, cost: 0.03, stock: 2000, min: 500, unit: 'tablet' },
        { name: 'Amoxicillin 500mg', generic: 'Amoxicillin', category: 'Antibiotic', price: 0.75, cost: 0.25, stock: 600, min: 100, unit: 'capsule' },
        { name: 'Omeprazole 20mg', generic: 'Omeprazole', category: 'Gastrointestinal', price: 0.65, cost: 0.20, stock: 450, min: 100, unit: 'capsule' },
        { name: 'Amlodipine 5mg', generic: 'Amlodipine Besylate', category: 'Cardiovascular', price: 0.90, cost: 0.35, stock: 350, min: 75, unit: 'tablet' },
        { name: 'Metoprolol 50mg', generic: 'Metoprolol Tartrate', category: 'Cardiovascular', price: 0.55, cost: 0.20, stock: 400, min: 100, unit: 'tablet' },
        { name: 'Warfarin 5mg', generic: 'Warfarin Sodium', category: 'Cardiovascular', price: 1.20, cost: 0.50, stock: 200, min: 50, unit: 'tablet' },
        { name: 'Hydrochlorothiazide 25mg', generic: 'HCTZ', category: 'Cardiovascular', price: 0.35, cost: 0.10, stock: 550, min: 100, unit: 'tablet' },
        { name: 'Prednisone 10mg', generic: 'Prednisone', category: 'Other', price: 0.40, cost: 0.12, stock: 300, min: 75, unit: 'tablet' },
        { name: 'Ibuprofen 400mg', generic: 'Ibuprofen', category: 'Other', price: 0.15, cost: 0.04, stock: 1500, min: 300, unit: 'tablet' },
        { name: 'Acetaminophen 500mg', generic: 'Acetaminophen', category: 'Other', price: 0.08, cost: 0.02, stock: 2000, min: 500, unit: 'tablet' },
        { name: 'Gabapentin 300mg', generic: 'Gabapentin', category: 'Other', price: 0.50, cost: 0.18, stock: 400, min: 100, unit: 'capsule' },
        { name: 'Levothyroxine 50mcg', generic: 'Levothyroxine Sodium', category: 'Other', price: 0.70, cost: 0.25, stock: 350, min: 75, unit: 'tablet' },
        { name: 'Losartan 50mg', generic: 'Losartan Potassium', category: 'Cardiovascular', price: 0.80, cost: 0.30, stock: 450, min: 100, unit: 'tablet' },
        { name: 'Glipizide 5mg', generic: 'Glipizide', category: 'Diabetes', price: 0.60, cost: 0.20, stock: 300, min: 75, unit: 'tablet' },
        { name: 'Digoxin 0.25mg', generic: 'Digoxin', category: 'Cardiovascular', price: 1.10, cost: 0.45, stock: 150, min: 30, unit: 'tablet' },
        { name: 'Ciprofloxacin 500mg', generic: 'Ciprofloxacin', category: 'Antibiotic', price: 1.35, cost: 0.50, stock: 250, min: 50, unit: 'tablet' },
        { name: 'Diazepam 5mg', generic: 'Diazepam', category: 'Other', price: 0.95, cost: 0.35, stock: 100, min: 25, unit: 'tablet' },
        { name: 'Salbutamol Inhaler', generic: 'Albuterol', category: 'Other', price: 28.50, cost: 12.00, stock: 80, min: 20, unit: 'inhaler' },
      ];
      for (const m of medicines) {
        const [medicineResult] = await conn.query(
          `INSERT INTO medicines (name, generic_name, category, unit_price, cost_price, stock_quantity, min_stock_level, unit, expiry_date, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, date('now', '+18 months'), 1)`,
          [m.name, m.generic, m.category, m.price, m.cost, m.stock, m.min, m.unit]
        );
        await conn.query(
          `INSERT INTO inventory_transactions
           (medicine_id, transaction_type, quantity, notes, performed_by)
           VALUES (?, 'purchase', ?, 'Opening demo inventory', ?)`,
          [medicineResult.insertId, m.stock, doctorUserId1]
        );
      }
    }
    console.log('  Medicines seeded');

    // --- Prescriptions with items ---
    const [existingRx] = await conn.query('SELECT COUNT(*) as count FROM prescriptions');
    if (existingRx[0].count === 0) {
      const [medRows] = await conn.query('SELECT id, name FROM medicines ORDER BY id LIMIT 20');
      const medMap = {};
      medRows.forEach(m => { medMap[m.name] = m.id; });

      const prescriptions = [
        { patientIdx: 0, doctorId: doctorUserId1, notes: 'Monitor blood pressure weekly.' },
        { patientIdx: 1, doctorId: doctorUserId2, notes: 'Maintain blood glucose logs.' },
        { patientIdx: 4, doctorId: doctorUserId1, notes: 'INR monitoring required every 2 weeks.' },
      ];
      const rxItems = [
        [
          { medName: 'Lisinopril 10mg', dosage: '1 tablet', frequency: 'Once daily', duration: '30 days', qty: 30 },
          { medName: 'Aspirin 81mg', dosage: '1 tablet', frequency: 'Once daily', duration: '30 days', qty: 30 },
        ],
        [
          { medName: 'Metformin 500mg', dosage: '1 tablet', frequency: 'Twice daily with meals', duration: '30 days', qty: 60 },
          { medName: 'Glipizide 5mg', dosage: '1 tablet', frequency: 'Once daily before breakfast', duration: '30 days', qty: 30 },
        ],
        [
          { medName: 'Warfarin 5mg', dosage: '1 tablet', frequency: 'Once daily in the evening', duration: '30 days', qty: 30 },
          { medName: 'Metoprolol 50mg', dosage: '1 tablet', frequency: 'Twice daily', duration: '30 days', qty: 60 },
          { medName: 'Digoxin 0.25mg', dosage: '1 tablet', frequency: 'Once daily', duration: '30 days', qty: 30 },
        ],
      ];
      for (let i = 0; i < prescriptions.length; i++) {
        const rx = prescriptions[i];
        const uuid = randomUUID();
        const rxNumber = `RX-${Date.now().toString(36).toUpperCase()}-${i + 1}`;
        const [result] = await conn.query(
          `INSERT INTO prescriptions (uuid, prescription_number, patient_id, doctor_id, notes, status)
           VALUES (?, ?, ?, ?, ?, 'active')`,
          [uuid, rxNumber, patientIds[rx.patientIdx % patientIds.length], rx.doctorId, rx.notes]
        );
        for (const item of rxItems[i]) {
          const medicineId = medMap[item.medName];
          if (medicineId) {
            await conn.query(
              `INSERT INTO prescription_items (prescription_id, medicine_id, dosage, frequency, duration, quantity, instructions)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [result.insertId, medicineId, item.dosage, item.frequency, item.duration, item.qty, 'Take as directed']
            );
          }
        }
      }
    }
    console.log('  Prescriptions seeded');

    // --- Lab Tests ---
    const [existingLabTests] = await conn.query('SELECT COUNT(*) as count FROM lab_tests');
    if (existingLabTests[0].count === 0) {
      const labTests = [
        { name: 'Complete Blood Count (CBC)', category: 'Hematology', normal: 'WBC 4.5-11.0, RBC 4.5-5.5', unit: 'x10^3/uL', price: 35.00 },
        { name: 'Basic Metabolic Panel (BMP)', category: 'Chemistry', normal: 'Glucose 70-100, BUN 7-20', unit: 'mg/dL', price: 45.00 },
        { name: 'Lipid Panel', category: 'Chemistry', normal: 'Total Cholesterol <200, LDL <100', unit: 'mg/dL', price: 55.00 },
        { name: 'Hemoglobin A1c', category: 'Endocrinology', normal: '<5.7% normal', unit: '%', price: 40.00 },
        { name: 'TSH', category: 'Endocrinology', normal: '0.4-4.0 mIU/L', unit: 'mIU/L', price: 50.00 },
        { name: 'Urinalysis', category: 'Urinalysis', normal: 'Clear, specific gravity 1.005-1.030', unit: '', price: 25.00 },
        { name: 'Prothrombin Time (PT/INR)', category: 'Coagulation', normal: 'INR 0.8-1.1', unit: 'seconds', price: 30.00 },
        { name: 'Comprehensive Metabolic Panel', category: 'Chemistry', normal: 'Includes BMP plus liver enzymes', unit: 'mg/dL', price: 60.00 },
        { name: 'Electrolyte Panel', category: 'Chemistry', normal: 'Na 136-145, K 3.5-5.0', unit: 'mEq/L', price: 35.00 },
        { name: 'Vitamin D, 25-Hydroxy', category: 'Endocrinology', normal: '30-100 ng/mL', unit: 'ng/mL', price: 65.00 },
      ];
      for (const t of labTests) {
        await conn.query(
          `INSERT INTO lab_tests (name, category, normal_range, unit, price, turnaround_time, is_active)
           VALUES (?, ?, ?, ?, ?, '24 hours', 1)`,
          [t.name, t.category, t.normal, t.unit, t.price]
        );
      }
    }
    console.log('  Lab tests seeded');

    // --- Lab Orders ---
    const [existingLabOrders] = await conn.query('SELECT COUNT(*) as count FROM lab_orders');
    if (existingLabOrders[0].count === 0) {
      const [labTestRows] = await conn.query('SELECT id, normal_range, unit FROM lab_tests ORDER BY id LIMIT 5');
      const statuses = ['ordered', 'in_progress', 'completed', 'completed', 'ordered'];
      for (let i = 0; i < 5; i++) {
        const uuid = randomUUID();
        const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
        const orderNum = `LAB-${today}-${String(i + 1).padStart(3, '0')}`;
        const [result] = await conn.query(
          `INSERT INTO lab_orders (uuid, order_number, patient_id, doctor_id, status, priority, clinical_notes)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [uuid, orderNum, patientIds[i % patientIds.length], i % 2 === 0 ? doctorUserId1 : doctorUserId2,
           statuses[i], i === 1 ? 'urgent' : 'routine',
           i === 0 ? 'Fasting required' : null]
        );
        await conn.query(
          `INSERT INTO lab_order_items (lab_order_id, lab_test_id, reference_range, result_unit)
           VALUES (?, ?, ?, ?)`,
          [result.insertId, labTestRows[i].id, labTestRows[i].normal_range || null, labTestRows[i].unit || null]
        );
      }
    }
    console.log('  Lab orders seeded');

    // --- Bills with items and payments ---
    const [existingBills] = await conn.query('SELECT COUNT(*) as count FROM bills');
    if (existingBills[0].count === 0) {
      const billData = [
        { patientIdx: 0, items: [{ desc: 'Cardiology Consultation', cat: 'consultation', price: 250 }, { desc: 'Echocardiogram', cat: 'procedure', price: 350 }], paid: 'paid' },
        { patientIdx: 1, items: [{ desc: 'Endocrinology Consultation', cat: 'consultation', price: 275 }, { desc: 'HbA1c Lab Test', cat: 'lab_test', price: 40 }], paid: 'paid' },
        { patientIdx: 2, items: [{ desc: 'Pulmonology Consultation', cat: 'consultation', price: 250 }, { desc: 'Chest X-Ray', cat: 'procedure', price: 120 }, { desc: 'Spirometry Test', cat: 'lab_test', price: 85 }], paid: 'partial' },
        { patientIdx: 3, items: [{ desc: 'General Consultation', cat: 'consultation', price: 150 }, { desc: 'CBC Lab Test', cat: 'lab_test', price: 35 }], paid: 'pending' },
        { patientIdx: 4, items: [{ desc: 'Cardiology Consultation', cat: 'consultation', price: 275 }, { desc: 'ECG', cat: 'procedure', price: 75 }], paid: 'pending' },
      ];
      for (let i = 0; i < billData.length; i++) {
        const bd = billData[i];
        const total = bd.items.reduce((sum, item) => sum + item.price, 0);
        const paidAmount = bd.paid === 'paid' ? total : (bd.paid === 'partial' ? total * 0.5 : 0);
        const uuid = randomUUID();
        const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
        const billNumber = `BIL-${today}-${String(i + 1).padStart(3, '0')}`;
        const [result] = await conn.query(
          `INSERT INTO bills (uuid, bill_number, patient_id, total_amount, discount, tax, net_amount, paid_amount, payment_status, payment_method, notes, created_by)
           VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
          [uuid, billNumber, patientIds[bd.patientIdx % patientIds.length], total, total * 0.1, total + total * 0.1,
           paidAmount, bd.paid, bd.paid !== 'pending' ? 'card' : null,
           i === 2 ? 'Insurance claim pending' : null, userIds[4]]
        );
        for (const item of bd.items) {
          await conn.query(
            `INSERT INTO bill_items (bill_id, description, category, quantity, unit_price, total)
             VALUES (?, ?, ?, 1, ?, ?)`,
            [result.insertId, item.desc, item.cat, item.price, item.price]
          );
        }
        if (paidAmount > 0) {
          const payUuid = randomUUID();
          const payNumber = `PAY-${Date.now().toString(36).toUpperCase()}-${i + 1}`;
          await conn.query(
            `INSERT INTO payments (uuid, payment_number, bill_id, patient_id, amount, payment_method, received_by, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [payUuid, payNumber, result.insertId, patientIds[bd.patientIdx % patientIds.length], paidAmount,
             i === 1 ? 'card' : 'cash', userIds[4],
             bd.paid === 'partial' ? 'Partial payment' : 'Full payment']
          );
        }
      }
    }
    console.log('  Bills and payments seeded');

    // --- Drug Interactions ---
    const [existingInteractions] = await conn.query('SELECT COUNT(*) as count FROM drug_interactions');
    if (existingInteractions[0].count === 0) {
      const [medRows] = await conn.query('SELECT id, generic_name FROM medicines');
      const genericMap = {};
      medRows.forEach(m => { genericMap[m.generic_name.toLowerCase()] = m.id; });
      const interactions = [
        ['Acetylsalicylic Acid', 'Warfarin Sodium', 'severe', 'Combined use significantly increases the risk of major bleeding.', 'Avoid combination when possible. If unavoidable, monitor INR closely and watch for signs of bleeding.'],
        ['Acetylsalicylic Acid', 'Ibuprofen', 'moderate', 'Ibuprofen may diminish the cardioprotective antiplatelet effect of aspirin.', 'Separate doses by at least 2 hours, or consider an alternative anti-inflammatory.'],
        ['Warfarin Sodium', 'Ibuprofen', 'severe', 'Highly increased risk of gastrointestinal and systemic bleeding.', 'Avoid combination; use acetaminophen for analgesia and test for occult blood if NSAID is essential.'],
        ['Warfarin Sodium', 'Acetaminophen', 'moderate', 'Chronic high-dose acetaminophen can elevate INR and potentiate anticoagulation.', 'Monitor INR during sustained therapy and adjust warfarin dose as needed.'],
        ['Warfarin Sodium', 'Ciprofloxacin', 'severe', 'Fluoroquinolones markedly potentiate warfarin effect, raising bleeding risk.', 'Avoid if possible; if required, monitor INR within 3-5 days of starting the antibiotic.'],
        ['Warfarin Sodium', 'Omeprazole', 'moderate', 'May increase INR and bleeding tendency through CYP inhibition.', 'Monitor INR when adding or stopping the PPI and adjust warfarin accordingly.'],
        ['Warfarin Sodium', 'Levothyroxine Sodium', 'moderate', 'Thyroid replacement can potentiate anticoagulant effect.', 'Monitor INR when thyroid dosing changes and adjust warfarin as needed.'],
        ['Lisinopril', 'Losartan Potassium', 'contraindicated', 'Dual RAAS blockade increases the risk of hyperkalemia, hypotension and renal impairment.', 'Do not combine ACE inhibitors with ARBs. Choose a single agent and monitor potassium and renal function.'],
        ['Metoprolol Tartrate', 'Glipizide', 'moderate', 'Beta-blockers can mask the adrenergic warning signs of hypoglycemia (tremor, tachycardia).', 'Counsel patients on hypoglycemia recognition; monitor blood glucose closely.'],
        ['Metoprolol Tartrate', 'Albuterol', 'moderate', 'Non-selective beta-blockade can antagonize beta-2 bronchodilator effects and worsen bronchospasm.', 'Use a cardioselective agent at the lowest effective dose and monitor respiratory status.'],
        ['Metoprolol Tartrate', 'Digoxin', 'moderate', 'Additive negative chronotropic effect increases the risk of bradycardia and heart block.', 'Monitor heart rate and digoxin levels; reduce dose if bradycardia occurs.'],
        ['Amlodipine Besylate', 'Digoxin', 'moderate', 'May raise serum digoxin concentrations and increase toxicity risk.', 'Monitor digoxin levels and watch for nausea, visual changes or arrhythmia.'],
        ['Ibuprofen', 'Prednisone', 'moderate', 'Combined use increases the risk of gastrointestinal ulceration and bleeding.', 'Add gastroprotection (PPI) and use the lowest effective NSAID dose for the shortest time.'],
        ['Prednisone', 'Glipizide', 'moderate', 'Corticosteroids raise blood glucose and may reduce the effect of antidiabetic agents.', 'Monitor blood glucose and adjust the antidiabetic dose during steroid therapy.'],
        ['Levothyroxine Sodium', 'Omeprazole', 'moderate', 'PPIs reduce levothyroxine absorption, potentially causing hypothyroid symptoms.', 'Take levothyroxine on an empty stomach, well separated from the PPI dose, and recheck TSH.'],
        ['Amlodipine Besylate', 'Metoprolol Tartrate', 'mild', 'Additive hypotensive effect; may cause dizziness or fatigue on initiation.', 'Monitor blood pressure during the dose-titration period.'],
      ];
      for (const [a, b, severity, description, clinical] of interactions) {
        const aId = genericMap[a.toLowerCase()];
        const bId = genericMap[b.toLowerCase()];
        if (!aId || !bId) continue;
        await conn.query(
          `INSERT INTO drug_interactions (medicine_a_id, medicine_b_id, severity, description, clinical_management)
           VALUES (?, ?, ?, ?, ?)`,
          [aId, bId, severity, description, clinical]
        );
      }
    }
    console.log('  Drug interactions seeded');

    // --- Admissions (Ward & Bed Management) ---
    const [existingAdmissions] = await conn.query('SELECT COUNT(*) as count FROM admissions');
    if (existingAdmissions[0].count === 0) {
      const [patientRows] = await conn.query('SELECT id FROM patients ORDER BY id');
      const patientIdList = patientRows.map(r => r.id);
      const wards = [
        { ward: 'General Medicine', bed: '01', patientIdx: 0, diagnosis: 'Hypertensive crisis', plan: 'IV antihypertensives, cardiac monitoring' },
        { ward: 'General Medicine', bed: '02', patientIdx: 2, diagnosis: 'COPD exacerbation', plan: 'Nebulized bronchodilators, oxygen therapy' },
        { ward: 'ICU', bed: '01', patientIdx: 4, diagnosis: 'Atrial fibrillation with RVR', plan: 'Continuous ECG, rate control, anticoagulation' },
        { ward: 'Surgery', bed: '03', patientIdx: 6, diagnosis: 'Post-operative observation (lumbar decompression)', plan: 'Pain control, physiotherapy consult' },
        { ward: 'Maternity', bed: '02', patientIdx: 1, diagnosis: 'Gestational diabetes monitoring', plan: 'Glucose monitoring, diet counseling' },
        { ward: 'Pediatrics', bed: '05', patientIdx: 3, diagnosis: 'Observation after ingestion', plan: 'Observation, IV fluids' },
        { ward: 'ICU', bed: '02', patientIdx: 9, diagnosis: 'Heart failure decompensation', plan: 'Diuretics, telemetry, daily weights' },
      ];
      for (let i = 0; i < wards.length; i++) {
        const w = wards[i];
        const uuid = randomUUID();
        const admNum = `ADM-${Date.now().toString(36).toUpperCase()}-${i + 1}`;
        await conn.query(
          `INSERT INTO admissions (uuid, admission_number, patient_id, doctor_id, ward, bed_number, diagnosis, treatment_plan, status, notes, admission_date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'admitted', ?, datetime('now', ?))`,
          [uuid, admNum, patientIdList[w.patientIdx % patientIdList.length], i % 2 === 0 ? doctorUserId1 : doctorUserId2,
           w.ward, w.bed, w.diagnosis, w.plan,
           `${w.bed} days stay, review daily`, `-${i % 5} days`]
        );
      }
      const dischargedUuid = randomUUID();
      await conn.query(
        `INSERT INTO admissions (uuid, admission_number, patient_id, doctor_id, ward, bed_number, diagnosis, treatment_plan, status, notes, admission_date, discharge_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'discharged', ?, datetime('now', '-10 days'), datetime('now', '-3 days'))`,
        [dischargedUuid, `ADM-${Date.now().toString(36).toUpperCase()}-X`, patientIdList[8], doctorUserId2,
         'Surgery', 'B-04', 'Appendectomy', 'Wound care, follow-up in clinic',
         'Recovered well, discharged to home care']
      );
    }
    console.log('  Admissions seeded');

    // --- Sample notifications ---
    const [existingNotifs] = await conn.query('SELECT COUNT(*) as count FROM notifications');
    if (existingNotifs[0].count === 0) {
      for (const uid of userIds) {
        await conn.query(
          `INSERT INTO notifications (user_id, type, title, message, is_read) VALUES (?, 'system', 'Welcome', 'Welcome to MediCare Hospital Management System!', 0)`,
          [uid]
        );
      }
    }
    console.log('  Notifications seeded');

    await conn.commit();
    console.log('\nDatabase seeded successfully!');
    console.log('\nDemo login credentials (password: password123):');
    console.log('  Admin:        admin@hospital.com');
    console.log('  Doctor:       doctor@hospital.com');
    console.log('  Nurse:        nurse@hospital.com');
    console.log('  Receptionist: receptionist@hospital.com');
    console.log('  Pharmacist:   pharmacist@hospital.com');
    console.log('  Lab Tech:     labtech@hospital.com');
    if (demoPortalCredentials.length > 0) {
      console.log('\nDemo patient portal credentials:');
      for (const credential of demoPortalCredentials) {
        console.log(`  ${credential.mrn}: ${credential.pin}`);
      }
    }
  } catch (error) {
    try { await conn.rollback(); } catch (_) { /* preserve original error */ }
    console.error('Seeding failed:', error);
    throw error;
  } finally {
    conn.release();
  }
}

if (require.main === module) {
  seed().catch(() => {
    process.exitCode = 1;
  });
}

module.exports = seed;
