<template>
  <div class="patients-page">

    <!-- ══ PAGE HEADER ══ -->
    <div class="page-header">
      <div>
        <h1 class="page-title">Patients</h1>
        <p class="page-sub">{{ total }} registered patient{{ total !== 1 ? 's' : '' }}</p>
      </div>
      <div class="header-actions">
        <button class="btn btn-ghost btn-sm" @click="lookupOpen = !lookupOpen">
          <span>🔍</span> Lookup by Code
        </button>
        <button class="btn btn-primary" @click="openCreateModal">
          <span>＋</span> New Patient
        </button>
      </div>
    </div>

    <!-- ══ DOCTOR / NURSE CODE LOOKUP PANEL ══ -->
    <Transition name="lookup-slide">
      <div class="lookup-panel" v-if="lookupOpen">
        <div class="lookup-inner">
          <div class="lookup-icon">🔑</div>
          <div class="lookup-content">
            <div class="lookup-heading">Patient Access Code Lookup</div>
            <div class="lookup-sub">Enter the code from the patient's access card to instantly pull their record.</div>
          </div>
          <div class="lookup-input-group">
            <input
              v-model="lookupCode"
              @keyup.enter="lookupPatient"
              placeholder="e.g. HMS-L9XQ-R4A2B"
              class="lookup-input"
              :class="{ 'lookup-input--error': lookupError, 'lookup-input--success': lookupResult }"
              spellcheck="false"
              autocomplete="off"
            />
            <button class="btn btn-primary" @click="lookupPatient" :disabled="lookupLoading">
              <span v-if="lookupLoading" class="mini-spin" />
              <span v-else>→</span>
            </button>
          </div>
          <div class="lookup-error" v-if="lookupError">⚠ {{ lookupError }}</div>
        </div>

        <!-- Lookup result card -->
        <Transition name="result-pop">
          <div class="lookup-result" v-if="lookupResult">
            <div class="lr-header">
              <div class="lr-avatar">{{ lookupResult.first_name?.charAt(0) }}{{ lookupResult.last_name?.charAt(0) }}</div>
              <div class="lr-identity">
                <div class="lr-name">{{ lookupResult.first_name }} {{ lookupResult.last_name }}</div>
                <div class="lr-meta">
                  <span class="lr-mrn">{{ lookupResult.mrn }}</span>
                  <span class="lr-sep">·</span>
                  <span :class="lookupResult.blood_type ? 'lr-blood' : 'lr-dim'">{{ lookupResult.blood_type || 'Blood type N/A' }}</span>
                  <span class="lr-sep">·</span>
                  <span>{{ lookupResult.gender }}</span>
                </div>
              </div>
              <span class="lr-badge" :class="lookupResult.status === 'active' ? 'lr-badge--active' : 'lr-badge--inactive'">
                {{ lookupResult.status }}
              </span>
            </div>

            <div class="lr-grid">
              <div class="lr-stat">
                <div class="lr-stat-val">{{ lookupResult.total_appointments ?? '—' }}</div>
                <div class="lr-stat-key">Appointments</div>
              </div>
              <div class="lr-stat">
                <div class="lr-stat-val">{{ lookupResult.total_records ?? '—' }}</div>
                <div class="lr-stat-key">Medical Records</div>
              </div>
              <div class="lr-stat">
                <div class="lr-stat-val">{{ lookupResult.total_prescriptions ?? '—' }}</div>
                <div class="lr-stat-key">Prescriptions</div>
              </div>
              <div class="lr-stat">
                <div class="lr-stat-val">{{ hasAllergy(lookupResult.allergies) ? '⚠' : '✓' }}</div>
                <div class="lr-stat-key">{{ hasAllergy(lookupResult.allergies) ? 'Has Allergies' : 'No Allergies' }}</div>
              </div>
            </div>

            <div class="lr-allergies" v-if="hasAllergy(lookupResult.allergies)">
              <span class="lr-allergy-label">⚠ Allergies:</span> {{ lookupResult.allergies }}
            </div>
            <div class="lr-conditions" v-if="hasClinicalCondition(lookupResult.chronic_conditions)">
              <span class="lr-cond-label">🔄 Chronic:</span> {{ lookupResult.chronic_conditions }}
            </div>

            <div class="lr-actions">
              <router-link :to="`/patients/${lookupResult.id}`" class="btn btn-primary btn-sm">
                Open Full Record
              </router-link>
              <router-link v-if="authStore.can('doctor', 'admin')" :to="`/emr?patient_id=${lookupResult.id}`" class="btn btn-secondary btn-sm">
                New EMR Entry
              </router-link>
              <router-link :to="`/appointments?patient_id=${lookupResult.id}`" class="btn btn-secondary btn-sm">
                Book Appointment
              </router-link>
              <button class="btn btn-ghost btn-sm" @click="clearLookup">Clear</button>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>

    <!-- ══ PATIENT LIST CARD ══ -->
    <div class="card">
      <div class="card-header">
        <div class="filter-bar" style="margin:0;flex:1">
          <div class="search-bar" style="flex:1">
            <span class="search-icon">🔎</span>
            <input
              type="text"
              v-model="search"
              placeholder="Search by name, MRN, phone, access code…"
              @input="debouncedSearch"
            />
            <button v-if="search" class="search-clear" @click="search=''; page=1; loadPatients()">✕</button>
          </div>
          <select v-model="statusFilter" @change="page=1; loadPatients()">
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="deceased">Deceased</option>
          </select>
        </div>
      </div>

      <!-- Loading -->
      <div class="loading-page" v-if="loading">
        <div class="loading-spinner lg" />
        <p>Loading patients…</p>
      </div>

      <!-- Table -->
      <div class="table-responsive" v-else-if="patients.length">
        <table class="data-table">
          <thead>
            <tr>
              <th>MRN</th>
              <th>Patient</th>
              <th>Access Code</th>
              <th>DOB</th>
              <th>Gender</th>
              <th>Phone</th>
              <th>Blood</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in patients" :key="p.id">
              <td><span class="mono-tag">{{ p.mrn }}</span></td>
              <td>
                <div class="patient-cell">
                  <div class="patient-cell-avatar">{{ p.first_name?.charAt(0) }}{{ p.last_name?.charAt(0) }}</div>
                  <div>
                    <router-link :to="`/patients/${p.id}`" class="patient-name-link">
                      {{ p.first_name }} {{ p.last_name }}
                    </router-link>
                    <div class="patient-email-row">{{ p.email || '—' }}</div>
                  </div>
                </div>
              </td>
              <td>
                <span class="code-pill" :title="'Access code: ' + p.access_code">
                  {{ p.access_code || '—' }}
                </span>
              </td>
              <td class="text-muted">{{ formatDate(p.date_of_birth) }}</td>
              <td class="text-muted" style="text-transform:capitalize">{{ p.gender }}</td>
              <td class="text-muted">{{ p.phone || '—' }}</td>
              <td>
                <span class="blood-chip" v-if="p.blood_type">{{ p.blood_type }}</span>
                <span class="text-muted" v-else>—</span>
              </td>
              <td>
                <span class="badge" :class="p.status === 'active' ? 'badge-success' : p.status === 'deceased' ? 'badge-danger' : 'badge-gray'">
                  {{ p.status }}
                </span>
              </td>
              <td>
                <div class="table-actions">
                  <router-link :to="`/patients/${p.id}`" class="btn btn-sm btn-secondary">View</router-link>
                  <button class="btn btn-sm btn-secondary" @click="openEditModal(p)">Edit</button>
                  <button v-if="authStore.can('admin', 'receptionist')" class="btn btn-sm btn-danger" @click="deletePatient(p)">Delete</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Empty -->
      <div class="empty-state" v-else>
        <span class="empty-state-icon">👥</span>
        <h3>No patients found</h3>
        <p>{{ search ? 'Try a different search term.' : 'Register your first patient to get started.' }}</p>
      </div>

      <!-- Pagination -->
      <div class="card-footer d-flex align-center justify-between" v-if="total > limit">
        <span class="text-muted text-sm">Showing {{ (page-1)*limit+1 }}–{{ Math.min(page*limit,total) }} of {{ total }}</span>
        <div class="pagination" style="margin:0">
          <button :disabled="page <= 1" @click="page--; loadPatients()">‹</button>
          <button
            v-for="p in pageRange" :key="p"
            :class="{ active: p === page }"
            @click="page = p; loadPatients()"
          >{{ p }}</button>
          <button :disabled="page >= totalPages" @click="page++; loadPatients()">›</button>
        </div>
      </div>
    </div>

    <!-- ══ REGISTER / EDIT MODAL ══ -->
    <Teleport to="body">
      <Transition name="fade">
        <div class="modal-overlay" v-if="showModal" @click.self="closeModal">
          <div class="modal modal-lg" style="max-height:90vh">
            <div class="modal-header">
              <div>
                <h2>{{ editingPatient ? 'Edit Patient' : 'Register New Patient' }}</h2>
                <p style="font-size:12.5px;color:var(--text-muted);margin-top:3px">
                  {{ editingPatient ? 'Update the patient record below.' : 'Fill in the patient details. An access code & PIN will be generated automatically.' }}
                </p>
              </div>
              <button class="modal-close" @click="closeModal">✕</button>
            </div>

            <div class="modal-body">
              <form @submit.prevent="savePatient" novalidate>

                <!-- Section: Basic Info -->
                <div class="form-section-title">Basic Information</div>
                <div class="form-row">
                  <div class="form-group">
                    <label>First Name <span class="req">*</span></label>
                    <input v-model="form.first_name" placeholder="e.g. Maria" :class="{ 'input-error': submitted && !form.first_name.trim() }" />
                    <span class="form-error" v-if="submitted && !form.first_name.trim()">Required</span>
                  </div>
                  <div class="form-group">
                    <label>Last Name <span class="req">*</span></label>
                    <input v-model="form.last_name" placeholder="e.g. Garcia" :class="{ 'input-error': submitted && !form.last_name.trim() }" />
                    <span class="form-error" v-if="submitted && !form.last_name.trim()">Required</span>
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label>Date of Birth <span class="req">*</span></label>
                    <input type="date" v-model="form.date_of_birth" :max="today" :class="{ 'input-error': submitted && !form.date_of_birth }" />
                    <span class="form-error" v-if="submitted && !form.date_of_birth">Required</span>
                  </div>
                  <div class="form-group">
                    <label>Gender <span class="req">*</span></label>
                    <select v-model="form.gender" :class="{ 'input-error': submitted && !form.gender }">
                      <option value="">— Select —</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="other">Other</option>
                    </select>
                    <span class="form-error" v-if="submitted && !form.gender">Required</span>
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label>Blood Type</label>
                    <select v-model="form.blood_type">
                      <option value="">— Unknown —</option>
                      <option v-for="bt in bloodTypes" :key="bt" :value="bt">{{ bt }}</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label>Phone</label>
                    <input
                      v-model.trim="form.phone" type="tel" inputmode="numeric" pattern="[0-9]*"
                      :maxlength="PHONE_MAX_DIGITS" placeholder="Digits only, e.g. 0788123456"
                    />
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label>Email</label>
                    <input type="email" v-model="form.email" placeholder="patient@email.com" />
                  </div>
                  <div class="form-group">
                    <label>Address</label>
                    <input v-model="form.address" placeholder="Street, City, Country" />
                  </div>
                </div>

                <!-- Section: Emergency -->
                <div class="form-section-title" style="margin-top:20px">Emergency Contact</div>
                <div class="form-row">
                  <div class="form-group">
                    <label>Contact Name</label>
                    <input v-model="form.emergency_contact_name" placeholder="Full name" />
                  </div>
                  <div class="form-group">
                    <label>Contact Phone</label>
                    <input
                      v-model.trim="form.emergency_contact_phone" type="tel" inputmode="numeric" pattern="[0-9]*"
                      :maxlength="PHONE_MAX_DIGITS" placeholder="Digits only, e.g. 0788123456"
                    />
                  </div>
                </div>

                <!-- Section: Insurance -->
                <div class="form-section-title" style="margin-top:20px">Insurance</div>
                <div class="form-row">
                  <div class="form-group">
                    <label>Insurance Provider</label>
                    <input v-model="form.insurance_provider" placeholder="e.g. BlueCross" />
                  </div>
                  <div class="form-group">
                    <label>Insurance Number</label>
                    <input v-model="form.insurance_number" placeholder="e.g. INS-123456" />
                  </div>
                </div>

                <!-- Section: Medical Notes -->
                <div class="form-section-title" style="margin-top:20px">Medical Notes</div>
                <div class="form-group">
                  <label>Known Allergies</label>
                  <textarea v-model="form.allergies" rows="2" placeholder="e.g. Penicillin, Peanuts (comma-separated)"></textarea>
                </div>
                <div class="form-group">
                  <label>Chronic Conditions</label>
                  <textarea v-model="form.chronic_conditions" rows="2" placeholder="e.g. Diabetes Type 2, Hypertension"></textarea>
                </div>

                <!-- Info note for new patients -->
                <div class="info-box" v-if="!editingPatient">
                  <span class="info-icon">🔑</span>
                  <div>
                    <strong>Access Code & Portal PIN will be auto-generated.</strong>
                    A unique access code and a 6-digit PIN will be created for this patient after registration. You will be able to print the patient card immediately.
                  </div>
                </div>

              </form>
            </div>

            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" @click="closeModal">Cancel</button>
              <button type="button" class="btn btn-primary" :disabled="saving" @click="savePatient">
                <span v-if="saving" class="loading-spinner sm" />
                {{ saving ? 'Saving…' : editingPatient ? 'Update Patient' : 'Register Patient' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- ══ ACCESS CARD MODAL (shown after successful registration) ══ -->
    <PatientAccessCard
      :visible="showAccessCard"
      :patient="newPatientData"
      :plain-pin="newPatientPin"
      @close="showAccessCard = false; loadPatients()"
      @register-another="showAccessCard = false; openCreateModal()"
    />

  </div>
</template>

<script>
import { ref, computed, onMounted } from 'vue'
import axios from 'axios'
import { formatDate, debounce, hasAllergy } from '../../utils/helpers'
import { useToast } from '../../store/toast'
import { useConfirm } from '../../store/confirm'
import { useAuthStore } from '../../store/auth'
import PatientAccessCard from '../../components/PatientAccessCard.vue'
import { PHONE_MAX_DIGITS } from '../../utils/phone'

export default {
  name: 'Patients',
  components: { PatientAccessCard },

  setup() {
    const toast     = useToast()
    const { confirm } = useConfirm()
    const authStore = useAuthStore()

    /* ── list state ── */
    const patients     = ref([])
    const total        = ref(0)
    const page         = ref(1)
    const limit        = ref(20)
    const search       = ref('')
    const statusFilter = ref('')
    const loading      = ref(false)

    /* ── modal state ── */
    const showModal      = ref(false)
    const saving         = ref(false)
    const submitted      = ref(false)
    const editingPatient = ref(null)

    /* ── access card state ── */
    const showAccessCard  = ref(false)
    const newPatientData  = ref({})
    const newPatientPin   = ref('')

    /* ── lookup state ── */
    const lookupOpen    = ref(false)
    const lookupCode    = ref('')
    const lookupLoading = ref(false)
    const lookupError   = ref('')
    const lookupResult  = ref(null)

    const today = ref(new Date().toISOString().slice(0, 10))
    const hasClinicalCondition = value => hasAllergy(value) && !/^none$/i.test(String(value).trim())

    const bloodTypes = ['A+','A-','B+','B-','AB+','AB-','O+','O-']

    const emptyForm = () => ({
      first_name: '', last_name: '', date_of_birth: '', gender: '',
      blood_type: '', phone: '', email: '', address: '',
      emergency_contact_name: '', emergency_contact_phone: '',
      insurance_provider: '', insurance_number: '',
      allergies: '', chronic_conditions: ''
    })
    const form = ref(emptyForm())

    /* ── computed ── */
    const totalPages = computed(() => Math.ceil(total.value / limit.value))
    const pageRange  = computed(() => {
      const range = [], cur = page.value, last = totalPages.value
      const start = Math.max(1, cur - 2), end = Math.min(last, cur + 2)
      for (let i = start; i <= end; i++) range.push(i)
      return range
    })

    /* ── data loading ── */
    let listRequestId = 0
    const loadPatients = async () => {
      const requestId = ++listRequestId
      loading.value = true
      try {
        const params = { page: page.value, limit: limit.value }
        if (search.value)       params.search = search.value
        if (statusFilter.value) params.status = statusFilter.value
        const { data } = await axios.get('/api/patients', { params })
        if (requestId !== listRequestId) return
        patients.value = data.patients
        total.value    = data.total
      } catch {
        toast.error('Failed to load patients.')
      } finally {
        if (requestId === listRequestId) loading.value = false
      }
    }

    const debouncedSearch = debounce(() => { page.value = 1; loadPatients() })

    /* ── modal helpers ── */
    const openCreateModal = () => {
      today.value = new Date().toISOString().slice(0, 10)
      submitted.value      = false
      editingPatient.value = null
      form.value           = emptyForm()
      showModal.value      = true
    }

    const openEditModal = (patient) => {
      today.value = new Date().toISOString().slice(0, 10)
      submitted.value      = false
      editingPatient.value = patient
      form.value = {
        first_name: patient.first_name || '',
        last_name:  patient.last_name  || '',
        date_of_birth: patient.date_of_birth || '',
        gender:     patient.gender     || '',
        blood_type: patient.blood_type || '',
        phone:      patient.phone      || '',
        email:      patient.email      || '',
        address:    patient.address    || '',
        emergency_contact_name:  patient.emergency_contact_name  || '',
        emergency_contact_phone: patient.emergency_contact_phone || '',
        insurance_provider:      patient.insurance_provider      || '',
        insurance_number:        patient.insurance_number        || '',
        allergies:          patient.allergies          || '',
        chronic_conditions: patient.chronic_conditions || '',
      }
      showModal.value = true
    }

    const closeModal = () => {
      showModal.value = false
      editingPatient.value = null
      submitted.value = false
    }

    /* ── save ── */
    const savePatient = async () => {
      submitted.value = true

      // client-side validation
      if (!form.value.first_name.trim() || !form.value.last_name.trim() ||
          !form.value.date_of_birth     || !form.value.gender) {
        toast.warning('Please fill in all required fields.')
        return
      }

      saving.value = true
      try {
        if (editingPatient.value) {
          await axios.put(`/api/patients/${editingPatient.value.id}`, form.value)
          toast.success('Patient updated successfully.')
          closeModal()
          loadPatients()
        } else {
          // POST returns { patient, plain_pin }
          const { data } = await axios.post('/api/patients', form.value)
          closeModal()
          // Show the access card with all details
          newPatientData.value = data.patient
          newPatientPin.value  = data.plain_pin
          showAccessCard.value = true
        }
      } catch (e) {
        const msg = e.response?.data?.message
          || (e.response?.data?.errors?.[0]?.msg)
          || 'Failed to save patient.'
        toast.error(msg)
      } finally {
        saving.value  = false
        submitted.value = false
      }
    }

    /* ── delete ── */
    const deletePatient = async (patient) => {
      const yes = await confirm({
        title:        'Delete Patient',
        message:      `Are you sure you want to deactivate ${patient.first_name} ${patient.last_name}?`,
        confirmText:  'Delete',
        confirmClass: 'btn-danger',
        icon:         '⚠️',
      })
      if (!yes) return
      try {
        await axios.delete(`/api/patients/${patient.id}`)
        toast.warning('Patient deactivated.')
        loadPatients()
      } catch (e) {
        toast.error(e.response?.data?.message || 'Failed to delete.')
      }
    }

    /* ── lookup ── */
    const lookupPatient = async () => {
      lookupError.value  = ''
      lookupResult.value = null
      const code = lookupCode.value.trim()
      if (!code) { lookupError.value = 'Please enter an access code.'; return }
      lookupLoading.value = true
      try {
        const { data } = await axios.get(`/api/patients/lookup/${encodeURIComponent(code)}`)
        lookupResult.value = data.patient
      } catch (e) {
        lookupError.value = e.response?.data?.message || 'No patient found for this code.'
      } finally {
        lookupLoading.value = false
      }
    }

    const clearLookup = () => {
      lookupCode.value   = ''
      lookupResult.value = null
      lookupError.value  = ''
    }

    onMounted(loadPatients)

    return {
      patients, total, page, limit, search, statusFilter, loading,
      showModal, saving, submitted, editingPatient, form,
      showAccessCard, newPatientData, newPatientPin,
      lookupOpen, lookupCode, lookupLoading, lookupError, lookupResult,
      today, bloodTypes, totalPages, pageRange,
      formatDate, debouncedSearch, hasAllergy, hasClinicalCondition, authStore,
      openCreateModal, openEditModal, closeModal, savePatient, deletePatient,
      lookupPatient, clearLookup,
      PHONE_MAX_DIGITS,
    }
  }
}
</script>

<style scoped>
/* ══ PAGE ══ */
.patients-page { animation: fadeUp .35s ease both; }
@keyframes fadeUp { from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none} }

.page-header {
  display: flex; align-items: flex-start; justify-content: space-between;
  margin-bottom: 20px; gap: 16px; flex-wrap: wrap;
}
.page-title { font-size: 22px; font-weight: 700; color: var(--gray-900); letter-spacing: -.03em; }
.page-sub   { font-size: 13px; color: var(--text-muted); margin-top: 3px; }
.header-actions { display: flex; gap: 10px; flex-wrap: wrap; }

/* ══ LOOKUP PANEL ══ */
.lookup-panel {
  background: linear-gradient(135deg, #0a2236 0%, #0d2d3a 100%);
  border: 1px solid rgba(20,184,166,.25);
  border-radius: 16px;
  padding: 22px 24px;
  margin-bottom: 20px;
  box-shadow: 0 4px 24px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.06);
  display: flex; flex-direction: column; gap: 16px;
}
.lookup-inner {
  display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
}
.lookup-icon { font-size: 28px; flex-shrink: 0; }
.lookup-content { flex: 1; min-width: 200px; }
.lookup-heading { font-size: 14.5px; font-weight: 700; color: #fff; }
.lookup-sub     { font-size: 12.5px; color: rgba(255,255,255,.5); margin-top: 2px; }

.lookup-input-group {
  display: flex; gap: 8px; flex-shrink: 0;
}
.lookup-input {
  width: 240px; padding: 10px 14px;
  background: rgba(255,255,255,.08); border: 1.5px solid rgba(255,255,255,.15);
  border-radius: 10px; color: #fff; font-family: 'JetBrains Mono','Fira Code',monospace;
  font-size: 14px; font-weight: 600; letter-spacing: .05em;
  outline: none; transition: border-color .2s;
}
.lookup-input::placeholder { color: rgba(255,255,255,.3); font-weight: 400; letter-spacing: 0; }
.lookup-input:focus { border-color: var(--focus-ring); box-shadow: 0 0 0 3px rgba(20,184,166,.2); }
.lookup-input--error   { border-color: var(--danger) !important; }
.lookup-input--success { border-color: var(--focus-ring) !important; }

.lookup-error { font-size: 12.5px; color: #f87171; }

/* ── lookup result ── */
.lookup-result {
  background: rgba(255,255,255,.06);
  border: 1px solid rgba(255,255,255,.12);
  border-radius: 12px; padding: 18px;
  display: flex; flex-direction: column; gap: 14px;
}
.lr-header { display: flex; align-items: center; gap: 14px; }
.lr-avatar {
  width: 46px; height: 46px; border-radius: 50%; flex-shrink: 0;
  background: linear-gradient(135deg, #14b8a6, #0d9488);
  color: #fff; font-weight: 700; font-size: 16px;
  display: flex; align-items: center; justify-content: center;
  border: 2px solid rgba(255,255,255,.2);
}
.lr-identity { flex: 1; }
.lr-name { font-size: 17px; font-weight: 700; color: #fff; }
.lr-meta { font-size: 12.5px; color: rgba(255,255,255,.5); margin-top: 3px; display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.lr-mrn  { font-family: monospace; font-size: 12px; background: rgba(255,255,255,.08); padding: 1px 7px; border-radius: 4px; }
.lr-sep  { opacity: .4; }
.lr-blood { color: #fca5a5; font-weight: 600; }
.lr-dim   { opacity: .4; }
.lr-badge { padding: 3px 11px; border-radius: 20px; font-size: 11px; font-weight: 700; flex-shrink: 0; }
.lr-badge--active   { background: rgba(16,185,129,.2); color: #34d399; border: 1px solid rgba(16,185,129,.3); }
.lr-badge--inactive { background: rgba(239,68,68,.18); color: #f87171; border: 1px solid rgba(239,68,68,.25); }

.lr-grid {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;
}
.lr-stat {
  background: rgba(255,255,255,.05); border-radius: 10px;
  padding: 10px 12px; text-align: center;
}
.lr-stat-val { font-size: 20px; font-weight: 700; color: #fff; }
.lr-stat-key { font-size: 11px; color: rgba(255,255,255,.4); margin-top: 2px; }

.lr-allergies, .lr-conditions {
  font-size: 12.5px; color: rgba(255,255,255,.7);
  background: rgba(239,68,68,.1); border: 1px solid rgba(239,68,68,.2);
  padding: 8px 12px; border-radius: 8px;
}
.lr-conditions { background: rgba(251,191,36,.08); border-color: rgba(251,191,36,.2); }
.lr-allergy-label, .lr-cond-label { font-weight: 600; margin-right: 4px; }

.lr-actions { display: flex; flex-wrap: wrap; gap: 8px; }

/* ══ TABLE ENHANCEMENTS ══ */
.patient-cell { display: flex; align-items: center; gap: 10px; }
.patient-cell-avatar {
  width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0;
  background: linear-gradient(135deg, #14b8a6, #0d9488);
  color: #fff; font-weight: 700; font-size: 12px;
  display: flex; align-items: center; justify-content: center;
}
.patient-name-link {
  font-weight: 600; color: var(--gray-800); text-decoration: none; font-size: 13.5px;
}
.patient-name-link:hover { color: var(--primary); }
.patient-email-row { font-size: 11.5px; color: var(--text-muted); }

.mono-tag {
  font-family: 'JetBrains Mono','Fira Code',monospace;
  font-size: 12px; color: var(--gray-600);
  background: var(--gray-100); padding: 2px 7px;
  border-radius: 5px;
}
.code-pill {
  font-family: 'JetBrains Mono','Fira Code',monospace;
  font-size: 11.5px; font-weight: 700;
  background: linear-gradient(135deg, rgba(13,148,136,.1), rgba(13,148,136,.05));
  border: 1px solid rgba(13,148,136,.2);
  color: var(--brand-700); padding: 3px 9px; border-radius: 6px;
  white-space: nowrap;
}
.blood-chip {
  font-size: 12px; font-weight: 700; color: var(--danger-fg);
  background: var(--danger-bg); padding: 2px 8px; border-radius: 6px;
  border: 1px solid #fecaca;
}

/* ══ FORM ══ */
.form-section-title {
  font-size: 11px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .1em; color: var(--text-muted);
  border-bottom: 1.5px solid var(--gray-100);
  padding-bottom: 8px; margin-bottom: 14px;
}
.req { color: var(--danger); margin-left: 2px; }
.input-error {
  border-color: var(--danger) !important;
  box-shadow: 0 0 0 3px rgba(220,38,38,.1) !important;
}
.info-box {
  display: flex; align-items: flex-start; gap: 12px;
  background: var(--brand-50); border: 1px solid var(--brand-200);
  border-radius: 10px; padding: 14px 16px;
  font-size: 13px; color: var(--brand-800); margin-top: 16px;
  line-height: 1.5;
}
.info-icon { font-size: 18px; flex-shrink: 0; margin-top: 1px; }

/* ══ TRANSITIONS ══ */
.lookup-slide-enter-active,.lookup-slide-leave-active { transition: all .3s cubic-bezier(.4,0,.2,1); }
.lookup-slide-enter-from { opacity:0; transform:translateY(-12px); }
.lookup-slide-leave-to   { opacity:0; transform:translateY(-8px); }

.result-pop-enter-active { animation: rIn .3s cubic-bezier(.34,1.46,.64,1); }
.result-pop-leave-active { animation: rOut .2s ease; }
@keyframes rIn  { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:none} }
@keyframes rOut { to{opacity:0} }

.mini-spin {
  display: inline-block; width: 14px; height: 14px;
  border: 2px solid rgba(255,255,255,.3); border-top-color: #fff;
  border-radius: 50%; animation: spin .7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ══ RESPONSIVE ══ */
@media (max-width: 768px) {
  .page-header { flex-direction: column; align-items: stretch; }
  .header-actions { flex-direction: column; }
  .lookup-inner { flex-direction: column; align-items: flex-start; }
  .lookup-input { width: 100%; }
  .lr-grid { grid-template-columns: repeat(2,1fr); }
}
</style>
