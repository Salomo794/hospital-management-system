<template>
  <div class="lab-page">
    <div class="page-header">
      <div class="tabs-inline">
        <button :class="{ active: view === 'orders' }" @click="switchTab('orders')">
          Lab Orders
          <span class="tab-count" v-if="orders.length">{{ orders.length }}</span>
        </button>
        <button :class="{ active: view === 'tests' }" @click="switchTab('tests')">
          Test Catalog
          <span class="tab-count" v-if="tests.length">{{ tests.length }}</span>
        </button>
      </div>
    </div>

    <div v-if="view === 'orders'">
      <div class="search-filters">
        <select v-model="statusFilter" @change="loadOrders">
          <option value="">All Status</option>
          <option value="ordered">Ordered</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
        </select>
      </div>
      <div class="card">
        <div class="card-header">
          <h3>Lab Orders</h3>
          <span class="text-muted-inline">{{ orders.length }} total</span>
        </div>

        <div v-if="loadingOrders" class="loading-state">
          <div class="spinner"></div>
          <span>Loading lab orders...</span>
        </div>

        <div v-else-if="orders.length === 0" class="empty-state">
          <div class="empty-icon">&#128269;</div>
          <h4>No Lab Orders Found</h4>
          <p v-if="statusFilter">No orders match the selected status filter.</p>
          <p v-else>There are no lab orders in the system yet.</p>
          <button v-if="statusFilter" class="btn btn-sm btn-outline" @click="statusFilter = ''; loadOrders()">Clear Filter</button>
        </div>

        <table class="data-table" v-else>
          <thead>
            <tr>
              <th>Order #</th>
              <th>Date</th>
              <th>Patient</th>
              <th>Doctor</th>
              <th>Tests</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="o in orders" :key="o.id">
              <td class="text-mono">{{ o.order_number }}</td>
              <td>{{ formatDate(o.order_date) }}</td>
              <td>{{ o.patient_first_name }} {{ o.patient_last_name }}</td>
              <td>Dr. {{ o.doctor_first_name }} {{ o.doctor_last_name }}</td>
              <td class="tests-cell">{{ o.test_names || '-' }}</td>
              <td>
                <span class="badge" :class="priorityClass(o.priority)">{{ o.priority }}</span>
              </td>
              <td>
                <span class="badge" :class="'badge-' + getStatusColor(o.status)">{{ o.status.replace('_', ' ') }}</span>
              </td>
              <td>
                <router-link :to="`/laboratory/orders/${o.id}`" class="btn btn-sm btn-outline">
                  {{ o.status === 'ordered' ? 'Process' : 'View' }}
                </router-link>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="view === 'tests'">
      <div class="card">
        <div class="card-header">
          <h3>Available Tests</h3>
          <span class="text-muted-inline">{{ tests.length }} tests</span>
        </div>

        <div v-if="loadingTests" class="loading-state">
          <div class="spinner"></div>
          <span>Loading test catalog...</span>
        </div>

        <div v-else-if="tests.length === 0" class="empty-state">
          <div class="empty-icon">&#128203;</div>
          <h4>No Tests Available</h4>
          <p>The test catalog is empty. Add tests to get started.</p>
        </div>

        <table class="data-table" v-else>
          <thead>
            <tr>
              <th>Test Name</th>
              <th>Category</th>
              <th>Normal Range</th>
              <th>Unit</th>
              <th>Price</th>
              <th>Turnaround</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in tests" :key="t.id">
              <td><strong>{{ t.name }}</strong></td>
              <td><span class="badge badge-info">{{ t.category || '-' }}</span></td>
              <td>{{ t.normal_range || '-' }}</td>
              <td>{{ t.unit || '-' }}</td>
              <td>{{ formatCurrency(t.price) }}</td>
              <td>{{ t.turnaround_time }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, onMounted } from 'vue'
import axios from 'axios'
import { useToast } from '../../store/toast'
import { formatDate, formatCurrency, getStatusColor } from '../../utils/helpers'

export default {
  name: 'Laboratory',
  setup() {
    const toast = useToast()
    const view = ref('orders')
    const orders = ref([])
    const tests = ref([])
    const statusFilter = ref('')
    const loadingOrders = ref(false)
    const loadingTests = ref(false)

    const switchTab = (tab) => {
      view.value = tab
      if (tab === 'orders') loadOrders()
      else loadTests()
    }

    const loadOrders = async () => {
      loadingOrders.value = true
      try {
        const params = {}
        if (statusFilter.value) params.status = statusFilter.value
        const { data } = await axios.get('/api/laboratory/orders', { params })
        orders.value = data.orders
      } catch (e) {
        toast.error('Failed to load lab orders')
      } finally {
        loadingOrders.value = false
      }
    }

    const loadTests = async () => {
      loadingTests.value = true
      try {
        const { data } = await axios.get('/api/laboratory/tests')
        tests.value = data
      } catch (e) {
        toast.error('Failed to load test catalog')
      } finally {
        loadingTests.value = false
      }
    }

    const priorityClass = (priority) => {
      if (priority === 'stat') return 'badge-danger'
      if (priority === 'urgent') return 'badge-warning'
      return 'badge-info'
    }

    onMounted(loadOrders)

    return {
      view, orders, tests, statusFilter,
      loadingOrders, loadingTests,
      switchTab, loadOrders, loadTests,
      priorityClass,
      formatDate, formatCurrency, getStatusColor
    }
  }
}
</script>

<style scoped>
.lab-page {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.page-header h1 {
  font-size: 22px;
  font-weight: 700;
  color: #0f172a;
  margin: 0;
}

.tabs-inline {
  display: flex;
  gap: 0;
}

.tabs-inline button {
  padding: 10px 20px;
  border: 1px solid #e2e8f0;
  background: white;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  color: #475569;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.15s ease;
}

.tabs-inline button:first-child {
  border-radius: 8px 0 0 8px;
}

.tabs-inline button:last-child {
  border-radius: 0 8px 8px 0;
}

.tabs-inline button.active {
  background: #0d9488;
  color: white;
  border-color: #0d9488;
}

.tabs-inline button:not(.active):hover {
  background: #f1f5f9;
}

.tab-count {
  background: rgba(255, 255, 255, 0.25);
  padding: 1px 7px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
}

.tabs-inline button:not(.active) .tab-count {
  background: #e2e8f0;
  color: #64748b;
}

.search-filters {
  margin-bottom: 16px;
}

.search-filters select {
  padding: 10px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 14px;
  color: #334155;
  background: white;
  min-width: 180px;
}

.text-mono {
  font-family: monospace;
  font-size: 13px;
  color: #475569;
}

.tests-cell {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #64748b;
}

/* Loading spinner */
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 48px 20px;
  color: #94a3b8;
  font-size: 14px;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #e2e8f0;
  border-top-color: #0d9488;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Empty state */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 48px 20px;
  text-align: center;
}

.empty-icon {
  font-size: 40px;
  line-height: 1;
  margin-bottom: 4px;
}

.empty-state h4 {
  font-size: 16px;
  font-weight: 600;
  color: #334155;
  margin: 0;
}

.empty-state p {
  font-size: 14px;
  color: #94a3b8;
  margin: 0;
}

/* Card overrides */
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.text-muted-inline {
  font-size: 13px;
  color: #94a3b8;
}

/* Responsive */
@media (max-width: 768px) {
  .lab-page {
    padding: 12px;
  }
  .page-header {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }
  .tabs-inline {
    width: 100%;
  }
  .tabs-inline button {
    flex: 1;
    padding: 10px 12px;
    justify-content: center;
  }
  .search-filters select {
    width: 100%;
  }
}

@media (max-width: 576px) {
  .tabs-inline {
    overflow-x: auto;
    white-space: nowrap;
  }
  .tabs-inline button {
    flex: none;
  }
}
</style>
