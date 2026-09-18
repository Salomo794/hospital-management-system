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

    <div class="card triage-panel" v-if="queue.length">
      <div class="card-header">
        <h3>Priority Triage Queue <span class="pill" v-if="stats.critical || 0">({{ stats.critical }} critical)</span></h3>
        <button class="btn btn-sm btn-secondary" @click="loadQueue">Refresh</button>
      </div>
      <div v-if="queueLoading" class="loading-container">
        <div class="spinner"></div>
      </div>
      <ul v-else class="queue-list">
        <li v-for="q in queue" :key="q.id" class="queue-item">
          <div class="queue-rank" :class="'rank-' + q.triage_severity">{{ q.queue_position }}</div>
          <div class="queue-body">
            <div class="queue-top">
              <span class="badge" :class="'badge-' + getStatusColor(q.triage_severity)">{{ q.triage_severity }}</span>
              <strong>{{ q.patient_first_name }} {{ q.patient_last_name }}</strong>
              <span class="queue-wait" :title="formatDateTime(q.admission_date)">
                ⏱ {{ formatWait(q.wait_hours) }}
              </span>
            </div>
            <div class="queue-complaint" v-if="q.chief_complaint">{{ q.chief_complaint }}</div>
            <div class="priority-bar">
              <div class="priority-fill" :style="{ width: (q.priority || q.triage_score || 0) + '%', background: priorityColor(q.triage_severity) }"></div>
            </div>
            <div class="queue-meta">
              Score {{ q.triage_score }} · {{ q.ward || 'Unassigned' }} · <span class="text-muted">{{ q.mrn }}</span>
            </div>
          </div>
        </li>
      </ul>
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
              <th>Triage</th>
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
              <td>
                <span class="badge" :class="'badge-' + getStatusColor(a.triage_severity || 'low')">
                  {{ a.triage_severity || 'low' }}
                </span>
                <span class="triage-score" v-if="a.triage_score">({{ a.triage_score }})</span>
              </td>
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
              <label>Chief Complaint</label>
              <textarea v-model="form.chief_complaint" rows="2" placeholder="e.g. Severe chest pain, difficulty breathing"></textarea>
            </div>
            <div class="form-row">
              <div class="form-group" style="flex: 1.4;">
                <label>Triage Severity</label>
                <select v-model="form.triage_severity">
                  <option value="">Auto-classify</option>
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="moderate">Moderate</option>
                  <option value="low">Low</option>
                </select>
              </div>
              <div class="form-group triage-score-box" style="flex: 1;">
                <label>Est. Triage Score</label>
                <div class="triage-score-display">
                  <span class="badge" :class="'badge-' + getStatusColor(triagePreview.severity)">{{ triagePreview.severity }}</span>
                  <strong>{{ triagePreview.score }}</strong>
                  <span class="text-muted" v-if="!form.chief_complaint">—</span>
                </div>
                <small class="text-muted">Auto-computed from complaint</small>
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
    const queue = ref([])
    const queueLoading = ref(false)
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
      { label: 'Critical', value: stats.value.critical || 0, color: '#ef4444' },
      { label: 'Occupied Beds', value: stats.value.occupiedBeds || 0, color: '#0d9488' }
    ])

    const PRIORITY_COLORS = {
      critical: '#ef4444',
      high: '#d97706',
      moderate: '#3b82f6',
      low: '#059669'
    }

    const SEVERITY_BUCKETS = [
      { level: 'critical', score: 45, words: ['cardiac arrest', 'respiratory arrest', 'unconscious', 'unresponsive', 'seizure', 'stroke', 'anaphylaxis', 'hemorrhage', 'haemorrhage', 'severe bleeding', 'overdose', 'ventilated', 'intubated', 'status epilepticus'] },
      { level: 'high', score: 22, words: ['chest pain', 'shortness of breath', 'breathing difficulty', 'difficulty breathing', 'palpitations', 'dizziness', 'head injury', 'fracture', 'high fever', 'severe headache', 'hypertensive crisis', 'stroke-like', 'slurred speech', 'atrial fibrillation', 'heart failure', 'copd', 'acute asthma', 'severe allergic', 'blood pressure'] },
      { level: 'moderate', score: 10, words: ['wheezing', 'asthma', 'pneumonia', 'infection', 'dehydration', 'vomiting', 'diarrhea', 'abdominal pain', 'burn', 'wound', 'fever', 'cough', 'sore throat', 'migraine', 'kidney stone', 'uti', 'low blood sugar', 'hypoglycemia'] },
      { level: 'low', score: 4, words: ['checkup', 'follow-up', 'routine', 'review', 'refill', 'screening', 'blood work', 'pre-operative'] }
    ]

    const triagePreview = computed(() => {
      const text = (form.value.chief_complaint || '')
      if (!text.trim()) {
        return { score: 0, severity: form.value.triage_severity || 'low' }
      }
      const lower = text.toLowerCase()
      let score = 0
      let hasCritical = false
      for (const bucket of SEVERITY_BUCKETS) {
        for (const word of bucket.words) {
          if (lower.includes(word.toLowerCase())) {
            score += bucket.score
            if (bucket.level === 'critical') hasCritical = true
          }
        }
      }
      if (hasCritical) score = Math.max(score, 85)
      const floor = { critical: 65, high: 35, moderate: 15, low: 0 }
      let severity = score >= 65 ? 'critical' : score >= 35 ? 'high' : score >= 15 ? 'moderate' : 'low'
      if (form.value.triage_severity) severity = form.value.triage_severity
      if (score < floor[severity]) score = floor[severity]
      return { score: Math.min(100, score), severity }
    })

    const formatWait = (hours) => {
      if (hours === null || hours === undefined) return '-'
      if (hours < 1) return `${Math.round(hours * 60)}m`
      if (hours < 24) return `${Math.round(hours * 10) / 10}h`
      return `${Math.round(hours / 24)}d`
    }

    const priorityColor = (severity) => PRIORITY_COLORS[severity] || '#94a3b8'

    const defaultForm = () => ({
      id: null,
      patient_id: null,
      patientName: '',
      doctor_id: '',
      ward: '',
      bed_number: '',
      chief_complaint: '',
      triage_severity: '',
      triage_score: '',
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

    const loadQueue = async () => {
      queueLoading.value = true
      try {
        const { data } = await axios.get('/api/admissions/queue')
        queue.value = data.queue || []
      } catch (e) { /* silent */ } finally {
        queueLoading.value = false
      }
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
          chief_complaint: admission.chief_complaint || '',
          triage_severity: admission.triage_severity || '',
          triage_score: admission.triage_score || '',
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
        loadQueue()
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
        loadQueue()
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
          loadQueue()
        } catch (e) {
          toast.error('Error discharging patient')
        }
      }
    }

    onMounted(() => {
      loadAdmissions()
      loadStats()
      loadQueue()
      loadDoctors()
    })

    return {
      admissions, doctors, queue, queueLoading, stats, statChips, total, page, limit, statusFilter, loading,
      showModal, showTransferModal, saving, formError, patientSearch, patientResults, transferForm, form,
      triagePreview, formatWait, priorityColor,
      loadAdmissions, loadQueue, searchPatients, selectPatient, clearPatient, openModal,
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

.triage-panel { margin-bottom: 20px; }
.pill { display: inline-block; margin-left: 6px; padding: 2px 10px; background: #fee2e2; color: #ef4444; border-radius: 20px; font-size: 12px; font-weight: 600; vertical-align: middle; }
.queue-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
.queue-item { display: flex; gap: 12px; align-items: stretch; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; }
.queue-rank { display: flex; align-items: center; justify-content: center; min-width: 34px; height: 34px; border-radius: 8px; font-weight: 700; color: white; font-size: 14px; }
.rank-critical { background: #ef4444; }
.rank-high { background: #d97706; }
.rank-moderate { background: #3b82f6; }
.rank-low { background: #64748b; }
.queue-body { flex: 1; min-width: 0; }
.queue-top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.queue-wait { font-size: 12px; color: #64748b; white-space: nowrap; }
.queue-complaint { margin-top: 4px; color: #475569; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.queue-meta { margin-top: 6px; font-size: 12px; color: #64748b; display: flex; gap: 8px; }
.priority-bar { height: 5px; background: #e2e8f0; border-radius: 10px; margin-top: 6px; overflow: hidden; }
.priority-fill { height: 100%; border-radius: 10px; transition: width 0.4s ease; }
.triage-score { margin-left: 6px; font-size: 12px; color: #64748b; }
.triage-score-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 12px; }
.triage-score-display { display: flex; align-items: center; gap: 10px; font-size: 18px; }

@media (max-width: 768px) {
  .page-header { flex-direction: column; align-items: stretch; }
  .header-actions { flex-direction: column; }
  .filter-group select { width: 100%; }
}
</style>