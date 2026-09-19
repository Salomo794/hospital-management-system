<template>
  <div class="billing-page">
    <div class="page-header">
      <div class="search-filters">
        <select v-model="statusFilter" @change="loadBills">
          <option value="">All Status</option>
          <option value="pending">Pending</option>
          <option value="partial">Partial</option>
          <option value="paid">Paid</option>
        </select>
        <input type="date" v-model="fromDate" @change="loadBills" />
        <input type="date" v-model="toDate" @change="loadBills" />
      </div>
      <button class="btn btn-primary" @click="openNewBillModal">+ New Bill</button>
    </div>

    <div class="billing-stats">
      <div class="stat-card stat-pending">
        <div class="stat-value">{{ formatCurrency(totalPending) }}</div>
        <div class="stat-label">Total Pending</div>
      </div>
      <div class="stat-card stat-collected">
        <div class="stat-value">{{ formatCurrency(totalCollectedToday) }}</div>
        <div class="stat-label">Collected Today</div>
      </div>
      <div class="stat-card stat-unpaid">
        <div class="stat-value">{{ unpaidCount }}</div>
        <div class="stat-label">Unpaid Bills</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h3>Bills ({{ bills.length }})</h3>
      </div>

      <div v-if="loading" class="loading-state">
        <div class="spinner"></div>
        <span>Loading bills...</span>
      </div>

      <template v-else>
        <table class="data-table" v-if="bills.length > 0">
          <thead>
            <tr>
              <th>Bill #</th>
              <th>Date</th>
              <th>Patient</th>
              <th>Total</th>
              <th>Paid</th>
              <th>Balance</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="b in bills" :key="b.id">
              <td class="text-mono">{{ b.bill_number }}</td>
              <td>{{ formatDate(b.created_at) }}</td>
              <td>{{ b.patient_first_name }} {{ b.patient_last_name }}</td>
              <td>{{ formatCurrency(b.net_amount) }}</td>
              <td>{{ formatCurrency(b.paid_amount) }}</td>
              <td class="text-danger">{{ formatCurrency(parseFloat(b.net_amount) - parseFloat(b.paid_amount)) }}</td>
              <td>
                <span class="badge" :class="'badge-' + getStatusColor(b.payment_status)">
                  {{ b.payment_status }}
                </span>
              </td>
              <td>
                <router-link :to="`/billing/${b.id}`" class="btn btn-sm btn-outline">View</router-link>
              </td>
            </tr>
          </tbody>
        </table>

        <div v-else class="empty-state">
          <div class="empty-icon">🧾</div>
          <h4>No bills found</h4>
          <p>No bills match your current filters. Try adjusting the filters or create a new bill.</p>
        </div>
      </template>
    </div>

    <div class="modal-overlay" v-if="showBillModal" @click.self="closeModal">
      <div class="modal">
        <div class="modal-header">
          <h3>New Bill</h3>
          <button class="modal-close" @click="closeModal">&times;</button>
        </div>

        <div class="modal-body">
          <div class="form-group">
            <label>Patient</label>
            <div class="patient-search">
              <input
                v-model="billForm.patientSearch"
                @input="searchPatients"
                type="text"
                placeholder="Search patient by name..."
              />
              <div class="search-results" v-if="patientResults.length > 0 && billForm.patientSearch">
                <div
                  class="search-result-item"
                  v-for="p in patientResults"
                  :key="p.id"
                  @click="selectPatient(p)"
                >
                  {{ p.first_name }} {{ p.last_name }} — {{ p.phone || '' }}
                </div>
              </div>
              <div class="selected-patient" v-if="billForm.patient_id">
                <span>Selected: {{ billForm.patientFirst }} {{ billForm.patientLast }}</span>
                <button class="btn-clear" @click="clearPatient">&times;</button>
              </div>
            </div>
          </div>

          <div class="form-group">
            <label>Bill Items</label>
            <div class="bill-items">
              <div class="bill-item" v-for="(item, index) in billForm.items" :key="index">
                <input v-model="item.description" type="text" placeholder="Description" class="input-desc" />
                <select v-model="item.category">
                  <option value="consultation">Consultation</option>
                  <option value="medicine">Medicine</option>
                  <option value="lab_test">Lab Test</option>
                  <option value="procedure">Procedure</option>
                  <option value="room">Room</option>
                  <option value="other">Other</option>
                </select>
                <input v-model.number="item.quantity" type="number" min="1" placeholder="Qty" class="input-num" />
                <input v-model.number="item.unit_price" type="number" min="0" step="0.01" placeholder="Unit Price" class="input-price" />
                <button class="btn-remove" @click="removeItem(index)" :disabled="billForm.items.length <= 1">&times;</button>
              </div>
            </div>
            <button class="btn btn-sm btn-outline btn-add-item" @click="addItem">+ Add Item</button>
          </div>

          <div class="totals-row">
            <div class="form-group">
              <label>Discount</label>
              <input v-model.number="billForm.discount" type="number" min="0" step="0.01" placeholder="0.00" />
            </div>
            <div class="totals-display">
              <div class="total-line">
                <span>Subtotal:</span>
                <span>{{ formatCurrency(subtotal) }}</span>
              </div>
              <div class="total-line">
                <span>Discount:</span>
                <span class="text-danger">-{{ formatCurrency(billForm.discount || 0) }}</span>
              </div>
              <div class="total-line">
                <span>Tax (10%):</span>
                <span>{{ formatCurrency(taxAmount) }}</span>
              </div>
              <div class="total-line total-net">
                <span>Net Amount:</span>
                <span>{{ formatCurrency(netAmount) }}</span>
              </div>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>Payment Method</label>
              <select v-model="billForm.payment_method">
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="insurance">Insurance</option>
                <option value="online">Online</option>
                <option value="bank_transfer">Bank Transfer</option>
              </select>
            </div>
            <div class="form-group">
              <label>Due Date</label>
              <input v-model="billForm.due_date" type="date" />
            </div>
          </div>

          <div class="form-group">
            <label>Notes</label>
            <textarea v-model="billForm.notes" rows="3" placeholder="Additional notes..."></textarea>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-outline" @click="closeModal">Cancel</button>
          <button class="btn btn-primary" @click="submitBill" :disabled="submitting || !billForm.patient_id">
            {{ submitting ? 'Creating...' : 'Create Bill' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, reactive, computed, onMounted } from 'vue'
import axios from 'axios'
import { formatDate, formatCurrency, getStatusColor } from '../../utils/helpers'
import { useToast } from '../../store/toast'

export default {
  name: 'Billing',
  setup() {
    const toast = useToast()

    const bills = ref([])
    const loading = ref(false)
    const statusFilter = ref('')
    const fromDate = ref('')
    const toDate = ref('')

    const showBillModal = ref(false)
    const submitting = ref(false)
    const patientResults = ref([])

    const billForm = reactive({
      patient_id: null,
      patientFirst: '',
      patientLast: '',
      patientSearch: '',
      items: [{ description: '', category: 'consultation', quantity: 1, unit_price: 0 }],
      discount: 0,
      payment_method: 'cash',
      due_date: '',
      notes: ''
    })

    const subtotal = computed(() =>
      billForm.items.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0)
    )
    const taxAmount = computed(() => Math.max(0, (subtotal.value - (billForm.discount || 0)) * 0.10))
    const netAmount = computed(() => Math.max(0, subtotal.value - (billForm.discount || 0) + taxAmount.value))

    const totalPending = computed(() =>
      bills.value
        .filter(b => b.payment_status !== 'paid')
        .reduce((s, b) => s + (parseFloat(b.net_amount) - parseFloat(b.paid_amount)), 0)
    )
    const totalCollectedToday = computed(() => {
      const today = new Date().toISOString().slice(0, 10)
      return bills.value
        .filter(b => b.created_at && b.created_at.slice(0, 10) === today && b.payment_status === 'paid')
        .reduce((s, b) => s + parseFloat(b.paid_amount), 0)
    })
    const unpaidCount = computed(() => bills.value.filter(b => b.payment_status !== 'paid').length)

    let searchTimeout = null
    const searchPatients = () => {
      clearTimeout(searchTimeout)
      if (!billForm.patientSearch || billForm.patientSearch.length < 2) {
        patientResults.value = []
        return
      }
      searchTimeout = setTimeout(async () => {
        try {
          const { data } = await axios.get('/api/patients', { params: { search: billForm.patientSearch } })
          patientResults.value = data.patients || data || []
        } catch {
          patientResults.value = []
        }
      }, 300)
    }

    const selectPatient = (p) => {
      billForm.patient_id = p.id
      billForm.patientFirst = p.first_name
      billForm.patientLast = p.last_name
      billForm.patientSearch = `${p.first_name} ${p.last_name}`
      patientResults.value = []
    }

    const clearPatient = () => {
      billForm.patient_id = null
      billForm.patientFirst = ''
      billForm.patientLast = ''
      billForm.patientSearch = ''
      patientResults.value = []
    }

    const addItem = () => {
      billForm.items.push({ description: '', category: 'consultation', quantity: 1, unit_price: 0 })
    }

    const removeItem = (index) => {
      if (billForm.items.length > 1) {
        billForm.items.splice(index, 1)
      }
    }

    const openNewBillModal = () => {
      billForm.patient_id = null
      billForm.patientFirst = ''
      billForm.patientLast = ''
      billForm.patientSearch = ''
      billForm.items = [{ description: '', category: 'consultation', quantity: 1, unit_price: 0 }]
      billForm.discount = 0
      billForm.payment_method = 'cash'
      billForm.due_date = ''
      billForm.notes = ''
      patientResults.value = []
      showBillModal.value = true
    }

    const closeModal = () => {
      showBillModal.value = false
    }

    const submitBill = async () => {
      if (!billForm.patient_id) {
        toast.error('Please select a patient')
        return
      }
      submitting.value = true
      try {
        await axios.post('/api/billing', {
          patient_id: billForm.patient_id,
          items: billForm.items.map(i => ({
            description: i.description,
            category: i.category,
            quantity: i.quantity,
            unit_price: i.unit_price
          })),
          discount: billForm.discount || 0,
          tax: taxAmount.value,
          payment_method: billForm.payment_method,
          due_date: billForm.due_date || null,
          notes: billForm.notes
        })
        toast.success('Bill created successfully')
        closeModal()
        loadBills()
      } catch (err) {
        toast.error(err.response?.data?.message || 'Failed to create bill')
      } finally {
        submitting.value = false
      }
    }

    const loadBills = async () => {
      loading.value = true
      try {
        const params = {}
        if (statusFilter.value) params.status = statusFilter.value
        if (fromDate.value) params.from_date = fromDate.value
        if (toDate.value) params.to_date = toDate.value
        const { data } = await axios.get('/api/billing', { params })
        bills.value = data.bills
      } catch {
        toast.error('Failed to load bills')
      } finally {
        loading.value = false
      }
    }

    onMounted(loadBills)

    return {
      bills,
      loading,
      statusFilter,
      fromDate,
      toDate,
      totalPending,
      totalCollectedToday,
      unpaidCount,
      showBillModal,
      submitting,
      billForm,
      patientResults,
      subtotal,
      taxAmount,
      netAmount,
      searchPatients,
      selectPatient,
      clearPatient,
      addItem,
      removeItem,
      openNewBillModal,
      closeModal,
      submitBill,
      loadBills,
      formatDate,
      formatCurrency,
      getStatusColor
    }
  }
}
</script>

<style scoped>
.billing-page {
  padding: 24px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 20px;
  align-items: center;
  gap: 16px;
}

.search-filters {
  display: flex;
  gap: 12px;
}

.search-filters select,
.search-filters input {
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 14px;
}

.billing-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-bottom: 20px;
}

.stat-card {
  background: white;
  padding: 20px;
  border-radius: 12px;
  text-align: center;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.stat-pending .stat-value { color: #ef4444; }
.stat-collected .stat-value { color: #10b981; }
.stat-unpaid .stat-value { color: #f59e0b; }

.stat-value {
  font-size: 24px;
  font-weight: 700;
}

.stat-label {
  font-size: 13px;
  color: #64748b;
  margin-top: 4px;
}

.text-danger { color: #ef4444; }
.text-success { color: #10b981; }
.text-mono { font-family: monospace; font-size: 13px; }
.text-muted { color: #94a3b8; text-align: center; padding: 20px; }

.card {
  background: white;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  overflow: hidden;
}

.card-header {
  padding: 16px 20px;
  border-bottom: 1px solid #e2e8f0;
}

.card-header h3 {
  margin: 0;
  font-size: 16px;
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 48px;
  color: #64748b;
}

.spinner {
  width: 24px;
  height: 24px;
  border: 3px solid #e2e8f0;
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.data-table {
  width: 100%;
  border-collapse: collapse;
}

.data-table th,
.data-table td {
  padding: 12px 16px;
  text-align: left;
  border-bottom: 1px solid #f1f5f9;
  font-size: 14px;
}

.data-table th {
  background: #f8fafc;
  font-weight: 600;
  color: #475569;
}

.badge {
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  text-transform: capitalize;
}

.badge-success { background: #d1fae5; color: #065f46; }
.badge-warning { background: #fef3c7; color: #92400e; }
.badge-danger { background: #fee2e2; color: #991b1b; }
.badge-info { background: #dbeafe; color: #1e40af; }
.badge-gray { background: #f1f5f9; color: #475569; }

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.15s;
}

.btn-primary {
  background: #3b82f6;
  color: white;
}

.btn-primary:hover { background: #2563eb; }
.btn-primary:disabled { background: #93c5fd; cursor: not-allowed; }

.btn-outline {
  background: transparent;
  border: 1px solid #e2e8f0;
  color: #475569;
}

.btn-outline:hover { background: #f8fafc; }

.btn-sm { padding: 6px 12px; font-size: 13px; }

.empty-state {
  text-align: center;
  padding: 48px 24px;
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
  margin: 0;
  font-size: 14px;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: white;
  border-radius: 16px;
  width: 100%;
  max-width: 720px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid #e2e8f0;
}

.modal-header h3 { margin: 0; }

.modal-close {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: #64748b;
  padding: 0 4px;
}

.modal-close:hover { color: #1e293b; }

.modal-body {
  padding: 24px;
  overflow-y: auto;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid #e2e8f0;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: #475569;
  margin-bottom: 6px;
}

.form-group input,
.form-group select,
.form-group textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 14px;
  box-sizing: border-box;
}

.form-group textarea {
  resize: vertical;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.patient-search {
  position: relative;
}

.search-results {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  max-height: 200px;
  overflow-y: auto;
  z-index: 10;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.search-result-item {
  padding: 10px 12px;
  cursor: pointer;
  font-size: 14px;
}

.search-result-item:hover {
  background: #f1f5f9;
}

.selected-patient {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  padding: 8px 12px;
  margin-top: 8px;
  font-size: 14px;
}

.btn-clear {
  background: none;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: #64748b;
}

.bill-items {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.bill-item {
  display: flex;
  gap: 8px;
  align-items: center;
}

.bill-item input,
.bill-item select {
  padding: 8px 10px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 13px;
}

.input-desc { flex: 3; }
.bill-item select { flex: 1.5; }
.input-num { flex: 0.7; min-width: 60px; }
.input-price { flex: 1.2; }

.btn-remove {
  background: #fee2e2;
  border: none;
  color: #991b1b;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 18px;
  flex-shrink: 0;
}

.btn-remove:hover { background: #fecaca; }
.btn-remove:disabled { opacity: 0.4; cursor: not-allowed; }

.btn-add-item {
  margin-top: 8px;
}

.totals-row {
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: 24px;
  align-items: start;
  margin-bottom: 16px;
}

.totals-display {
  background: #f8fafc;
  border-radius: 8px;
  padding: 16px;
}

.total-line {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  font-size: 14px;
}

.total-net {
  border-top: 1px solid #e2e8f0;
  margin-top: 8px;
  padding-top: 8px;
  font-weight: 700;
  font-size: 16px;
}

/* Responsive */
@media (max-width: 900px) {
  .billing-stats {
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  }
}

@media (max-width: 768px) {
  .billing-page {
    padding: 12px;
  }
  .page-header {
    flex-direction: column;
    align-items: stretch;
  }
  .page-header .btn {
    width: 100%;
  }
  .search-filters {
    flex-direction: column;
  }
  .search-filters select,
  .search-filters input {
    width: 100%;
  }
  .billing-stats {
    grid-template-columns: 1fr;
  }
  .form-row {
    grid-template-columns: 1fr;
  }
  .bill-item {
    flex-wrap: wrap;
  }
  .totals-row {
    grid-template-columns: 1fr;
  }
  .modal-footer {
    flex-direction: column;
  }
  .modal-footer .btn {
    width: 100%;
  }
}
</style>
