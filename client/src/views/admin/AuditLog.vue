<template>
  <div class="audit-page">
    <div class="page-header">
      <div class="header-left">
        <span class="user-count badge badge-info" v-if="!loading">{{ total }} entries</span>
      </div>
      <div class="header-actions">
        <div class="filter-group">
          <select v-model="actionFilter" @change="page = 1; loadEntries()">
            <option value="">All Actions</option>
            <option v-for="action in actions" :key="action" :value="action">{{ action }}</option>
          </select>
        </div>
        <div class="filter-group">
          <select v-model="actorFilter" @change="page = 1; loadEntries()">
            <option value="">All Actors</option>
            <option value="staff">Staff</option>
            <option value="patient">Patient</option>
            <option value="anonymous">Anonymous</option>
          </select>
        </div>
        <div class="filter-group">
          <input type="date" v-model="fromDate" @change="page = 1; loadEntries()" title="From date" />
          <input type="date" v-model="toDate" @change="page = 1; loadEntries()" title="To date" />
        </div>
        <button class="btn btn-sm btn-outline" @click="loadEntries" :disabled="loading">Refresh</button>
      </div>
    </div>

    <div v-if="loading" class="loading-state">
      <div class="spinner"></div>
      <p>Loading audit trail...</p>
    </div>

    <div v-else-if="error" class="empty-state">
      <span class="empty-icon">!</span>
      <p>{{ error }}</p>
    </div>

    <div v-else-if="entries.length === 0" class="empty-state">
      <span class="empty-icon">🗂️</span>
      <p>No audit entries found.</p>
      <span class="text-muted">Try adjusting the filters.</span>
    </div>

    <div v-else class="card">
      <table class="data-table">
        <thead>
          <tr><th>When</th><th>Actor</th><th>Action</th><th>Summary</th><th>Record</th><th>IP</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="entry in entries" :key="entry.id">
            <td class="text-muted">{{ formatDateTime(entry.created_at) }}</td>
            <td>
              <div>{{ actorName(entry) }}</div>
              <span class="badge" :class="actorBadge(entry.actor_type)">{{ entry.actor_type }}</span>
            </td>
            <td><code class="action-code">{{ entry.action }}</code></td>
            <td class="summary-cell">{{ entry.summary || '-' }}</td>
            <td class="text-muted">
              <span v-if="entry.table_name">{{ entry.table_name }}<template v-if="entry.record_id"> #{{ entry.record_id }}</template></span>
              <span v-else>-</span>
            </td>
            <td class="text-muted">{{ entry.ip_address || '-' }}</td>
            <td>
              <button
                v-if="entry.old_values || entry.new_values"
                class="btn btn-sm btn-outline"
                @click="toggleDetails(entry.id)"
              >
                {{ expanded === entry.id ? 'Hide' : 'Details' }}
              </button>
            </td>
          </tr>
          <template v-if="expandedDetails">
            <tr v-for="row in expandedDetails" :key="`d-${row.id}`" class="detail-row">
              <td colspan="7">
                <div class="detail-grid">
                  <div>
                    <h4>Before</h4>
                    <pre>{{ pretty(row.old_values) }}</pre>
                  </div>
                  <div>
                    <h4>After</h4>
                    <pre>{{ pretty(row.new_values) }}</pre>
                  </div>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
      <div class="pagination" v-if="total > limit">
        <button class="btn btn-sm" :disabled="page <= 1" @click="page--; loadEntries()">Previous</button>
        <span>Page {{ page }} of {{ Math.ceil(total / limit) }}</span>
        <button class="btn btn-sm" :disabled="page >= Math.ceil(total / limit)" @click="page++; loadEntries()">Next</button>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, onMounted } from 'vue'
import axios from 'axios'
import { formatDateTime } from '../../utils/helpers'
import { useToast } from '../../store/toast'

export default {
  name: 'AuditLog',
  setup() {
    const toast = useToast()
    const entries = ref([])
    const actions = ref([])
    const total = ref(0)
    const page = ref(1)
    const limit = ref(20)
    const loading = ref(false)
    const error = ref('')
    const actionFilter = ref('')
    const actorFilter = ref('')
    const fromDate = ref('')
    const toDate = ref('')
    const expanded = ref(null)
    const expandedDetails = ref([])

    const loadEntries = async () => {
      loading.value = true
      error.value = ''
      try {
        const params = { page: page.value, limit: limit.value }
        if (actionFilter.value) params.action = actionFilter.value
        if (actorFilter.value) params.actor_type = actorFilter.value
        if (fromDate.value) params.from_date = fromDate.value
        if (toDate.value) params.to_date = toDate.value
        const { data } = await axios.get('/api/audit', { params })
        entries.value = data.entries || []
        total.value = data.total || 0
        if (expanded.value !== null) await toggleDetails(expanded.value)
      } catch (e) {
        error.value = e.response?.data?.message || 'Failed to load the audit trail.'
        toast.error(error.value)
      } finally {
        loading.value = false
      }
    }

    const loadActions = async () => {
      try {
        const { data } = await axios.get('/api/audit/actions')
        actions.value = data.actions || []
      } catch {
        // The filter list is a convenience; the table still works without it.
        actions.value = []
      }
    }

    const toggleDetails = async (id) => {
      if (expanded.value === id) {
        expanded.value = null
        expandedDetails.value = []
        return
      }
      const entry = entries.value.find(item => item.id === id)
      expanded.value = id
      expandedDetails.value = entry ? [entry] : []
    }

    const actorName = (entry) => {
      if (entry.actor_type === 'staff') {
        return entry.actor_email
          || [entry.actor_first_name, entry.actor_last_name].filter(Boolean).join(' ')
          || `User #${entry.user_id}`
      }
      return entry.actor_label || 'Unknown'
    }

    const actorBadge = (type) => ({
      staff: 'badge-info',
      patient: 'badge-success',
      anonymous: 'badge-secondary',
    }[type] || 'badge-info')

    const pretty = (value) => {
      if (!value) return '—'
      try {
        return JSON.stringify(JSON.parse(value), null, 2)
      } catch {
        return value
      }
    }

    onMounted(() => {
      loadEntries()
      loadActions()
    })

    return {
      entries, actions, total, page, limit, loading, error,
      actionFilter, actorFilter, fromDate, toDate,
      expanded, expandedDetails,
      loadEntries, toggleDetails, actorName, actorBadge, pretty, formatDateTime
    }
  }
}
</script>

<style scoped>
.action-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  background: var(--gray-100);
  padding: 2px 6px;
  border-radius: 4px;
  white-space: nowrap;
}
.summary-cell {
  max-width: 320px;
  font-size: 13px;
  color: var(--gray-600);
}
.detail-row td {
  background: var(--gray-50);
}
.detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.detail-grid h4 {
  margin: 0 0 6px;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
.detail-grid pre {
  margin: 0;
  padding: 10px;
  background: var(--white);
  border: 1px solid var(--gray-200);
  border-radius: 6px;
  font-size: 12px;
  max-height: 240px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
.btn-outline { border: 1px solid var(--gray-200); background: var(--white); color: var(--gray-600); }
.btn-outline:hover { background: var(--gray-50); }
.empty-state { text-align: center; padding: 40px 16px; color: var(--text-subtle); }
.empty-icon { font-size: 30px; display: block; margin-bottom: 8px; }
@media (max-width: 900px) { .detail-grid { grid-template-columns: 1fr; } }
</style>
