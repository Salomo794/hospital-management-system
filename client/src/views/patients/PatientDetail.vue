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
        <button class="btn btn-primary" @click="openEdit">Edit Profile</button>
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

      <!-- Edit Profile Modal -->
      <div class="modal-overlay" v-if="showEditModal" @click.self="showEditModal = false">
        <div class="modal">
          <div class="modal-header">
            <h3>Edit Patient Profile</h3>
            <button class="modal-close" @click="showEditModal = false">&times;</button>
          </div>
          <div class="modal-body">
            <div class="alert alert-danger" v-if="editError">{{ editError }}</div>
            <form @submit.prevent="saveEdit">
              <div class="form-row">
                <div class="form-group">
                  <label>First Name *</label>
                  <input v-model="editForm.first_name" required />
                </div>
                <div class="form-group">
                  <label>Last Name *</label>
                  <input v-model="editForm.last_name" required />
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label>Date of Birth *</label>
                  <input type="date" v-model="editForm.date_of_birth" required />
                </div>
                <div class="form-group">
                  <label>Gender *</label>
                  <select v-model="editForm.gender" required>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label>Blood Type</label>
                  <select v-model="editForm.blood_type">
                    <option value="">Unknown</option>
                    <option v-for="bt in bloodTypes" :key="bt" :value="bt">{{ bt }}</option>
                  </select>
                </div>
                <div class="form-group">
                  <label>Phone</label>
                  <input v-model="editForm.phone" placeholder="e.g. +1 555 123 4567" />
                </div>
              </div>
              <div class="form-group">
                <label>Email</label>
                <input type="email" v-model="editForm.email" />
              </div>
              <div class="form-group">
                <label>Address</label>
                <input v-model="editForm.address" />
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label>Emergency Contact Name</label>
                  <input v-model="editForm.emergency_contact_name" />
                </div>
                <div class="form-group">
                  <label>Emergency Contact Phone</label>
                  <input v-model="editForm.emergency_contact_phone" />
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label>Insurance Provider</label>
                  <input v-model="editForm.insurance_provider" />
                </div>
                <div class="form-group">
                  <label>Insurance Number</label>
                  <input v-model="editForm.insurance_number" />
                </div>
              </div>
              <div class="form-group">
                <label>Allergies</label>
                <textarea v-model="editForm.allergies" rows="2" placeholder="e.g. Penicillin, peanuts"></textarea>
              </div>
              <div class="form-group">
                <label>Chronic Conditions</label>
                <textarea v-model="editForm.chronic_conditions" rows="2" placeholder="e.g. Hypertension, Type 2 diabetes"></textarea>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" @click="showEditModal = false">Cancel</button>
                <button type="submit" class="btn btn-primary" :disabled="savingEdit">
                  <span v-if="savingEdit" class="spinner-small"></span>
                  {{ savingEdit ? 'Saving...' : 'Save Changes' }}
                </button>
              </div>
            </form>
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

const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']

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
    const editForm = ref({})
    const editError = ref('')
    const savingEdit = ref(false)
    const bloodTypes = BLOOD_TYPES

    const openEdit = () => {
      const p = patient.value
      editForm.value = {
        first_name: p.first_name, last_name: p.last_name, date_of_birth: p.date_of_birth,
        gender: p.gender, blood_type: p.blood_type || '', phone: p.phone || '', email: p.email || '',
        address: p.address || '', emergency_contact_name: p.emergency_contact_name || '',
        emergency_contact_phone: p.emergency_contact_phone || '',
        insurance_provider: p.insurance_provider || '', insurance_number: p.insurance_number || '',
        allergies: p.allergies || '', chronic_conditions: p.chronic_conditions || ''
      }
      editError.value = ''
      showEditModal.value = true
    }

    const saveEdit = async () => {
      if (!editForm.value.first_name || !editForm.value.last_name || !editForm.value.date_of_birth || !editForm.value.gender) {
        editError.value = 'Please fill in all required fields'
        return
      }
      savingEdit.value = true
      editError.value = ''
      try {
        const { data } = await axios.put(`/api/patients/${route.params.id}`, editForm.value)
        patient.value = data
        showEditModal.value = false
        toast.success('Patient profile updated successfully')
      } catch (e) {
        editError.value = e.response?.data?.message || 'Error updating patient profile'
        toast.error(editError.value)
      } finally {
        savingEdit.value = false
      }
    }

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

    return { patient, history, tab, showEditModal, loading, editForm, editError, savingEdit, bloodTypes, openEdit, saveEdit, formatDate, formatTime, formatCurrency, getStatusColor }
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

.spinner-small {
  width: 14px; height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  display: inline-block;
  vertical-align: middle;
  margin-right: 6px;
}

@media (max-width: 768px) { .detail-grid { grid-template-columns: 1fr; } .info-grid { grid-template-columns: 1fr; } }
</style>
