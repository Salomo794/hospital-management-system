<template>
  <div class="procurement-page">
    <div class="page-header">
      <div class="page-header-title">
        <h1>Procurement</h1>
        <p>Raise supplier orders, route them for approval, and receive stock into inventory.</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-secondary" @click="loadAll" :disabled="loading">Refresh</button>
        <button
          v-if="canAdmin"
          class="btn btn-secondary"
          @click="openSupplierModal()"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6"/></svg>
          New Supplier
        </button>
        <button class="btn btn-primary" @click="openOrderModal()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
          New Order
        </button>
      </div>
    </div>

    <!-- ──── Stat strip ──── -->
    <div class="stats-grid" v-if="!loading && summary">
      <StatsCard
        :icon="'📦'" icon-bg="linear-gradient(135deg, #dbeafe, #bfdbfe)"
        :value="summary.open_orders" label="Open orders"
      />
      <StatsCard
        :icon="'⏳'" icon-bg="linear-gradient(135deg, #fef3c7, #fde68a)"
        :value="summary.awaiting_approval" label="Awaiting approval"
      />
      <StatsCard
        :icon="'💰'" icon-bg="linear-gradient(135deg, #dcfce7, #bbf7d0)"
        :value="formatCurrency(summary.open_order_value)" label="Committed value"
      />
      <StatsCard
        :icon="'⚠️'" icon-bg="linear-gradient(135deg, #fee2e2, #fecaca)"
        :value="summary.low_stock_items" label="Medicines below minimum"
      />
      <StatsCard
        :icon="'🏭'" icon-bg="linear-gradient(135deg, #ccfbf1, #99f6e4)"
        :value="summary.active_suppliers" label="Active suppliers"
      />
    </div>

    <!-- ──── Tabs ──── -->
    <div class="tab-bar">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-btn"
        :class="{ 'tab-btn--active': activeTab === tab.key }"
        @click="switchTab(tab.key)"
      >
        {{ tab.label }}
        <span v-if="tab.count" class="tab-count">{{ tab.count }}</span>
      </button>
    </div>

    <div v-if="loading" class="loading-state">
      <div class="spinner"></div>
      <p>Loading procurement data...</p>
    </div>

    <!-- ──── REORDER SUGGESTIONS ──── -->
    <template v-else-if="activeTab === 'suggestions'">
      <div v-if="suggestions.length === 0" class="empty-state">
        <span class="empty-icon">✅</span>
        <p>Nothing needs reordering.</p>
        <span class="text-muted">Every active medicine is above its minimum and nothing expires within 30 days.</span>
      </div>

      <div v-else class="card">
        <div class="card-header suggestion-header">
          <div>
            <h3>Reorder suggestions</h3>
            <p class="text-muted">
              Sized from 30-day dispensing and top-up ceilings &mdash; estimated total
              <strong>{{ formatCurrency(suggestionTotal) }}</strong>.
            </p>
          </div>
          <button
            class="btn btn-sm btn-primary"
            :disabled="!selectedSuggestions.length"
            @click="orderFromSuggestions"
          >
            Create order ({{ selectedSuggestions.length }})
          </button>
        </div>
        <table class="data-table">
          <thead>
            <tr>
              <th style="width:36px"></th>
              <th>Medicine</th>
              <th>On hand</th>
              <th>Min</th>
              <th>Days left</th>
              <th>Order qty</th>
              <th>Unit cost</th>
              <th>Est. cost</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in suggestions" :key="item.medicine_id">
              <td>
                <input
                  type="checkbox"
                  :checked="isSelected(item.medicine_id)"
                  @change="toggleSuggestion(item)"
                  :aria-label="`Select ${item.name}`"
                />
              </td>
              <td>
                <strong>{{ item.name }}</strong>
                <div class="cell-sub">
                  <span v-if="item.low_stock" class="badge badge-danger">Low stock</span>
                  <span v-if="item.expiring_soon" class="badge badge-warning">Expires {{ item.expiry_date }}</span>
                </div>
              </td>
              <td>{{ item.stock }} {{ item.unit }}</td>
              <td>{{ item.min_stock_level }}</td>
              <td>{{ item.days_left === null ? '—' : item.days_left }}</td>
              <td><strong>{{ item.suggested_quantity }}</strong></td>
              <td>{{ formatCurrency(item.unit_cost) }}</td>
              <td>{{ formatCurrency(item.estimated_cost) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- ──── PURCHASE ORDERS ──── -->
    <template v-else-if="activeTab === 'orders'">
      <div class="page-header">
        <div class="header-left filter-row">
          <div class="search-bar">
            <input type="text" v-model="search" placeholder="Search order number or supplier..." @input="debouncedLoadOrders" />
          </div>
          <select v-model="statusFilter" @change="page = 1; loadOrders()">
            <option value="">All statuses</option>
            <option v-for="status in ORDER_STATUSES" :key="status" :value="status">{{ labelFor(status) }}</option>
          </select>
        </div>
      </div>

      <div v-if="orders.length === 0" class="empty-state">
        <span class="empty-icon">📋</span>
        <p>No purchase orders found.</p>
        <span class="text-muted">Adjust the filters, or raise a new order.</span>
      </div>

      <div v-else class="card">
        <table class="data-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Supplier</th>
              <th>Status</th>
              <th>Items</th>
              <th>Value</th>
              <th>Expected</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="order in orders" :key="order.id">
              <td>
                <strong>{{ order.order_number }}</strong>
                <div class="cell-sub">{{ formatDate(order.created_at) }}</div>
              </td>
              <td>{{ order.supplier_name }}</td>
              <td><span class="badge" :class="statusColor(order.status)">{{ labelFor(order.status) }}</span></td>
              <td>{{ order.item_count }} ({{ order.units_received }} received)</td>
              <td><strong>{{ formatCurrency(order.total_amount) }}</strong></td>
              <td>{{ order.expected_date || '—' }}</td>
              <td class="actions-cell">
                <button class="btn btn-sm btn-secondary" @click="openDetail(order.id)">View</button>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="pagination" v-if="total > limit">
          <button class="btn btn-sm" :disabled="page <= 1" @click="page--; loadOrders()">Previous</button>
          <span class="pagination-info">Page {{ page }} of {{ Math.ceil(total / limit) }}</span>
          <button class="btn btn-sm" :disabled="page >= Math.ceil(total / limit)" @click="page++; loadOrders()">Next</button>
        </div>
      </div>
    </template>

    <!-- ──── SUPPLIERS ──── -->
    <template v-else>
      <div class="page-header">
        <div class="header-left filter-row">
          <div class="search-bar">
            <input type="text" v-model="supplierSearch" placeholder="Search suppliers..." @input="debouncedLoadSuppliers" />
          </div>
          <select v-model="supplierActiveFilter" @change="supplierPage = 1; loadSuppliers()">
            <option value="">All suppliers</option>
            <option value="true">Active only</option>
            <option value="false">Inactive only</option>
          </select>
        </div>
      </div>

      <div v-if="suppliers.length === 0" class="empty-state">
        <span class="empty-icon">🏭</span>
        <p>No suppliers found.</p>
        <span class="text-muted">Add a supplier before raising a purchase order.</span>
      </div>

      <div v-else class="card">
        <table class="data-table">
          <thead>
            <tr>
              <th>Supplier</th>
              <th>Contact</th>
              <th>Lead time</th>
              <th>Orders</th>
              <th>Lifetime value</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="supplier in suppliers" :key="supplier.id">
              <td>
                <strong>{{ supplier.name }}</strong>
                <div v-if="supplier.notes" class="cell-sub">{{ supplier.notes }}</div>
              </td>
              <td>
                {{ supplier.contact_name || '—' }}
                <div v-if="supplier.email" class="cell-sub">{{ supplier.email }}</div>
              </td>
              <td>{{ supplier.lead_time_days }}d</td>
              <td>{{ supplier.order_count }}</td>
              <td>{{ formatCurrency(supplier.lifetime_value) }}</td>
              <td>
                <span class="badge" :class="supplier.is_active ? 'badge-success' : 'badge-gray'">
                  {{ supplier.is_active ? 'Active' : 'Inactive' }}
                </span>
              </td>
              <td class="actions-cell">
                <button
                  v-if="canAdmin"
                  class="btn btn-sm btn-secondary"
                  @click="openSupplierModal(supplier)"
                >Edit</button>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="pagination" v-if="supplierTotal > supplierLimit">
          <button class="btn btn-sm" :disabled="supplierPage <= 1" @click="supplierPage--; loadSuppliers()">Previous</button>
          <span class="pagination-info">Page {{ supplierPage }} of {{ Math.ceil(supplierTotal / supplierLimit) }}</span>
          <button class="btn btn-sm" :disabled="supplierPage >= Math.ceil(supplierTotal / supplierLimit)" @click="supplierPage++; loadSuppliers()">Next</button>
        </div>
      </div>
    </template>

    <!-- ──── ORDER DETAIL MODAL ──── -->
    <div class="modal-overlay" v-if="detail" @click.self="detail = null">
      <div class="modal modal-lg" role="dialog" aria-modal="true" aria-labelledby="po-detail-title">
        <div class="modal-header">
          <h2 id="po-detail-title">{{ detail.order_number }}</h2>
          <button class="modal-close" type="button" @click="detail = null" aria-label="Close">✕</button>
        </div>
        <div class="modal-body">
          <div class="detail-grid">
            <div><span class="detail-label">Status</span><span class="badge" :class="statusColor(detail.status)">{{ labelFor(detail.status) }}</span></div>
            <div><span class="detail-label">Supplier</span><strong>{{ detail.supplier_name }}</strong></div>
            <div><span class="detail-label">Raised by</span><strong>{{ detail.ordered_by_name || '—' }}</strong></div>
            <div><span class="detail-label">Approved by</span><strong>{{ detail.approved_by_name || '—' }}</strong></div>
            <div><span class="detail-label">Expected</span><strong>{{ detail.expected_date || '—' }}</strong></div>
            <div><span class="detail-label">Total</span><strong>{{ formatCurrency(detail.total_amount) }}</strong></div>
          </div>

          <div v-if="detail.cancellation_reason" class="alert alert-danger">
            <strong>Cancelled:</strong> {{ detail.cancellation_reason }}
          </div>
          <div v-else-if="detail.notes" class="alert">{{ detail.notes }}</div>

          <div v-if="canApprove(detail)" class="alert alert-warning">
            Raised by {{ detail.ordered_by_name || 'a colleague' }}. You cannot approve an order you raised
            yourself &mdash; a second administrator has to sign this off.
          </div>

          <table class="data-table detail-items">
            <thead>
              <tr>
                <th>Medicine</th>
                <th>Ordered</th>
                <th>Received</th>
                <th>Unit cost</th>
                <th>Line total</th>
                <th v-if="canReceive(detail)">Receive now</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in detail.items" :key="item.id">
                <td>
                  <strong>{{ item.medicine_name }}</strong>
                  <div class="cell-sub">On hand {{ item.stock_quantity }} {{ item.unit }}</div>
                </td>
                <td>{{ item.quantity }}</td>
                <td>
                  {{ item.quantity_received }}
                  <span v-if="item.quantity_received >= item.quantity" class="badge badge-success">Complete</span>
                </td>
                <td>{{ formatCurrency(item.unit_cost) }}</td>
                <td>{{ formatCurrency(item.quantity * item.unit_cost) }}</td>
                <td v-if="canReceive(detail)">
                  <input
                    type="number"
                    class="receive-input"
                    min="0"
                    :max="item.quantity - item.quantity_received"
                    v-model.number="receiveQuantities[item.id]"
                    :placeholder="String(item.quantity - item.quantity_received)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="modal-footer">
          <button
            v-if="canCancel(detail)"
            class="btn btn-danger"
            @click="cancelOrder"
            :disabled="busy"
          >Cancel order</button>
          <button
            v-if="detail.status === 'draft'"
            class="btn btn-secondary"
            @click="submitOrder"
            :disabled="busy"
          >Submit for approval</button>
          <button
            v-if="detail.status === 'submitted'"
            class="btn btn-success"
            @click="approveOrder"
            :disabled="busy"
          >Approve</button>
          <button
            v-if="canReceive(detail)"
            class="btn btn-primary"
            @click="receiveOrder"
            :disabled="busy"
          >Receive stock</button>
          <button class="btn btn-secondary" @click="detail = null">Close</button>
        </div>
      </div>
    </div>

    <!-- ──── NEW / EDIT ORDER MODAL ──── -->
    <div class="modal-overlay" v-if="showOrderModal" @click.self="showOrderModal = false">
      <div class="modal modal-lg" role="dialog" aria-modal="true" aria-labelledby="new-order-title">
        <div class="modal-header">
          <h2 id="new-order-title">New purchase order</h2>
          <button class="modal-close" type="button" @click="showOrderModal = false" aria-label="Close">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-row">
            <div class="form-group">
              <label for="po-supplier">Supplier *</label>
              <select id="po-supplier" v-model.number="orderForm.supplier_id" required>
                <option :value="null" disabled>Select a supplier</option>
                <option v-for="s in activeSuppliers" :key="s.id" :value="s.id">
                  {{ s.name }} ({{ s.lead_time_days }}d lead)
                </option>
              </select>
            </div>
            <div class="form-group">
              <label for="po-expected">Expected delivery</label>
              <input id="po-expected" type="date" v-model="orderForm.expected_date" />
            </div>
          </div>

          <div class="form-group">
            <label for="po-notes">Notes</label>
            <textarea id="po-notes" rows="2" v-model="orderForm.notes" placeholder="Optional note for the approver"></textarea>
          </div>

          <div class="items-header">
            <h4>Line items</h4>
            <button class="btn btn-sm btn-secondary" @click="addLine">Add line</button>
          </div>

          <div v-if="orderForm.items.length === 0" class="text-muted empty-lines">Add at least one line item.</div>

          <div v-for="(line, index) in orderForm.items" :key="index" class="line-row">
            <select v-model.number="line.medicine_id" class="line-medicine">
              <option :value="null" disabled>Select a medicine</option>
              <option v-for="m in medicines" :key="m.id" :value="m.id">
                {{ m.name }} (stock {{ m.stock_quantity }})
              </option>
            </select>
            <input type="number" min="1" v-model.number="line.quantity" placeholder="Qty" class="line-qty" />
            <input type="number" min="0" step="0.01" v-model.number="line.unit_cost" placeholder="Unit cost" class="line-cost" />
            <span class="line-total">{{ formatCurrency((line.quantity || 0) * (line.unit_cost || 0)) }}</span>
            <button class="btn btn-sm btn-danger" @click="orderForm.items.splice(index, 1)" :aria-label="`Remove line ${index + 1}`">✕</button>
          </div>

          <div v-if="orderForm.items.length" class="order-total">
            <span>Order total</span>
            <strong>{{ formatCurrency(orderTotal) }}</strong>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="showOrderModal = false">Cancel</button>
          <button class="btn btn-primary" @click="createOrder" :disabled="busy">Create draft</button>
        </div>
      </div>
    </div>

    <!-- ──── SUPPLIER MODAL ──── -->
    <div class="modal-overlay" v-if="showSupplierModal" @click.self="showSupplierModal = false">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="supplier-modal-title">
        <div class="modal-header">
          <h2 id="supplier-modal-title">{{ editingSupplier ? 'Edit supplier' : 'New supplier' }}</h2>
          <button class="modal-close" type="button" @click="showSupplierModal = false" aria-label="Close">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label for="sup-name">Name *</label>
            <input id="sup-name" type="text" v-model.trim="supplierForm.name" required />
          </div>
          <div class="form-row">
            <div class="form-group">
              <label for="sup-contact">Contact person</label>
              <input id="sup-contact" type="text" v-model.trim="supplierForm.contact_name" />
            </div>
            <div class="form-group">
              <label for="sup-lead">Lead time (days)</label>
              <input id="sup-lead" type="number" min="0" v-model.number="supplierForm.lead_time_days" />
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label for="sup-email">Email</label>
              <input id="sup-email" type="email" v-model.trim="supplierForm.email" />
            </div>
            <div class="form-group">
              <label for="sup-phone">Phone</label>
              <input id="sup-phone" type="tel" v-model.trim="supplierForm.phone" />
            </div>
          </div>
          <div class="form-group">
            <label for="sup-notes">Notes</label>
            <textarea id="sup-notes" rows="2" v-model="supplierForm.notes"></textarea>
          </div>
          <div v-if="editingSupplier" class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" v-model="supplierForm.is_active" />
              Active &mdash; inactive suppliers cannot take new orders
            </label>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="showSupplierModal = false">Cancel</button>
          <button class="btn btn-primary" @click="saveSupplier" :disabled="busy">Save supplier</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from 'axios'
import StatsCard from '../../components/StatsCard.vue'
import { useToast } from '../../store/toast'
import { useAuthStore } from '../../store/auth'
import { formatDate, formatCurrency, debounce } from '../../utils/helpers'

const ORDER_STATUSES = ['draft', 'submitted', 'approved', 'partially_received', 'received', 'cancelled']

export default {
  name: 'Procurement',
  components: { StatsCard },
  setup() {
    const toast = useToast()
    const authStore = useAuthStore()
    const route = useRoute()
    const router = useRouter()

    const loading = ref(true)
    const busy = ref(false)
    const activeTab = ref('orders')

    const summary = ref(null)
    const suggestions = ref([])
    const selectedIds = ref([])
    const orders = ref([])
    const total = ref(0)
    const page = ref(1)
    const limit = ref(20)
    const search = ref('')
    const statusFilter = ref('')

    const suppliers = ref([])
    const supplierTotal = ref(0)
    const supplierPage = ref(1)
    const supplierLimit = ref(20)
    const supplierSearch = ref('')
    const supplierActiveFilter = ref('')

    const medicines = ref([])
    const detail = ref(null)
    const receiveQuantities = reactive({})

    const showOrderModal = ref(false)
    const showSupplierModal = ref(false)
    const editingSupplier = ref(null)
    const supplierForm = reactive(emptySupplierForm())
    const orderForm = reactive({ supplier_id: null, expected_date: '', notes: '', items: [] })

    const canAdmin = computed(() => authStore.can('admin'))
    const activeSuppliers = computed(() => suppliers.value.filter(s => s.is_active))
    const suggestionTotal = computed(() =>
      suggestions.value.filter(s => selectedIds.value.includes(s.medicine_id)).reduce((sum, s) => sum + s.estimated_cost, 0)
    )
    const orderTotal = computed(() =>
      orderForm.items.reduce((sum, line) => sum + (line.quantity || 0) * (line.unit_cost || 0), 0)
    )
    const tabs = computed(() => [
      { key: 'orders', label: 'Purchase orders', count: total.value || null },
      { key: 'suggestions', label: 'Reorder suggestions', count: suggestions.value.length || null },
      { key: 'suppliers', label: 'Suppliers', count: supplierTotal.value || null }
    ])

    function emptySupplierForm() {
      return { name: '', contact_name: '', email: '', phone: '', notes: '', lead_time_days: 7, is_active: true }
    }

    /* ── permissions ── */
    const canApprove = order => order.status === 'submitted'
    const canReceive = order => order.status === 'approved' || order.status === 'partially_received'
    const canCancel = order => ['draft', 'submitted', 'approved'].includes(order.status)

    const labelFor = status => status ? status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : ''
    const statusColor = status => ({
      draft: 'badge-gray',
      submitted: 'badge-warning',
      approved: 'badge-info',
      partially_received: 'badge-primary',
      received: 'badge-success',
      cancelled: 'badge-danger'
    }[status] || 'badge-gray')

    /* ── loaders ── */
    let ordersRequest = 0
    async function loadOrders() {
      const current = ++ordersRequest
      try {
        const params = { page: page.value, limit: limit.value }
        if (search.value) params.search = search.value
        if (statusFilter.value) params.status = statusFilter.value
        const { data } = await axios.get('/api/procurement/orders', { params })
        if (current !== ordersRequest) return
        orders.value = data.orders
        total.value = data.total
      } catch (e) {
        toast.error(apiError(e, 'Failed to load purchase orders.'))
      }
    }

    let suppliersRequest = 0
    async function loadSuppliers() {
      const current = ++suppliersRequest
      try {
        const params = { page: supplierPage.value, limit: supplierLimit.value }
        if (supplierSearch.value) params.search = supplierSearch.value
        if (supplierActiveFilter.value) params.is_active = supplierActiveFilter.value
        const { data } = await axios.get('/api/procurement/suppliers', { params })
        if (current !== suppliersRequest) return
        suppliers.value = data.suppliers
        supplierTotal.value = data.total
      } catch (e) {
        toast.error(apiError(e, 'Failed to load suppliers.'))
      }
    }

    async function loadSuggestions() {
      try {
        const { data } = await axios.get('/api/procurement/suggestions')
        suggestions.value = data.suggestions
      } catch (e) {
        toast.error(apiError(e, 'Failed to load reorder suggestions.'))
      }
    }

    async function loadMedicines() {
      try {
        const { data } = await axios.get('/api/pharmacy/medicines', { params: { limit: 100 } })
        medicines.value = data.medicines
      } catch {
        medicines.value = []
      }
    }

    async function loadSummary() {
      try {
        const { data } = await axios.get('/api/procurement/summary')
        summary.value = data
      } catch {
        summary.value = null
      }
    }

    async function loadAll() {
      loading.value = true
      try {
        await Promise.all([loadOrders(), loadSuppliers(), loadSuggestions(), loadSummary(), loadMedicines()])
      } finally {
        loading.value = false
      }
    }

    function switchTab(key) {
      activeTab.value = key
    }

    /* ── suggestions ── */
    const isSelected = id => selectedIds.value.includes(id)
    function toggleSuggestion(item) {
      const index = selectedIds.value.indexOf(item.medicine_id)
      if (index === -1) selectedIds.value.push(item.medicine_id)
      else selectedIds.value.splice(index, 1)
    }

    function orderFromSuggestions() {
      const chosen = suggestions.value.filter(s => selectedIds.value.includes(s.medicine_id))
      if (!chosen.length) return
      openOrderModal()
      const first = activeSuppliers.value[0]
      orderForm.supplier_id = first ? first.id : null
      orderForm.items = chosen.map(item => ({
        medicine_id: item.medicine_id,
        quantity: item.suggested_quantity,
        unit_cost: item.unit_cost
      }))
      selectedIds.value = []
    }

    /* ── order modal ── */
    function openOrderModal() {
      Object.assign(orderForm, {
        supplier_id: activeSuppliers.value[0]?.id ?? null,
        expected_date: '',
        notes: '',
        items: [{ medicine_id: null, quantity: 1, unit_cost: 0 }]
      })
      showOrderModal.value = true
    }

    const addLine = () => orderForm.items.push({ medicine_id: null, quantity: 1, unit_cost: 0 })

    async function createOrder() {
      if (busy.value) return
      const items = orderForm.items.filter(line => line.medicine_id)
      if (!orderForm.supplier_id) return toast.warning('Choose a supplier first.')
      if (!items.length) return toast.warning('Add at least one line item.')
      if (items.some(line => !line.quantity || line.quantity < 1)) {
        return toast.warning('Every line needs a quantity of at least 1.')
      }
      busy.value = true
      try {
        const { data } = await axios.post('/api/procurement/orders', {
          supplier_id: orderForm.supplier_id,
          expected_date: orderForm.expected_date || null,
          notes: orderForm.notes || null,
          items: items.map(line => ({ medicine_id: line.medicine_id, quantity: line.quantity, unit_cost: line.unit_cost }))
        })
        showOrderModal.value = false
        toast.success(`Draft ${data.order_number} created.`)
        activeTab.value = 'orders'
        page.value = 1
        await Promise.all([loadOrders(), loadSummary()])
      } catch (e) {
        toast.error(apiError(e, 'Failed to create the purchase order.'))
      } finally {
        busy.value = false
      }
    }

    /* ── order detail / actions ── */
    async function openDetail(id) {
      try {
        const { data } = await axios.get(`/api/procurement/orders/${id}`)
        detail.value = data
        Object.keys(receiveQuantities).forEach(key => delete receiveQuantities[key])
        for (const item of data.items) {
          const outstanding = item.quantity - item.quantity_received
          if (outstanding > 0) receiveQuantities[item.id] = outstanding
        }
      } catch (e) {
        toast.error(apiError(e, 'Failed to load the purchase order.'))
      }
    }

    async function refreshDetail() {
      if (detail.value) await openDetail(detail.value.id)
      await Promise.all([loadOrders(), loadSummary(), loadSuggestions()])
    }

    async function submitOrder() {
      if (busy.value) return
      busy.value = true
      try {
        await axios.post(`/api/procurement/orders/${detail.value.id}/submit`)
        toast.success('Submitted for approval.')
        await refreshDetail()
      } catch (e) {
        toast.error(apiError(e, 'Failed to submit the order.'))
      } finally {
        busy.value = false
      }
    }

    async function approveOrder() {
      if (busy.value) return
      busy.value = true
      try {
        await axios.post(`/api/procurement/orders/${detail.value.id}/approve`)
        toast.success('Order approved.')
        await refreshDetail()
      } catch (e) {
        toast.error(apiError(e, 'Failed to approve the order.'))
      } finally {
        busy.value = false
      }
    }

    async function cancelOrder() {
      if (busy.value) return
      const reason = window.prompt('Why is this order being cancelled? The reason is recorded in the audit log.')
      if (!reason || !reason.trim()) return
      busy.value = true
      try {
        await axios.post(`/api/procurement/orders/${detail.value.id}/cancel`, { reason: reason.trim() })
        toast.success('Order cancelled.')
        await refreshDetail()
      } catch (e) {
        toast.error(apiError(e, 'Failed to cancel the order.'))
      } finally {
        busy.value = false
      }
    }

    async function receiveOrder() {
      if (busy.value) return
      const items = Object.entries(receiveQuantities)
        .map(([itemId, quantity]) => ({ item_id: Number(itemId), quantity: Number(quantity) }))
        .filter(entry => entry.quantity > 0)
      if (!items.length) return toast.warning('Enter at least one quantity to receive.')
      busy.value = true
      try {
        const { data } = await axios.post(`/api/procurement/orders/${detail.value.id}/receive`, { items })
        const received = data.receipt?.unitsReceived ?? items.reduce((s, i) => s + i.quantity, 0)
        toast.success(
          data.status === 'received'
            ? `Order complete. ${received} unit(s) added to inventory.`
            : `Received ${received} unit(s). The order stays partly open.`
        )
        await refreshDetail()
      } catch (e) {
        toast.error(apiError(e, 'Failed to receive stock.'))
      } finally {
        busy.value = false
      }
    }

    /* ── supplier modal ── */
    function openSupplierModal(supplier = null) {
      editingSupplier.value = supplier
      Object.assign(supplierForm, emptySupplierForm(), supplier ? {
        name: supplier.name,
        contact_name: supplier.contact_name || '',
        email: supplier.email || '',
        phone: supplier.phone || '',
        notes: supplier.notes || '',
        lead_time_days: supplier.lead_time_days,
        is_active: !!supplier.is_active
      } : {})
      showSupplierModal.value = true
    }

    async function saveSupplier() {
      if (busy.value) return
      if (!supplierForm.name) return toast.warning('A supplier name is required.')
      busy.value = true
      try {
        const payload = {
          name: supplierForm.name,
          contact_name: supplierForm.contact_name || null,
          email: supplierForm.email || null,
          phone: supplierForm.phone || null,
          notes: supplierForm.notes || null,
          lead_time_days: supplierForm.lead_time_days
        }
        if (editingSupplier.value) {
          payload.is_active = supplierForm.is_active
          await axios.put(`/api/procurement/suppliers/${editingSupplier.value.id}`, payload)
          toast.success('Supplier updated.')
        } else {
          await axios.post('/api/procurement/suppliers', payload)
          toast.success('Supplier created.')
        }
        showSupplierModal.value = false
        await Promise.all([loadSuppliers(), loadSummary()])
      } catch (e) {
        toast.error(apiError(e, 'Failed to save the supplier.'))
      } finally {
        busy.value = false
      }
    }

    function apiError(error, fallback) {
      return error.response?.data?.message || fallback
    }

    const debouncedLoadOrders = debounce(() => { page.value = 1; loadOrders() }, 300)
    const debouncedLoadSuppliers = debounce(() => { supplierPage.value = 1; loadSuppliers() }, 300)

    onMounted(async () => {
      await loadAll()
      // Notifications deep-link here, e.g. /procurement?order=12
      const focusOrder = Number(route.query.order)
      if (focusOrder) {
        await openDetail(focusOrder)
        if (route.fullPath !== '/procurement') router.replace({ path: '/procurement' })
      }
    })
    onUnmounted(() => {
      debouncedLoadOrders.cancel()
      debouncedLoadSuppliers.cancel()
    })

    return {
      ORDER_STATUSES,
      loading, busy, activeTab, summary, suggestions, selectedIds,
      orders, total, page, limit, search, statusFilter,
      suppliers, supplierTotal, supplierPage, supplierLimit, supplierSearch, supplierActiveFilter,
      medicines, detail, receiveQuantities,
      showOrderModal, showSupplierModal, editingSupplier, supplierForm, orderForm,
      canAdmin, activeSuppliers, suggestionTotal, orderTotal, tabs,
      canApprove, canReceive, canCancel, labelFor, statusColor,
      loadAll, loadOrders, loadSuppliers, switchTab,
      isSelected, toggleSuggestion, orderFromSuggestions,
      openOrderModal, addLine, createOrder,
      openDetail, submitOrder, approveOrder, cancelOrder, receiveOrder,
      openSupplierModal, saveSupplier,
      debouncedLoadOrders, debouncedLoadSuppliers,
      formatDate, formatCurrency
    }
  }
}
</script>

<style scoped>
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 16px;
  margin-bottom: 22px;
}

.tab-bar {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--gray-200);
  margin-bottom: 20px;
  overflow-x: auto;
}
.tab-btn {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 10px 16px;
  font-size: 13.5px;
  font-weight: 600;
  font-family: inherit;
  color: var(--text-muted);
  cursor: pointer;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 7px;
  transition: color .15s, border-color .15s;
}
.tab-btn:hover { color: var(--gray-800); }
.tab-btn--active { color: var(--brand-700); border-bottom-color: var(--brand-600); }
.tab-count {
  background: var(--gray-100);
  color: var(--gray-600);
  font-size: 10.5px;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: var(--radius-full);
}
.tab-btn--active .tab-count { background: var(--brand-50); color: var(--brand-700); }

.filter-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.search-bar input {
  padding: 9px 14px;
  border: 1px solid var(--gray-200);
  border-radius: 8px;
  width: 280px;
  font-size: 13.5px;
  font-family: inherit;
}
.search-bar input:focus { border-color: var(--brand-500); outline: none; }
.filter-row select {
  padding: 9px 14px;
  border: 1px solid var(--gray-200);
  border-radius: 8px;
  font-size: 13.5px;
  background: var(--white);
  color: var(--gray-700);
  font-family: inherit;
}

.suggestion-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.suggestion-header h3 { margin: 0 0 3px; font-size: 15px; }
.suggestion-header p { margin: 0; font-size: 12.5px; }

.cell-sub { font-size: 11.5px; color: var(--text-subtle); margin-top: 3px; display: flex; gap: 6px; }
.actions-cell { text-align: right; white-space: nowrap; }

.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 16px;
  padding-bottom: 18px;
  margin-bottom: 18px;
  border-bottom: 1px solid var(--gray-100);
}
.detail-grid > div { display: flex; flex-direction: column; gap: 5px; }
.detail-label {
  font-size: 10.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .07em;
  color: var(--text-subtle);
}
.detail-grid strong { font-size: 13.5px; color: var(--gray-800); }
.detail-grid .badge { align-self: flex-start; }

.alert {
  padding: 11px 14px;
  border-radius: 8px;
  font-size: 13px;
  background: var(--gray-50);
  border: 1px solid var(--gray-200);
  color: var(--gray-700);
  margin-bottom: 16px;
}
.alert-warning { background: var(--warning-bg); border-color: var(--warning-border); color: #92400e; }
.alert-danger  { background: var(--danger-bg);  border-color: var(--danger-border);  color: var(--danger-fg); }

.detail-items { margin-top: 4px; }
.receive-input {
  width: 78px;
  padding: 6px 9px;
  border: 1px solid var(--gray-200);
  border-radius: 7px;
  font-size: 13px;
  font-family: inherit;
}
.receive-input:focus { border-color: var(--brand-500); outline: none; }

.items-header { display: flex; align-items: center; justify-content: space-between; margin: 20px 0 10px; }
.items-header h4 { margin: 0; font-size: 13.5px; color: var(--gray-700); }
.empty-lines { padding: 14px 0; font-size: 13px; }

.line-row {
  display: grid;
  grid-template-columns: 1fr 74px 96px 92px 32px;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}
.line-row select, .line-row input {
  padding: 8px 10px;
  border: 1px solid var(--gray-200);
  border-radius: 7px;
  font-size: 13px;
  font-family: inherit;
  width: 100%;
}
.line-row select:focus, .line-row input:focus { border-color: var(--brand-500); outline: none; }
.line-total { font-size: 13px; font-weight: 600; color: var(--gray-700); text-align: right; }

.order-total {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 13px 0 0;
  margin-top: 6px;
  border-top: 1px solid var(--gray-200);
  font-size: 14px;
  color: var(--gray-600);
}
.order-total strong { font-size: 17px; color: var(--gray-900); }

.checkbox-label { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--gray-600); cursor: pointer; }

.empty-state { text-align: center; padding: 60px 20px; color: var(--text-muted); }
.empty-icon { font-size: 40px; display: block; margin-bottom: 12px; }
.text-muted { color: var(--text-subtle); font-size: 13px; }

.loading-state { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; color: var(--text-muted); }
.spinner { width: 38px; height: 38px; border: 4px solid var(--gray-200); border-top-color: var(--brand-600); border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 14px; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 768px) {
  .filter-row { flex-direction: column; align-items: stretch; }
  .search-bar input { width: 100%; }
  .line-row { grid-template-columns: 1fr 1fr; }
  .line-medicine { grid-column: 1 / -1; }
}
</style>
