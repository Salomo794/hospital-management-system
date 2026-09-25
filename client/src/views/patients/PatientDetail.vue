<template>
  <div class="patient-detail">
    <div v-if="loading" class="loading-state">
      <div class="spinner"></div>
      <p>Loading patient details...</p>
    </div>

    <div v-else-if="error" class="loading-state">
      <p>{{ error }}</p>
      <button class="btn btn-primary" @click="loadPatient">Retry</button>
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
        <div class="header-actions">
          <button
            v-if="canResetPortalPin"
            class="btn btn-outline"
            :disabled="resettingPortalPin"
            @click="resetPortalPin"
          >
            {{ resettingPortalPin ? 'Resetting…' : 'Reset Portal PIN' }}
          </button>
          <button class="btn btn-primary" @click="openEditModal">Edit Profile</button>
        </div>
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

      <div v-if="newPortalPin" class="portal-pin-notice" role="status">
        <div>
          <strong>New portal PIN: {{ newPortalPin }}</strong>
          <span>Share it securely with the patient. It will not be shown again.</span>
        </div>
        <button class="btn btn-sm btn-secondary" @click="newPortalPin = ''">Dismiss</button>
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

    <Teleport to="body">
      <div v-if="showEditModal" class="modal-overlay" @click.self="closeEditModal">
        <form class="modal" @submit.prevent="savePatient">
          <div class="modal-header">
            <h3>Edit Patient Profile</h3>
            <button type="button" class="modal-close" @click="closeEditModal">&times;</button>
          </div>
          <div class="modal-body edit-grid">
            <label>First name<input v-model.trim="editForm.first_name" required /></label>
            <label>Last name<input v-model.trim="editForm.last_name" required /></label>
            <label>Date of birth<input v-model="editForm.date_of_birth" type="date" :max="today" required /></label>
            <label>Gender<select v-model="editForm.gender" required><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></select></label>
            <label>Blood type<select v-model="editForm.blood_type"><option value="">Unknown</option><option v-for="type in bloodTypes" :key="type">{{ type }}</option></select></label>
            <label>Phone<input v-model.trim="editForm.phone" /></label>
            <label class="full">Email<input v-model.trim="editForm.email" type="email" /></label>
            <label class="full">Address<input v-model.trim="editForm.address" /></label>
            <label>Emergency contact<input v-model.trim="editForm.emergency_contact_name" /></label>
            <label>Emergency phone<input v-model.trim="editForm.emergency_contact_phone" /></label>
            <label>Insurance provider<input v-model.trim="editForm.insurance_provider" /></label>
            <label>Insurance number<input v-model.trim="editForm.insurance_number" /></label>
            <label class="full">Allergies<textarea v-model="editForm.allergies" rows="2" /></label>
            <label class="full">Chronic conditions<textarea v-model="editForm.chronic_conditions" rows="2" /></label>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" @click="closeEditModal">Cancel</button>
            <button type="submit" class="btn btn-primary" :disabled="saving">{{ saving ? 'Saving…' : 'Save Changes' }}</button>
          </div>
        </form>
      </div>
    </Teleport>
  </div>
</template>

<script>
import { computed, ref, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import axios from 'axios'
import { useToast } from '../../store/toast'
import { useAuthStore } from '../../store/auth'
import { formatDate, formatTime, formatCurrency, getStatusColor } from '../../utils/helpers'

const emptyEditForm = () => ({
  first_name: '', last_name: '', date_of_birth: '', gender: 'other', blood_type: '',
  phone: '', email: '', address: '', emergency_contact_name: '', emergency_contact_phone: '',
  insurance_provider: '', insurance_number: '', allergies: '', chronic_conditions: ''
})

export default {
  name: 'PatientDetail',
  setup() {
    const route = useRoute()
    const toast = useToast()
    const auth = useAuthStore()
    const patient = ref(null)
    const history = ref({ appointments: [], medical_records: [], prescriptions: [], bills: [] })
    const tab = ref('records')
    const showEditModal = ref(false)
    const loading = ref(true)
    const saving = ref(false)
    const error = ref('')
    const editForm = ref(emptyEditForm())
    const resettingPortalPin = ref(false)
    const newPortalPin = ref('')
    const canResetPortalPin = computed(() => ['admin', 'receptionist'].includes(auth.userRole))
    const today = new Date().toISOString().slice(0, 10)
    const bloodTypes = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']

    const loadPatient = async () => {
      const id = route.params.id
      loading.value = true
      error.value = ''
      patient.value = null
      newPortalPin.value = ''
      try {
        const patientResponse = await axios.get(`/api/patients/${id}`)
        patient.value = patientResponse.data
        try {
          const historyResponse = await axios.get(`/api/patients/${id}/history`)
          history.value = historyResponse.data
        } catch {
          history.value = { appointments: [], medical_records: [], prescriptions: [], bills: [] }
          toast.warning('Patient loaded, but medical history could not be retrieved.')
        }
      } catch (requestError) {
        error.value = requestError.response?.data?.message || 'Failed to load patient details.'
      } finally {
        loading.value = false
      }
    }

    const openEditModal = () => {
      if (!patient.value) return
      editForm.value = {
        first_name: patient.value.first_name || '', last_name: patient.value.last_name || '',
        date_of_birth: patient.value.date_of_birth || '', gender: patient.value.gender || 'other',
        blood_type: patient.value.blood_type || '', phone: patient.value.phone || '',
        email: patient.value.email || '', address: patient.value.address || '',
        emergency_contact_name: patient.value.emergency_contact_name || '',
        emergency_contact_phone: patient.value.emergency_contact_phone || '',
        insurance_provider: patient.value.insurance_provider || '',
        insurance_number: patient.value.insurance_number || '',
        allergies: patient.value.allergies || '', chronic_conditions: patient.value.chronic_conditions || ''
      }
      showEditModal.value = true
    }

    const closeEditModal = () => { showEditModal.value = false }
    const savePatient = async () => {
      saving.value = true
      try {
        const { data } = await axios.put(`/api/patients/${patient.value.id}`, editForm.value)
        patient.value = data
        showEditModal.value = false
        toast.success('Patient updated successfully.')
      } catch (requestError) {
        toast.error(requestError.response?.data?.message || 'Failed to update patient.')
      } finally {
        saving.value = false
      }
    }

    const resetPortalPin = async () => {
      if (!patient.value || resettingPortalPin.value) return
      const confirmed = window.confirm(`Reset the portal PIN for ${patient.value.first_name} ${patient.value.last_name}? The current PIN will stop working immediately.`)
      if (!confirmed) return
      resettingPortalPin.value = true
      try {
        const { data } = await axios.post(`/api/patients/${patient.value.id}/portal-pin`)
        newPortalPin.value = data.plain_pin
        patient.value.portal_pin_provisioned = true
        toast.success('Portal PIN reset successfully.')
      } catch (requestError) {
        toast.error(requestError.response?.data?.message || 'Failed to reset portal PIN.')
      } finally {
        resettingPortalPin.value = false
      }
    }

    onMounted(loadPatient)
    watch(() => route.params.id, loadPatient)

    return {
      patient, history, tab, showEditModal, loading, saving, error, editForm,
      resettingPortalPin, newPortalPin, canResetPortalPin,
      today, bloodTypes, formatDate, formatTime, formatCurrency, getStatusColor,
      loadPatient, openEditModal, closeEditModal, savePatient, resetPortalPin
    }
  }
}
</script>

<style scoped>
.detail-header { display: flex; align-items: center; gap: 20px; margin-bottom: 24px; }
.header-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.portal-pin-notice { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 20px; padding: 14px 16px; border: 1px solid var(--brand-200); border-radius: 10px; background: var(--brand-50); }
.portal-pin-notice div { display: grid; gap: 4px; }
.portal-pin-notice span { color: var(--gray-600); font-size: 12px; }
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
.info-item label { font-size: 11px; color: var(--gray-400); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
.info-item span { font-size: 14px; color: var(--gray-800); }
.tabs { display: flex; gap: 0; border-bottom: 2px solid var(--gray-200); margin-bottom: 16px; }
.tabs button {
  padding: 10px 20px; border: none; background: none; cursor: pointer;
  font-size: 14px; color: var(--gray-500); border-bottom: 2px solid transparent;
  margin-bottom: -2px; transition: all 0.2s;
}
.tabs button:hover { color: var(--gray-600); }
.tabs button.active { color: #0d9488; border-bottom-color: #0d9488; font-weight: 600; }
.tab-content { min-height: 100px; }
.empty-tab { text-align: center; padding: 40px 20px; color: var(--gray-400); }
.empty-tab .empty-icon { font-size: 32px; display: block; margin-bottom: 8px; }

.loading-state { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 80px 20px; color: var(--gray-500); }
.spinner { width: 40px; height: 40px; border: 4px solid var(--gray-200); border-top-color: #0d9488; border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 16px; }
@keyframes spin { to { transform: rotate(360deg); } }

.text-muted { color: var(--gray-400); font-size: 12px; }
.text-danger { color: #ef4444; }
.edit-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.edit-grid label { display: grid; gap: 6px; color: var(--gray-600); font-size: 13px; font-weight: 600; }
.edit-grid .full { grid-column: 1 / -1; }
.edit-grid input, .edit-grid select, .edit-grid textarea { width: 100%; }
@media (max-width: 768px) {
  .detail-grid { grid-template-columns: 1fr; }
  .edit-grid { grid-template-columns: 1fr; }
  .edit-grid .full { grid-column: auto; }
  .info-grid { grid-template-columns: 1fr; }
  .detail-header { flex-wrap: wrap; gap: 12px; }
  .tabs { overflow-x: auto; white-space: nowrap; }
  .tabs button { flex: 1; padding: 10px 14px; }
}
@media (max-width: 480px) {
  .patient-title { flex-wrap: wrap; }
}
</style>
