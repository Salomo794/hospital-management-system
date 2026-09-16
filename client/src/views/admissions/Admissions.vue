<template>
  <div class="admissions-page">
    <div class="page-header">
      <div class="header-left">
        <div class="stats-row">
          <div class="stat-chip" v-for="s in statChips" :key="s.label">
            <strong :style="{ color: s.color }">{{ s.value }}</strong>
            <span>{{ s.label }}</span>
          </div>
        </div>
      </div>
      <div class="header-actions">
        <div class="filter-group">
          <select v-model="statusFilter" @change="page = 1; loadAdmissions()">
            <option value="">All Status</option>
            <option value="admitted">Admitted</option>
            <option value="transferred">Transferred</option>
            <option value="discharged">Discharged</option>
          </select>
        </div>
        <button class="btn btn-primary" @click="openModal()">+ New Admission</button>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h3>Admissions ({{ total }})</h3>
      </div>

      <div v-if="loading" class="loading-container">
        <div class="spinner"></div>
        <span>Loading admissions...</span>
      </div>

      <template v-else>
        <table class="data-table" v-if="admissions.length">
          <thead>
            <tr>
              <th>Admission #</th>
              <th>Patient</th>
              <th>Doctor</th>
              <th>Ward / Bed</th>
              <th>Admitted</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in admissions" :key="a.id">
              <td class="text-mono">{{ a.admission_number }}</td>
              <td>{{ a.patient_first_name }} {{ a.patient_last_name }}</td>
              <td>Dr. {{ a.doctor_first_name }} {{ a.doctor_last_name }}</td>
              <td>{{ a.ward || '-' }} {{ a.bed_number ? '/ ' + a.bed_number : '' }}</td>
              <td>{{ formatDateTime(a.admission_date) }}</td>
              <td><span class="badge" :class="'badge-' + getStatusColor(a.status)">{{ a.status }}</span></td>
              <td>
                <div class="btn-group">
                  <button class="btn btn-sm btn-secondary" @click="openModal(a)">Edit</button>
                  <button v-if="a.status === 'admitted'" class="btn btn-sm btn-primary" @click="openTransferModal(a)">Transfer</button>
                  <button v-if="a.status !== 'discharged'" class="btn btn-sm btn-success" @click="discharge(a)">Discharge</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        <div v-else class="empty-state">
          <div class="empty-icon">🏥</div>
          <p>No admissions found.</p>
        </div>
      </template>

      <div class="pagination" v-if="total > limit">
        <button class="btn btn-sm" :disabled="page <= 1" @click="page--; loadAdmissions()">Prev</button>
        <span>Page {{ page }} of {{ Math.ceil(total / limit) }}</span>
        <button class="btn btn-sm" :disabled="page >= Math.ceil(total / limit)" @click="page++; loadAdmissions()">Next</button>
      </div>
    </div>

    <div class="modal-overlay" v-if="showModal" @click.self="showModal = false">
      <div class="modal">
        <div class="modal-header">
          <h3>{{ form.id ? 'Edit Admission' : 'New Admission' }}</h3>
          <button class="modal-close" @click="showModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="alert alert-danger" v-if="formError">{{ formError }}</div>
          <form @submit.prevent="saveAdmission">
            <div class="form-group">
              <label>Patient *</label>
              <input
                v-model="patientSearch"
                placeholder="Search patient by name or MRN..."
                @input="searchPatients"
                :disabled="!!form.patient_id"
              />
              <div class="search-results" v-if="patientResults.length">
                <div class="result-item" v-for="p in patientResults" :key="p.id" @click="selectPatient(p)">
                  {{ p.first_name }} {{ p.last_name }} <span class="text-muted">({{ p.mrn }})</span>
                </div>
              </div>
              <div v-if="form.patient_id" class="selected-item">
                <span class="selected-label">Selected:</span> <strong>{{ form.patientName }}</strong>
                <button type="button" class="btn-clear" @click="clearPatient">&times;</button>
              </div>
            </div>
            <div class="form-group">
              <label>Doctor *</label>
              <select v-model="form.doctor_id" required>
                <option value="">Select Doctor</option>
                <option v-for="d in doctors" :key="d.id" :value="d.id">
                  Dr. {{ d.first_name }} {{ d.last_name }}
                </option>
              </select>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Ward</label>
                <input v-model="form.ward" placeholder="e.g. Ward A / ICU" />
              </div>
              <div class="form-group">
                <label>Bed Number</label>
                <input v-model="form.bed_number" placeholder="e.g. B-102" />
              </div>
            </div>
            <div class="form-group">
              <label>Diagnosis</label>
              <textarea v-model="form.diagnosis" rows="2"></textarea>
            </div>
            <div class="form-group">
              <label>Treatment Plan</label>
              <textarea v-model="form.treatment_plan" rows="2"></textarea>
            </div>
            <div class="form-group">
              <label>Notes</label>
              <textarea v-model="form.notes" rows="2"></textarea>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" @click="showModal = false">Cancel</button>
              <button type="submit" class="btn btn-primary" :disabled="saving">
                {{ saving ? 'Saving...' : form.id ? 'Save Changes' : 'Admit Patient' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>

    <div class="modal-overlay" v-if="showTransferModal" @click.self="showTransferModal = false">
      <div class="modal">
        <div class="modal-header">
          <h3>Transfer Patient</h3>
          <button class="modal-close" @click="showTransferModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <form @submit.prevent="transfer">
            <div class="form-group">
              <label>New Ward</label>
              <input v-model="transferForm.ward" placeholder="e.g. ICU" required />
            </div>
            <div class="form-group">
              <label>New Bed Number</label>
              <input v-model="transferForm.bed_number" placeholder="e.g. B-204" />
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" @click="showTransferModal = false">Cancel</button>
              <button type="submit" class="btn btn-primary">Transfer</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, onMounted, computed } from 'vue'
import axios from 'axios'
import { useToast } from '../../store/toast'
import { useConfirm } from '../../store/confirm'
import { formatDateTime, getStatusColor } from '../../utils/helpers'

export default {
  name: 'Admissions',
  setup() {
    const toast = useToast()
    const confirmModal = useConfirm()

    const admissions = ref([])
    const doctors = ref([])
    const stats = ref({})
    const total = ref(0)
    const page = ref(1)
    const limit = ref(20)
    const statusFilter = ref('')
    const loading = ref(false)
    const showModal = ref(false)
    const showTransferModal = ref(false)
    const saving = ref(false)
    const formError = ref('')
    const patientSearch = ref('')
    const patientResults = ref([])
    const transferForm = ref({ ward: '', bed_number: '' })
    const transferringId = ref(null)

    const statChips = computed(() => [
      { label: 'Admitted', value: stats.value.admitted || 0, color: '#2563eb' },
      { label: 'Transferred', value: stats.value.transferred || 0, color: '#d97706' },
      { label: 'Discharged', value: stats.value.discharged || 0, color: '#059669' },
      { label: 'Occupied Beds', value: stats.value.occupiedBeds || 0, color: '#0d9488' }
    ])

    const defaultForm = () => ({
      id: null,
      patient_id: null,
      patientName: '',
      doctor_id: '',
      ward: '',
      bed_number: '',
      diagnosis: '',
      treatment_plan: '',
      notes: ''
    })

    const form = ref(defaultForm())

    const loadAdmissions = async () => {
      loading.value = true
      try {
        const params = { page: page.value, limit: limit.value }
        if (statusFilter.value) params.status = statusFilter.value
        const { data } = await axios.get('/api/admissions', { params })
        admissions.value = data.admissions
        total.value = data.total
      } catch (e) {
        toast.error('Failed to load admissions')
      } finally {
        loading.value = false
      }
    }

    const loadStats = async () => {
      try {
        const { data } = await axios.get('/api/admissions/stats')
        stats.value = data
      } catch (e) { /* silent */ }
    }

    const loadDoctors = async () => {
      try {
        const { data } = await axios.get('/api/doctors')
        doctors.value = data.doctors
      } catch (e) {
        toast.error('Failed to load doctors')
      }
    }

    const searchPatients = async () => {
      if (patientSearch.value.length < 2) {
        patientResults.value = []
        return
      }
      try {
        const { data } = await axios.get('/api/patients', { params: { search: patientSearch.value, limit: 5 } })
        patientResults.value = data.patients
      } catch (e) { /* silent */ }
    }

    const selectPatient = (p) => {
      form.value.patient_id = p.id
      form.value.patientName = `${p.first_name} ${p.last_name}`
      patientSearch.value = ''
      patientResults.value = []
    }

    const clearPatient = () => {
      form.value.patient_id = null
      form.value.patientName = ''
    }

    const openModal = (admission = null) => {
      form.value = defaultForm()
      if (admission) {
        form.value = {
          id: admission.id,
          patient_id: admission.patient_id,
          patientName: `${admission.patient_first_name} ${admission.patient_last_name}`,
          doctor_id: admission.doctor_id,
          ward: admission.ward,
          bed_number: admission.bed_number,
          diagnosis: admission.diagnosis,
          treatment_plan: admission.treatment_plan,
          notes: admission.notes
        }
      }
      showModal.value = true
    }

    const saveAdmission = async () => {
      if (!form.value.patient_id) {
        formError.value = 'Please select a patient'
        return
      }
      saving.value = true
      formError.value = ''
      try {
        if (form.value.id) {
          await axios.put(`/api/admissions/${form.value.id}`, form.value)
          toast.success('Admission updated')
        } else {
          await axios.post('/api/admissions', form.value)
          toast.success('Patient admitted successfully')
        }
        showModal.value = false
        loadAdmissions()
        loadStats()
      } catch (e) {
        formError.value = e.response?.data?.message || 'Error saving admission'
        toast.error(formError.value)
      } finally {
        saving.value = false
      }
    }

    const openTransferModal = (admission) => {
      transferringId.value = admission.id
      transferForm.value = { ward: admission.ward || '', bed_number: admission.bed_number || '' }
      showTransferModal.value = true
    }

    const transfer = async () => {
      try {
        await axios.put(`/api/admissions/${transferringId.value}/transfer`, transferForm.value)
        toast.success('Patient transferred')
        showTransferModal.value = false
        loadAdmissions()
        loadStats()
      } catch (e) {
        toast.error('Error transferring patient')
      }
    }

    const discharge = async (admission) => {
      const ok = await confirmModal.confirm({
        title: 'Discharge Patient',
        message: `Discharge ${admission.patient_first_name} ${admission.patient_last_name}?`
      })
      if (ok) {
        try {
          await axios.put(`/api/admissions/${admission.id}/discharge`)
          toast.success('Patient discharged')
          loadAdmissions()
          loadStats()
        } catch (e) {
          toast.error('Error discharging patient')
        }
      }
    }

    onMounted(() => {
      loadAdmissions()
      loadStats()
      loadDoctors()
    })

    return {
      admissions, doctors, stats, statChips, total, page, limit, statusFilter, loading,
      showModal, showTransferModal, saving, formError, patientSearch, patientResults, transferForm, form,
      loadAdmissions, searchPatients, selectPatient, clearPatient, openModal,
      saveAdmission, openTransferModal, transfer, discharge,
      formatDateTime, getStatusColor
    }
  }
}
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; gap: 16px; flex-wrap: wrap; }
.header-left { display: flex; align-items: center; }
.header-actions { display: flex; gap: 12px; align-items: center; }
.stats-row { display: flex; gap: 12px; flex-wrap: wrap; }
.stat-chip {
  display: flex; flex-direction: column; align-items: center;
  background: white; border-radius: 10px; padding: 8px 18px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08); min-width: 90px;
}
.stat-chip strong { font-size: 18px; }
.stat-chip span { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.3px; }

.filter-group select { padding: 10px 16px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px; background: white; }
.filter-group select:focus { outline: none; border-color: #0d9488; }

.text-mono { font-family: monospace; font-size: 13px; }
.btn-group { display: flex; gap: 6px; }

.loading-container { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 48px 20px; color: #64748b; gap: 12px; }
.spinner { width: 36px; height: 36px; border: 3px solid #e2e8f0; border-top-color: #0d9488; border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.empty-state { text-align: center; padding: 48px 20px; color: #64748b; }
.empty-icon { font-size: 48px; margin-bottom: 12px; }

.pagination { display: flex; justify-content: center; align-items: center; gap: 16px; padding: 16px; border-top: 1px solid #f1f5f9; }

.modal-close { background: none; border: none; font-size: 24px; cursor: pointer; color: #64748b; }
.modal-close:hover { color: #1e293b; }

.search-results { border: 1px solid #e2e8f0; border-radius: 8px; max-height: 150px; overflow-y: auto; margin-top: 4px; }
.result-item { padding: 10px 12px; cursor: pointer; font-size: 14px; transition: background 0.15s; }
.result-item:hover { background: #f0fdfa; }
.selected-item { padding: 8px 12px; background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 6px; margin-top: 4px; font-size: 14px; display: flex; align-items: center; gap: 8px; }
.selected-label { color: #64748b; }
.btn-clear { background: none; border: none; font-size: 18px; cursor: pointer; color: #94a3b8; padding: 0 4px; }
.btn-clear:hover { color: #ef4444; }
.text-muted { color: #94a3b8; }

@media (max-width: 768px) {
  .page-header { flex-direction: column; align-items: stretch; }
  .header-actions { flex-direction: column; }
  .filter-group select { width: 100%; }
}
</style>