<template>
  <div class="emr-page">
    <div class="page-header">
      <div class="search-bar">
        <input type="text" v-model="search" placeholder="Search patient by name or MRN..." @input="searchPatients" />
        <div class="search-results" v-if="patientResults.length">
          <div class="result-item" v-for="p in patientResults" :key="p.id" @click="selectPatient(p)">
            {{ p.first_name }} {{ p.last_name }} ({{ p.mrn }})
          </div>
        </div>
      </div>
      <button class="btn btn-primary" @click="showNewModal = true" :disabled="!selectedPatient">+ New Record</button>
    </div>

    <div v-if="selectedPatient" class="selected-patient-banner">
      <span>Selected Patient: <strong>{{ selectedPatient.first_name }} {{ selectedPatient.last_name }}</strong> ({{ selectedPatient.mrn }})</span>
      <button class="btn btn-sm" @click="selectedPatient = null">Clear</button>
    </div>

    <div v-if="selectedPatient" class="card">
      <div class="card-header"><h3>Medical Records</h3></div>
      <div v-if="loadingRecords" class="loading-container">
        <div class="spinner"></div>
        <span class="loading-text">Loading records...</span>
      </div>
      <template v-else>
        <table class="data-table" v-if="records.length">
          <thead><tr><th>Date</th><th>Doctor</th><th>Diagnosis</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            <tr v-for="r in records" :key="r.id">
              <td>{{ formatDate(r.record_date) }}</td>
              <td>Dr. {{ r.doctor_first_name }} {{ r.doctor_last_name }}</td>
              <td>{{ r.diagnosis || '-' }}</td>
              <td><span class="badge" :class="'badge-' + getStatusColor(r.status)">{{ r.status }}</span></td>
              <td><router-link :to="`/emr/${r.id}`" class="btn btn-sm btn-outline">View</router-link></td>
            </tr>
          </tbody>
        </table>
        <div v-else class="empty-state">
          <div class="empty-icon">&#x1F4CB;</div>
          <p>No medical records found for this patient.</p>
          <span class="empty-hint">Click "+ New Record" to create the first record.</span>
        </div>
      </template>
    </div>

    <div v-if="!selectedPatient && !loadingPatients" class="empty-state full-page-empty">
      <div class="empty-icon">&#x1FA7A;</div>
      <p>Select a patient to view their medical records.</p>
      <span class="empty-hint">Type a name or MRN in the search bar above.</span>
    </div>

    <!-- New Record Modal -->
    <div class="modal-overlay" v-if="showNewModal" @click.self="showNewModal = false">
      <div class="modal modal-lg">
        <div class="modal-header">
          <h3>New Medical Record</h3>
          <button class="modal-close" @click="showNewModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <form @submit.prevent="createRecord">
            <div class="form-group">
              <label>Appointment (optional)</label>
              <select v-model="recordForm.appointment_id">
                <option value="">None</option>
              </select>
            </div>
            <div class="form-group">
              <label>Chief Complaint *</label>
              <textarea v-model="recordForm.chief_complaint" rows="2" required placeholder="Patient's main complaint..."></textarea>
            </div>
            <div class="form-group">
              <label>History of Present Illness</label>
              <textarea v-model="recordForm.history_of_present_illness" rows="3" placeholder="Detailed history..."></textarea>
            </div>
            <div class="form-row">
              <div class="form-group"><label>Blood Pressure</label><input v-model="vitalSigns.bp" placeholder="120/80" /></div>
              <div class="form-group"><label>Temperature</label><input v-model="vitalSigns.temp" placeholder="98.6&#176;F" /></div>
              <div class="form-group"><label>Pulse</label><input v-model="vitalSigns.pulse" placeholder="72 bpm" /></div>
              <div class="form-group"><label>Weight</label><input v-model="vitalSigns.weight" placeholder="70 kg" /></div>
            </div>
            <div class="form-group">
              <label>Physical Examination</label>
              <textarea v-model="recordForm.physical_examination" rows="3" placeholder="Examination findings..."></textarea>
            </div>
            <div class="form-group">
              <label>Diagnosis *</label>
              <textarea v-model="recordForm.diagnosis" rows="2" required placeholder="Primary diagnosis..."></textarea>
            </div>
            <div class="form-group">
              <label>Treatment Plan</label>
              <textarea v-model="recordForm.treatment_plan" rows="2" placeholder="Recommended treatment..."></textarea>
            </div>
            <div class="form-group">
              <label>Notes</label>
              <textarea v-model="recordForm.notes" rows="2" placeholder="Additional notes..."></textarea>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" @click="showNewModal = false">Cancel</button>
              <button type="submit" class="btn btn-primary" :disabled="saving">
                <span v-if="saving" class="spinner-sm"></span>
                {{ saving ? 'Saving...' : 'Create Record' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from 'axios'
import { useToast } from '../../store/toast'
import { formatDate, getStatusColor } from '../../utils/helpers'

export default {
  name: 'EMR',
  setup() {
    const router = useRouter()
    const route = useRoute()
    const toast = useToast()
    const search = ref('')
    const patientResults = ref([])
    const selectedPatient = ref(null)
    const records = ref([])
    const showNewModal = ref(false)
    const saving = ref(false)
    const loadingPatients = ref(false)
    const loadingRecords = ref(false)
    let timeout = null

    const vitalSigns = ref({ bp: '', temp: '', pulse: '', weight: '' })
    const recordForm = ref({
      appointment_id: '', chief_complaint: '', history_of_present_illness: '',
      physical_examination: '', diagnosis: '', treatment_plan: '', notes: ''
    })

    const searchPatients = () => {
      clearTimeout(timeout)
      timeout = setTimeout(async () => {
        if (search.value.length < 2) { patientResults.value = []; return }
        loadingPatients.value = true
        try {
          const { data } = await axios.get('/api/patients', { params: { search: search.value, limit: 5 } })
          patientResults.value = data.patients
        } catch (e) {
          toast.error('Failed to search patients')
        } finally {
          loadingPatients.value = false
        }
      }, 300)
    }

    const selectPatient = async (p) => {
      selectedPatient.value = p
      search.value = ''
      patientResults.value = []
      loadingRecords.value = true
      try {
        const { data } = await axios.get(`/api/emr/patient/${p.id}`)
        records.value = data
      } catch (e) {
        toast.error('Failed to load medical records')
      } finally {
        loadingRecords.value = false
      }
    }

    const createRecord = async () => {
      saving.value = true
      try {
        const payload = { ...recordForm.value, patient_id: selectedPatient.value.id, vital_signs: vitalSigns.value }
        const { data } = await axios.post('/api/emr', payload)
        showNewModal.value = false
        toast.success('Medical record created successfully')
        router.push(`/emr/${data.id}`)
      } catch (e) {
        toast.error(e.response?.data?.message || 'Error creating record')
      } finally {
        saving.value = false
      }
    }

    onMounted(async () => {
      const patientId = route.query.patient_id
      if (!patientId) return
      try {
        const { data } = await axios.get(`/api/patients/${encodeURIComponent(patientId)}`)
        await selectPatient(data)
      } catch (e) {
        toast.error('Unable to load the selected patient')
      }
    })

    return { search, patientResults, selectedPatient, records, showNewModal, saving, loadingPatients, loadingRecords, vitalSigns, recordForm, searchPatients, selectPatient, createRecord, formatDate, getStatusColor }
  }
}
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; margin-bottom: 20px; gap: 16px; }
.search-bar { position: relative; flex: 1; max-width: 400px; }
.search-bar input { width: 100%; padding: 10px 16px; border: 1px solid var(--gray-200); border-radius: 8px; font-size: 14px; }
.search-results { position: absolute; top: 100%; left: 0; right: 0; background: var(--white); border: 1px solid var(--gray-200); border-radius: 8px; max-height: 200px; overflow-y: auto; z-index: 10; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
.result-item { padding: 10px 14px; cursor: pointer; font-size: 14px; }
.result-item:hover { background: var(--brand-50); }
.selected-patient-banner { background: var(--brand-50); padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; border: 1px solid #99f6e4; }
.modal-lg { max-width: 700px; }
.modal-close { background: none; border: none; font-size: 24px; cursor: pointer; color: var(--gray-500); }

.loading-container { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 40px 20px; }
.spinner { width: 36px; height: 36px; border: 3px solid var(--gray-200); border-top-color: #0d9488; border-radius: 50%; animation: spin 0.8s linear infinite; }
.spinner-sm { display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: spin 0.8s linear infinite; margin-right: 6px; vertical-align: middle; }
@keyframes spin { to { transform: rotate(360deg); } }
.loading-text { font-size: 14px; color: var(--gray-400); }

.empty-state { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 48px 20px; text-align: center; }
.empty-icon { font-size: 48px; line-height: 1; }
.empty-state p { font-size: 15px; color: var(--gray-600); margin: 0; }
.empty-hint { font-size: 13px; color: var(--gray-400); }
.full-page-empty { padding: 80px 20px; }

/* Responsive */
@media (max-width: 768px) {
  .page-header {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }
  .page-header .search-bar {
    max-width: 100%;
    width: 100%;
  }
  .page-header .btn {
    width: 100%;
  }
  .selected-patient-banner {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
  .selected-patient-banner .btn {
    align-self: flex-end;
  }
}
</style>
