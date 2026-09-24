<template>
  <div class="reports-page">
    <div class="page-header">
      <div class="tabs-inline">
        <button :class="{ active: activeTab === 'overview' }" @click="switchTab('overview')">Overview</button>
        <button v-if="authStore.can('admin')" :class="{ active: activeTab === 'financial' }" @click="switchTab('financial')">Financial</button>
        <button :class="{ active: activeTab === 'patients' }" @click="switchTab('patients')">Patient Stats</button>
      </div>
    </div>

    <!-- Overview Tab -->
    <div v-if="activeTab === 'overview'">
      <div v-if="loadingOverview" class="loading-spinner">
        <div class="spinner"></div>
        <p>Loading dashboard data...</p>
      </div>
      <template v-else>
        <div v-if="!stats.totalPatients && stats.totalPatients !== 0" class="empty-state">
          <span class="empty-icon">&#128202;</span>
          <h3>No Overview Data</h3>
          <p>Dashboard data will appear here once available.</p>
        </div>
        <template v-else>
          <div class="stats-grid">
            <div class="stats-card" style="border-left: 4px solid #0d9488;">
              <div class="stats-value">{{ stats.totalPatients || 0 }}</div>
              <div class="stats-label">Total Active Patients</div>
            </div>
            <div class="stats-card" style="border-left: 4px solid #3b82f6;">
              <div class="stats-value">{{ stats.totalDoctors || 0 }}</div>
              <div class="stats-label">Active Doctors</div>
            </div>
            <div class="stats-card" style="border-left: 4px solid #8b5cf6;">
              <div class="stats-value">{{ stats.todayAppointments || 0 }}</div>
              <div class="stats-label">Today's Appointments</div>
            </div>
            <div class="stats-card" style="border-left: 4px solid #10b981;">
              <div class="stats-value">{{ formatCurrency(stats.monthlyRevenue || 0) }}</div>
              <div class="stats-label">Monthly Revenue</div>
            </div>
          </div>
          <div class="card" style="margin-top:20px">
            <div class="card-header"><h3>Weekly Appointment Trend</h3></div>
            <div class="card-body">
              <div v-if="weeklyStats.length" class="chart-wrap">
                <BarChart :key="uiStore.dark ? 'dark' : 'light'" :data="weeklyChartData" :options="barOptions" />
              </div>
              <div v-else class="empty-state">
                <span class="empty-icon">&#128197;</span>
                <h3>No Weekly Data</h3>
                <p>Weekly appointment trends will appear here.</p>
              </div>
            </div>
          </div>
        </template>
      </template>
    </div>

    <!-- Financial Tab -->
    <div v-if="activeTab === 'financial' && authStore.can('admin')">
      <div class="filter-bar">
        <select v-model="period" @change="loadFinancial">
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
        <input type="number" v-model="year" :min="2020" :max="2030" @change="loadFinancial" />
      </div>

      <div v-if="loadingFinancial" class="loading-spinner">
        <div class="spinner"></div>
        <p>Loading financial data...</p>
      </div>
      <template v-else>
        <div class="financial-summary">
          <div class="summary-card summary-revenue">
            <div class="summary-label">Total Revenue</div>
            <div class="summary-value">{{ formatCurrency(totalRevenue) }}</div>
          </div>
          <div class="summary-card summary-expenses">
            <div class="summary-label">Total Expenses</div>
            <div class="summary-value">{{ formatCurrency(totalExpenses) }}</div>
          </div>
          <div class="summary-card summary-net">
            <div class="summary-label">Net Income</div>
            <div class="summary-value" :class="netIncome >= 0 ? 'positive' : 'negative'">{{ formatCurrency(netIncome) }}</div>
          </div>
        </div>

        <div class="report-grid">
          <div class="card">
            <div class="card-header"><h3>Revenue by Period</h3></div>
            <div class="card-body">
              <div v-if="financial.revenue && financial.revenue.length">
                <div v-for="(r, idx) in groupedRevenue" :key="idx" class="report-row">
                  <span class="row-label">{{ r.period }}</span>
                  <span class="row-value">{{ formatCurrency(r.revenue) }}</span>
                  <span class="row-sub">{{ r.transaction_count }} transactions</span>
                </div>
              </div>
              <div v-else class="empty-state">
                <span class="empty-icon">&#128176;</span>
                <h3>No Revenue Data</h3>
                <p>Revenue by period will appear here.</p>
              </div>
            </div>
          </div>
          <div class="card">
            <div class="card-header"><h3>Revenue by Category</h3></div>
            <div class="card-body">
              <div v-if="financial.topServices && financial.topServices.length">
                <div class="chart-wrap doughnut-wrap">
                  <DoughnutChart :key="uiStore.dark ? 'dark' : 'light'" :data="categoryChartData" :options="chartOptions" />
                </div>
                <div v-for="s in financial.topServices" :key="s.category" class="report-row">
                  <span class="row-label">{{ formatCategory(s.category) }}</span>
                  <span class="row-value">{{ formatCurrency(s.collected_revenue) }}</span>
                  <span class="row-sub">{{ s.count }} items</span>
                </div>
              </div>
              <div v-else class="empty-state">
                <span class="empty-icon">&#128203;</span>
                <h3>No Service Data</h3>
                <p>Revenue by category will appear here.</p>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- Patient Stats Tab -->
    <div v-if="activeTab === 'patients'">
      <div v-if="loadingPatients" class="loading-spinner">
        <div class="spinner"></div>
        <p>Loading patient statistics...</p>
      </div>
      <div v-else-if="!hasPatientData" class="empty-state">
        <span class="empty-icon">&#128100;</span>
        <h3>No Patient Statistics</h3>
        <p>Patient statistics will appear here once data is available.</p>
      </div>
      <div v-else class="report-grid">
        <div class="card">
          <div class="card-header"><h3>By Gender</h3></div>
          <div class="card-body">
            <div v-for="g in patientStats.byGender" :key="g.gender" class="report-row">
              <span class="row-label">{{ g.gender }}</span>
              <span class="row-value">{{ g.count }}</span>
              <div class="progress-wrap">
                <div class="progress-bar">
                  <div class="progress-fill" :style="{ width: (g.count / totalPatients * 100) + '%', background: g.gender === 'male' ? '#3b82f6' : '#ec4899' }"></div>
                </div>
                <span class="progress-pct">{{ Math.round(g.count / totalPatients * 100) }}%</span>
              </div>
            </div>
            <div v-if="!patientStats.byGender || !patientStats.byGender.length" class="empty-state-sm">
              <p>No gender data available.</p>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3>By Age Group</h3></div>
          <div class="card-body">
            <div v-for="a in patientStats.byAge" :key="a.age_group" class="report-row">
              <span class="row-label">{{ a.age_group }}</span>
              <span class="row-value">{{ a.count }}</span>
              <div class="progress-wrap">
                <div class="progress-bar">
                  <div class="progress-fill" :style="{ width: (a.count / totalPatients * 100) + '%', background: '#0d9488' }"></div>
                </div>
                <span class="progress-pct">{{ Math.round(a.count / totalPatients * 100) }}%</span>
              </div>
            </div>
            <div v-if="!patientStats.byAge || !patientStats.byAge.length" class="empty-state-sm">
              <p>No age data available.</p>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3>By Blood Type</h3></div>
          <div class="card-body">
            <div v-for="b in patientStats.byBloodType" :key="b.blood_type" class="report-row">
              <span class="row-label">{{ b.blood_type }}</span>
              <span class="row-value">{{ b.count }}</span>
              <div class="progress-wrap">
                <div class="progress-bar">
                  <div class="progress-fill" :style="{ width: (b.count / totalPatients * 100) + '%', background: '#8b5cf6' }"></div>
                </div>
                <span class="progress-pct">{{ Math.round(b.count / totalPatients * 100) }}%</span>
              </div>
            </div>
            <div v-if="!patientStats.byBloodType || !patientStats.byBloodType.length" class="empty-state-sm">
              <p>No blood type data available.</p>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3>Top Diagnoses</h3></div>
          <div class="card-body">
            <div v-for="(d, idx) in patientStats.topDiagnoses" :key="d.diagnosis" class="report-row">
              <span class="row-label">
                <span class="diagnosis-rank">{{ idx + 1 }}</span>
                {{ d.diagnosis }}
              </span>
              <span class="row-value">{{ d.count }}</span>
              <div class="progress-wrap">
                <div class="progress-bar">
                  <div class="progress-fill" :style="{ width: (d.count / maxDiagnosisCount * 100) + '%', background: '#f59e0b' }"></div>
                </div>
                <span class="progress-pct">{{ Math.round(d.count / maxDiagnosisCount * 100) }}%</span>
              </div>
            </div>
            <div v-if="!patientStats.topDiagnoses || !patientStats.topDiagnoses.length" class="empty-state-sm">
              <p>No diagnosis data yet.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted } from 'vue'
import axios from 'axios'
import { useToast } from '../../store/toast'
import { useUiStore } from '../../store/ui'
import { useAuthStore } from '../../store/auth'
import { formatDate, formatCurrency } from '../../utils/helpers'

export default {
  name: 'Reports',
  setup() {
    const toast = useToast()
    const uiStore = useUiStore()
    const authStore = useAuthStore()
    const activeTab = ref('overview')
    const stats = ref({})
    const weeklyStats = ref([])
    const period = ref('monthly')
    const year = ref(new Date().getFullYear())
    const financial = ref({ revenue: [], expenses: [], topServices: [] })
    const patientStats = ref({ byGender: [], byAge: [], byBloodType: [], topDiagnoses: [] })
    const loadingOverview = ref(false)
    const loadingFinancial = ref(false)
    const loadingPatients = ref(false)

    const totalPatients = computed(() => patientStats.value.byGender.reduce((s, g) => s + g.count, 0) || 1)
    const maxDiagnosisCount = computed(() => {
      if (!patientStats.value.topDiagnoses || !patientStats.value.topDiagnoses.length) return 1
      return Math.max(...patientStats.value.topDiagnoses.map(d => d.count), 1)
    })

    const hasPatientData = computed(() => {
      return (patientStats.value.byGender && patientStats.value.byGender.length) ||
        (patientStats.value.byAge && patientStats.value.byAge.length) ||
        (patientStats.value.byBloodType && patientStats.value.byBloodType.length) ||
        (patientStats.value.topDiagnoses && patientStats.value.topDiagnoses.length)
    })

    const totalRevenue = computed(() => {
      return groupedRevenue.value.reduce((s, r) => s + r.revenue, 0)
    })

    const totalExpenses = computed(() => {
      if (!financial.value.expenses || !financial.value.expenses.length) return 0
      return financial.value.expenses.reduce((s, e) => s + parseFloat(e.expenses || 0), 0)
    })

    const netIncome = computed(() => totalRevenue.value - totalExpenses.value)

    const groupedRevenue = computed(() => {
      const map = {}
      financial.value.revenue.forEach(r => {
        if (!map[r.period]) map[r.period] = { period: r.period, revenue: 0, transaction_count: 0 }
        map[r.period].revenue += parseFloat(r.revenue)
        map[r.period].transaction_count += r.transaction_count
      })
      return Object.values(map).sort((a, b) => b.period.localeCompare(a.period))
    })

    const formatDay = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en', { weekday: 'short' })
    const formatCategory = (c) => c ? c.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()) : ''

    const weeklyChartData = computed(() => ({
      labels: weeklyStats.value.map(d => formatDay(d.date)),
      datasets: [
        {
          label: 'Completed',
          data: weeklyStats.value.map(d => d.completed || 0),
          backgroundColor: '#10b981',
          borderRadius: 6,
          maxBarThickness: 32
        },
        {
          label: 'Cancelled',
          data: weeklyStats.value.map(d => d.cancelled || 0),
          backgroundColor: '#f59e0b',
          borderRadius: 6,
          maxBarThickness: 32
        }
      ]
    }))

    const barOptions = computed(() => {
      const dark = uiStore.dark
      return {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            ticks: { precision: 0, color: dark ? '#8b95a5' : '#64748b' },
            grid: { color: dark ? '#2a3444' : '#f1f5f9', drawBorder: false }
          },
          x: { grid: { display: false }, ticks: { color: dark ? '#8b95a5' : '#64748b' } }
        },
        plugins: {
          legend: { labels: { font: { family: 'Inter, sans-serif' }, usePointStyle: true, boxWidth: 8, color: dark ? '#c6cedb' : '#475569' } },
          tooltip: { backgroundColor: dark ? '#0a1019' : '#0f172a', padding: 12, cornerRadius: 8 }
        }
      }
    })

    const categoryChartData = computed(() => {
      const dark = uiStore.dark
      return {
        labels: (financial.value.topServices || []).map(s => formatCategory(s.category)),
        datasets: [{
          label: 'Revenue',
          data: (financial.value.topServices || []).map(s => parseFloat(s.collected_revenue) || 0),
          backgroundColor: ['#0d9488', '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4'],
          borderWidth: 2,
          borderColor: dark ? '#111823' : '#ffffff'
        }]
      }
    })

    const chartOptions = computed(() => {
      const dark = uiStore.dark
      return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { font: { family: 'Inter, sans-serif' }, usePointStyle: true, boxWidth: 8, padding: 14, color: dark ? '#c6cedb' : '#475569' } },
          tooltip: {
            backgroundColor: dark ? '#0a1019' : '#0f172a',
            padding: 12,
            cornerRadius: 8,
            callbacks: {
              label: (ctx) => ` ${ctx.label}: ${formatCurrency(ctx.parsed)}`
            }
          }
        }
      }
    })

    const loadDashboard = async () => {
      loadingOverview.value = true
      try {
        const { data } = await axios.get('/api/reports/dashboard')
        stats.value = data.stats
        weeklyStats.value = data.weeklyStats || []
      } catch (e) {
        toast.error('Failed to load dashboard data')
      } finally {
        loadingOverview.value = false
      }
    }

    const loadFinancial = async () => {
      loadingFinancial.value = true
      try {
        const { data } = await axios.get('/api/reports/financial', { params: { period: period.value, year: year.value } })
        financial.value = data
      } catch (e) {
        toast.error('Failed to load financial data')
      } finally {
        loadingFinancial.value = false
      }
    }

    const loadPatientStats = async () => {
      loadingPatients.value = true
      try {
        const { data } = await axios.get('/api/reports/patients')
        patientStats.value = data
      } catch (e) {
        toast.error('Failed to load patient statistics')
      } finally {
        loadingPatients.value = false
      }
    }

    const switchTab = tab => {
      if (tab === 'financial' && !authStore.can('admin')) return
      activeTab.value = tab
      if (tab === 'overview' && !stats.value.totalPatients && stats.value.totalPatients !== 0) loadDashboard()
      if (tab === 'financial' && !financial.value.revenue.length) loadFinancial()
      if (tab === 'patients' && !patientStats.value.byGender.length) loadPatientStats()
    }

    onMounted(loadDashboard)
    return {
      activeTab, stats, weeklyStats, period, year, financial, patientStats,
      totalPatients, maxDiagnosisCount, hasPatientData,
      totalRevenue, totalExpenses, netIncome, groupedRevenue,
      weeklyChartData, categoryChartData, barOptions, chartOptions, uiStore, authStore,
      formatDate, formatCurrency, formatDay, formatCategory,
      loadFinancial, loadPatientStats, switchTab,
      loadingOverview, loadingFinancial, loadingPatients
    }
  }
}
</script>

<style scoped>
.page-header { margin-bottom: 20px; }
.tabs-inline { display: flex; gap: 0; }
.tabs-inline button { padding: 10px 20px; border: 1px solid var(--gray-200); background: var(--white); cursor: pointer; font-size: 14px; transition: all 0.2s; }
.tabs-inline button:first-child { border-radius: 8px 0 0 8px; }
.tabs-inline button:last-child { border-radius: 0 8px 8px 0; }
.tabs-inline button.active { background: #0d9488; color: white; border-color: #0d9488; }
.tabs-inline button:hover:not(.active) { background: var(--brand-50); border-color: #0d9488; color: #0d9488; }

.stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
.stats-card { background: var(--white); padding: 20px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); transition: transform 0.2s, box-shadow 0.2s; }
.stats-card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.12); }
.stats-value { font-size: 24px; font-weight: 700; color: var(--gray-800); }
.stats-label { font-size: 13px; color: var(--gray-500); margin-top: 4px; }

.chart-wrap { height: 240px; }
.doughnut-wrap { height: 220px; margin-bottom: 8px; }

.filter-bar { display: flex; gap: 12px; margin-bottom: 20px; }
.filter-bar select, .filter-bar input { padding: 10px 12px; border: 1px solid var(--gray-200); border-radius: 8px; font-size: 14px; outline: none; transition: border-color 0.2s; }
.filter-bar select:focus, .filter-bar input:focus { border-color: #0d9488; }

.financial-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 20px; }
.summary-card { background: var(--white); padding: 20px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); text-align: center; }
.summary-card.summary-revenue { border-top: 3px solid #10b981; }
.summary-card.summary-expenses { border-top: 3px solid #ef4444; }
.summary-card.summary-net { border-top: 3px solid #3b82f6; }
.summary-label { font-size: 13px; color: var(--gray-500); margin-bottom: 6px; font-weight: 500; }
.summary-value { font-size: 22px; font-weight: 700; color: var(--gray-800); }
.summary-value.positive { color: #10b981; }
.summary-value.negative { color: #ef4444; }

.report-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.report-row { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--gray-100); }
.report-row:last-child { border-bottom: none; }
.row-label { flex: 1; font-size: 14px; color: var(--gray-700); display: flex; align-items: center; gap: 8px; }
.row-value { font-weight: 600; font-size: 14px; color: var(--gray-800); min-width: 80px; text-align: right; }
.row-sub { font-size: 12px; color: var(--gray-400); min-width: 80px; text-align: right; }

.progress-wrap { flex: 1.5; display: flex; align-items: center; gap: 8px; }
.progress-bar { flex: 1; height: 8px; background: var(--gray-200); border-radius: 4px; overflow: hidden; }
.progress-fill { height: 100%; border-radius: 4px; transition: width 0.5s ease; }
.progress-pct { font-size: 11px; font-weight: 600; color: var(--gray-500); min-width: 32px; text-align: right; }

.diagnosis-rank { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; background: var(--gray-100); font-size: 11px; font-weight: 700; color: var(--gray-500); flex-shrink: 0; }

.empty-state { text-align: center; padding: 48px 20px; }
.empty-icon { font-size: 48px; display: block; margin-bottom: 12px; opacity: 0.6; }
.empty-state h3 { font-size: 16px; font-weight: 600; color: var(--gray-600); margin: 0 0 6px; }
.empty-state p { font-size: 13px; color: var(--gray-400); margin: 0; }

.empty-state-sm { text-align: center; padding: 20px; color: var(--gray-400); font-size: 13px; }

.loading-spinner { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; }
.spinner { width: 36px; height: 36px; border: 3px solid var(--gray-200); border-top-color: #0d9488; border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 12px; }
@keyframes spin { to { transform: rotate(360deg); } }
.loading-spinner p { color: var(--gray-400); font-size: 14px; margin: 0; }

.card { background: var(--white); border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); overflow: hidden; }
.card-header { padding: 16px 20px; border-bottom: 1px solid var(--gray-100); }
.card-header h3 { margin: 0; font-size: 15px; font-weight: 600; color: var(--gray-800); }
.card-body { padding: 16px 20px; }

.text-muted { color: var(--gray-400); text-align: center; padding: 20px; }

@media (max-width: 1024px) {
  .stats-grid { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 768px) {
  .stats-grid, .report-grid, .financial-summary { grid-template-columns: 1fr; }
  .tabs-inline { width: 100%; }
  .tabs-inline button { flex: 1; padding: 10px 12px; justify-content: center; }
  .filter-bar { flex-direction: column; align-items: stretch; }
  .filter-bar select, .filter-bar input { width: 100%; }
}

@media (max-width: 576px) {
  .tabs-inline { overflow-x: auto; white-space: nowrap; }
  .tabs-inline button { flex: none; }
}
</style>
