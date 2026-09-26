<template>
  <div class="emr-detail">
    <div v-if="loading" class="loading-state">
      <div class="spinner"></div>
      <p>Loading medical record...</p>
    </div>

    <div v-else-if="error" class="loading-state">
      <p>{{ error }}</p>
      <div class="btn-group">
        <button class="btn btn-primary" @click="fetchRecord">Retry</button>
        <button class="btn btn-outline" @click="$router.back()">Go back</button>
      </div>
    </div>

    <template v-else-if="record">
      <div class="detail-header">
        <button class="btn btn-sm" @click="$router.back()">&larr; Back</button>
        <div class="record-title">
          <h2>Medical Record</h2>
          <span class="text-muted">MRN: {{ record.mrn }} | Patient: {{ record.patient_first_name }} {{ record.patient_last_name }}</span>
        </div>
        <span class="badge" :class="'badge-' + getStatusColor(record.status)">{{ record.status }}</span>
      </div>

      <div class="record-grid">
        <div class="card">
          <div class="card-header"><h3>Patient Information</h3></div>
          <div class="card-body">
            <div class="info-row"><label>Doctor:</label><span>Dr. {{ record.doctor_first_name }} {{ record.doctor_last_name }}</span></div>
            <div class="info-row"><label>Date:</label><span>{{ formatDate(record.record_date) }}</span></div>
            <div class="info-row" v-if="record.specialty_name"><label>Specialty:</label><span>{{ record.specialty_name }}</span></div>
          </div>
        </div>

        <div class="card" v-if="record.vital_signs">
          <div class="card-header"><h3>Vital Signs</h3></div>
          <div class="card-body">
            <div class="vitals-grid">
              <div
                class="vital-card"
                :class="'vital-' + getVitalColor(key)"
                v-for="(val, key) in parsedVitals"
                :key="key"
              >
                <span class="vital-label">{{ key }}</span>
                <span class="vital-value">{{ val }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="card-header"><h3>Clinical Information</h3></div>
        <div class="card-body">
          <div class="clinical-section" v-if="record.chief_complaint">
            <h4>Chief Complaint</h4>
            <p>{{ record.chief_complaint }}</p>
          </div>
          <div class="clinical-section" v-if="record.history_of_present_illness">
            <h4>History of Present Illness</h4>
            <p>{{ record.history_of_present_illness }}</p>
          </div>
          <div class="clinical-section" v-if="record.physical_examination">
            <h4>Physical Examination</h4>
            <p>{{ record.physical_examination }}</p>
          </div>
          <div class="clinical-section" v-if="record.diagnosis">
            <h4>Diagnosis</h4>
            <p class="diagnosis">{{ record.diagnosis }}</p>
          </div>
          <div class="clinical-section" v-if="record.treatment_plan">
            <h4>Treatment Plan</h4>
            <p>{{ record.treatment_plan }}</p>
          </div>
          <div class="clinical-section" v-if="record.notes">
            <h4>Notes</h4>
            <p>{{ record.notes }}</p>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="card-header">
          <h3>Prescriptions</h3>
          <button
            v-if="canCreatePrescription"
            class="btn btn-sm btn-primary"
            @click="openPrescriptionModal"
          >+ Create Prescription</button>
        </div>
        <div class="card-body">
          <div v-if="record.prescriptions && record.prescriptions.length" class="prescriptions-list">
            <div v-for="rx in record.prescriptions" :key="rx.id" class="prescription-card">
              <div class="rx-header">
                <span class="rx-number">{{ rx.prescription_number }}</span>
                <span class="badge" :class="'badge-' + getStatusColor(rx.status)">{{ rx.status }}</span>
                <span class="rx-date">{{ formatDate(rx.created_at) }}</span>
              </div>
              <div class="rx-body">
                <p v-if="rx.medication_summary" class="rx-summary">{{ rx.medication_summary }}</p>
                <div v-if="rx.items && rx.items.length" class="rx-items">
                  <div v-for="(item, idx) in rx.items" :key="idx" class="rx-item">
                    <span class="rx-med">{{ item.medicine_name || item.medicine?.name || 'Medicine' }}</span>
                    <span class="rx-detail" v-if="item.dosage">{{ item.dosage }}</span>
                    <span class="rx-detail" v-if="item.frequency">{{ item.frequency }}</span>
                    <span class="rx-detail" v-if="item.duration">{{ item.duration }}</span>
                    <span class="rx-detail" v-if="item.quantity">Qty: {{ item.quantity }}</span>
                  </div>
                </div>
                <p v-if="rx.notes" class="rx-notes">{{ rx.notes }}</p>
              </div>
            </div>
          </div>
          <p v-else class="empty-state">No prescriptions found.</p>
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="card-header">
          <h3>Lab Orders</h3>
          <button
            v-if="canCreateLabOrder"
            class="btn btn-sm btn-primary"
            @click="openLabOrderModal"
          >+ Order Lab Tests</button>
        </div>
        <div class="card-body">
          <div v-if="record.lab_orders && record.lab_orders.length" class="lab-orders-list">
            <div v-for="lo in record.lab_orders" :key="lo.id" class="lab-order-card">
              <div class="lo-header">
                <span class="lo-order-number">{{ lo.order_number }}</span>
                <span class="badge" :class="'badge-' + getStatusColor(lo.status)">{{ lo.status }}</span>
                <span class="lo-priority" v-if="lo.priority">{{ lo.priority }}</span>
                <span class="lo-date">{{ formatDate(lo.created_at || lo.ordered_date) }}</span>
              </div>
              <div class="lo-body">
                <p v-if="lo.test_names" class="lo-tests">{{ lo.test_names }}</p>
                <div v-if="lo.tests && lo.tests.length" class="lo-tests-list">
                  <span v-for="test in lo.tests" :key="test.id" class="lo-test-tag">{{ test.name }}</span>
                </div>
                <p v-if="lo.clinical_notes" class="lo-notes">{{ lo.clinical_notes }}</p>
              </div>
            </div>
          </div>
          <p v-else class="empty-state">No lab orders found.</p>
        </div>
      </div>

      <!-- Prescription Modal -->
      <teleport to="body">
        <div v-if="showPrescriptionModal" class="modal-overlay" @click.self="closePrescriptionModal">
          <div class="modal-content prescription-modal">
            <div class="modal-header">
              <h3>Create Prescription</h3>
              <button class="modal-close" @click="closePrescriptionModal">&times;</button>
            </div>
            <div class="modal-body">
              <div v-if="record && !noAllergy(record.patient_allergies)" class="alert alert-info" style="margin-bottom: 16px">
                <span class="alert-icon">&#9888;</span>
                <div class="alert-content">
                  <div class="alert-title">Recorded allergies</div>
                  {{ record.patient_allergies }}
                </div>
              </div>

              <div v-if="safetyWarnings.length" class="alert alert-danger" style="margin-bottom: 16px">
                <span class="alert-icon">&#9940;</span>
                <div class="alert-content">
                  <div class="alert-title">Safety warning — review before prescribing</div>
                  <ul style="margin: 6px 0 0 16px">
                    <li v-for="(w, i) in safetyWarnings" :key="i">{{ w.message }}</li>
                  </ul>
                </div>
              </div>

              <div class="form-group">
                <label>Notes</label>
                <textarea
                  v-model="prescriptionForm.notes"
                  class="form-control"
                  rows="2"
                  placeholder="Prescription notes..."
                ></textarea>
              </div>

              <div class="items-header">
                <h4>Prescription Items</h4>
                <button class="btn btn-sm btn-primary" @click="addPrescriptionItem">+ Add Item</button>
              </div>

              <div
                v-for="(item, idx) in prescriptionForm.items"
                :key="idx"
                class="prescription-item-form"
              >
                <div class="item-header">
                  <span class="item-number">Item {{ idx + 1 }}</span>
                  <button
                    v-if="prescriptionForm.items.length > 1"
                    class="btn btn-sm btn-danger"
                    @click="removePrescriptionItem(idx)"
                  >Remove</button>
                </div>

                <div class="form-row">
                  <div class="form-group flex-2">
                    <label>Medicine *</label>
                    <div class="medicine-search-wrap">
                      <input
                        type="text"
                        class="form-control"
                        :value="item.medicineSearch"
                        @input="searchMedicine(idx, $event.target.value)"
                        @focus="item.showDropdown = true"
                        placeholder="Search medicine..."
                      />
                      <div v-if="item.showDropdown && item.medicineOptions.length" class="medicine-dropdown">
                        <div
                          v-for="med in item.medicineOptions"
                          :key="med.id"
                          class="medicine-option"
                          @click="selectMedicine(idx, med)"
                        >
                          <span class="med-name">{{ med.name }}</span>
                          <span class="med-generic" v-if="med.generic_name">{{ med.generic_name }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="form-row">
                  <div class="form-group">
                    <label>Dosage</label>
                    <input
                      v-model="item.dosage"
                      class="form-control"
                      placeholder="e.g. 500mg"
                    />
                  </div>
                  <div class="form-group">
                    <label>Frequency *</label>
                    <select v-model="item.frequency" class="form-control">
                      <option value="">Select...</option>
                      <option value="Once daily">Once daily</option>
                      <option value="Twice daily">Twice daily</option>
                      <option value="Three times daily">Three times daily</option>
                      <option value="Four times daily">Four times daily</option>
                      <option value="As needed">As needed</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label>Duration</label>
                    <input
                      v-model="item.duration"
                      class="form-control"
                      placeholder="e.g. 30 days"
                    />
                  </div>
                </div>

                <div class="form-row">
                  <div class="form-group">
                    <label>Quantity *</label>
                    <input
                      v-model.number="item.quantity"
                      type="number"
                      min="1"
                      step="1"
                      required
                      class="form-control"
                    />
                  </div>
                  <div class="form-group flex-2">
                    <label>Instructions</label>
                    <textarea
                      v-model="item.instructions"
                      class="form-control"
                      rows="2"
                      placeholder="e.g. Take with food"
                    ></textarea>
                  </div>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn btn-sm" @click="closePrescriptionModal">Cancel</button>
              <button
                v-if="safetyWarnings.length"
                class="btn btn-sm btn-danger"
                :disabled="submittingPrescription"
                @click="submitPrescription(true)"
              >
                {{ submittingPrescription ? 'Creating...' : 'Prescribe Anyway' }}
              </button>
              <button
                v-else
                class="btn btn-sm btn-primary"
                :disabled="submittingPrescription"
                @click="submitPrescription(false)"
              >
                {{ submittingPrescription ? 'Creating...' : 'Create Prescription' }}
              </button>
            </div>
          </div>
        </div>
      </teleport>

      <!-- Lab Order Modal -->
      <teleport to="body">
        <div v-if="showLabOrderModal" class="modal-overlay" @click.self="closeLabOrderModal">
          <div class="modal-content lab-order-modal">
            <div class="modal-header">
              <h3>Order Lab Tests</h3>
              <button class="modal-close" @click="closeLabOrderModal">&times;</button>
            </div>
            <div class="modal-body">
              <div class="form-group">
                <label>Priority</label>
                <select v-model="labOrderForm.priority" class="form-control">
                  <option value="routine">Routine</option>
                  <option value="urgent">Urgent</option>
                  <option value="stat">STAT</option>
                </select>
              </div>

              <div class="form-group">
                <label>Clinical Notes</label>
                <textarea
                  v-model="labOrderForm.clinical_notes"
                  class="form-control"
                  rows="3"
                  placeholder="Clinical notes for the lab..."
                ></textarea>
              </div>

              <div class="form-group">
                <label>Select Lab Tests *</label>
                <div v-if="loadingLabTests" class="loading-small">Loading tests...</div>
                <div v-else class="lab-tests-checklist">
                  <label
                    v-for="test in availableLabTests"
                    :key="test.id"
                    class="lab-test-checkbox"
                  >
                    <input
                      type="checkbox"
                      :value="test.id"
                      v-model="labOrderForm.test_ids"
                    />
                    <span class="test-name">{{ test.name }}</span>
                    <span class="test-category" v-if="test.category">{{ test.category }}</span>
                  </label>
                  <p v-if="!availableLabTests.length" class="empty-state small">No lab tests available.</p>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn btn-sm" @click="closeLabOrderModal">Cancel</button>
              <button
                class="btn btn-sm btn-primary"
                :disabled="submittingLabOrder || !labOrderForm.test_ids.length"
                @click="submitLabOrder"
              >
                {{ submittingLabOrder ? 'Ordering...' : 'Submit Order' }}
              </button>
            </div>
          </div>
        </div>
      </teleport>
    </template>
  </div>
</template>

<script>
import { ref, computed, onMounted, onBeforeUnmount, reactive, watch } from 'vue'
import { useRoute } from 'vue-router'
import axios from 'axios'
import { useToast } from '../../store/toast'
import { useAuthStore } from '../../store/auth'
import { formatDate, formatCurrency, getStatusColor } from '../../utils/helpers'

export default {
  name: 'EMRDetail',
  setup() {
    const route = useRoute()
    const toast = useToast()
    const auth = useAuthStore()
    const record = ref(null)
    const loading = ref(true)
    const error = ref('')
    let recordRequestGeneration = 0
    let recordController = null
    let prescriptionSubmissionGeneration = 0
    let labOrderSubmissionGeneration = 0
    let componentUnmounted = false

    const parsedVitals = computed(() => {
      if (!record.value?.vital_signs) return {}
      try {
        return typeof record.value.vital_signs === 'string'
          ? JSON.parse(record.value.vital_signs)
          : record.value.vital_signs
      } catch {
        return {}
      }
    })

    const canCreatePrescription = computed(() => {
      return ['doctor', 'admin'].includes(auth.userRole)
    })

    const canCreateLabOrder = computed(() => {
      return ['doctor', 'admin', 'nurse'].includes(auth.userRole)
    })

    function getVitalColor(key) {
      const k = key.toLowerCase()
      if (k.includes('bp') || k.includes('blood') || k.includes('pressure') || k.includes('systolic') || k.includes('diastolic')) return 'red'
      if (k.includes('temp')) return 'orange'
      if (k.includes('pulse') || k.includes('heart') || k.includes('hr')) return 'blue'
      if (k.includes('weight')) return 'green'
      return 'teal'
    }

    async function fetchRecord() {
      if (componentUnmounted) return
      recordRequestGeneration += 1
      const requestGeneration = recordRequestGeneration
      const recordId = route.params.id
      recordController?.abort()
      const controller = new AbortController()
      recordController = controller
      loading.value = true
      error.value = ''
      record.value = null
      try {
        const { data } = await axios.get(`/api/emr/${recordId}`, { signal: controller.signal })
        if (
          componentUnmounted ||
          controller.signal.aborted ||
          requestGeneration !== recordRequestGeneration
        ) return
        record.value = data
      } catch (err) {
        if (
          componentUnmounted ||
          controller.signal.aborted ||
          requestGeneration !== recordRequestGeneration ||
          axios.isCancel(err)
        ) return
        error.value = err.response?.data?.message || 'Failed to load medical record.'
        toast.error(error.value)
      } finally {
        if (
          !componentUnmounted &&
          requestGeneration === recordRequestGeneration &&
          recordController === controller
        ) {
          loading.value = false
          recordController = null
        }
      }
    }

    // --- Prescription Modal ---
    const showPrescriptionModal = ref(false)
    const submittingPrescription = ref(false)
    const safetyWarnings = ref([])

    function noAllergy(text) {
      if (!text) return true
      return ['none', 'n/a', 'na', 'nil', 'nkda'].includes(String(text).trim().toLowerCase())
    }

    function createEmptyItem() {
      return {
        medicine_id: null,
        medicineSearch: '',
        medicineOptions: [],
        showDropdown: false,
        dosage: '',
        frequency: '',
        duration: '',
        quantity: 1,
        instructions: ''
      }
    }

    const prescriptionForm = reactive({
      notes: '',
      items: [createEmptyItem()]
    })

    const medicineSearchDebouncers = new Map()
    const medicineSearchControllers = new Map()

    function clearPrescriptionWarnings() {
      safetyWarnings.value = []
    }

    function searchMedicine(idx, value) {
      const item = prescriptionForm.items[idx]
      if (!item) return
      item.medicineSearch = value
      item.medicine_id = null
      clearPrescriptionWarnings()
      clearTimeout(medicineSearchDebouncers.get(idx))
      medicineSearchDebouncers.delete(idx)
      medicineSearchControllers.get(idx)?.abort()
      medicineSearchControllers.delete(idx)
      const requestId = (item.searchRequestId || 0) + 1
      item.searchRequestId = requestId
      if (!value || value.length < 2) {
        item.medicineOptions = []
        return
      }
      const controller = new AbortController()
      medicineSearchControllers.set(idx, controller)
      const timer = setTimeout(async () => {
        try {
          const { data } = await axios.get('/api/pharmacy/medicines', {
            params: { search: value, limit: 20 },
            signal: controller.signal
          })
          if (
            !componentUnmounted &&
            !controller.signal.aborted &&
            prescriptionForm.items[idx] === item &&
            item.searchRequestId === requestId &&
            item.medicineSearch === value
          ) {
            item.medicineOptions = data.medicines || []
          }
        } catch {
          if (!componentUnmounted && !controller.signal.aborted && prescriptionForm.items[idx] === item && item.searchRequestId === requestId) {
            item.medicineOptions = []
          }
        } finally {
          if (medicineSearchControllers.get(idx) === controller) medicineSearchControllers.delete(idx)
        }
      }, 350)
      medicineSearchDebouncers.set(idx, timer)
    }

    function selectMedicine(idx, med) {
      prescriptionForm.items[idx].medicine_id = med.id
      prescriptionForm.items[idx].medicineSearch = med.name
      prescriptionForm.items[idx].medicineOptions = []
      prescriptionForm.items[idx].showDropdown = false
      clearPrescriptionWarnings()
    }

    function addPrescriptionItem() {
      prescriptionForm.items.push(createEmptyItem())
      clearPrescriptionWarnings()
    }

    function removePrescriptionItem(idx) {
      clearTimeout(medicineSearchDebouncers.get(idx))
      medicineSearchDebouncers.delete(idx)
      medicineSearchControllers.get(idx)?.abort()
      medicineSearchControllers.delete(idx)
      prescriptionForm.items.splice(idx, 1)
      clearPrescriptionWarnings()
    }

    function clearMedicineSearches() {
      medicineSearchDebouncers.forEach(timer => clearTimeout(timer))
      medicineSearchDebouncers.clear()
      medicineSearchControllers.forEach(controller => controller.abort())
      medicineSearchControllers.clear()
    }

    function openPrescriptionModal() {
      clearMedicineSearches()
      prescriptionForm.notes = ''
      prescriptionForm.items = [createEmptyItem()]
      safetyWarnings.value = []
      showPrescriptionModal.value = true
    }

    function closePrescriptionModal() {
      clearMedicineSearches()
      showPrescriptionModal.value = false
      safetyWarnings.value = []
    }

    async function submitPrescription(acknowledge = false) {
      const recordId = Number(record.value?.id)
      if (!recordId) return
      const invalidItem = prescriptionForm.items.find(item => {
        const quantity = Number(item.quantity)
        return !item.medicine_id || !String(item.dosage || '').trim() || !String(item.frequency || '').trim() || !Number.isInteger(quantity) || quantity <= 0
      })
      if (invalidItem) {
        toast.warning('Complete every prescription item, including medicine, dosage, frequency, and a positive whole-number quantity.')
        return
      }

      const requestRecordGeneration = recordRequestGeneration
      const submissionGeneration = ++prescriptionSubmissionGeneration
      const isCurrentRequest = () => (
        !componentUnmounted &&
        submissionGeneration === prescriptionSubmissionGeneration &&
        requestRecordGeneration === recordRequestGeneration &&
        Number(route.params.id) === recordId &&
        Number(record.value?.id) === recordId
      )
      submittingPrescription.value = true
      if (!acknowledge) safetyWarnings.value = []
      try {
        const { data } = await axios.post('/api/emr/prescriptions', {
          medical_record_id: recordId,
          patient_id: record.value.patient_id,
          items: prescriptionForm.items.map(i => ({
            medicine_id: i.medicine_id,
            dosage: String(i.dosage).trim(),
            frequency: i.frequency,
            duration: i.duration,
            quantity: Number(i.quantity),
            instructions: i.instructions
          })),
          notes: prescriptionForm.notes,
          acknowledge_warnings: acknowledge
        })
        if (!isCurrentRequest()) return
        if (data.warnings && data.warnings.length) {
          toast.warning(`Prescription created with ${data.warnings.length} safety warning(s).`)
        } else {
          toast.success('Prescription created successfully.')
        }
        closePrescriptionModal()
        await fetchRecord()
      } catch (err) {
        if (!isCurrentRequest()) return
        const res = err.response?.data
        if (err.response?.status === 409 && res?.warnings) {
          safetyWarnings.value = res.warnings
          toast.warning(res.message || 'Safety warning detected.')
        } else {
          toast.error(res?.message || 'Failed to create prescription.')
        }
      } finally {
        if (submissionGeneration === prescriptionSubmissionGeneration) submittingPrescription.value = false
      }
    }

    // --- Lab Order Modal ---
    const showLabOrderModal = ref(false)
    const submittingLabOrder = ref(false)
    const loadingLabTests = ref(false)
    const availableLabTests = ref([])
    let labTestsGeneration = 0
    let labTestsController = null

    const labOrderForm = reactive({
      test_ids: [],
      priority: 'routine',
      clinical_notes: ''
    })

    function openLabOrderModal() {
      labOrderForm.test_ids = []
      labOrderForm.priority = 'routine'
      labOrderForm.clinical_notes = ''
      showLabOrderModal.value = true
      fetchLabTests()
    }

    function closeLabOrderModal() {
      showLabOrderModal.value = false
      labTestsGeneration += 1
      labTestsController?.abort()
      labTestsController = null
      loadingLabTests.value = false
    }

    async function fetchLabTests() {
      if (componentUnmounted) return
      labTestsGeneration += 1
      const requestGeneration = labTestsGeneration
      labTestsController?.abort()
      const controller = new AbortController()
      labTestsController = controller
      loadingLabTests.value = true
      try {
        const { data } = await axios.get('/api/laboratory/tests', { signal: controller.signal })
        if (componentUnmounted || controller.signal.aborted || requestGeneration !== labTestsGeneration) return
        availableLabTests.value = Array.isArray(data) ? data : (data.data || data.tests || [])
      } catch {
        if (!componentUnmounted && !controller.signal.aborted && requestGeneration === labTestsGeneration) {
          toast.error('Failed to load lab tests.')
        }
      } finally {
        if (!componentUnmounted && requestGeneration === labTestsGeneration && labTestsController === controller) {
          loadingLabTests.value = false
          labTestsController = null
        }
      }
    }

    async function submitLabOrder() {
      const recordId = Number(record.value?.id)
      if (!recordId) return
      if (!labOrderForm.test_ids.length) {
        toast.warning('Please select at least one lab test.')
        return
      }

      const requestRecordGeneration = recordRequestGeneration
      const submissionGeneration = ++labOrderSubmissionGeneration
      const isCurrentRequest = () => (
        !componentUnmounted &&
        submissionGeneration === labOrderSubmissionGeneration &&
        requestRecordGeneration === recordRequestGeneration &&
        Number(route.params.id) === recordId &&
        Number(record.value?.id) === recordId
      )
      submittingLabOrder.value = true
      try {
        await axios.post('/api/laboratory/orders', {
          patient_id: record.value.patient_id,
          doctor_id: record.value.doctor_id,
          medical_record_id: recordId,
          test_ids: labOrderForm.test_ids,
          priority: labOrderForm.priority,
          clinical_notes: labOrderForm.clinical_notes
        })
        if (!isCurrentRequest()) return
        toast.success('Lab order submitted successfully.')
        closeLabOrderModal()
        await fetchRecord()
      } catch (err) {
        if (!isCurrentRequest()) return
        toast.error(err.response?.data?.message || 'Failed to submit lab order.')
      } finally {
        if (submissionGeneration === labOrderSubmissionGeneration) submittingLabOrder.value = false
      }
    }

    // Close dropdowns on outside click
    function handleOutsideClick() {
      prescriptionForm.items.forEach(item => {
        if (item.showDropdown) {
          item.showDropdown = false
        }
      })
    }

    watch(() => route.params.id, () => {
      prescriptionSubmissionGeneration += 1
      labOrderSubmissionGeneration += 1
      submittingPrescription.value = false
      submittingLabOrder.value = false
      closePrescriptionModal()
      closeLabOrderModal()
      fetchRecord()
    }, { immediate: true })
    onMounted(() => {
      document.addEventListener('click', handleOutsideClick)
    })

    onBeforeUnmount(() => {
      componentUnmounted = true
      recordRequestGeneration += 1
      prescriptionSubmissionGeneration += 1
      labOrderSubmissionGeneration += 1
      recordController?.abort()
      recordController = null
      clearMedicineSearches()
      labTestsGeneration += 1
      labTestsController?.abort()
      labTestsController = null
      document.removeEventListener('click', handleOutsideClick)
    })

    return {
      record,
      loading,
      error,
      fetchRecord,
      parsedVitals,
      canCreatePrescription,
      canCreateLabOrder,
      getVitalColor,
      formatDate,
      formatCurrency,
      getStatusColor,
      showPrescriptionModal,
      submittingPrescription,
      safetyWarnings,
      noAllergy,
      prescriptionForm,
      searchMedicine,
      selectMedicine,
      addPrescriptionItem,
      removePrescriptionItem,
      openPrescriptionModal,
      closePrescriptionModal,
      submitPrescription,
      showLabOrderModal,
      submittingLabOrder,
      loadingLabTests,
      availableLabTests,
      labOrderForm,
      openLabOrderModal,
      closeLabOrderModal,
      submitLabOrder
    }
  }
}
</script>

<style scoped>
.emr-detail {
  padding: 24px;
  max-width: 1100px;
  margin: 0 auto;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 0;
  gap: 16px;
  color: var(--gray-500);
}

.spinner {
  width: 36px;
  height: 36px;
  border: 3px solid var(--gray-200);
  border-top-color: #0d9488;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.detail-header {
  display: flex;
  align-items: center;
  gap: 20px;
  margin-bottom: 24px;
}

.record-title {
  flex: 1;
}

.record-title h2 {
  font-size: 20px;
  color: var(--gray-800);
}

.text-muted {
  color: var(--gray-400);
  font-size: 13px;
}

.record-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.info-row {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  border-bottom: 1px solid var(--gray-100);
  font-size: 14px;
}

.info-row label {
  color: var(--gray-500);
}

.info-row span {
  font-weight: 500;
  color: var(--gray-800);
}

.vitals-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

.vital-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  border-radius: 8px;
  text-align: center;
}

.vital-label {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.vital-value {
  font-size: 18px;
  font-weight: 700;
}

.vital-red {
  background: var(--danger-bg);
  border: 1px solid #fecaca;
}
.vital-red .vital-label { color: #dc2626; }
.vital-red .vital-value { color: #dc2626; }

.vital-orange {
  background: var(--warning-bg);
  border: 1px solid #fed7aa;
}
.vital-orange .vital-label { color: #ea580c; }
.vital-orange .vital-value { color: #ea580c; }

.vital-blue {
  background: var(--info-bg);
  border: 1px solid #bfdbfe;
}
.vital-blue .vital-label { color: #2563eb; }
.vital-blue .vital-value { color: #2563eb; }

.vital-green {
  background: var(--success-bg);
  border: 1px solid #bbf7d0;
}
.vital-green .vital-label { color: #16a34a; }
.vital-green .vital-value { color: #16a34a; }

.vital-teal {
  background: var(--brand-50);
  border: 1px solid #99f6e4;
}
.vital-teal .vital-label { color: #0d9488; }
.vital-teal .vital-value { color: #0d9488; }

.clinical-section {
  margin-bottom: 16px;
}

.clinical-section h4 {
  font-size: 14px;
  color: #0d9488;
  margin-bottom: 6px;
  font-weight: 600;
}

.clinical-section p {
  font-size: 14px;
  color: var(--gray-700);
  line-height: 1.6;
  white-space: pre-wrap;
}

.diagnosis {
  background: var(--danger-bg);
  padding: 8px 12px;
  border-radius: 6px;
  border-left: 3px solid #ef4444;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.prescriptions-list,
.lab-orders-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.prescription-card {
  border: 1px solid var(--gray-200);
  border-radius: 8px;
  padding: 14px;
  background: var(--gray-50);
}

.rx-header {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 8px;
}

.rx-number {
  font-weight: 600;
  color: #0d9488;
  font-size: 14px;
}

.rx-date {
  margin-left: auto;
  font-size: 12px;
  color: var(--gray-400);
}

.rx-body {
  font-size: 14px;
  color: var(--gray-700);
}

.rx-summary {
  color: var(--gray-600);
  margin-bottom: 8px;
}

.rx-items {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.rx-item {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 13px;
  padding: 4px 0;
  border-bottom: 1px dashed var(--gray-100);
}

.rx-med {
  font-weight: 600;
  color: var(--gray-800);
}

.rx-detail {
  color: var(--gray-500);
}

.rx-notes {
  margin-top: 8px;
  font-size: 13px;
  color: var(--gray-500);
  font-style: italic;
}

.lab-order-card {
  border: 1px solid var(--gray-200);
  border-radius: 8px;
  padding: 14px;
  background: var(--gray-50);
}

.lo-header {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 8px;
}

.lo-order-number {
  font-weight: 600;
  color: #2563eb;
  font-size: 14px;
}

.lo-priority {
  font-size: 12px;
  text-transform: capitalize;
  color: var(--gray-500);
  background: var(--gray-100);
  padding: 2px 8px;
  border-radius: 4px;
}

.lo-date {
  margin-left: auto;
  font-size: 12px;
  color: var(--gray-400);
}

.lo-body {
  font-size: 14px;
  color: var(--gray-700);
}

.lo-tests {
  font-weight: 500;
  color: var(--gray-800);
}

.lo-tests-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}

.lo-test-tag {
  background: var(--info-bg);
  color: #2563eb;
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 12px;
  border: 1px solid #bfdbfe;
}

.lo-notes {
  margin-top: 8px;
  font-size: 13px;
  color: var(--gray-500);
  font-style: italic;
}

.empty-state {
  color: var(--gray-400);
  font-size: 14px;
  text-align: center;
  padding: 20px;
}

.empty-state.small {
  padding: 10px;
  font-size: 13px;
}

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: var(--white);
  border-radius: 12px;
  width: 90%;
  max-height: 85vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.prescription-modal {
  max-width: 680px;
}

.lab-order-modal {
  max-width: 600px;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--gray-200);
}

.modal-header h3 {
  font-size: 18px;
  color: var(--gray-800);
  margin: 0;
}

.modal-close {
  background: none;
  border: none;
  font-size: 24px;
  color: var(--gray-400);
  cursor: pointer;
  line-height: 1;
}

.modal-close:hover {
  color: var(--gray-600);
}

.modal-body {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 20px;
  border-top: 1px solid var(--gray-200);
}

.form-group {
  margin-bottom: 14px;
}

.form-group label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--gray-700);
  margin-bottom: 4px;
}

.form-control {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--gray-300);
  border-radius: 6px;
  font-size: 14px;
  color: var(--gray-800);
  background: var(--white);
  box-sizing: border-box;
}

.form-control:focus {
  outline: none;
  border-color: #0d9488;
  box-shadow: 0 0 0 3px rgba(13, 148, 136, 0.1);
}

textarea.form-control {
  resize: vertical;
}

select.form-control {
  appearance: auto;
}

.form-row {
  display: flex;
  gap: 12px;
}

.form-row .form-group {
  flex: 1;
}

.form-row .form-group.flex-2 {
  flex: 2;
}

.items-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.items-header h4 {
  font-size: 15px;
  color: var(--gray-800);
  margin: 0;
}

.prescription-item-form {
  border: 1px solid var(--gray-200);
  border-radius: 8px;
  padding: 14px;
  margin-bottom: 12px;
  background: var(--gray-50);
}

.item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.item-number {
  font-weight: 600;
  font-size: 13px;
  color: #0d9488;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.medicine-search-wrap {
  position: relative;
}

.medicine-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: var(--white);
  border: 1px solid var(--gray-300);
  border-top: none;
  border-radius: 0 0 6px 6px;
  max-height: 180px;
  overflow-y: auto;
  z-index: 10;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.medicine-option {
  padding: 8px 12px;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.medicine-option:hover {
  background: var(--brand-50);
}

.med-name {
  font-weight: 500;
  color: var(--gray-800);
}

.med-generic {
  font-size: 12px;
  color: var(--gray-400);
}

.lab-tests-checklist {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid var(--gray-200);
  border-radius: 6px;
  padding: 8px;
}

.lab-test-checkbox {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.lab-test-checkbox:hover {
  background: var(--gray-50);
}

.lab-test-checkbox input[type="checkbox"] {
  accent-color: #0d9488;
}

.test-name {
  color: var(--gray-800);
  font-weight: 500;
}

.test-category {
  font-size: 12px;
  color: var(--gray-400);
  margin-left: auto;
}

.loading-small {
  font-size: 13px;
  color: var(--gray-400);
  padding: 10px;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 16px;
  border: 1px solid var(--gray-300);
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  background: var(--white);
  color: var(--gray-700);
  transition: all 0.15s;
}

.btn:hover {
  background: var(--gray-50);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-sm {
  padding: 5px 12px;
  font-size: 13px;
}

.btn-primary {
  background: #0d9488;
  color: white;
  border-color: #0d9488;
}

.btn-primary:hover {
  background: #0f766e;
}

.btn-danger {
  background: #ef4444;
  color: white;
  border-color: #ef4444;
}

.btn-danger:hover {
  background: #dc2626;
}

.badge {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  text-transform: capitalize;
}

.badge-success {
  background: var(--success-bg);
  color: var(--success-fg);
}

.badge-warning {
  background: var(--warning-bg);
  color: var(--warning-fg);
}

.badge-info {
  background: var(--info-bg);
  color: var(--info-fg);
}

.badge-danger {
  background: var(--danger-bg);
  color: var(--danger-fg);
}

.badge-gray {
  background: var(--gray-100);
  color: var(--gray-500);
}

@media (max-width: 768px) {
  .record-grid {
    grid-template-columns: 1fr;
  }
  .form-row {
    flex-direction: column;
  }
  .vitals-grid {
    grid-template-columns: 1fr 1fr;
  }
  .detail-header {
    flex-wrap: wrap;
    gap: 12px;
  }
}

@media (max-width: 480px) {
  .vitals-grid {
    grid-template-columns: 1fr;
  }
  .record-title h2 {
    font-size: 17px;
  }
}
</style>
