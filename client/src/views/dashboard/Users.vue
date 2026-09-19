<template>
  <div class="users-page">
    <div class="page-header">
      <div class="header-left">
        <h2>Staff Members</h2>
        <span class="user-count badge badge-info" v-if="!loading">{{ total }} users</span>
      </div>
      <div class="header-actions">
        <div class="search-bar">
          <input type="text" v-model="search" placeholder="Search users..." @input="debouncedLoad" />
        </div>
        <div class="filter-group">
          <select v-model="roleFilter" @change="loadUsers">
            <option value="">All Roles</option>
            <option value="admin">Admin</option>
            <option value="doctor">Doctor</option>
            <option value="nurse">Nurse</option>
            <option value="receptionist">Receptionist</option>
            <option value="pharmacist">Pharmacist</option>
            <option value="lab_technician">Lab Technician</option>
          </select>
        </div>
      </div>
    </div>

    <div v-if="loading" class="loading-state">
      <div class="spinner"></div>
      <p>Loading users...</p>
    </div>

    <div v-else-if="users.length === 0" class="empty-state">
      <span class="empty-icon">👥</span>
      <p>No users found.</p>
      <span class="text-muted">Try adjusting your search or filters.</span>
    </div>

    <div v-else class="card">
      <table class="data-table">
        <thead>
          <tr><th>Name</th><th>Email</th><th>Role</th><th>Phone</th><th>Status</th><th>Last Login</th></tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id">
            <td><strong>{{ u.first_name }} {{ u.last_name }}</strong></td>
            <td>{{ u.email }}</td>
            <td><span class="badge" :class="'badge-' + getRoleColor(u.role)">{{ formatStatusLabel(u.role) }}</span></td>
            <td>{{ u.phone || '-' }}</td>
            <td><span class="badge" :class="u.is_active ? 'badge-success' : 'badge-danger'">{{ u.is_active ? 'Active' : 'Inactive' }}</span></td>
            <td>{{ u.last_login ? formatDateTime(u.last_login) : 'Never' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script>
import { ref, onMounted } from 'vue'
import axios from 'axios'
import { useToast } from '../../store/toast'
import { formatDateTime, getStatusLabel, debounce } from '../../utils/helpers'

export default {
  name: 'Users',
  setup() {
    const toast = useToast()
    const users = ref([])
    const total = ref(0)
    const search = ref('')
    const roleFilter = ref('')
    const loading = ref(true)

    const loadUsers = async () => {
      loading.value = true
      try {
        const params = { page: 1, limit: 50 }
        if (search.value) params.search = search.value
        if (roleFilter.value) params.role = roleFilter.value
        const { data } = await axios.get('/api/users', { params })
        users.value = data.users
        total.value = data.total
      } catch (e) {
        toast.error('Failed to load users.')
      } finally {
        loading.value = false
      }
    }

    const debouncedLoad = debounce(() => loadUsers(), 300)

    const getRoleColor = (role) => {
      const map = { admin: 'danger', doctor: 'info', nurse: 'success', receptionist: 'warning', pharmacist: 'info', lab_technician: 'info' }
      return map[role] || 'info'
    }

    const formatStatusLabel = (status) => getStatusLabel(status)

    onMounted(loadUsers)
    return { users, total, search, roleFilter, loading, loadUsers, debouncedLoad, getRoleColor, formatDateTime, formatStatusLabel }
  }
}
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; gap: 16px; }
.header-left { display: flex; align-items: center; gap: 12px; }
.header-left h2 { margin: 0; }
.user-count { font-size: 12px; }
.header-actions { display: flex; gap: 12px; }
.search-bar input { padding: 10px 16px; border: 1px solid #e2e8f0; border-radius: 8px; width: 300px; font-size: 14px; }
.search-bar input:focus { border-color: #0d9488; outline: none; }
.filter-group select { padding: 10px 16px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px; }

.empty-state { text-align: center; padding: 60px 20px; color: #64748b; }
.empty-icon { font-size: 40px; display: block; margin-bottom: 12px; }
.text-muted { color: #94a3b8; font-size: 13px; }

.loading-state { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; color: #64748b; }
.spinner { width: 40px; height: 40px; border: 4px solid #e2e8f0; border-top-color: #0d9488; border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 16px; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 768px) {
  .page-header { flex-direction: column; align-items: stretch; }
  .header-actions { flex-direction: column; }
  .search-bar input { width: 100%; }
  .filter-group select { width: 100%; }
}
</style>
