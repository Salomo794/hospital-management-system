<template>
  <div class="doctors-page">
    <div class="page-header">
      <div class="header-left">
        <span class="doctor-count" v-if="!loading">{{ total }} doctor{{ total !== 1 ? 's' : '' }}</span>
      </div>
      <div class="header-right">
        <div class="search-bar">
          <input
            type="text"
            v-model="search"
            placeholder="Search doctors..."
            @input="debouncedSearch"
          />
        </div>
        <div class="filter-group">
          <select v-model="specialtyFilter" @change="page = 1; loadDoctors()">
            <option value="">All Specialties</option>
            <option v-for="s in specialties" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </div>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="loading-container">
      <div class="spinner"></div>
      <span>Loading doctors...</span>
    </div>

    <!-- Doctors Grid -->
    <div class="doctors-grid" v-else-if="doctors.length">
      <div class="doctor-card" v-for="d in doctors" :key="d.id">
        <div class="doctor-avatar">{{ d.first_name.charAt(0) }}{{ d.last_name.charAt(0) }}</div>
        <h3>Dr. {{ d.first_name }} {{ d.last_name }}</h3>
        <p class="specialty">{{ d.specialty_name || 'General Practice' }}</p>
        <div class="doctor-details">
          <span v-if="d.qualification" class="detail-item">
            <span class="detail-icon">🎓</span> {{ d.qualification }}
          </span>
          <span v-if="d.years_of_experience" class="detail-item">
            <span class="detail-icon">⏱</span> {{ d.years_of_experience }} years experience
          </span>
          <span v-if="d.consultation_fee" class="detail-item fee">
            <span class="detail-icon">💰</span> {{ formatCurrency(d.consultation_fee) }}
          </span>
        </div>
        <div class="doctor-status">
          <span class="badge" :class="d.is_available ? 'badge-success' : 'badge-danger'">
            {{ d.is_available ? 'Available' : 'Unavailable' }}
          </span>
        </div>
        <div class="doctor-actions">
          <router-link :to="`/appointments?doctor_id=${d.id}`" class="btn btn-sm btn-primary btn-schedule">
            View Schedule
          </router-link>
        </div>
      </div>
    </div>

    <div class="pagination" v-if="total > limit">
      <button class="btn btn-sm" :disabled="page <= 1" @click="page--; loadDoctors()">Previous</button>
      <span>Page {{ page }} of {{ Math.ceil(total / limit) }}</span>
      <button class="btn btn-sm" :disabled="page >= Math.ceil(total / limit)" @click="page++; loadDoctors()">Next</button>
    </div>

    <!-- Empty State -->
    <div v-else class="empty-state">
      <div class="empty-icon">👨‍⚕️</div>
      <h4>No doctors found</h4>
      <p v-if="search || specialtyFilter">
        No doctors match your current filters.
      </p>
      <p v-else>
        No doctors are currently registered in the system.
      </p>
      <button v-if="search || specialtyFilter" class="btn btn-secondary" @click="clearFilters">
        Clear Filters
      </button>
    </div>
  </div>
</template>

<script>
import { ref, onMounted } from 'vue'
import axios from 'axios'
import { useToast } from '../../store/toast'
import { formatCurrency } from '../../utils/helpers'

export default {
  name: 'Doctors',
  setup() {
    const toast = useToast()
    const doctors = ref([])
    const total = ref(0)
    const page = ref(1)
    const limit = ref(20)
    const specialties = ref([])
    const search = ref('')
    const specialtyFilter = ref('')
    const loading = ref(false)
    let searchTimeout = null
    let requestId = 0

    const loadDoctors = async () => {
      const currentRequest = ++requestId
      loading.value = true
      try {
        const params = { page: page.value, limit: limit.value }
        if (search.value) params.search = search.value
        if (specialtyFilter.value) params.specialty_id = specialtyFilter.value
        const { data } = await axios.get('/api/doctors', { params })
        if (currentRequest !== requestId) return
        doctors.value = data.doctors
        total.value = data.total
      } catch (e) {
        toast.error('Failed to load doctors')
      } finally {
        if (currentRequest === requestId) loading.value = false
      }
    }

    const debouncedSearch = () => {
      clearTimeout(searchTimeout)
      searchTimeout = setTimeout(() => {
        page.value = 1
        loadDoctors()
      }, 300)
    }

    const clearFilters = () => {
      search.value = ''
      specialtyFilter.value = ''
      page.value = 1
      loadDoctors()
    }

    onMounted(async () => {
      loading.value = true
      try {
        const [specRes] = await Promise.all([
          axios.get('/api/doctors/specialties/all'),
          loadDoctors()
        ])
        specialties.value = specRes.data
      } catch (e) {
        toast.error('Failed to load specialties')
      } finally {
        loading.value = false
      }
    })

    return {
      doctors, total, page, limit, specialties, search, specialtyFilter, loading,
      loadDoctors, debouncedSearch, clearFilters, formatCurrency
    }
  }
}
</script>

<style scoped>
.page-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 24px;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-left h2 {
  margin: 0;
  color: var(--gray-800);
}

.doctor-count {
  font-size: 12px;
  font-weight: 600;
  color: var(--primary);
  background: var(--primary-bg);
  padding: 5px 12px;
  border-radius: 20px;
  white-space: nowrap;
}

.header-right {
  display: flex;
  gap: 12px;
  align-items: center;
}

.search-bar input {
  padding: 10px 16px;
  border: 1px solid var(--gray-200);
  border-radius: 8px;
  width: 280px;
  font-size: 14px;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.search-bar input:focus {
  outline: none;
  border-color: #0d9488;
  box-shadow: 0 0 0 3px rgba(13, 148, 136, 0.1);
}

.filter-group select {
  padding: 10px 16px;
  border: 1px solid var(--gray-200);
  border-radius: 8px;
  font-size: 14px;
  background: var(--white);
  transition: border-color 0.2s;
}

.filter-group select:focus {
  outline: none;
  border-color: #0d9488;
}

/* Loading State */
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 20px;
  color: var(--gray-500);
  gap: 12px;
}

.spinner {
  width: 36px;
  height: 36px;
  border: 3px solid var(--gray-200);
  border-top-color: #0d9488;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Doctors Grid */
.doctors-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px;
}

.doctor-card {
  background: var(--white);
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  text-align: center;
  transition: transform 0.2s, box-shadow 0.2s;
  border: 1px solid var(--gray-100);
}

.doctor-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.1);
  border-color: #99f6e4;
}

.doctor-avatar {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: linear-gradient(135deg, #0d9488, #0f4c5c);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 20px;
  margin: 0 auto 12px;
}

.doctor-card h3 {
  font-size: 16px;
  color: var(--gray-800);
  margin: 0 0 4px;
}

.specialty {
  color: #0d9488;
  font-size: 13px;
  font-weight: 500;
  margin: 0 0 12px;
}

.doctor-details {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.detail-item {
  font-size: 12px;
  color: var(--gray-500);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.detail-icon {
  font-size: 12px;
}

.detail-item.fee {
  font-weight: 600;
  color: #0d9488;
  font-size: 14px;
}

.doctor-status {
  margin-bottom: 12px;
}

.doctor-actions {
  margin-top: 8px;
}

.btn-schedule {
  width: 100%;
  text-align: center;
  display: block;
}

/* Empty State */
.empty-state {
  text-align: center;
  padding: 64px 20px;
  color: var(--gray-500);
}

.empty-icon {
  font-size: 56px;
  margin-bottom: 16px;
}

.empty-state h4 {
  margin: 0 0 8px;
  color: var(--gray-700);
}

.empty-state p {
  margin: 0 0 16px;
}

/* Responsive */
@media (max-width: 768px) {
  .page-header {
    flex-direction: column;
    align-items: stretch;
  }
  .header-right {
    flex-direction: column;
    align-items: stretch;
  }
  .search-bar input {
    width: 100%;
  }
  .filter-group select {
    width: 100%;
  }
}
</style>
