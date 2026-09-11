<template>
  <div class="patients-page">
    <div class="page-header">
      <div class="search-bar">
        <svg class="search-icon" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd"/></svg>
        <input type="text" v-model="search" placeholder="Search patients by name, MRN, phone..." @input="debouncedSearch" />
      </div>
      <button class="btn btn-primary" @click="openCreateModal">+ New Patient</button>
    </div>

    <div class="card">
      <div class="card-header">
        <h3>Patients ({{ total }})</h3>
      </div>

      <div v-if="loading" class="loading-state">
        <div class="spinner"></div>
        <p>Loading patients...</p>
      </div>

      <table v-else class="data-table">
        <thead>
          <tr>
            <th>MRN</th>
            <th>Name</th>
            <th>DOB</th>
            <th>Gender</th>
            <th>Phone</th>
            <th>Blood Type</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="patients.length === 0">
            <td colspan="8" class="empty-state">No patients found.</td>
          </tr>
          <tr v-for="p in patients" :key="p.id">
            <td><span class="text-mono">{{ p.mrn }}</span></td>
            <td><router-link :to="`/patients/${p.id}`" class="link"><strong>{{ p.first_name }} {{ p.last_name }}</strong></router-link></td>
            <td>{{ formatDate(p.date_of_birth) }}</td>
            <td>{{ p.gender }}</td>
            <td>{{ p.phone || '-' }}</td>
            <td>{{ p.blood_type || '-' }}</td>
            <td><span class="badge" :class="p.status === 'active' ? 'badge-success' : 'badge-danger'">{{ p.status }}</span></td>
            <td class="actions-cell">
              <router-link :to="`/patients/${p.id}`" class="btn btn-sm btn-outline">View</router-link>
              <button class="btn btn-sm btn-outline" @click="openEditModal(p)">Edit</button>
              <button class="btn btn-sm btn-danger" @click="deletePatient(p)">Delete</button>
            </td>
          </tr>
        </tbody>
      </table>

      <div class="pagination" v-if="total > limit">
        <button class="btn btn-sm" :disabled="page <= 1" @click="page--; loadPatients()">Previous</button>
        <span>Page {{ page }} of {{ Math.ceil(total / limit) }}</span>
        <button class="btn btn-sm" :disabled="page >= Math.ceil(total / limit)" @click="page++; loadPatients()">Next</button>
      </div>
    </div>

    <!-- Create / Edit Modal -->
    <div class="modal-overlay" v-if="showModal" @click.self="closeModal">
      <div class="modal">
        <div class="modal-header">
          <h3>{{ editingPatient ? 'Edit Patient' : 'Register New Patient' }}</h3>
          <button class="modal-close" @click="closeModal">&times;</button>
        </div>
        <div class="modal-body">
          <form @submit.prevent="savePatient">
            <div class="form-row">
              <div class="form-group">
                <label>First Name *</label>
                <input v-model="form.first_name" required />
              </div>
              <div class="form-group">
                <label>Last Name *</label>
                <input v-model="form.last_name" required />
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Date of Birth *</label>
                <input type="date" v-model="form.date_of_birth" required />
              </div>
              <div class="form-group">
                <label>Gender *</label>
                <select v-model="form.gender" required>
                  <option value="">Select</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Blood Type</label>
                <select v-model="form.blood_type">
                  <option value="">Select</option>
                  <option>A+</option><option>A-</option>
                  <option>B+</option><option>B-</option>
                  <option>AB+</option><option>AB-</option>
                  <option>O+</option><option>O-</option>
                </select>
              </div>
              <div class="form-group">
                <label>Phone</label>
                <input v-model="form.phone" />
              </div>
            </div>
            <div class="form-group">
              <label>Email</label>
              <input type="email" v-model="form.email" />
            </div>
            <div class="form-group">
              <label>Address</label>
              <textarea v-model="form.address" rows="2"></textarea>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Emergency Contact Name</label>
                <input v-model="form.emergency_contact_name" />
              </div>
              <div class="form-group">
                <label>Emergency Contact Phone</label>
                <input v-model="form.emergency_contact_phone" />
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Insurance Provider</label>
                <input v-model="form.insurance_provider" />
              </div>
              <div class="form-group">
                <label>Insurance Number</label>
                <input v-model="form.insurance_number" />
              </div>
            </div>
            <div class="form-group">
              <label>Allergies</label>
              <textarea v-model="form.allergies" rows="2" placeholder="List any known allergies..."></textarea>
            </div>
            <div class="form-group">
              <label>Chronic Conditions</label>
              <textarea v-model="form.chronic_conditions" rows="2" placeholder="List any chronic conditions..."></textarea>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" @click="closeModal">Cancel</button>
              <button type="submit" class="btn btn-primary" :disabled="saving">{{ saving ? 'Saving...' : editingPatient ? 'Update Patient' : 'Register Patient' }}</button>
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
import { formatDate, debounce } from '../../utils/helpers'
import { useToast } from '../../store/toast'
import { useConfirm } from '../../store/confirm'

export default {
  name: 'Patients',
  setup() {
    const toast = useToast()
    const { confirm } = useConfirm()

    const patients = ref([])
    const total = ref(0)
    const page = ref(1)
    const limit = ref(20)
    const search = ref('')
    const showModal = ref(false)
    const saving = ref(false)
    const loading = ref(false)
    const editingPatient = ref(null)

    const emptyForm = () => ({
      first_name: '', last_name: '', date_of_birth: '', gender: '', blood_type: '',
      phone: '', email: '', address: '', emergency_contact_name: '', emergency_contact_phone: '',
      insurance_provider: '', insurance_number: '', allergies: '', chronic_conditions: ''
    })

    const form = ref(emptyForm())

    const loadPatients = async () => {
      loading.value = true
      try {
        const params = { page: page.value, limit: limit.value }
        if (search.value) params.search = search.value
        const { data } = await axios.get('/api/patients', { params })
        patients.value = data.patients
        total.value = data.total
      } catch (e) {
        toast.error('Failed to load patients.')
      } finally {
        loading.value = false
      }
    }

    const debouncedSearch = debounce(() => {
      page.value = 1
      loadPatients()
    })

    const openCreateModal = () => {
      editingPatient.value = null
      form.value = emptyForm()
      showModal.value = true
    }

    const openEditModal = (patient) => {
      editingPatient.value = patient
      form.value = { ...patient }
      showModal.value = true
    }

    const closeModal = () => {
      showModal.value = false
      editingPatient.value = null
    }

    const savePatient = async () => {
      saving.value = true
      try {
        if (editingPatient.value) {
          await axios.put(`/api/patients/${editingPatient.value.id}`, form.value)
          toast.success('Patient updated successfully.')
        } else {
          await axios.post('/api/patients', form.value)
          toast.success('Patient registered successfully.')
        }
        closeModal()
        loadPatients()
      } catch (e) {
        toast.error(e.response?.data?.message || 'Failed to save patient.')
      } finally {
        saving.value = false
      }
    }

    const deletePatient = async (patient) => {
      const yes = await confirm({
        title: 'Delete Patient',
        message: `Are you sure you want to delete ${patient.first_name} ${patient.last_name}? This action cannot be undone.`,
        confirmText: 'Delete',
        confirmClass: 'btn-danger'
      })
      if (!yes) return
      try {
        await axios.delete(`/api/patients/${patient.id}`)
        toast.warning('Patient deleted.')
        loadPatients()
      } catch (e) {
        toast.error(e.response?.data?.message || 'Failed to delete patient.')
      }
    }

    onMounted(loadPatients)

    return {
      patients, total, page, limit, search, showModal, saving, loading,
      editingPatient, form, formatDate, debouncedSearch,
      openCreateModal, openEditModal, closeModal, savePatient, deletePatient, loadPatients
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

.search-bar {
  position: relative;
}

.search-bar .search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  width: 18px;
  height: 18px;
  color: #94a3b8;
  pointer-events: none;
}

.search-bar input {
  padding: 10px 16px 10px 40px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  width: 380px;
  font-size: 14px;
  transition: border-color 0.2s;
}

.search-bar input:focus {
  outline: none;
  border-color: #0d9488;
  box-shadow: 0 0 0 3px rgba(13, 148, 136, 0.1);
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  color: #64748b;
}

.spinner {
  width: 36px;
  height: 36px;
  border: 3px solid #e2e8f0;
  border-top-color: #0d9488;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  margin-bottom: 12px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.text-mono {
  font-family: monospace;
  font-size: 13px;
  color: #64748b;
}

.link {
  color: #0d9488;
  text-decoration: none;
}

.link:hover {
  text-decoration: underline;
}

.actions-cell {
  display: flex;
  gap: 6px;
}

.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: #94a3b8;
}

.btn-danger {
  background-color: #ef4444;
  color: #fff;
  border: 1px solid #ef4444;
}

.btn-danger:hover {
  background-color: #dc2626;
}

.btn-secondary {
  background-color: #f1f5f9;
  color: #475569;
  border: 1px solid #e2e8f0;
}

.btn-secondary:hover {
  background-color: #e2e8f0;
}

.btn-primary {
  background-color: #0d9488;
  color: #fff;
  border: 1px solid #0d9488;
}

.btn-primary:hover {
  background-color: #0f766e;
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.pagination {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 16px;
  padding: 16px;
}

.modal-close {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: #64748b;
}

.modal-close:hover {
  color: #1e293b;
}
</style>
