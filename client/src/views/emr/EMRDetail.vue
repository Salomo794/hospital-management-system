<template>
  <div class="emr-detail">
    <div v-if="loading" class="loading-state">
      <div class="spinner"></div>
      <p>Loading medical record...</p>
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
                    <label>Quantity</label>
                    <input
                      v-model.number="item.quantity"
                      type="number"
                      min="1"
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
import { ref, computed, onMounted, onBeforeUnmount, reactive } from 'vue'
import { useRoute } from 'vue-router'
import axios from 'axios'
import { useToast } from '../../store/toast'
import { useAuthStore } from '../../store/auth'
import { formatDate, formatCurrency, getStatusColor, debounce } from '../../utils/helpers'

export default {
  name: 'EMRDetail',
  setup() {
    const route = useRoute()
    const toast = useToast()
    const auth = useAuthStore()
    const record = ref(null)
    const loading = ref(true)

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
      loading.value = true
      try {
        const { data } = await axios.get(`/api/emr/${route.params.id}`)
        record.value = data
      } catch (err) {
        toast.error('Failed to load medical record.')
      } finally {
        loading.value = false
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

    const searchMedicineDebounced = debounce(async (idx, query) => {
      if (!query || query.length < 2) {
        prescriptionForm.items[idx].medicineOptions = []
        return
      }
      try {
        const { data } = await axios.get('/api/pharmacy/medicines', { params: { search: query } })
        prescriptionForm.items[idx].medicineOptions = Array.isArray(data) ? data : (data.data || data.medicines || [])
      } catch {
        prescriptionForm.items[idx].medicineOptions = []
      }
    }, 350)

    function searchMedicine(idx, value) {
      prescriptionForm.items[idx].medicineSearch = value
      prescriptionForm.items[idx].medicine_id = null
      searchMedicineDebounced(idx, value)
    }

    function selectMedicine(idx, med) {
      prescriptionForm.items[idx].medicine_id = med.id
      prescriptionForm.items[idx].medicineSearch = med.name
      prescriptionForm.items[idx].medicineOptions = []
      prescriptionForm.items[idx].showDropdown = false
    }

    function addPrescriptionItem() {
      prescriptionForm.items.push(createEmptyItem())
    }

    function removePrescriptionItem(idx) {
      prescriptionForm.items.splice(idx, 1)
    }

    function openPrescriptionModal() {
      prescriptionForm.notes = ''
      prescriptionForm.items = [createEmptyItem()]
      safetyWarnings.value = []
      showPrescriptionModal.value = true
    }

    function closePrescriptionModal() {
      showPrescriptionModal.value = false
      safetyWarnings.value = []
    }

    async function submitPrescription(acknowledge = false) {
      const validItems = prescriptionForm.items.filter(i => i.medicine_id && i.frequency)
      if (!validItems.length) {
        toast.warning('Please add at least one item with a medicine and frequency.')
        return
      }
      submittingPrescription.value = true
      if (!acknowledge) safetyWarnings.value = []
      try {
        const { data } = await axios.post('/api/emr/prescriptions', {
          medical_record_id: record.value.id,
          patient_id: record.value.patient_id,
          items: validItems.map(i => ({
            medicine_id: i.medicine_id,
            dosage: i.dosage,
            frequency: i.frequency,
            duration: i.duration,
            quantity: i.quantity,
            instructions: i.instructions
          })),
          notes: prescriptionForm.notes,
          acknowledge_warnings: acknowledge
        })
        if (data.warnings && data.warnings.length) {
          toast.warning(`Prescription created with ${data.warnings.length} safety warning(s).`)
        } else {
          toast.success('Prescription created successfully.')
        }
        closePrescriptionModal()
        await fetchRecord()
      } catch (err) {
        const res = err.response?.data
        if (err.response?.status === 409 && res?.warnings) {
          safetyWarnings.value = res.warnings
          toast.warning(res.message || 'Safety warning detected.')
        } else {
          toast.error(res?.message || 'Failed to create prescription.')
        }
      } finally {
        submittingPrescription.value = false
      }
    }

    // --- Lab Order Modal ---
    const showLabOrderModal = ref(false)
    const submittingLabOrder = ref(false)
    const loadingLabTests = ref(false)
    const availableLabTests = ref([])

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
    }

    async function fetchLabTests() {
      loadingLabTests.value = true
      try {
        const { data } = await axios.get('/api/laboratory/tests')
        availableLabTests.value = Array.isArray(data) ? data : (data.data || data.tests || [])
      } catch {
        toast.error('Failed to load lab tests.')
      } finally {
        loadingLabTests.value = false
      }
    }

    async function submitLabOrder() {
      if (!labOrderForm.test_ids.length) {
        toast.warning('Please select at least one lab test.')
        return
      }
      submittingLabOrder.value = true
      try {
        await axios.post('/api/laboratory/orders', {
          patient_id: record.value.patient_id,
          medical_record_id: record.value.id,
          test_ids: labOrderForm.test_ids,
          priority: labOrderForm.priority,
          clinical_notes: labOrderForm.clinical_notes
        })
        toast.success('Lab order submitted successfully.')
        closeLabOrderModal()
        await fetchRecord()
      } catch (err) {
        toast.error(err.response?.data?.message || 'Failed to submit lab order.')
      } finally {
        submittingLabOrder.value = false
      }
    }

    // Close dropdowns on outside click
    function handleOutsideClick(e) {
      prescriptionForm.items.forEach(item => {
        if (item.showDropdown) {
          item.showDropdown = false
        }
      })
    }

    onMounted(() => {
      fetchRecord()
      document.addEventListener('click', handleOutsideClick)
    })

    onBeforeUnmount(() => {
      document.removeEventListener('click', handleOutsideClick)
    })

    return {
      record,
      loading,
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
  color: #64748b;
}

.spinner {
  width: 36px;
  height: 36px;
  border: 3px solid #e2e8f0;
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
  color: #1e293b;
}

.text-muted {
  color: #94a3b8;
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
  border-bottom: 1px solid #f1f5f9;
  font-size: 14px;
}

.info-row label {
  color: #64748b;
}

.info-row span {
  font-weight: 500;
  color: #1e293b;
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
  background: #fef2f2;
  border: 1px solid #fecaca;
}
.vital-red .vital-label { color: #dc2626; }
.vital-red .vital-value { color: #dc2626; }

.vital-orange {
  background: #fff7ed;
  border: 1px solid #fed7aa;
}
.vital-orange .vital-label { color: #ea580c; }
.vital-orange .vital-value { color: #ea580c; }

.vital-blue {
  background: #eff6ff;
  border: 1px solid #bfdbfe;
}
.vital-blue .vital-label { color: #2563eb; }
.vital-blue .vital-value { color: #2563eb; }

.vital-green {
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
}
.vital-green .vital-label { color: #16a34a; }
.vital-green .vital-value { color: #16a34a; }

.vital-teal {
  background: #f0fdfa;
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
  color: #334155;
  line-height: 1.6;
  white-space: pre-wrap;
}

.diagnosis {
  background: #fef2f2;
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
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 14px;
  background: #fafffe;
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
  color: #94a3b8;
}

.rx-body {
  font-size: 14px;
  color: #334155;
}

.rx-summary {
  color: #475569;
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
  border-bottom: 1px dashed #f1f5f9;
}

.rx-med {
  font-weight: 600;
  color: #1e293b;
}

.rx-detail {
  color: #64748b;
}

.rx-notes {
  margin-top: 8px;
  font-size: 13px;
  color: #64748b;
  font-style: italic;
}

.lab-order-card {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 14px;
  background: #fafffe;
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
  color: #64748b;
  background: #f1f5f9;
  padding: 2px 8px;
  border-radius: 4px;
}

.lo-date {
  margin-left: auto;
  font-size: 12px;
  color: #94a3b8;
}

.lo-body {
  font-size: 14px;
  color: #334155;
}

.lo-tests {
  font-weight: 500;
  color: #1e293b;
}

.lo-tests-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}

.lo-test-tag {
  background: #eff6ff;
  color: #2563eb;
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 12px;
  border: 1px solid #bfdbfe;
}

.lo-notes {
  margin-top: 8px;
  font-size: 13px;
  color: #64748b;
  font-style: italic;
}

.empty-state {
  color: #94a3b8;
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
  background: white;
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
  border-bottom: 1px solid #e2e8f0;
}

.modal-header h3 {
  font-size: 18px;
  color: #1e293b;
  margin: 0;
}

.modal-close {
  background: none;
  border: none;
  font-size: 24px;
  color: #94a3b8;
  cursor: pointer;
  line-height: 1;
}

.modal-close:hover {
  color: #475569;
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
  border-top: 1px solid #e2e8f0;
}

.form-group {
  margin-bottom: 14px;
}

.form-group label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: #374151;
  margin-bottom: 4px;
}

.form-control {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
  color: #1e293b;
  background: white;
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
  color: #1e293b;
  margin: 0;
}

.prescription-item-form {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 14px;
  margin-bottom: 12px;
  background: #fafffe;
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
  background: white;
  border: 1px solid #d1d5db;
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
  background: #f0fdfa;
}

.med-name {
  font-weight: 500;
  color: #1e293b;
}

.med-generic {
  font-size: 12px;
  color: #94a3b8;
}

.lab-tests-checklist {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid #e2e8f0;
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
  background: #f8fafc;
}

.lab-test-checkbox input[type="checkbox"] {
  accent-color: #0d9488;
}

.test-name {
  color: #1e293b;
  font-weight: 500;
}

.test-category {
  font-size: 12px;
  color: #94a3b8;
  margin-left: auto;
}

.loading-small {
  font-size: 13px;
  color: #94a3b8;
  padding: 10px;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 16px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  background: white;
  color: #374151;
  transition: all 0.15s;
}

.btn:hover {
  background: #f8fafc;
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
  background: #dcfce7;
  color: #16a34a;
}

.badge-warning {
  background: #fef9c3;
  color: #ca8a04;
}

.badge-info {
  background: #e0f2fe;
  color: #0284c7;
}

.badge-danger {
  background: #fee2e2;
  color: #dc2626;
}

.badge-gray {
  background: #f1f5f9;
  color: #64748b;
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
}
</style>
