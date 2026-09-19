<template>
  <div class="appointments-page">
    <div class="page-header">
      <div class="filter-group">
        <select v-model="statusFilter" @change="page = 1; loadAppointments()">
          <option value="">All Status</option>
          <option value="scheduled">Scheduled</option>
          <option value="confirmed">Confirmed</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <input type="date" v-model="dateFilter" @change="page = 1; loadAppointments()" />
      </div>
      <button class="btn btn-primary" @click="showModal = true">+ New Appointment</button>
    </div>

    <div class="card">
      <div class="card-header">
        <h3>Appointments ({{ total }})</h3>
      </div>

      <!-- Loading State -->
      <div v-if="loadingAppointments" class="loading-container">
        <div class="spinner"></div>
        <span>Loading appointments...</span>
      </div>

      <template v-else>
        <table class="data-table" v-if="appointments.length">
          <thead>
            <tr>
              <th>APT #</th>
              <th>Date</th>
              <th>Time</th>
              <th>Patient</th>
              <th>Doctor</th>
              <th>Type</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in appointments" :key="a.id">
              <td class="text-mono">{{ a.appointment_number }}</td>
              <td>{{ formatDate(a.appointment_date) }}</td>
              <td>{{ formatTime(a.appointment_time) }}</td>
              <td>{{ a.patient_first_name }} {{ a.patient_last_name }}</td>
              <td>Dr. {{ a.doctor_first_name }} {{ a.doctor_last_name }}</td>
              <td><span class="badge badge-info">{{ a.type?.replace('_', ' ') }}</span></td>
              <td><span class="badge" :class="'badge-' + getStatusColor(a.status)">{{ a.status?.replace('_', ' ') }}</span></td>
              <td>
                <div class="btn-group">
                  <button v-if="a.status === 'scheduled'" class="btn btn-sm btn-success" @click="updateStatus(a.id, 'confirmed')">
                    Confirm
                  </button>
                  <button v-if="a.status === 'confirmed'" class="btn btn-sm btn-primary" @click="updateStatus(a.id, 'in_progress')">
                    Start
                  </button>
                  <button v-if="a.status === 'in_progress'" class="btn btn-sm btn-success" @click="updateStatus(a.id, 'completed')">
                    Complete
                  </button>
                  <button v-if="a.status !== 'cancelled' && a.status !== 'completed'" class="btn btn-sm btn-danger" @click="confirmCancel(a.id)">
                    Cancel
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        <!-- Empty State -->
        <div v-else class="empty-state">
          <div class="empty-icon">📅</div>
          <h4>No appointments found</h4>
          <p v-if="statusFilter || dateFilter">Try adjusting your filters or </p>
          <button v-if="statusFilter || dateFilter" class="btn btn-sm btn-secondary" @click="clearFilters">Clear Filters</button>
          <p v-else>No appointments have been scheduled yet.</p>
        </div>
      </template>

      <!-- Pagination -->
      <div class="pagination" v-if="total > limit">
        <button class="btn btn-sm" :disabled="page <= 1" @click="page--; loadAppointments()">Prev</button>
        <span>Page {{ page }} of {{ Math.ceil(total / limit) }}</span>
        <button class="btn btn-sm" :disabled="page >= Math.ceil(total / limit)" @click="page++; loadAppointments()">Next</button>
      </div>
    </div>

    <!-- New Appointment Modal -->
    <div class="modal-overlay" v-if="showModal" @click.self="showModal = false">
      <div class="modal">
        <div class="modal-header">
          <h3>Book Appointment</h3>
          <button class="modal-close" @click="showModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="alert alert-danger" v-if="formError">{{ formError }}</div>
          <form @submit.prevent="createAppointment">
            <div class="form-group">
              <label>Patient *</label>
              <input
                v-model="patientSearch"
                placeholder="Search patient by name or MRN..."
                @input="searchPatients"
                :disabled="!!form.patient_id"
              />
              <div v-if="searchingPatients" class="search-hint">
                <div class="spinner-small"></div> Searching...
              </div>
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
              <select v-model="form.doctor_id" @change="loadSlots" required>
                <option value="">Select Doctor</option>
                <option v-for="d in doctors" :key="d.id" :value="d.id">
                  Dr. {{ d.first_name }} {{ d.last_name }} - {{ d.specialty_name || 'General' }}
                </option>
              </select>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Date *</label>
                <input type="date" v-model="form.appointment_date" @change="loadSlots" :min="today" required />
              </div>
              <div class="form-group">
                <label>Time *</label>
                <select v-model="form.appointment_time" required :disabled="!form.doctor_id || !form.appointment_date">
                  <option value="">Select Time</option>
                  <option v-for="s in availableSlots" :key="s" :value="s">{{ s }}</option>
                </select>
                <div v-if="loadingSlots" class="search-hint">
                  <div class="spinner-small"></div> Loading slots...
                </div>
              </div>
            </div>
            <div class="form-group">
              <label>Type</label>
              <select v-model="form.type">
                <option value="consultation">Consultation</option>
                <option value="follow_up">Follow-up</option>
                <option value="emergency">Emergency</option>
                <option value="telemedicine">Telemedicine</option>
              </select>
            </div>
            <div class="form-group">
              <label>Reason</label>
              <textarea v-model="form.reason" rows="2" placeholder="Reason for visit..."></textarea>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" @click="showModal = false">Cancel</button>
              <button type="submit" class="btn btn-primary" :disabled="saving">
                <div v-if="saving" class="spinner-small"></div>
                {{ saving ? 'Booking...' : 'Book Appointment' }}
              </button>
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
import { formatDate, formatTime, getStatusColor } from '../../utils/helpers'

export default {
  name: 'Appointments',
  setup() {
    const toast = useToast()
    const { confirm } = useConfirm()

    const appointments = ref([])
    const doctors = ref([])
    const total = ref(0)
    const page = ref(1)
    const limit = ref(20)
    const statusFilter = ref('')
    const dateFilter = ref('')
    const showModal = ref(false)
    const saving = ref(false)
    const formError = ref('')
    const patientSearch = ref('')
    const patientResults = ref([])
    const availableSlots = ref([])
    const loadingAppointments = ref(false)
    const loadingSlots = ref(false)
    const searchingPatients = ref(false)

    const today = computed(() => new Date().toISOString().split('T')[0])

    const defaultForm = () => ({
      patient_id: null,
      patientName: '',
      doctor_id: '',
      appointment_date: '',
      appointment_time: '',
      type: 'consultation',
      reason: ''
    })

    const form = ref(defaultForm())

    const loadAppointments = async () => {
      loadingAppointments.value = true
      try {
        const params = { page: page.value, limit: limit.value }
        if (statusFilter.value) params.status = statusFilter.value
        if (dateFilter.value) params.date = dateFilter.value
        const { data } = await axios.get('/api/appointments', { params })
        appointments.value = data.appointments
        total.value = data.total
      } catch (e) {
        toast.error('Failed to load appointments')
      } finally {
        loadingAppointments.value = false
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
      searchingPatients.value = true
      try {
        const { data } = await axios.get('/api/patients', { params: { search: patientSearch.value, limit: 5 } })
        patientResults.value = data.patients
      } catch (e) {
        toast.error('Failed to search patients')
      } finally {
        searchingPatients.value = false
      }
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

    const loadSlots = async () => {
      if (!form.value.doctor_id || !form.value.appointment_date) {
        availableSlots.value = []
        form.value.appointment_time = ''
        return
      }
      loadingSlots.value = true
      form.value.appointment_time = ''
      try {
        const { data } = await axios.get(`/api/appointments/slots/${form.value.doctor_id}`, { params: { date: form.value.appointment_date } })
        availableSlots.value = data.slots
      } catch (e) {
        toast.error('Failed to load available slots')
      } finally {
        loadingSlots.value = false
      }
    }

    const createAppointment = async () => {
      if (!form.value.patient_id) {
        formError.value = 'Please select a patient'
        return
      }
      saving.value = true
      formError.value = ''
      try {
        await axios.post('/api/appointments', form.value)
        showModal.value = false
        toast.success('Appointment booked successfully')
        form.value = defaultForm()
        patientSearch.value = ''
        patientResults.value = []
        availableSlots.value = []
        loadAppointments()
      } catch (e) {
        formError.value = e.response?.data?.message || 'Error booking appointment'
        toast.error(formError.value)
      } finally {
        saving.value = false
      }
    }

    const updateStatus = async (id, status) => {
      try {
        await axios.put(`/api/appointments/${id}`, { status })
        const label = status.replace('_', ' ')
        toast.success(`Appointment ${label} successfully`)
        loadAppointments()
      } catch (e) {
        toast.error('Error updating appointment status')
      }
    }

    const confirmCancel = async (id) => {
      const ok = await confirm({ title: 'Cancel Appointment', message: 'Are you sure you want to cancel this appointment? This action cannot be undone.' })
      if (ok) {
        await updateStatus(id, 'cancelled')
      }
    }

    const clearFilters = () => {
      statusFilter.value = ''
      dateFilter.value = ''
      page.value = 1
      loadAppointments()
    }

    onMounted(() => {
      loadAppointments()
      loadDoctors()
    })

    return {
      appointments, doctors, total, page, limit,
      statusFilter, dateFilter, showModal, saving, formError,
      patientSearch, patientResults, availableSlots, today, form,
      loadingAppointments, loadingSlots, searchingPatients,
      loadAppointments, searchPatients, selectPatient, clearPatient,
      loadSlots, createAppointment, updateStatus, confirmCancel, clearFilters,
      formatDate, formatTime, getStatusColor
    }
  }
}
</script>

<style scoped>
.page-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 20px;
  gap: 16px;
  align-items: center;
}

.filter-group {
  display: flex;
  gap: 12px;
}

.filter-group select,
.filter-group input {
  padding: 10px 16px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 14px;
  background: white;
  transition: border-color 0.2s;
}

.filter-group select:focus,
.filter-group input:focus {
  outline: none;
  border-color: #0d9488;
}

.text-mono {
  font-family: monospace;
  font-size: 13px;
}

.btn-group {
  display: flex;
  gap: 6px;
}

.btn-group .btn {
  white-space: nowrap;
}

/* Loading States */
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 20px;
  color: #64748b;
  gap: 12px;
}

.spinner {
  width: 36px;
  height: 36px;
  border: 3px solid #e2e8f0;
  border-top-color: #0d9488;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.spinner-small {
  width: 16px;
  height: 16px;
  border: 2px solid #e2e8f0;
  border-top-color: #0d9488;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  display: inline-block;
  vertical-align: middle;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Empty State */
.empty-state {
  text-align: center;
  padding: 48px 20px;
  color: #64748b;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.empty-state h4 {
  margin: 0 0 8px;
  color: #334155;
}

.empty-state p {
  margin: 0 0 12px;
}

/* Pagination */
.pagination {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 16px;
  padding: 16px;
  border-top: 1px solid #f1f5f9;
}

/* Modal */
.modal-close {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: #64748b;
  transition: color 0.2s;
}

.modal-close:hover {
  color: #1e293b;
}

/* Search */
.search-results {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  max-height: 150px;
  overflow-y: auto;
  margin-top: 4px;
}

.result-item {
  padding: 10px 12px;
  cursor: pointer;
  font-size: 14px;
  transition: background 0.15s;
}

.result-item:hover {
  background: #f0fdfa;
}

.selected-item {
  padding: 8px 12px;
  background: #f0fdfa;
  border: 1px solid #99f6e4;
  border-radius: 6px;
  margin-top: 4px;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.selected-label {
  color: #64748b;
}

.btn-clear {
  background: none;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: #94a3b8;
  padding: 0 4px;
  transition: color 0.2s;
}

.btn-clear:hover {
  color: #ef4444;
}

.search-hint {
  font-size: 12px;
  color: #94a3b8;
  padding: 6px 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

/* Responsive */
@media (max-width: 768px) {
  .page-header {
    flex-direction: column;
    align-items: stretch;
  }
  .page-header .btn {
    width: 100%;
  }
  .filter-group {
    flex-direction: column;
  }
  .filter-group select,
  .filter-group input {
    width: 100%;
  }
  .btn-group {
    flex-wrap: wrap;
  }
  .btn-group .btn {
    flex: 1;
    min-width: 70px;
  }
  .pagination {
    flex-wrap: wrap;
    gap: 8px;
    padding: 12px;
  }
}

@media (max-width: 576px) {
  .page-title {
    font-size: 17px;
  }
}
</style>
