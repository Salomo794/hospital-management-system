<template>
  <div class="patient-detail">
    <div v-if="loading" class="loading-state">
      <div class="spinner"></div>
      <p>Loading patient details...</p>
    </div>

    <template v-else-if="patient">
      <div class="detail-header">
        <button class="btn btn-sm" @click="$router.back()">&larr; Back</button>
        <div class="patient-title">
          <div class="patient-avatar-large">{{ patient.first_name.charAt(0) }}{{ patient.last_name.charAt(0) }}</div>
          <div>
            <h2>{{ patient.first_name }} {{ patient.last_name }}</h2>
            <span class="text-muted">MRN: {{ patient.mrn }} | {{ patient.gender }} | DOB: {{ formatDate(patient.date_of_birth) }}</span>
          </div>
        </div>
        <button class="btn btn-primary" @click="showEditModal = true">Edit Profile</button>
      </div>

      <div class="detail-grid">
        <div class="card info-card">
          <div class="card-header"><h3>Personal Information</h3></div>
          <div class="card-body">
            <div class="info-grid">
              <div class="info-item"><label>Blood Type</label><span>{{ patient.blood_type || 'Not recorded' }}</span></div>
              <div class="info-item"><label>Phone</label><span>{{ patient.phone || '-' }}</span></div>
              <div class="info-item"><label>Email</label><span>{{ patient.email || '-' }}</span></div>
              <div class="info-item full-width"><label>Address</label><span>{{ patient.address || '-' }}</span></div>
              <div class="info-item"><label>Insurance</label><span>{{ patient.insurance_provider || 'None' }} {{ patient.insurance_number || '' }}</span></div>
            </div>
          </div>
        </div>

        <div class="card info-card">
          <div class="card-header"><h3>Emergency Contact</h3></div>
          <div class="card-body">
            <div class="info-grid">
              <div class="info-item"><label>Name</label><span>{{ patient.emergency_contact_name || '-' }}</span></div>
              <div class="info-item"><label>Phone</label><span>{{ patient.emergency_contact_phone || '-' }}</span></div>
            </div>
          </div>
        </div>

        <div class="card info-card">
          <div class="card-header"><h3>Medical Information</h3></div>
          <div class="card-body">
            <div class="info-grid">
              <div class="info-item"><label>Allergies</label><span class="text-danger">{{ patient.allergies || 'None recorded' }}</span></div>
              <div class="info-item"><label>Chronic Conditions</label><span>{{ patient.chronic_conditions || 'None recorded' }}</span></div>
            </div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:20px">
        <div class="card-header"><h3>Medical History</h3></div>
        <div class="card-body">
          <div class="tabs">
            <button :class="{ active: tab === 'records' }" @click="tab = 'records'">Medical Records</button>
            <button :class="{ active: tab === 'appointments' }" @click="tab = 'appointments'">Appointments</button>
            <button :class="{ active: tab === 'prescriptions' }" @click="tab = 'prescriptions'">Prescriptions</button>
            <button :class="{ active: tab === 'bills' }" @click="tab = 'bills'">Bills</button>
          </div>

          <div v-if="tab === 'records'" class="tab-content">
            <table class="data-table" v-if="history.medical_records.length">
              <thead><tr><th>Date</th><th>Doctor</th><th>Diagnosis</th><th>Status</th></tr></thead>
              <tbody>
                <tr v-for="r in history.medical_records" :key="r.id">
                  <td>{{ formatDate(r.record_date) }}</td>
                  <td>Dr. {{ r.doctor_first_name }} {{ r.doctor_last_name }}</td>
                  <td>{{ r.diagnosis || '-' }}</td>
                  <td><span class="badge" :class="'badge-' + getStatusColor(r.status)">{{ r.status }}</span></td>
                </tr>
              </tbody>
            </table>
            <div v-else class="empty-tab"><span class="empty-icon">📋</span><p>No medical records found.</p></div>
          </div>

          <div v-if="tab === 'appointments'" class="tab-content">
            <table class="data-table" v-if="history.appointments.length">
              <thead><tr><th>Date</th><th>Time</th><th>Doctor</th><th>Type</th><th>Status</th></tr></thead>
              <tbody>
                <tr v-for="a in history.appointments" :key="a.id">
                  <td>{{ formatDate(a.appointment_date) }}</td>
                  <td>{{ formatTime(a.appointment_time) }}</td>
                  <td>Dr. {{ a.doctor_first_name }} {{ a.doctor_last_name }}</td>
                  <td>{{ a.type }}</td>
                  <td><span class="badge" :class="'badge-' + getStatusColor(a.status)">{{ a.status }}</span></td>
                </tr>
              </tbody>
            </table>
            <div v-else class="empty-tab"><span class="empty-icon">📅</span><p>No appointments found.</p></div>
          </div>

          <div v-if="tab === 'prescriptions'" class="tab-content">
            <table class="data-table" v-if="history.prescriptions.length">
              <thead><tr><th>Prescription #</th><th>Date</th><th>Doctor</th><th>Status</th></tr></thead>
              <tbody>
                <tr v-for="p in history.prescriptions" :key="p.id">
                  <td>{{ p.prescription_number }}</td>
                  <td>{{ formatDate(p.prescribed_date) }}</td>
                  <td>Dr. {{ p.doctor_first_name }} {{ p.doctor_last_name }}</td>
                  <td><span class="badge" :class="'badge-' + getStatusColor(p.status)">{{ p.status }}</span></td>
                </tr>
              </tbody>
            </table>
            <div v-else class="empty-tab"><span class="empty-icon">💊</span><p>No prescriptions found.</p></div>
          </div>

          <div v-if="tab === 'bills'" class="tab-content">
            <table class="data-table" v-if="history.bills.length">
              <thead><tr><th>Bill #</th><th>Date</th><th>Amount</th><th>Status</th></tr></thead>
              <tbody>
                <tr v-for="b in history.bills" :key="b.id">
                  <td>{{ b.bill_number }}</td>
                  <td>{{ formatDate(b.created_at) }}</td>
                  <td>{{ formatCurrency(b.net_amount) }}</td>
                  <td><span class="badge" :class="'badge-' + getStatusColor(b.payment_status)">{{ b.payment_status }}</span></td>
                </tr>
              </tbody>
            </table>
            <div v-else class="empty-tab"><span class="empty-icon">🧾</span><p>No bills found.</p></div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import axios from 'axios'
import { useToast } from '../../store/toast'
import { formatDate, formatTime, formatCurrency, getStatusColor } from '../../utils/helpers'

export default {
  name: 'PatientDetail',
  setup() {
    const route = useRoute()
    const toast = useToast()
    const patient = ref(null)
    const history = ref({ appointments: [], medical_records: [], prescriptions: [], bills: [] })
    const tab = ref('records')
    const showEditModal = ref(false)
    const loading = ref(true)

    onMounted(async () => {
      const id = route.params.id
      try {
        const [pRes, hRes] = await Promise.all([
          axios.get(`/api/patients/${id}`),
          axios.get(`/api/patients/${id}/history`)
        ])
        patient.value = pRes.data
        history.value = hRes.data
      } catch (e) {
        toast.error('Failed to load patient details.')
      } finally {
        loading.value = false
      }
    })

    return { patient, history, tab, showEditModal, loading, formatDate, formatTime, formatCurrency, getStatusColor }
  }
}
</script>

<style scoped>
.detail-header { display: flex; align-items: center; gap: 20px; margin-bottom: 24px; }
.patient-title { display: flex; align-items: center; gap: 16px; flex: 1; }
.patient-avatar-large {
  width: 56px; height: 56px; background: #0d9488; color: white;
  border-radius: 50%; display: flex; align-items: center;
  justify-content: center; font-weight: 700; font-size: 18px; flex-shrink: 0;
}
.detail-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.info-card { transition: box-shadow 0.2s; }
.info-card:hover { box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06); }
.info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.info-grid .full-width { grid-column: 1 / -1; }
.info-item { display: flex; flex-direction: column; gap: 4px; }
.info-item label { font-size: 11px; color: #94a3b8; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
.info-item span { font-size: 14px; color: #1e293b; }
.tabs { display: flex; gap: 0; border-bottom: 2px solid #e2e8f0; margin-bottom: 16px; }
.tabs button {
  padding: 10px 20px; border: none; background: none; cursor: pointer;
  font-size: 14px; color: #64748b; border-bottom: 2px solid transparent;
  margin-bottom: -2px; transition: all 0.2s;
}
.tabs button:hover { color: #475569; }
.tabs button.active { color: #0d9488; border-bottom-color: #0d9488; font-weight: 600; }
.tab-content { min-height: 100px; }
.empty-tab { text-align: center; padding: 40px 20px; color: #94a3b8; }
.empty-tab .empty-icon { font-size: 32px; display: block; margin-bottom: 8px; }

.loading-state { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 80px 20px; color: #64748b; }
.spinner { width: 40px; height: 40px; border: 4px solid #e2e8f0; border-top-color: #0d9488; border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 16px; }
@keyframes spin { to { transform: rotate(360deg); } }

.text-muted { color: #94a3b8; font-size: 12px; }
.text-danger { color: #ef4444; }
@media (max-width: 768px) { .detail-grid { grid-template-columns: 1fr; } .info-grid { grid-template-columns: 1fr; } }
</style>
