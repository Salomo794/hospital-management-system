<template>
  <div class="audit-page">
    <div class="page-header">
      <div class="header-left">
        <h2>Audit Log</h2>
        <span class="user-count badge badge-info" v-if="!loading">{{ total }} entries</span>
      </div>
      <div class="header-actions">
        <div class="search-bar">
          <input type="text" v-model="search" placeholder="Search user, table, action..." @input="debouncedLoad" />
        </div>
        <div class="filter-group">
          <select v-model="actionFilter" @change="loadLogs">
            <option value="">All Actions</option>
            <option v-for="a in actionOptions" :key="a" :value="a">{{ a }}</option>
          </select>
        </div>
      </div>
    </div>

    <div v-if="!loading && actionsSummary.length" class="summary-grid">
      <div class="summary-card" v-for="item in actionsSummary" :key="item.action">
        <div class="summary-count">{{ item.count }}</div>
        <div class="summary-label">{{ item.action }}</div>
      </div>
    </div>

    <div v-if="loading" class="loading-state">
      <div class="spinner"></div>
      <p>Loading audit log...</p>
    </div>

    <div v-else-if="logs.length === 0" class="empty-state">
      <span class="empty-icon">📜</span>
      <p>No audit entries found.</p>
    </div>

    <div v-else class="card">
      <table class="data-table">
        <thead>
          <tr><th>Time</th><th>User</th><th>Action</th><th>Table</th><th>Record</th><th>IP</th></tr>
        </thead>
        <tbody>
          <tr v-for="log in logs" :key="log.id">
            <td>{{ formatDateTime(log.created_at) }}</td>
            <td>{{ log.first_name ? log.first_name + ' ' + log.last_name : 'System' }}</td>
            <td><span class="badge" :class="'badge-' + actionColor(log.action)">{{ log.action }}</span></td>
            <td><span class="text-mono">{{ log.table_name || '-' }}</span></td>
            <td>{{ log.record_id || '-' }}</td>
            <td>{{ log.ip_address || '-' }}</td>
          </tr>
        </tbody>
      </table>

      <div class="pagination" v-if="total > limit">
        <button class="btn btn-sm" :disabled="page <= 1" @click="page--; loadLogs()">Prev</button>
        <span>Page {{ page }} of {{ Math.ceil(total / limit) }}</span>
        <button class="btn btn-sm" :disabled="page >= Math.ceil(total / limit)" @click="page++; loadLogs()">Next</button>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, onMounted, computed } from 'vue'
import axios from 'axios'
import { useToast } from '../../store/toast'
import { formatDateTime, debounce } from '../../utils/helpers'

export default {
  name: 'AuditLog',
  setup() {
    const toast = useToast()
    const logs = ref([])
    const summary = ref([])
    const total = ref(0)
    const page = ref(1)
    const limit = ref(30)
    const search = ref('')
    const actionFilter = ref('')
    const loading = ref(true)

    const actionOptions = ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'DISCHARGE', 'TRANSFER', 'DISPENSE', 'PAYMENT']

    const actionsSummary = computed(() => summary.value.filter(s => s.count > 0))

    const loadLogs = async () => {
      loading.value = true
      try {
        const params = { page: page.value, limit: limit.value }
        if (search.value) params.search = search.value
        if (actionFilter.value) params.action = actionFilter.value
        const { data } = await axios.get('/api/audit', { params })
        logs.value = data.logs
        total.value = data.total
      } catch (e) {
        toast.error('Failed to load audit log')
      } finally {
        loading.value = false
      }
    }

    const loadSummary = async () => {
      try {
        const { data } = await axios.get('/api/audit/recent')
        summary.value = data.byAction
      } catch (e) { /* silent */ }
    }

    const debouncedLoad = debounce(() => loadLogs(), 300)

    const actionColor = (action) => {
      const map = { CREATE: 'success', UPDATE: 'info', DELETE: 'danger', LOGIN: 'info', LOGOUT: 'gray', DISCHARGE: 'success', TRANSFER: 'warning', DISPENSE: 'info', PAYMENT: 'success' }
      return map[action] || 'gray'
    }

    onMounted(() => {
      loadLogs()
      loadSummary()
    })

    return { logs, summary, actionsSummary, total, page, limit, search, actionFilter, loading, actionOptions, loadLogs, debouncedLoad, actionColor, formatDateTime }
  }
}
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; gap: 16px; }
.header-left { display: flex; align-items: center; gap: 12px; }
.header-left h2 { margin: 0; }
.user-count { font-size: 12px; }
.header-actions { display: flex; gap: 12px; }
.search-bar input { padding: 10px 16px; border: 1px solid #e2e8f0; border-radius: 8px; width: 280px; font-size: 14px; }
.search-bar input:focus { border-color: #0d9488; outline: none; }
.filter-group select { padding: 10px 16px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px; background: white; }

.summary-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 12px; margin-bottom: 20px; }
.summary-card { background: white; border-radius: 10px; padding: 14px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); display: flex; flex-direction: column; align-items: center; }
.summary-count { font-size: 22px; font-weight: 700; color: #0d9488; }
.summary-label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.3px; }

.text-mono { font-family: monospace; font-size: 13px; }

.empty-state { text-align: center; padding: 60px 20px; color: #64748b; }
.empty-icon { font-size: 40px; display: block; margin-bottom: 12px; }

.loading-state { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; color: #64748b; }
.spinner { width: 40px; height: 40px; border: 4px solid #e2e8f0; border-top-color: #0d9488; border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 16px; }
@keyframes spin { to { transform: rotate(360deg); } }

.pagination { display: flex; justify-content: center; align-items: center; gap: 16px; padding: 16px; border-top: 1px solid #f1f5f9; }

@media (max-width: 768px) {
  .page-header { flex-direction: column; align-items: stretch; }
  .header-actions { flex-direction: column; }
  .search-bar input { width: 100%; }
}
</style>