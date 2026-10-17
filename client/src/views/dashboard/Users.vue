<template>
  <div class="users-page">
    <div class="page-header">
      <div class="header-left">
        <span class="user-count badge badge-info" v-if="!loading">{{ total }} users</span>
      </div>
      <div class="header-actions">
        <div class="search-bar">
          <input type="text" v-model="search" placeholder="Search users..." aria-label="Search users" @input="debouncedLoad" />
        </div>
        <div class="filter-group">
          <select v-model="roleFilter" aria-label="Filter by role" @change="page = 1; loadUsers()">
            <option value="">All Roles</option>
            <option value="admin">Admin</option>
            <option value="doctor">Doctor</option>
            <option value="nurse">Nurse</option>
            <option value="receptionist">Receptionist</option>
            <option value="pharmacist">Pharmacist</option>
            <option value="lab_technician">Lab Technician</option>
          </select>
        </div>
        <div class="filter-group">
          <select v-model="statusFilter" aria-label="Filter by account status" @change="page = 1; loadUsers()">
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <button class="btn btn-primary add-user-btn" @click="openCreate">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
          Add User
        </button>
      </div>
    </div>

    <!-- The table frame is drawn immediately and the rows shimmer, so the page
         keeps its shape and nothing jumps when the data lands. -->
    <div v-if="loading" class="card">
      <table class="data-table">
        <thead>
          <tr><th>Name</th><th>Email</th><th>Role</th><th>Phone</th><th>Status</th><th>Last Login</th><th>Actions</th></tr>
        </thead>
        <tbody>
          <tr v-for="n in 6" :key="`skeleton-${n}`" class="skeleton-row">
            <td><span class="skeleton ske ske-name"></span></td>
            <td><span class="skeleton ske ske-email"></span></td>
            <td><span class="skeleton ske ske-chip"></span></td>
            <td><span class="skeleton ske ske-phone"></span></td>
            <td><span class="skeleton ske ske-chip"></span></td>
            <td><span class="skeleton ske ske-date"></span></td>
            <td></td>
          </tr>
        </tbody>
      </table>
      <span class="sr-only" role="status">Loading users…</span>
    </div>

    <div v-else-if="users.length === 0" class="empty-state">
      <span class="empty-icon">👥</span>
      <p>No users found.</p>
      <span class="text-muted">
        {{ hasFilters ? 'Try adjusting your search or filters.' : 'Add a user to get started.' }}
      </span>
      <button v-if="hasFilters" class="btn btn-secondary clear-filters" @click="clearFilters">
        Clear filters
      </button>
    </div>

    <div v-else class="card">
      <table class="data-table">
        <thead>
          <tr><th>Name</th><th>Email</th><th>Role</th><th>Phone</th><th>Status</th><th>Last Login</th><th>Actions</th></tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id">
            <td><strong>{{ u.first_name }} {{ u.last_name }}</strong></td>
            <td>{{ u.email }}</td>
            <td><span class="badge" :class="'badge-' + getRoleColor(u.role)">{{ formatStatusLabel(u.role) }}</span></td>
            <td>{{ u.phone || '-' }}</td>
            <td><span class="badge" :class="u.is_active ? 'badge-success' : 'badge-danger'">{{ u.is_active ? 'Active' : 'Inactive' }}</span></td>
            <td>{{ u.last_login ? formatDateTime(u.last_login) : 'Never' }}</td>
            <td>
              <div class="table-actions">
                <!-- Delete deactivates the account (the API never drops the row),
                     so the restore button is what brings a user back. The server
                     also refuses a self-delete, so the admin's own row shows a
                     quiet "You" label instead of a button that would only fail. -->
                <template v-if="u.id === authStore.user?.id">
                  <span class="self-tag">You</span>
                </template>
                <template v-else-if="u.is_active">
                  <button
                    type="button"
                    class="btn btn-sm btn-ghost btn-icon action-danger"
                    :disabled="busyId === u.id"
                    :title="`Delete ${u.first_name} ${u.last_name}`"
                    :aria-label="`Delete ${u.first_name} ${u.last_name}`"
                    @click="deleteUser(u)"
                  >
                    <AppIcon name="trash" :size="15" :class="{ spinning: busyId === u.id }" />
                  </button>
                </template>
                <template v-else>
                  <button
                    type="button"
                    class="btn btn-sm btn-ghost btn-icon action-success"
                    :disabled="busyId === u.id"
                    :title="`Restore access for ${u.first_name} ${u.last_name}`"
                    :aria-label="`Restore access for ${u.first_name} ${u.last_name}`"
                    @click="restoreUser(u)"
                  >
                    <AppIcon name="user-check" :size="15" :class="{ spinning: busyId === u.id }" />
                  </button>
                </template>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="pagination" v-if="total > limit">
        <button class="btn btn-sm" :disabled="page <= 1" @click="page--; loadUsers()">Previous</button>
        <span>Page {{ page }} of {{ Math.ceil(total / limit) }}</span>
        <button class="btn btn-sm" :disabled="page >= Math.ceil(total / limit)" @click="page++; loadUsers()">Next</button>
      </div>
    </div>

    <!-- ──── ADD USER MODAL ──── -->
    <div class="modal-overlay" v-if="showCreate" @click.self="showCreate = false">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="add-user-title">
        <div class="modal-header">
          <h2 id="add-user-title">Add New User</h2>
          <button class="modal-close" type="button" @click="showCreate = false" aria-label="Close">✕</button>
        </div>
        <form @submit.prevent="createUser">
          <div class="modal-body">
            <div class="form-row">
              <div class="form-group">
                <label for="nu-first">First name *</label>
                <input id="nu-first" type="text" v-model.trim="form.first_name" required autocomplete="off" />
              </div>
              <div class="form-group">
                <label for="nu-last">Last name *</label>
                <input id="nu-last" type="text" v-model.trim="form.last_name" required autocomplete="off" />
              </div>
            </div>
            <div class="form-group">
              <label for="nu-email">Email *</label>
              <input id="nu-email" type="email" v-model.trim="form.email" required autocomplete="off" />
            </div>
            <div class="form-row">
              <div class="form-group">
                <label for="nu-role">Role *</label>
                <select id="nu-role" v-model="form.role" required>
                  <option value="" disabled>Select a role</option>
                  <option value="admin">Admin</option>
                  <option value="doctor">Doctor</option>
                  <option value="nurse">Nurse</option>
                  <option value="receptionist">Receptionist</option>
                  <option value="pharmacist">Pharmacist</option>
                  <option value="lab_technician">Lab Technician</option>
                </select>
              </div>
              <div class="form-group">
                <label for="nu-phone">Phone</label>
                <!-- pattern and inputmode make the browser hold the same line as
                     the API: digits only. A mobile keypad is offered on a phone,
                     and letters are refused before the request is sent. -->
                <input
                  id="nu-phone" type="tel" v-model.trim="form.phone" placeholder="Digits only, e.g. 0788123456"
                  inputmode="numeric" pattern="[0-9]*" :maxlength="PHONE_MAX_DIGITS" autocomplete="off"
                />
                <span class="field-error" v-if="phoneProblem">{{ phoneProblem }}</span>
              </div>
            </div>
            <div class="form-group">
              <label for="nu-password">Password *</label>
              <div class="input-wrap">
                <input
                  id="nu-password"
                  :type="showPassword ? 'text' : 'password'"
                  v-model="form.password"
                  required
                  :minlength="PASSWORD_MIN_LENGTH"
                  :maxlength="PASSWORD_MAX_LENGTH"
                  autocomplete="new-password"
                  :aria-describedby="'nu-password-help'"
                />
                <!-- An admin has to read this password to pass it to the new
                     member of staff, which is the whole reason this form exists. -->
                <button
                  type="button" class="reveal"
                  @click="showPassword = !showPassword"
                  :aria-label="showPassword ? 'Hide password' : 'Show password'"
                  :title="showPassword ? 'Hide password' : 'Show password'"
                >
                  <span v-html="showPassword ? icons.eyeOff : icons.eye" />
                </button>
              </div>
              <div class="strength-meter" :id="'nu-password-help'">
                <div class="strength-bar"><span :class="strengthClass" :style="{ width: strengthPercent }" /></div>
                <span class="strength-label">{{ strengthLabel }}</span>
              </div>
              <ul v-if="passwordProblems.length" class="policy-list">
                <li v-for="problem in passwordProblems" :key="problem">{{ problem }}</li>
              </ul>
              <span v-else class="form-hint">
                At least {{ PASSWORD_MIN_LENGTH }} characters. A short passphrase beats a short complex word.
              </span>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" @click="showCreate = false">Cancel</button>
            <button type="submit" class="btn btn-primary" :disabled="creating">
              {{ creating ? 'Creating…' : 'Create User' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, reactive, computed, onMounted } from 'vue'
import axios from 'axios'
import { useToast } from '../../store/toast'
import { useConfirm } from '../../store/confirm'
import { useAuthStore } from '../../store/auth'
import { formatDateTime, getStatusLabel, debounce } from '../../utils/helpers'
import {
  validatePassword, passwordStrength, MIN_LENGTH as PASSWORD_MIN_LENGTH, MAX_LENGTH as PASSWORD_MAX_LENGTH
} from '../../utils/passwordPolicy'
import { phoneProblem as checkPhone, PHONE_MAX_DIGITS } from '../../utils/phone'
import AppIcon from '../../components/AppIcon.vue'

// The same eye pair the sign-in and reset screens use, so the control looks the
// same wherever a password is typed.
const s = body =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
const icons = {
  eye: s('<path d="M2.2 12S5.6 5.5 12 5.5 21.8 12 21.8 12 18.4 18.5 12 18.5 2.2 12 2.2 12Z"/><circle cx="12" cy="12" r="3.1"/>'),
  eyeOff: s('<path d="M9.9 5.7A9.6 9.6 0 0 1 12 5.5c6.4 0 9.8 6.5 9.8 6.5a17.6 17.6 0 0 1-3.4 4.2"/><path d="M6.4 7.4A17.4 17.4 0 0 0 2.2 12S5.6 18.5 12 18.5a9.7 9.7 0 0 0 4.2-.9"/><path d="M9.9 9.9a3.1 3.1 0 0 0 4.3 4.3"/><path d="M3 3l18 18"/>'),
}

export default {
  name: 'Users',
  components: { AppIcon },
  setup() {
    const toast = useToast()
    const { confirm } = useConfirm()
    const authStore = useAuthStore()
    const users = ref([])
    const total = ref(0)
    const page = ref(1)
    const limit = ref(20)
    const search = ref('')
    const roleFilter = ref('')
    const statusFilter = ref('')
    const loading = ref(true)

    /* ── create-user modal ── */
    const showCreate = ref(false)
    const creating = ref(false)
    // Cleared when the modal opens, so a password left visible by the last use is
    // not still on screen for the next person who opens this.
    const showPassword = ref(false)
    const emptyForm = () => ({
      first_name: '', last_name: '', email: '',
      password: '', role: '', phone: ''
    })
    const form = reactive(emptyForm())

    const openCreate = () => {
      Object.assign(form, emptyForm())
      showPassword.value = false
      showCreate.value = true
    }

    // Checked as they type so a rejected password is explained before the
    // request is sent. The server applies the same rules and has the final say.
    const passwordProblems = computed(() => {
      if (!form.password) return []
      return validatePassword(form.password, {
        email: form.email,
        firstName: form.first_name,
        lastName: form.last_name
      })
    })
    const strength = computed(() => passwordStrength(form.password))
    const strengthLabel = computed(() => strength.value.label)
    const strengthClass = computed(() => `strength-${strength.value.score}`)
    const strengthPercent = computed(() => `${(strength.value.score / 4) * 100}%`)
    const phoneProblem = computed(() => checkPhone(form.phone))

    const createUser = async () => {
      if (creating.value) return
      if (passwordProblems.value.length > 0) {
        toast.warning('Choose a password that meets the listed requirements.')
        return
      }
      if (phoneProblem.value) {
        toast.warning(phoneProblem.value)
        return
      }
      creating.value = true
      try {
        await axios.post('/api/auth/register', {
          first_name: form.first_name,
          last_name: form.last_name,
          email: form.email,
          password: form.password,
          role: form.role,
          phone: form.phone.trim() || null
        })
        toast.success(`User ${form.first_name} ${form.last_name} created.`)
        showCreate.value = false
        loadUsers()
      } catch (e) {
        const data = e.response?.data
        const msg = data?.message
          || data?.errors?.map(err => err.msg).join(', ')
          || 'Failed to create user.'
        toast.error(msg)
      } finally {
        creating.value = false
      }
    }

    /* ── delete / restore ── */
    // The API deactivates rather than drops the row, so appointments, audit
    // entries and anything else pointing at this user keep their history.
    const busyId = ref(null)
    const deleteUser = async (u) => {
      if (busyId.value) return
      const yes = await confirm({
        title:        'Delete User',
        message:      `Are you sure you want to delete ${u.first_name} ${u.last_name}? They will no longer be able to sign in, and you can restore them later from this list.`,
        confirmText:  'Delete',
        confirmClass: 'btn-danger',
      })
      if (!yes) return
      busyId.value = u.id
      try {
        await axios.delete(`/api/users/${u.id}`)
        // The undo travels in the toast instead of a second dialog: the list
        // reloads straight away and a mis-click is one tap away from undone.
        toast.warning(`User ${u.first_name} ${u.last_name} deleted.`, {
          label: 'Undo',
          onClick: () => restoreUser(u, { silentBusy: true }),
        })
        loadUsers()
      } catch (e) {
        toast.error(e.response?.data?.message || 'Failed to delete user.')
      } finally {
        busyId.value = null
      }
    }

    const restoreUser = async (u, { silentBusy = false } = {}) => {
      if (busyId.value) return
      if (!silentBusy) busyId.value = u.id
      try {
        await axios.put(`/api/users/${u.id}`, { is_active: true })
        toast.success(`Access restored for ${u.first_name} ${u.last_name}.`)
        loadUsers()
      } catch (e) {
        toast.error(e.response?.data?.message || 'Failed to restore user.')
      } finally {
        busyId.value = null
      }
    }

    let requestId = 0
    const loadUsers = async () => {
      const currentRequest = ++requestId
      loading.value = true
      try {
        const params = { page: page.value, limit: limit.value }
        if (search.value) params.search = search.value
        if (roleFilter.value) params.role = roleFilter.value
        if (statusFilter.value) params.status = statusFilter.value
        const { data } = await axios.get('/api/users', { params })
        if (currentRequest !== requestId) return
        users.value = data.users
        total.value = data.total
      } catch (e) {
        toast.error('Failed to load users.')
      } finally {
        if (currentRequest === requestId) loading.value = false
      }
    }

    const debouncedLoad = debounce(() => {
      page.value = 1
      loadUsers()
    }, 300)

    // Drives the empty state, so a zero-result screen offers a way out instead
    // of leaving the admin to spot which control they set.
    const hasFilters = computed(() => !!(search.value || roleFilter.value || statusFilter.value))
    const clearFilters = () => {
      search.value = ''
      roleFilter.value = ''
      statusFilter.value = ''
      page.value = 1
      loadUsers()
    }

    const getRoleColor = (role) => {
      const map = { admin: 'danger', doctor: 'info', nurse: 'success', receptionist: 'warning', pharmacist: 'info', lab_technician: 'info' }
      return map[role] || 'info'
    }

    const formatStatusLabel = (status) => getStatusLabel(status)

    onMounted(loadUsers)
    return {
      users, total, page, limit, search, roleFilter, loading, loadUsers, debouncedLoad,
      getRoleColor, formatDateTime, formatStatusLabel,
      showCreate, creating, form, openCreate, createUser, showPassword, icons,
      deleteUser, restoreUser, busyId, authStore,
      statusFilter, hasFilters, clearFilters,
      passwordProblems, strengthLabel, strengthClass, strengthPercent,
      phoneProblem, PHONE_MAX_DIGITS,
      PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH
    }
  }
}
</script>

<style scoped>
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; gap: 16px; }
.header-left { display: flex; align-items: center; gap: 12px; }
.header-left h2 { margin: 0; }
.user-count { font-size: 12px; }
.header-actions { display: flex; gap: 12px; }
.search-bar input { padding: 10px 16px; border: 1px solid var(--gray-200); border-radius: 8px; width: 300px; font-size: 14px; }
.search-bar input:focus { border-color: var(--focus-ring); outline: none; }
.filter-group select { padding: 10px 16px; border: 1px solid var(--gray-200); border-radius: 8px; font-size: 14px; background: var(--white); color: var(--gray-700); }
.add-user-btn { white-space: nowrap; }
.add-user-btn svg { width: 15px; height: 15px; }

.strength-meter { display: flex; align-items: center; gap: 10px; margin-top: 6px; }.strength-bar { flex: 1; height: 5px; background: var(--gray-200); border-radius: 3px; overflow: hidden; }
.strength-bar span { display: block; height: 100%; border-radius: 3px; transition: width .2s ease, background .2s ease; }
.strength-0 { background: #dc2626; }
.strength-1 { background: #ea580c; }
.strength-2 { background: #ca8a04; }
.strength-3 { background: #0d9488; }
.strength-4 { background: #15803d; }
.strength-label { font-size: 11px; color: var(--text-muted); min-width: 58px; }
.policy-list { margin: 8px 0 0; padding-left: 18px; font-size: 12px; color: var(--gray-600); }
.policy-list li { margin-bottom: 2px; }
.field-error { display: block; margin-top: 4px; font-size: 12px; color: var(--danger, #b91c1c); }

/* Password reveal, styled to match the sign-in and reset screens */
.input-wrap { position: relative; display: flex; align-items: center; }
.input-wrap input { padding-right: 44px; }
.reveal {
  position: absolute; right: 8px;
  display: flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; padding: 0;
  background: none; border: none; border-radius: 7px;
  color: var(--text-subtle); cursor: pointer;
}
.reveal:hover { color: var(--brand-600, #0d9488); background: var(--brand-50, #f0fdfa); }
.reveal :deep(svg) { width: 17px; height: 17px; }

.table-actions { display: flex; gap: 2px; align-items: center; }
.table-actions .btn-icon { color: var(--text-subtle); }
.action-danger:hover:not(:disabled) { color: var(--danger); background: var(--danger-bg); }
.action-success:hover:not(:disabled) { color: var(--success); background: var(--success-bg); }
.spinning :deep(.app-icon) { animation: spin .8s linear infinite; }
.self-tag {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-subtle);
  background: var(--gray-100);
  border-radius: var(--radius-full);
  padding: 3px 10px;
}

.empty-state { text-align: center; padding: 60px 20px; color: var(--text-muted); }
.empty-state .clear-filters { margin-top: 16px; }
.sr-only {
  position: absolute; width: 1px; height: 1px;
  padding: 0; margin: -1px; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

/* Loading rows keep the table layout, then shimmer in place */
.skeleton-row td { padding: 16px 14px; }
.skeleton-row .ske { display: block; height: 13px; border-radius: var(--radius-sm); }
.ske-name  { width: 130px; }
.ske-email { width: 170px; }
.ske-chip  { width: 64px; height: 20px; border-radius: var(--radius-full); }
.ske-phone { width: 100px; }
.ske-date  { width: 120px; }
.empty-icon { font-size: 40px; display: block; margin-bottom: 12px; }
.text-muted { color: var(--text-subtle); font-size: 13px; }

@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 768px) {
  .page-header { flex-direction: column; align-items: stretch; }
  .header-actions { flex-direction: column; }
  .search-bar input { width: 100%; }
  .filter-group select { width: 100%; }
}
</style>
