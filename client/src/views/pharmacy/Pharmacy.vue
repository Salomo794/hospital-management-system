<template>
  <div class="pharmacy-page">
    <div class="page-header">
      <div class="tabs-inline">
        <button :class="{ active: view === 'medicines' }" @click="view = 'medicines'; loadMedicines()">Medicines</button>
        <button :class="{ active: view === 'alerts' }" @click="view = 'alerts'; loadAlerts()">Stock Alerts</button>
        <button :class="{ active: view === 'reorder' }" @click="view = 'reorder'; loadReorder()">Smart Reorder</button>
      </div>
      <div class="header-actions">
        <button class="btn btn-outline" @click="openDispenseModal" v-if="view === 'medicines'">Dispense</button>
        <button class="btn btn-primary" @click="showAddModal = true" v-if="view === 'medicines'">+ Add Medicine</button>
      </div>
    </div>

    <div v-if="view === 'medicines'">
      <div class="search-filters">
        <input type="text" v-model="search" placeholder="Search medicines..." @input="debouncedLoadMedicines" />
        <select v-model="categoryFilter" @change="loadMedicines">
          <option value="">All Categories</option>
          <option>Analgesic</option><option>Antibiotic</option><option>Antihistamine</option>
          <option>Cardiovascular</option><option>Diabetes</option><option>Gastrointestinal</option>
          <option>Respiratory</option><option>Vitamins</option><option>Other</option>
        </select>
        <label class="checkbox-label"><input type="checkbox" v-model="lowStockOnly" @change="loadMedicines" /> Low Stock Only</label>
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

    <div v-if="view === 'reorder'">
      <div v-if="loadingReorder" class="loading-container">
        <div class="spinner"></div>
        <span class="loading-text">Analyzing stock levels...</span>
      </div>
      <template v-else>
        <div class="reorder-summary-bar" v-if="reorderData.summary">
          <div class="summary-stat urgent">
            <strong>{{ (reorderData.summary.critical || 0) + (reorderData.summary.urgent || 0) }}</strong>
            <span>Need Attention</span>
          </div>
          <div class="summary-stat warning">
            <strong>{{ reorderData.summary.warning || 0 }}</strong>
            <span>Run Low Soon</span>
          </div>
          <div class="summary-stat">
            <strong>{{ reorderData.suggestions?.length || 0 }}</strong>
            <span>Total Tracked</span>
          </div>
        </div>

        <div class="card" style="margin-top: 16px;">
          <div class="card-header">
            <h3>Reorder Recommendations</h3>
            <span class="text-muted">Based on 30-day consumption data</span>
          </div>
          <div v-if="reorderData.suggestions && reorderData.suggestions.length">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Medicine</th>
                  <th>Current Stock</th>
                  <th>Daily Usage</th>
                  <th>Days Left</th>
                  <th>Suggested Order</th>
                  <th>Urgency</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="s in reorderData.suggestions" :key="s.medicine_id">
                  <td><strong>{{ s.name }}</strong><br><span class="text-muted">{{ s.category || '' }}</span></td>
                  <td>{{ s.stock_quantity }} {{ s.unit }}</td>
                  <td>~{{ s.daily_consumption }} /day</td>
                  <td>
                    <span :class="daysLeftClass(s.days_left)">{{ s.days_left == null ? '∞' : s.days_left + 'd' }}</span>
                  </td>
                  <td>{{ s.suggested_order_quantity || '—' }} {{ s.unit }}</td>
                  <td><span class="badge" :class="'badge-' + urgencyBadge(s.urgency)">{{ s.urgency }}</span></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="empty-state">
            <p>No reorder data available yet — dispense some medicines first.</p>
          </div>
        </div>
      </template>
    </div>

    <!-- Add Medicine Modal -->
    <div class="modal-overlay" v-if="showAddModal" @click.self="showAddModal = false">
      <div class="modal">
        <div class="modal-header"><h3>Add New Medicine</h3><button class="modal-close" @click="showAddModal = false">&times;</button></div>
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
              <button type="button" class="btn btn-secondary" @click="showAddModal = false">Cancel</button>
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
                <div class="rx-qty">Qty: {{ item.quantity_prescribed }}</div>
              </div>
            </div>
            <div v-else-if="prescriptionSearch.length >= 2" class="empty-state">
              <p>No pending prescription items match your search.</p>
            </div>

            <div v-if="dispenseForm.prescription_item_id" class="selected-rx-banner">
              <span>Selected: <strong>{{ selectedPrescriptionItem?.medicine_name }}</strong> for {{ selectedPrescriptionItem?.patient_name }}</span>
            </div>

            <form @submit.prevent="dispenseMedicineAction" v-if="dispenseForm.prescription_item_id">
              <div class="form-group">
                <label>Quantity to Dispense *</label>
                <input
                  type="number"
                  v-model.number="dispenseForm.quantity"
                  min="1"
                  :max="selectedPrescriptionItem?.quantity_prescribed || 9999"
                  required
                />
                <span class="field-hint" v-if="selectedPrescriptionItem">
                  Prescribed: {{ selectedPrescriptionItem.quantity_prescribed }}
                </span>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" @click="closeDispenseModal">Cancel</button>
                <button type="submit" class="btn btn-primary" :disabled="dispensing || !dispenseForm.quantity">
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
import { ref, onMounted } from 'vue'
import axios from 'axios'
import { useToast } from '../../store/toast'
import { formatDate, formatCurrency, debounce } from '../../utils/helpers'

export default {
  name: 'Pharmacy',
  setup() {
    const toast = useToast()
    const view = ref('medicines')
    const medicines = ref([])
    const search = ref('')
    const categoryFilter = ref('')
    const lowStockOnly = ref(false)
    const showAddModal = ref(false)
    const lowStock = ref([])
    const expired = ref([])
    const reorderData = ref({ suggestions: [], summary: {} })
    const loadingReorder = ref(false)
    const loadingMedicines = ref(false)
    const loadingAlerts = ref(false)
    const savingMedicine = ref(false)
    const medForm = ref({ name: '', generic_name: '', category: '', manufacturer: '', unit_price: 0, cost_price: 0, stock_quantity: 0, unit: 'tablet', min_stock_level: 10, expiry_date: '' })

    const showDispenseModal = ref(false)
    const dispensing = ref(false)
    const loadingPrescriptions = ref(false)
    const prescriptionSearch = ref('')
    const prescriptionItems = ref([])
    const filteredPrescriptionItems = ref([])
    const selectedPrescriptionItem = ref(null)
    const dispenseForm = ref({ prescription_item_id: null, quantity: 1 })

    const loadMedicines = async () => {
      loadingMedicines.value = true
      try {
        const params = {}
        if (search.value) params.search = search.value
        if (categoryFilter.value) params.category = categoryFilter.value
        if (lowStockOnly.value) params.low_stock = 'true'
        const { data } = await axios.get('/api/pharmacy/medicines', { params })
        medicines.value = data.medicines
      } catch (e) {
        toast.error('Failed to load medicines')
      } finally {
        loadingMedicines.value = false
      }
    }
    const debouncedLoadMedicines = debounce(loadMedicines, 300)

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

    const loadReorder = async () => {
      loadingReorder.value = true
      try {
        const { data } = await axios.get('/api/pharmacy/reorder-suggestions')
        const order = { critical: 0, urgent: 1, warning: 2, healthy: 3, inactive: 4 }
        const suggestions = (data.suggestions || []).slice().sort(
          (a, b) => (order[a.urgency] ?? 9) - (order[b.urgency] ?? 9)
        )
        reorderData.value = { ...data, suggestions }
      } catch (e) {
        toast.error('Failed to load reorder suggestions')
      } finally {
        loadingReorder.value = false
      }
    }

    const urgencyBadge = (u) => ({ critical: 'danger', urgent: 'danger', warning: 'warning', healthy: 'success', inactive: 'gray' }[u] || 'info')

    const daysLeftClass = (d) => {
      if (d == null) return 'days-ok'
      if (d <= 3) return 'days-critical'
      if (d <= 7) return 'days-urgent'
      if (d <= 14) return 'days-warning'
      return 'days-ok'
    }

    const addMedicine = async () => {
      savingMedicine.value = true
      try {
        await axios.post('/api/pharmacy/medicines', medForm.value)
        showAddModal.value = false
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
      dispenseForm.value = { prescription_item_id: null, quantity: 1 }
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
      dispenseForm.value = { prescription_item_id: item.id, quantity: 1 }
    }

    const closeDispenseModal = () => {
      showDispenseModal.value = false
      selectedPrescriptionItem.value = null
      prescriptionItems.value = []
      filteredPrescriptionItems.value = []
    }

    const dispenseMedicineAction = async () => {
      dispensing.value = true
      try {
        await axios.post('/api/pharmacy/dispense', {
          prescription_item_id: dispenseForm.value.prescription_item_id,
          quantity: dispenseForm.value.quantity
        })
        toast.success('Medicine dispensed successfully')
        closeDispenseModal()
        loadMedicines()
      } catch (e) {
        toast.error(e.response?.data?.message || 'Error dispensing medicine')
      } finally {
        dispensing.value = false
      }
    }

    onMounted(loadMedicines)
    return {
      view, medicines, search, categoryFilter, lowStockOnly, showAddModal, lowStock, expired, medForm,
      loadingMedicines, loadingAlerts, savingMedicine,
      reorderData, loadingReorder,
      loadMedicines, debouncedLoadMedicines, loadAlerts, addMedicine, formatDate, formatCurrency,
      loadReorder, urgencyBadge, daysLeftClass,
      showDispenseModal, dispensing, loadingPrescriptions, prescriptionSearch,
      filteredPrescriptionItems, selectedPrescriptionItem, dispenseForm,
      openDispenseModal, closeDispenseModal, filterPrescriptionItems, selectPrescriptionItem,
      dispenseMedicineAction
    }
  }
}
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.header-actions { display: flex; gap: 8px; }
.tabs-inline { display: flex; gap: 0; }
.tabs-inline button { padding: 10px 20px; border: 1px solid #e2e8f0; background: white; cursor: pointer; font-size: 14px; }
.tabs-inline button:first-child { border-radius: 8px 0 0 8px; }
.tabs-inline button:last-child { border-radius: 0 8px 8px 0; }
.tabs-inline button.active { background: #0d9488; color: white; border-color: #0d9488; }
.search-filters { display: flex; gap: 12px; margin-bottom: 16px; align-items: center; }
.search-filters input { padding: 10px 16px; border: 1px solid #e2e8f0; border-radius: 8px; width: 250px; font-size: 14px; }
.search-filters select { padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px; }
.checkbox-label { font-size: 14px; display: flex; align-items: center; gap: 6px; cursor: pointer; }
.alerts-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.alert-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #f1f5f9; }
.alert-info { display: flex; flex-direction: column; gap: 2px; font-size: 14px; }
.text-danger { color: #ef4444; }
.text-muted { color: #94a3b8; }
.reorder-summary-bar { display: flex; gap: 16px; flex-wrap: wrap; }
.summary-stat {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  background: white; border-radius: 12px; padding: 16px 28px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08); min-width: 120px;
}
.summary-stat strong { font-size: 24px; color: #1e293b; }
.summary-stat span { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.3px; }
.summary-stat.urgent strong { color: #ef4444; }
.summary-stat.warning strong { color: #d97706; }
.days-critical { color: #ef4444; font-weight: 700; }
.days-urgent { color: #d97706; font-weight: 600; }
.days-warning { color: #b45309; }
.days-ok { color: #059669; }
.modal-close { background: none; border: none; font-size: 24px; cursor: pointer; color: #64748b; }

.loading-container { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 40px 20px; }
.spinner { width: 36px; height: 36px; border: 3px solid #e2e8f0; border-top-color: #0d9488; border-radius: 50%; animation: spin 0.8s linear infinite; }
.spinner-sm { display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: spin 0.8s linear infinite; margin-right: 6px; vertical-align: middle; }
@keyframes spin { to { transform: rotate(360deg); } }
.loading-text { font-size: 14px; color: #94a3b8; }

.empty-state { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 40px 20px; text-align: center; }
.empty-icon { font-size: 48px; line-height: 1; }
.empty-state p { font-size: 15px; color: #475569; margin: 0; }
.empty-hint { font-size: 13px; color: #94a3b8; }

.prescription-list { max-height: 280px; overflow-y: auto; margin: 12px 0; border: 1px solid #e2e8f0; border-radius: 8px; }
.prescription-item { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; cursor: pointer; border-bottom: 1px solid #f1f5f9; transition: background 0.15s; }
.prescription-item:last-child { border-bottom: none; }
.prescription-item:hover { background: #f0fdfa; }
.prescription-item.selected { background: #ccfbf1; border-color: #99f6e4; }
.rx-info { display: flex; flex-direction: column; gap: 2px; }
.rx-meta { font-size: 12px; color: #64748b; }
.rx-qty { font-size: 13px; color: #475569; white-space: nowrap; margin-left: 12px; }
.selected-rx-banner { background: #f0fdfa; padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; border: 1px solid #99f6e4; font-size: 14px; }
.field-hint { display: block; margin-top: 4px; font-size: 12px; color: #64748b; }

@media (max-width: 768px) { .alerts-grid { grid-template-columns: 1fr; } }
</style>
