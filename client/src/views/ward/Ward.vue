<template>
  <div class="ward-page">
    <div class="page-header">
      <div class="header-actions ml-auto">
        <button class="btn btn-outline" @click="loadAll">Refresh</button>
        <button class="btn btn-primary" @click="openAdmitModal" v-if="canAdmit">+ Admit Patient</button>
      </div>
    </div>

    <div v-if="loadingWards" class="loading-container">
      <div class="spinner"></div>
      <span class="loading-text">Loading ward occupancy...</span>
    </div>

    <template v-else>
      <!-- Occupancy summary -->
      <div class="stats-grid">
        <div class="stats-card">
          <div class="stats-icon" style="background:#0d9488;color:#fff">&#127973;</div>
          <div class="stats-info">
            <div class="stats-value">{{ totals.totalBeds }}</div>
            <div class="stats-label">Total Beds</div>
          </div>
        </div>
        <div class="stats-card">
          <div class="stats-icon" style="background:#ef4444;color:#fff">&#128101;</div>
          <div class="stats-info">
            <div class="stats-value">{{ totals.totalOccupied }}</div>
            <div class="stats-label">Occupied</div>
          </div>
        </div>
        <div class="stats-card">
          <div class="stats-icon" style="background:#10b981;color:#fff">&#9989;</div>
          <div class="stats-info">
            <div class="stats-value">{{ totals.totalAvailable }}</div>
            <div class="stats-label">Available</div>
          </div>
        </div>
        <div class="stats-card">
          <div class="stats-icon" style="background:#f59e0b;color:#fff">&#128200;</div>
          <div class="stats-info">
            <div class="stats-value">{{ totals.percentage }}%</div>
            <div class="stats-label">Occupancy Rate</div>
          </div>
        </div>
      </div>

      <!-- Ward cards with bed grid -->
      <div class="wards-grid">
        <div class="card ward-card" v-for="w in wards" :key="w.ward">
          <div class="card-header">
            <h3>{{ w.ward }}</h3>
            <span class="badge" :class="w.percentage >= 90 ? 'badge-danger' : w.percentage >= 60 ? 'badge-warning' : 'badge-success'">
              {{ w.occupied }}/{{ w.total }} full
            </span>
          </div>
          <div class="card-body">
            <div class="occupancy-bar">
              <div class="occupancy-fill" :style="{ width: w.percentage + '%', background: w.percentage >= 90 ? '#ef4444' : w.percentage >= 60 ? '#f59e0b' : '#10b981' }"></div>
            </div>
            <div class="bed-grid">
              <div
                v-for="b in w.beds"
                :key="b.bed"
                class="bed"
                :class="{ occupied: b.status === 'occupied' }"
                :title="b.status === 'occupied' ? `Bed ${b.bed} — ${b.diagnosis || 'Occupied'}` : `Bed ${b.bed} — Available`"
                @click="b.status === 'occupied' && selectBed(b, w.ward)"
              >
                {{ b.bed }}
              </div>
            </div>
            <div class="ward-foot">
              <span class="text-muted">{{ w.available }} available · {{ w.percentage }}% occupied</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Selected bed detail -->
      <div class="card selected-bed-card" v-if="selectedBed">
        <div class="card-header">
          <h3>Bed {{ selectedBed.bed }} — {{ selectedBed.ward }}</h3>
          <button class="btn btn-secondary btn-sm" @click="selectedBed = null">Close</button>
        </div>
        <div class="card-body">
          <div class="selected-bed-body">
            <div class="bed-detail-item"><span class="detail-label">Diagnosis</span><span>{{ selectedBed.diagnosis || '-' }}</span></div>
            <div class="bed-detail-item"><span class="detail-label">Patient ID</span><span>{{ selectedBed.patientId }}</span></div>
            <div class="bed-detail-item"><span class="detail-label">Admission #</span><span>{{ selectedBed.admissionId }}</span></div>
            <div class="bed-actions" v-if="canDischarge">
              <button class="btn btn-danger btn-sm" @click="dischargeAdmission(selectedBed.admissionId)">Discharge</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Admissions list -->
      <div class="card">
        <div class="card-header">
          <h3>Admissions ({{ totalAdmissions }})</h3>
        </div>
        <div class="card-body">
          <div class="search-filters">
            <input type="text" v-model="search" placeholder="Search patient / MRN / bed..." @keyup.enter="loadAdmissions" />
            <select v-model="statusFilter" @change="loadAdmissions">
              <option value="">All Statuses</option>
              <option value="admitted">Admitted</option>
              <option value="transferred">Transferred</option>
              <option value="discharged">Discharged</option>
            </select>
            <select v-model="wardFilter" @change="loadAdmissions">
              <option value="">All Wards</option>
              <option v-for="w in wards" :key="w.ward" :value="w.ward">{{ w.ward }}</option>
            </select>
          </div>
          <div v-if="loadingAdmissions" class="loading-container">
            <div class="spinner"></div>
            <span class="loading-text">Loading admissions...</span>
          </div>
          <table v-else-if="admissions.length" class="data-table">
            <thead>
              <tr>
                <th>Admission #</th><th>Patient</th><th>Ward</th><th>Bed</th><th>Diagnosis</th><th>Doctor</th><th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in admissions" :key="a.id">
                <td>{{ a.admission_number }}</td>
                <td>{{ a.patient_first_name }} {{ a.patient_last_name }} <span class="text-muted">({{ a.mrn }})</span></td>
                <td>{{ a.ward }}</td>
                <td>{{ a.bed_number || '-' }}</td>
                <td>{{ a.diagnosis || '-' }}</td>
                <td>Dr. {{ a.doctor_first_name }} {{ a.doctor_last_name }}</td>
                <td><span class="badge" :class="'badge-' + getStatusColor(a.status)">{{ getStatusLabel(a.status) }}</span></td>
                <td>
                  <button v-if="a.status === 'admitted' && canDischarge" class="btn btn-danger btn-sm" @click="dischargeAdmission(a.id)">Discharge</button>
                  <span v-else class="text-muted">-</span>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else class="empty-state">
            <div class="empty-icon">&#127973;</div>
            <p>No admissions found.</p>
            <span class="empty-hint">Adjust filters or admit a new patient.</span>
          </div>
        </div>
      </div>
    </template>

    <!-- Admit Modal -->
    <div class="modal-overlay" v-if="showAdmitModal" @click.self="showAdmitModal = false">
      <div class="modal modal-lg">
        <div class="modal-header">
          <h3>Admit Patient</h3>
          <button class="modal-close" @click="showAdmitModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <form @submit.prevent="submitAdmission">
            <div class="form-row">
              <div class="form-group">
                <label>Patient *</label>
                <input
                  type="text"
                  v-model="patientSearch"
                  placeholder="Search patient name or MRN..."
                  @input="filterPatients"
                />
                <select v-model="admitForm.patient_id" required class="mt-2">
                  <option value="">-- Select patient --</option>
                  <option v-for="p in filteredPatients" :key="p.id" :value="p.id">{{ p.first_name }} {{ p.last_name }} ({{ p.mrn }})</option>
                </select>
              </div>
              <div class="form-group">
                <label>Admitting Doctor *</label>
                <select v-model="admitForm.doctor_id" required>
                  <option value="">-- Select doctor --</option>
                  <option v-for="d in doctors" :key="d.id" :value="d.id">Dr. {{ d.first_name }} {{ d.last_name }}</option>
                </select>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Ward *</label>
                <select v-model="admitForm.ward" required>
                  <option value="">-- Select ward --</option>
                  <option v-for="w in wards" :key="w.ward" :value="w.ward">{{ w.ward }} ({{ w.available }} available)</option>
                </select>
              </div>
              <div class="form-group">
                <label>Bed Number</label>
                <input v-model="admitForm.bed_number" placeholder="Auto-assign if empty" />
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Triage Severity</label>
                <select v-model="admitForm.triage_severity">
                  <option value="">None</option>
                  <option value="minor">Minor</option>
                  <option value="moderate">Moderate</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
            </div>
            <div class="form-group">
              <label>Chief Complaint</label>
              <input v-model="admitForm.chief_complaint" />
            </div>
            <div class="form-group">
              <label>Diagnosis</label>
              <input v-model="admitForm.diagnosis" />
            </div>
            <div class="form-group">
              <label>Treatment Plan</label>
              <textarea v-model="admitForm.treatment_plan" rows="2"></textarea>
            </div>
            <div class="form-group">
              <label>Notes</label>
              <textarea v-model="admitForm.notes" rows="2"></textarea>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" @click="showAdmitModal = false">Cancel</button>
              <button type="submit" class="btn btn-primary" :disabled="savingAdmission">
                <span v-if="savingAdmission" class="spinner-sm"></span>
                {{ savingAdmission ? 'Admitting...' : 'Confirm Admission' }}
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
import axios from 'axios'
import { useToast } from '../../store/toast'
import { useAuthStore } from '../../store/auth'
import { getStatusColor, getStatusLabel } from '../../utils/helpers'

export default {
  name: 'Ward',
  setup() {
    const toast = useToast()
    const authStore = useAuthStore()

    const canAdmit = ['admin', 'doctor', 'nurse', 'receptionist'].includes(authStore.userRole)
    const canDischarge = ['admin', 'doctor', 'nurse', 'receptionist'].includes(authStore.userRole)

    const wards = ref([])
    const totals = ref({})
    const loadingWards = ref(true)
    const selectedBed = ref(null)

    const admissions = ref([])
    const totalAdmissions = ref(0)
    const loadingAdmissions = ref(false)
    const search = ref('')
    const statusFilter = ref('')
    const wardFilter = ref('')

    const showAdmitModal = ref(false)
    const savingAdmission = ref(false)
    const doctors = ref([])
    const patients = ref([])
    const filteredPatients = ref([])
    const patientSearch = ref('')
    const admitForm = ref({ patient_id: '', doctor_id: '', ward: '', bed_number: '', diagnosis: '', treatment_plan: '', notes: '', chief_complaint: '', triage_severity: '' })

    const loadWards = async () => {
      loadingWards.value = true
      try {
        const { data } = await axios.get('/api/admissions/wards')
        wards.value = data.wards
        totals.value = data.totals
      } catch (e) {
        toast.error('Failed to load ward data')
      } finally {
        loadingWards.value = false
      }
    }

    const loadAdmissions = async () => {
      loadingAdmissions.value = true
      try {
        const params = {}
        if (statusFilter.value) params.status = statusFilter.value
        if (wardFilter.value) params.ward = wardFilter.value
        if (search.value) params.search = search.value
        const { data } = await axios.get('/api/admissions', { params })
        admissions.value = data.admissions
        totalAdmissions.value = data.total
      } catch (e) {
        toast.error('Failed to load admissions')
      } finally {
        loadingAdmissions.value = false
      }
    }

    const loadAll = async () => {
      await Promise.all([loadWards(), loadAdmissions()])
    }

    const selectBed = (bed, ward) => {
      selectedBed.value = { ...bed, ward }
    }

    const openAdmitModal = async () => {
      showAdmitModal.value = true
      patientSearch.value = ''
      admitForm.value = { patient_id: '', doctor_id: '', ward: '', bed_number: '', diagnosis: '', treatment_plan: '', notes: '', chief_complaint: '', triage_severity: '' }
      patientSearch.value = ''
      filteredPatients.value = patients.value
      if (!doctors.value.length) {
        try {
          const { data } = await axios.get('/api/doctors')
          doctors.value = data.doctors || data
        } catch (e) {
          toast.error('Failed to load doctors')
        }
      }
      if (!patients.value.length) {
        try {
          const { data } = await axios.get('/api/patients', { params: { limit: 100 } })
          patients.value = data.patients || []
          filteredPatients.value = patients.value
        } catch (e) {
          toast.error('Failed to load patients')
        }
      }
    }

    const filterPatients = () => {
      const q = patientSearch.value.toLowerCase()
      if (!q) { filteredPatients.value = patients.value; return }
      filteredPatients.value = patients.value.filter(p =>
        (p.first_name + ' ' + p.last_name).toLowerCase().includes(q) ||
        (p.mrn || '').toLowerCase().includes(q)
      )
    }

    const submitAdmission = async () => {
      savingAdmission.value = true
      try {
        await axios.post('/api/admissions', admitForm.value)
        toast.success('Patient admitted successfully')
        showAdmitModal.value = false
        loadAll()
      } catch (e) {
        toast.error(e.response?.data?.message || 'Error admitting patient')
      } finally {
        savingAdmission.value = false
      }
    }

    const dischargeAdmission = async (id) => {
      if (!confirm('Discharge this admission?')) return
      try {
        await axios.post(`/api/admissions/${id}/discharge`)
        toast.success('Admission discharged')
        selectedBed.value = null
        loadAll()
      } catch (e) {
        toast.error(e.response?.data?.message || 'Error discharging admission')
      }
    }

    onMounted(loadAll)

    return {
      wards, totals, loadingWards, selectedBed, admissions, totalAdmissions, loadingAdmissions,
      search, statusFilter, wardFilter, canAdmit, canDischarge,
      showAdmitModal, savingAdmission, doctors, patients, filteredPatients, patientSearch, admitForm,
      loadAll, loadAdmissions, selectBed, openAdmitModal, filterPatients, submitAdmission,
      dischargeAdmission, getStatusColor, getStatusLabel
    }
  }
}
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.page-header h2 { margin: 0; font-size: 20px; color: var(--gray-800); }
.header-actions { display: flex; gap: 8px; }

.stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
.stats-card { background: var(--white); border-radius: 12px; padding: 20px; display: flex; align-items: center; gap: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
.stats-icon { width: 48px; height: 48px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 22px; flex-shrink: 0; }
.stats-value { font-size: 22px; font-weight: 700; color: var(--gray-800); }
.stats-label { font-size: 13px; color: var(--gray-500); }

.wards-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin-bottom: 24px; }
.ward-card .card-body { padding: 16px 20px; }
.occupancy-bar { height: 8px; background: var(--gray-200); border-radius: 4px; overflow: hidden; margin-bottom: 14px; }
.occupancy-fill { height: 100%; border-radius: 4px; transition: width 0.4s ease; }
.bed-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.bed {
  width: 38px; height: 38px; border-radius: 8px; display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 600; cursor: default; transition: transform 0.15s;
}
.bed { background: var(--success-bg); color: var(--success-fg); border: 1px solid #a7f3d0; }
.bed.occupied { background: var(--danger-bg); color: var(--danger-fg); border: 1px solid #fecaca; cursor: pointer; }
.bed.occupied:hover { transform: scale(1.08); }
.ward-foot { margin-top: 14px; font-size: 12px; }
.text-muted { color: var(--gray-400); }

.selected-bed-card { margin-bottom: 24px; }
.selected-bed-body { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.bed-detail-item { display: flex; flex-direction: column; gap: 2px; font-size: 14px; }
.detail-label { font-size: 11px; color: var(--gray-400); text-transform: uppercase; font-weight: 600; }
.bed-actions { display: flex; align-items: flex-end; }

.search-filters { display: flex; gap: 12px; margin-bottom: 16px; align-items: center; flex-wrap: wrap; }
.search-filters input { padding: 10px 16px; border: 1px solid var(--gray-200); border-radius: 8px; width: 250px; font-size: 14px; }
.search-filters select { padding: 10px 12px; border: 1px solid var(--gray-200); border-radius: 8px; font-size: 14px; }

.loading-container { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 40px 20px; }
.spinner { width: 36px; height: 36px; border: 3px solid var(--gray-200); border-top-color: #0d9488; border-radius: 50%; animation: spin 0.8s linear infinite; }
.spinner-sm { display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: spin 0.8s linear infinite; margin-right: 6px; vertical-align: middle; }
@keyframes spin { to { transform: rotate(360deg); } }
.loading-text { font-size: 14px; color: var(--gray-400); }

.empty-state { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 40px 20px; text-align: center; }
.empty-icon { font-size: 48px; line-height: 1; }
.empty-state p { font-size: 15px; color: var(--gray-600); margin: 0; }
.empty-hint { font-size: 13px; color: var(--gray-400); }

.btn { padding: 6px 14px; border-radius: 6px; font-size: 13px; font-weight: 500; text-decoration: none; transition: all 0.2s; cursor: pointer; border: none; }
.btn:hover { opacity: 0.85; }
.btn-primary { background: #0d9488; color: white; }
.btn-secondary { background: var(--gray-200); color: var(--gray-700); }
.btn-danger { background: #ef4444; color: white; }
.btn-outline { border: 1px solid var(--gray-200); background: var(--white); color: var(--gray-600); }
.btn-sm { font-size: 12px; padding: 5px 12px; }

.badge { display: inline-block; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 500; }
.badge-success { background: var(--success-bg); color: var(--success-fg); }
.badge-warning { background: var(--warning-bg); color: var(--warning-fg); }
.badge-danger { background: var(--danger-bg); color: var(--danger-fg); }
.badge-info { background: var(--info-bg); color: var(--info-fg); }
.badge-gray { background: var(--gray-50); color: var(--gray-500); }

.mt-2 { margin-top: 8px; }

@media (max-width: 1024px) { .stats-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 768px) {
  .wards-grid { grid-template-columns: 1fr; }
  .selected-bed-body { grid-template-columns: 1fr; }
  .stats-grid { grid-template-columns: 1fr; }
  .page-header { flex-direction: column; align-items: stretch; gap: 12px; }
  .header-actions { width: 100%; }
  .header-actions .btn { flex: 1; }
  .search-filters { flex-direction: column; align-items: stretch; }
  .search-filters input,
  .search-filters select { width: 100%; }
}
@media (max-width: 480px) {
  .bed { width: 34px; height: 34px; font-size: 11px; }
}
</style>