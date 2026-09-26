<template>
  <div class="pharmacy-page">
    <div class="page-header">
      <div class="tabs-inline">
        <button :class="{ active: view === 'medicines' }" @click="view = 'medicines'; loadMedicines()">Medicines</button>
        <button :class="{ active: view === 'alerts' }" @click="view = 'alerts'; loadAlerts()">Stock Alerts</button>
        <button :class="{ active: view === 'interactions' }" @click="view = 'interactions'; loadInteractionView()">Interactions</button>
      </div>
      <div class="header-actions">
        <button v-if="view === 'medicines' && authStore.can('admin', 'pharmacist')" class="btn btn-outline" @click="openDispenseModal">Dispense</button>
        <button class="btn btn-primary" @click="openAddModal" v-if="view === 'medicines'">+ Add Medicine</button>
      </div>
    </div>

    <div v-if="view === 'medicines'">
      <div class="search-filters">
        <input type="text" v-model="search" placeholder="Search medicines..." @input="debouncedSearch" />
        <select v-model="categoryFilter" @change="page = 1; loadMedicines()">
          <option value="">All Categories</option>
          <option>Analgesic</option><option>Antibiotic</option><option>Antihistamine</option>
          <option>Cardiovascular</option><option>Diabetes</option><option>Gastrointestinal</option>
          <option>Respiratory</option><option>Vitamins</option><option>Other</option>
        </select>
        <label class="checkbox-label"><input type="checkbox" v-model="lowStockOnly" @change="page = 1; loadMedicines()" /> Low Stock Only</label>
      </div>
      <div class="card">
        <div v-if="loadingMedicines" class="loading-container">
          <div class="spinner"></div>
          <span class="loading-text">Loading medicines...</span>
        </div>
        <template v-else>
          <table class="data-table" v-if="medicines.length">
            <thead><tr><th>Name</th><th>Generic Name</th><th>Category</th><th>Stock</th><th>Unit Price</th><th>Expiry</th><th>Status</th></tr></thead>
            <tbody>
              <tr v-for="m in medicines" :key="m.id">
                <td><strong>{{ m.name }}</strong></td>
                <td>{{ m.generic_name || '-' }}</td>
                <td><span class="badge badge-info">{{ m.category || '-' }}</span></td>
                <td>
                  <span :class="m.stock_quantity <= m.min_stock_level ? 'text-danger' : ''">
                    {{ m.stock_quantity }} {{ m.unit }}
                  </span>
                </td>
                <td>{{ formatCurrency(m.unit_price) }}</td>
                <td>{{ formatDate(m.expiry_date) }}</td>
                <td>
                  <span v-if="m.stock_quantity <= m.min_stock_level" class="badge badge-danger">Low Stock</span>
                  <span v-else class="badge badge-success">In Stock</span>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else class="empty-state">
            <div class="empty-icon">&#x1F48A;</div>
            <p>No medicines found.</p>
            <span class="empty-hint">Add a medicine or adjust your search filters.</span>
          </div>
        </template>
      </div>
      <div class="pagination" v-if="total > limit">
        <button class="btn btn-sm" :disabled="page <= 1" @click="page--; loadMedicines()">Previous</button>
        <span>Page {{ page }} of {{ Math.ceil(total / limit) }}</span>
        <button class="btn btn-sm" :disabled="page >= Math.ceil(total / limit)" @click="page++; loadMedicines()">Next</button>
      </div>
    </div>

    <div v-if="view === 'alerts'">
      <div v-if="loadingAlerts" class="loading-container">
        <div class="spinner"></div>
        <span class="loading-text">Loading alerts...</span>
      </div>
      <div class="alerts-grid" v-else>
        <div class="card">
          <div class="card-header"><h3>Low Stock Items ({{ lowStock.length }})</h3></div>
          <div class="card-body">
            <div class="alert-item" v-for="m in lowStock" :key="m.id">
              <div class="alert-info">
                <strong>{{ m.name }}</strong>
                <span class="text-danger">{{ m.stock_quantity }} {{ m.unit }} remaining (min: {{ m.min_stock_level }})</span>
              </div>
            </div>
            <div v-if="lowStock.length === 0" class="empty-state">
              <p>All items are well-stocked.</p>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3>Expired Items ({{ expired.length }})</h3></div>
          <div class="card-body">
            <div class="alert-item" v-for="m in expired" :key="m.id">
              <div class="alert-info">
                <strong>{{ m.name }}</strong>
                <span class="text-danger">Expired: {{ formatDate(m.expiry_date) }}</span>
              </div>
            </div>
            <div v-if="expired.length === 0" class="empty-state">
              <p>No expired items.</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Drug Interaction Checker -->
    <div v-if="view === 'interactions'">
      <div v-if="loadingInteractions" class="loading-container">
        <div class="spinner"></div>
        <span class="loading-text">Loading interaction data...</span>
      </div>
      <template v-else>
        <div class="interaction-summary">
          <div class="summary-chip" v-for="s in severityKeys" :key="s" :class="'chip-' + s">
            <span class="chip-count">{{ interactionSummary.summary[s] || 0 }}</span>
            <span class="chip-label">{{ severityLabel(s) }}</span>
          </div>
          <div class="summary-total"><strong>{{ interactionSummary.total || 0 }}</strong> known interactions in formulary</div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3>Check Interactions</h3>
            <button class="btn btn-primary btn-sm" :disabled="selectedIds.length < 2 || checkingInteractions" @click="checkInteractions">
              <span v-if="checkingInteractions" class="spinner-sm"></span>
              {{ checkingInteractions ? 'Checking...' : 'Check Interactions' }}
            </button>
          </div>
          <div class="card-body">
            <p class="interaction-hint">Select at least two medicines to screen for potential drug-drug interactions.</p>
            <div class="interaction-picker">
              <label class="picker-item" v-for="m in medicines" :key="m.id">
                <input type="checkbox" :value="m.id" v-model="selectedIds" @change="clearInteractionResults" />
                <span>{{ m.name }}</span>
                <span class="picker-generic" v-if="m.generic_name">{{ m.generic_name }}</span>
              </label>
              <div v-if="!medicines.length" class="empty-state"><p>No medicines available to check.</p></div>
            </div>

            <div v-if="interactionResults.length" class="interaction-results">
              <div class="result-group" v-for="grp in groupedResults" :key="grp.severity">
                <h4 :class="'sev-' + grp.severity">{{ severityLabel(grp.severity) }} ({{ grp.items.length }})</h4>
                <div class="interaction-item" v-for="it in grp.items" :key="it.id">
                  <div class="interaction-pair">
                    <span class="pair-med">{{ it.medicine_a }}</span>
                    <span class="pair-sep">&#8646;</span>
                    <span class="pair-med">{{ it.medicine_b }}</span>
                    <span class="badge" :class="'badge-' + sevBadge(it.severity)">{{ it.severity }}</span>
                  </div>
                  <div class="interaction-desc">{{ it.description }}</div>
                  <div class="interaction-mgmt" v-if="it.clinical_management"><strong>Management:</strong> {{ it.clinical_management }}</div>
                </div>
              </div>
            </div>
            <div v-else-if="checkedIds.length >= 2" class="empty-state interaction-clear">
              <div class="empty-icon">&#9989;</div>
              <p>No known interactions between the selected medicines.</p>
            </div>
          </div>
        </div>
      </template>
    </div>
    <div class="modal-overlay" v-if="showAddModal" @click.self="closeAddModal">
      <div class="modal">
        <div class="modal-header"><h3>Add New Medicine</h3><button class="modal-close" @click="closeAddModal">&times;</button></div>
        <div class="modal-body">
          <form @submit.prevent="addMedicine">
            <div class="form-row">
              <div class="form-group"><label>Name *</label><input v-model="medForm.name" required /></div>
              <div class="form-group"><label>Generic Name</label><input v-model="medForm.generic_name" /></div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Category</label>
                <select v-model="medForm.category"><option>Analgesic</option><option>Antibiotic</option><option>Antihistamine</option><option>Cardiovascular</option><option>Diabetes</option><option>Gastrointestinal</option><option>Respiratory</option><option>Vitamins</option><option>Other</option></select>
              </div>
              <div class="form-group"><label>Manufacturer</label><input v-model="medForm.manufacturer" /></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label>Unit Price *</label><input type="number" step="0.01" v-model="medForm.unit_price" required /></div>
              <div class="form-group"><label>Cost Price</label><input type="number" step="0.01" v-model="medForm.cost_price" /></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label>Stock Quantity *</label><input type="number" v-model="medForm.stock_quantity" required /></div>
              <div class="form-group"><label>Unit</label><select v-model="medForm.unit"><option>tablet</option><option>capsule</option><option>ml</option><option>vial</option><option>ampoule</option><option>tube</option></select></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label>Min Stock Level</label><input type="number" v-model="medForm.min_stock_level" /></div>
              <div class="form-group"><label>Expiry Date</label><input type="date" v-model="medForm.expiry_date" /></div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" @click="closeAddModal">Cancel</button>
              <button type="submit" class="btn btn-primary" :disabled="savingMedicine">
                <span v-if="savingMedicine" class="spinner-sm"></span>
                {{ savingMedicine ? 'Adding...' : 'Add Medicine' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>

    <!-- Dispense Modal -->
    <div class="modal-overlay" v-if="showDispenseModal" @click.self="closeDispenseModal">
      <div class="modal">
        <div class="modal-header">
          <h3>Dispense Medicine</h3>
          <button class="modal-close" @click="closeDispenseModal">&times;</button>
        </div>
        <div class="modal-body">
          <div v-if="loadingPrescriptions" class="loading-container">
            <div class="spinner"></div>
            <span class="loading-text">Loading prescriptions...</span>
          </div>
          <template v-else>
            <div class="form-group">
              <label>Search Prescription Items *</label>
              <input
                v-model="prescriptionSearch"
                placeholder="Search by patient name, medicine, or prescription #..."
                @input="filterPrescriptionItems"
              />
            </div>
            <div v-if="filteredPrescriptionItems.length" class="prescription-list">
              <div
                v-for="item in filteredPrescriptionItems"
                :key="item.id"
                class="prescription-item"
                :class="{ selected: dispenseForm.prescription_item_id === item.id }"
                @click="selectPrescriptionItem(item)"
              >
                <div class="rx-info">
                  <strong>{{ item.medicine_name }}</strong>
                  <span class="rx-meta">
                    Rx #{{ item.prescription_id }} &mdash; {{ item.patient_name }} ({{ item.patient_mrn }})
                  </span>
                </div>
                <div class="rx-qty">Remaining: {{ item.quantity_remaining ?? item.quantity_prescribed }}</div>
              </div>
            </div>
            <div v-else-if="prescriptionSearch.length >= 2" class="empty-state">
              <p>No pending prescription items match your search.</p>
            </div>

            <div v-if="dispenseForm.prescription_item_id" class="selected-rx-banner">
              <span>Selected: <strong>{{ selectedPrescriptionItem?.medicine_name }}</strong> for {{ selectedPrescriptionItem?.patient_name }}</span>
            </div>

            <div
              v-if="selectedPrescriptionItem && !noAllergy(selectedPrescriptionItem.patient_allergies)"
              class="alert alert-info"
              style="margin-bottom: 12px"
            >
              <span class="alert-icon">&#9888;</span>
              <div class="alert-content">
                <div class="alert-title">Recorded allergies</div>
                {{ selectedPrescriptionItem.patient_allergies }}
              </div>
            </div>

            <div v-if="safetyWarnings.length" class="alert alert-danger" style="margin-bottom: 12px">
              <span class="alert-icon">&#9940;</span>
              <div class="alert-content">
                <div class="alert-title">Safety warning — review before dispensing</div>
                <ul style="margin: 6px 0 0 16px">
                  <li v-for="(w, i) in safetyWarnings" :key="i">{{ w.message }}</li>
                </ul>
              </div>
            </div>

            <form @submit.prevent="dispenseMedicineAction(false)" v-if="dispenseForm.prescription_item_id">
              <div class="form-group">
                <label>Quantity to Dispense *</label>
                <input
                  type="number"
                  v-model.number="dispenseForm.quantity"
                  min="1"
                  step="1"
                  :max="selectedPrescriptionItem?.quantity_remaining || selectedPrescriptionItem?.quantity_prescribed || 1"
                  required
                  @input="onDispenseQuantityChange"
                />
                <span class="field-hint" v-if="selectedPrescriptionItem">
                  Prescribed: {{ selectedPrescriptionItem.quantity_prescribed }} · Remaining: {{ selectedPrescriptionItem.quantity_remaining ?? selectedPrescriptionItem.quantity_prescribed }}
                </span>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" @click="closeDispenseModal">Cancel</button>
                <button
                  v-if="safetyWarnings.length"
                  type="button"
                  class="btn btn-danger"
                  :disabled="dispensing || !dispenseQuantityValid"
                  @click="dispenseMedicineAction(true)"
                >
                  <span v-if="dispensing" class="spinner-sm"></span>
                  {{ dispensing ? 'Dispensing...' : 'Dispense Anyway' }}
                </button>
                <button v-else type="submit" class="btn btn-primary" :disabled="dispensing || !dispenseQuantityValid">
                  <span v-if="dispensing" class="spinner-sm"></span>
                  {{ dispensing ? 'Dispensing...' : 'Dispense' }}
                </button>
              </div>
            </form>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted } from 'vue'
import axios from 'axios'
import { useToast } from '../../store/toast'
import { useAuthStore } from '../../store/auth'
import { formatDate, formatCurrency, debounce, hasAllergy } from '../../utils/helpers'

export default {
  name: 'Pharmacy',
  setup() {
    const toast = useToast()
    const authStore = useAuthStore()
    const view = ref('medicines')
    const medicines = ref([])
    const total = ref(0)
    const page = ref(1)
    const limit = ref(20)
    const search = ref('')
    const categoryFilter = ref('')
    const lowStockOnly = ref(false)
    const showAddModal = ref(false)
    const lowStock = ref([])
    const expired = ref([])
    const loadingMedicines = ref(false)
    const loadingAlerts = ref(false)
    const savingMedicine = ref(false)
    const medForm = ref({ name: '', generic_name: '', category: 'Analgesic', manufacturer: '', unit_price: 0, cost_price: 0, stock_quantity: 0, unit: 'tablet', min_stock_level: 10, expiry_date: '' })

    const showDispenseModal = ref(false)
    const dispensing = ref(false)
    const loadingPrescriptions = ref(false)
    const prescriptionSearch = ref('')
    const prescriptionItems = ref([])
    const filteredPrescriptionItems = ref([])
    const selectedPrescriptionItem = ref(null)
    const dispenseForm = ref({ prescription_item_id: null, quantity: 1, request_id: '' })
    const safetyWarnings = ref([])
    const dispenseQuantityValid = computed(() => {
      const quantity = Number(dispenseForm.value.quantity)
      const remaining = Number(selectedPrescriptionItem.value?.quantity_remaining ?? selectedPrescriptionItem.value?.quantity_prescribed)
      return Boolean(selectedPrescriptionItem.value) && Number.isInteger(quantity) && quantity > 0 && quantity <= remaining
    })

    const newRequestId = () => {
      if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
      return `dispense-${Date.now()}-${Math.random().toString(36).slice(2)}`
    }

    const loadingInteractions = ref(false)
    const interactionSummary = ref({ summary: { mild: 0, moderate: 0, severe: 0, contraindicated: 0 }, total: 0 })
    const selectedIds = ref([])
    const checkingInteractions = ref(false)
    const interactionResults = ref([])
    const checkedIds = ref([])
    const severityKeys = ['contraindicated', 'severe', 'moderate', 'mild']
    const severityLabel = (s) => s.charAt(0).toUpperCase() + s.slice(1)
    const sevBadge = (s) => s === 'contraindicated' || s === 'severe' ? 'danger' : s === 'moderate' ? 'warning' : 'info'

    const groupedResults = computed(() =>
      severityKeys
        .map(severity => ({ severity, items: interactionResults.value.filter(r => r.severity === severity) }))
        .filter(g => g.items.length)
    )

    const loadInteractionView = async () => {
      loadingInteractions.value = true
      clearInteractionResults()
      try {
        const [medsRes, summaryRes] = await Promise.all([
          axios.get('/api/pharmacy/medicines', { params: { limit: 100 } }),
          axios.get('/api/pharmacy/interactions/summary')
        ])
        medicines.value = medsRes.data.medicines || []
        interactionSummary.value = summaryRes.data
      } catch (e) {
        toast.error('Failed to load interaction data')
      } finally {
        loadingInteractions.value = false
      }
    }

    let interactionRequestId = 0
    const clearInteractionResults = () => {
      interactionRequestId += 1
      checkingInteractions.value = false
      interactionResults.value = []
      checkedIds.value = []
    }

    const checkInteractions = async () => {
      const ids = [...selectedIds.value]
      if (ids.length < 2) return
      const requestId = ++interactionRequestId
      checkingInteractions.value = true
      interactionResults.value = []
      try {
        const { data } = await axios.post('/api/pharmacy/interactions/check', { medicineIds: ids })
        if (requestId !== interactionRequestId) return
        interactionResults.value = data.interactions
        checkedIds.value = data.checkedIds
      } catch (e) {
        if (requestId === interactionRequestId) toast.error(e.response?.data?.message || 'Error checking interactions')
      } finally {
        if (requestId === interactionRequestId) checkingInteractions.value = false
      }
    }

    const noAllergy = text => !hasAllergy(text)

    let medicinesRequestId = 0
    const loadMedicines = async () => {
      const requestId = ++medicinesRequestId
      loadingMedicines.value = true
      try {
        const params = { page: page.value, limit: limit.value }
        if (search.value) params.search = search.value
        if (categoryFilter.value) params.category = categoryFilter.value
        if (lowStockOnly.value) params.low_stock = 'true'
        const { data } = await axios.get('/api/pharmacy/medicines', { params })
        if (requestId !== medicinesRequestId) return
        medicines.value = data.medicines
        total.value = data.total
      } catch (e) {
        toast.error('Failed to load medicines')
      } finally {
        if (requestId === medicinesRequestId) loadingMedicines.value = false
      }
    }

    const debouncedSearch = debounce(() => {
      page.value = 1
      loadMedicines()
    })

    const openAddModal = () => {
      medForm.value = {
        name: '', generic_name: '', category: 'Analgesic', manufacturer: '',
        unit_price: 0, cost_price: 0, stock_quantity: 0, unit: 'tablet',
        min_stock_level: 10, expiry_date: ''
      }
      showAddModal.value = true
    }

    const closeAddModal = () => { showAddModal.value = false }

    const loadAlerts = async () => {
      loadingAlerts.value = true
      try {
        const { data } = await axios.get('/api/pharmacy/alerts')
        lowStock.value = data.low_stock
        expired.value = data.expired
      } catch (e) {
        toast.error('Failed to load stock alerts')
      } finally {
        loadingAlerts.value = false
      }
    }

    const addMedicine = async () => {
      savingMedicine.value = true
      try {
        await axios.post('/api/pharmacy/medicines', medForm.value)
        closeAddModal()
        toast.success('Medicine added successfully')
        loadMedicines()
      } catch (e) {
        toast.error(e.response?.data?.message || 'Error adding medicine')
      } finally {
        savingMedicine.value = false
      }
    }

    const openDispenseModal = async () => {
      showDispenseModal.value = true
      prescriptionSearch.value = ''
      filteredPrescriptionItems.value = []
      selectedPrescriptionItem.value = null
      dispenseForm.value = { prescription_item_id: null, quantity: 1, request_id: newRequestId() }
      safetyWarnings.value = []
      loadingPrescriptions.value = true
      try {
        const { data } = await axios.get('/api/prescriptions/pending-items')
        prescriptionItems.value = data.items || data
      } catch (e) {
        toast.error('Failed to load pending prescriptions')
        prescriptionItems.value = []
      } finally {
        loadingPrescriptions.value = false
      }
    }

    const filterPrescriptionItems = () => {
      const q = prescriptionSearch.value.toLowerCase()
      if (q.length < 2) { filteredPrescriptionItems.value = []; return }
      filteredPrescriptionItems.value = prescriptionItems.value.filter(item =>
        (item.medicine_name || '').toLowerCase().includes(q) ||
        (item.patient_name || '').toLowerCase().includes(q) ||
        (item.patient_mrn || '').toLowerCase().includes(q) ||
        String(item.prescription_id).includes(q)
      )
    }

    const selectPrescriptionItem = (item) => {
      selectedPrescriptionItem.value = item
      const remaining = Number(item.quantity_remaining ?? item.quantity_prescribed)
      dispenseForm.value = { prescription_item_id: item.id, quantity: remaining, request_id: newRequestId() }
      safetyWarnings.value = []
    }

    const closeDispenseModal = () => {
      showDispenseModal.value = false
      selectedPrescriptionItem.value = null
      prescriptionItems.value = []
      filteredPrescriptionItems.value = []
    }

    const onDispenseQuantityChange = () => {
      // A new quantity is a new operation and must not reuse an idempotency
      // key belonging to a previous request.
      dispenseForm.value.request_id = newRequestId()
      safetyWarnings.value = []
    }

    const dispenseMedicineAction = async (acknowledge = false) => {
      const item = selectedPrescriptionItem.value
      const quantity = Number(dispenseForm.value.quantity)
      const remaining = Number(item?.quantity_remaining ?? item?.quantity_prescribed)
      if (!dispenseForm.value.prescription_item_id || !item) {
        toast.error('Please select a prescription item.')
        return
      }
      if (!Number.isInteger(quantity) || quantity <= 0) {
        toast.error('Quantity must be a positive whole number.')
        return
      }
      if (!Number.isFinite(remaining) || quantity > remaining) {
        toast.error(`Only ${Number.isFinite(remaining) ? remaining : 0} unit(s) remain to be dispensed.`)
        return
      }
      if (!dispenseForm.value.request_id) dispenseForm.value.request_id = newRequestId()
      dispensing.value = true
      if (!acknowledge) safetyWarnings.value = []
      try {
        const { data } = await axios.post('/api/pharmacy/dispense', {
          prescription_item_id: dispenseForm.value.prescription_item_id,
          quantity,
          request_id: dispenseForm.value.request_id,
          acknowledge_warnings: acknowledge
        })
        if (data.warnings && data.warnings.length) {
          toast.warning(`Dispensed with ${data.warnings.length} safety warning(s).`)
        } else {
          toast.success('Medicine dispensed successfully')
        }
        closeDispenseModal()
        loadMedicines()
      } catch (e) {
        const res = e.response?.data
        if (e.response?.status === 409 && res?.warnings) {
          safetyWarnings.value = res.warnings
          toast.warning(res.message || 'Safety warning detected')
        } else {
          toast.error(res?.message || 'Error dispensing medicine')
        }
      } finally {
        dispensing.value = false
      }
    }

    onMounted(loadMedicines)
    return {
      view, medicines, total, page, limit, search, categoryFilter, lowStockOnly, showAddModal, lowStock, expired, medForm,
      loadingMedicines, loadingAlerts, savingMedicine, authStore,
      loadMedicines, debouncedSearch, loadAlerts, openAddModal, closeAddModal, addMedicine, formatDate, formatCurrency,
      showDispenseModal, dispensing, loadingPrescriptions, prescriptionSearch,
      filteredPrescriptionItems, selectedPrescriptionItem, dispenseForm,
      safetyWarnings, noAllergy, dispenseQuantityValid,
      openDispenseModal, closeDispenseModal, filterPrescriptionItems, selectPrescriptionItem,
      onDispenseQuantityChange, dispenseMedicineAction,
      loadingInteractions, interactionSummary, selectedIds, checkingInteractions, interactionResults,
      checkedIds, severityKeys, groupedResults, severityLabel, sevBadge,
      loadInteractionView, checkInteractions, clearInteractionResults
    }
  }
}
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.header-actions { display: flex; gap: 8px; }
.tabs-inline { display: flex; gap: 0; }
.tabs-inline button { padding: 10px 20px; border: 1px solid var(--gray-200); background: var(--white); cursor: pointer; font-size: 14px; }
.tabs-inline button:first-child { border-radius: 8px 0 0 8px; }
.tabs-inline button:last-child { border-radius: 0 8px 8px 0; }
.tabs-inline button.active { background: #0d9488; color: white; border-color: var(--focus-ring); }
.search-filters { display: flex; gap: 12px; margin-bottom: 16px; align-items: center; }
.search-filters input { padding: 10px 16px; border: 1px solid var(--gray-200); border-radius: 8px; width: 250px; font-size: 14px; }
.search-filters select { padding: 10px 12px; border: 1px solid var(--gray-200); border-radius: 8px; font-size: 14px; }
.checkbox-label { font-size: 14px; display: flex; align-items: center; gap: 6px; cursor: pointer; }
.alerts-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.alert-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--gray-100); }
.alert-info { display: flex; flex-direction: column; gap: 2px; font-size: 14px; }
.text-danger { color: var(--danger-fg); }
.modal-close { background: none; border: none; font-size: 24px; cursor: pointer; color: var(--text-muted); }

.loading-container { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 40px 20px; }
.spinner { width: 36px; height: 36px; border: 3px solid var(--gray-200); border-top-color: var(--primary); border-radius: 50%; animation: spin 0.8s linear infinite; }
.spinner-sm { display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: spin 0.8s linear infinite; margin-right: 6px; vertical-align: middle; }
@keyframes spin { to { transform: rotate(360deg); } }
.loading-text { font-size: 14px; color: var(--text-subtle); }

.empty-state { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 40px 20px; text-align: center; }
.empty-icon { font-size: 48px; line-height: 1; }
.empty-state p { font-size: 15px; color: var(--gray-600); margin: 0; }
.empty-hint { font-size: 13px; color: var(--text-subtle); }

.prescription-list { max-height: 280px; overflow-y: auto; margin: 12px 0; border: 1px solid var(--gray-200); border-radius: 8px; }
.prescription-item { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; cursor: pointer; border-bottom: 1px solid var(--gray-100); transition: background 0.15s; }
.prescription-item:last-child { border-bottom: none; }
.prescription-item:hover { background: var(--brand-50); }
.prescription-item.selected { background: var(--brand-100); border-color: var(--brand-200); }
.rx-info { display: flex; flex-direction: column; gap: 2px; }
.rx-meta { font-size: 12px; color: var(--text-muted); }
.rx-qty { font-size: 13px; color: var(--gray-600); white-space: nowrap; margin-left: 12px; }
.selected-rx-banner { background: var(--brand-50); padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; border: 1px solid #99f6e4; font-size: 14px; }
.field-hint { display: block; margin-top: 4px; font-size: 12px; color: var(--text-muted); }

.interaction-summary { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.summary-chip { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 20px; font-size: 12px; font-weight: 500; }
.chip-contraindicated { background: #7f1d1d; color: #fff; }
.chip-severe { background: var(--danger-bg); color: var(--danger-fg); }
.chip-moderate { background: var(--warning-bg); color: var(--warning-fg); }
.chip-mild { background: var(--info-bg); color: var(--info-fg); }
.summary-total { font-size: 13px; color: var(--text-muted); margin-left: auto; }
.interaction-hint { font-size: 13px; color: var(--text-muted); margin: 0 0 12px; }
.interaction-picker { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; max-height: 260px; overflow-y: auto; border: 1px solid var(--gray-200); border-radius: 8px; padding: 12px; }
.picker-item { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--gray-700); cursor: pointer; padding: 6px 8px; border-radius: 6px; }
.picker-item:hover { background: var(--gray-50); }
.picker-generic { font-size: 11px; color: var(--text-subtle); }
.interaction-results { margin-top: 16px; display: flex; flex-direction: column; gap: 14px; }
.result-group h4 { margin: 0 0 8px; font-size: 13px; font-weight: 600; }
.sev-contraindicated { color: var(--danger-fg); }
.sev-severe { color: var(--danger-fg); }
.sev-moderate { color: var(--warning-fg); }
.sev-mild { color: var(--info-fg); }
.interaction-item { border: 1px solid var(--gray-200); border-left: 4px solid var(--gray-400); border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; background: var(--white); }
.interaction-pair { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 14px; color: var(--gray-800); }
.pair-sep { color: var(--text-subtle); }
.interaction-desc { font-size: 13px; color: var(--gray-600); margin-top: 6px; }
.interaction-mgmt { font-size: 12px; color: var(--text-muted); margin-top: 6px; }
.interaction-clear { padding: 24px; }
.badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: capitalize; }
.badge-danger { background: var(--danger-bg); color: var(--danger-fg); }
.badge-warning { background: var(--warning-bg); color: var(--warning-fg); }
.badge-info { background: var(--info-bg); color: var(--info-fg); }

@media (max-width: 768px) {
  .alerts-grid { grid-template-columns: 1fr; }
  .interaction-picker { grid-template-columns: 1fr; }
  .page-header {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }
  .header-actions {
    width: 100%;
  }
  .header-actions .btn {
    flex: 1;
  }
  .tabs-inline {
    width: 100%;
  }
  .tabs-inline button {
    flex: 1;
    padding: 10px 12px;
    justify-content: center;
  }
  .search-filters {
    flex-direction: column;
    align-items: stretch;
  }
  .search-filters input,
  .search-filters select {
    width: 100%;
  }
  .interaction-summary {
    flex-direction: column;
    align-items: flex-start;
  }
  .summary-total {
    margin-left: 0;
  }
  .prescription-item {
    flex-wrap: wrap;
    gap: 6px;
  }
}

@media (max-width: 576px) {
  .tabs-inline {
    overflow-x: auto;
    white-space: nowrap;
  }
  .tabs-inline button {
    flex: none;
    min-width: max-content;
  }
}
</style>
