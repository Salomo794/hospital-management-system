<template>
  <div class="dashboard">

    <!-- Header row -->
    <div class="dash-header">
      <div>
        <h1 class="dash-title">Good {{ greeting }}, {{ firstName }} 👋</h1>
        <p class="dash-sub">Here's what's happening at the hospital today.</p>
      </div>
      <div class="dash-header-actions">
        <router-link to="/ai-assistant" class="btn btn-ghost btn-sm">
          <span class="btn-icon-inline">✨</span> AI Assistant
        </router-link>
        <router-link to="/reports" class="btn btn-primary btn-sm">
          <span class="btn-icon-inline">📊</span> View Reports
        </router-link>
      </div>
    </div>

    <!-- Loading skeleton -->
    <template v-if="loading">
      <div class="stats-grid mb-4">
        <div v-for="i in 8" :key="i" class="skeleton-card">
          <div class="skeleton skeleton-avatar mb-2" />
          <div class="skeleton skeleton-title" />
          <div class="skeleton skeleton-text" style="width:55%" />
        </div>
      </div>
    </template>

    <template v-else>
      <!-- Stats grid -->
      <div class="stats-grid mb-4">
        <div
          class="stat-card"
          v-for="s in statCards"
          :key="s.label"
        >
          <div class="stat-icon" :style="{ background: s.gradient }">
            <span class="stat-emoji">{{ s.icon }}</span>
          </div>
          <div class="stat-body">
            <div class="stat-value">{{ s.value }}</div>
            <div class="stat-label">{{ s.label }}</div>
          </div>
          <div class="stat-trend" :class="s.trend > 0 ? 'trend-up' : s.trend < 0 ? 'trend-down' : 'trend-flat'" v-if="s.trend !== undefined">
            {{ s.trend > 0 ? '▲' : s.trend < 0 ? '▼' : '—' }}
            {{ s.trend !== 0 ? Math.abs(s.trend) + '%' : '' }}
          </div>
        </div>
      </div>

      <!-- Main content grid -->
      <div class="dash-grid">

        <!-- Smart insights — full width -->
        <div class="card dash-insights" v-if="insights.length">
          <div class="card-header">
            <div class="d-flex align-center gap-2">
              <span class="section-badge">✨</span>
              <h3>Smart Insights</h3>
            </div>
            <span class="chip chip-teal">AI-powered</span>
          </div>
          <div class="card-body">
            <div class="insights-grid">
              <router-link
                v-for="(ins, i) in insights"
                :key="i"
                :to="ins.link || '#'"
                class="insight-card"
                :class="`insight-${ins.severity}`"
              >
                <span class="insight-emoji">{{ ins.icon }}</span>
                <div class="insight-body">
                  <div class="insight-title">{{ ins.title }}</div>
                  <div class="insight-msg">{{ ins.message }}</div>
                </div>
                <span class="insight-arrow">→</span>
              </router-link>
            </div>
          </div>
        </div>

        <!-- Today's appointments -->
        <div class="card">
          <div class="card-header">
            <div class="d-flex align-center gap-2">
              <span class="section-badge">📅</span>
              <h3>Today's Appointments</h3>
            </div>
            <router-link to="/appointments" class="btn btn-ghost btn-sm">View all →</router-link>
          </div>
          <div class="card-body p-0">
            <table class="dash-table" v-if="recentAppointments.length">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Patient</th>
                  <th>Doctor</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="a in recentAppointments" :key="a.id">
                  <td class="font-semibold text-primary">{{ formatTime(a.appointment_time) }}</td>
                  <td>{{ a.patient_first_name }} {{ a.patient_last_name }}</td>
                  <td class="text-muted">Dr. {{ a.doctor_last_name }}</td>
                  <td>
                    <span class="badge" :class="`badge-${getStatusColor(a.status)}`">
                      {{ a.status?.replace(/_/g,' ') }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
            <div class="empty-state" v-else>
              <span class="empty-state-icon">📭</span>
              <h3>No appointments today</h3>
              <p>Nothing scheduled for today yet.</p>
            </div>
          </div>
        </div>

        <!-- Recent patients -->
        <div class="card">
          <div class="card-header">
            <div class="d-flex align-center gap-2">
              <span class="section-badge">👤</span>
              <h3>Recent Patients</h3>
            </div>
            <router-link to="/patients" class="btn btn-ghost btn-sm">View all →</router-link>
          </div>
          <div class="card-body p-0">
            <div v-if="recentPatients.length">
              <router-link
                v-for="p in recentPatients"
                :key="p.id"
                :to="`/patients/${p.id}`"
                class="patient-row"
              >
                <div class="patient-avatar-sm">{{ p.first_name?.charAt(0) }}{{ p.last_name?.charAt(0) }}</div>
                <div class="patient-details">
                  <span class="patient-name-text">{{ p.first_name }} {{ p.last_name }}</span>
                  <span class="patient-meta-text">{{ p.mrn }} · {{ p.phone || 'No phone' }}</span>
                </div>
                <span class="badge" :class="p.status === 'active' ? 'badge-success' : 'badge-gray'">{{ p.status }}</span>
              </router-link>
            </div>
            <div class="empty-state" v-else>
              <span class="empty-state-icon">👥</span>
              <h3>No recent patients</h3>
              <p>Newly registered patients appear here.</p>
            </div>
          </div>
        </div>

        <!-- Weekly chart -->
        <div class="card">
          <div class="card-header">
            <div class="d-flex align-center gap-2">
              <span class="section-badge">📈</span>
              <h3>Weekly Overview</h3>
            </div>
            <span class="chip">7-day trend</span>
          </div>
          <div class="card-body">
            <div class="chart-container" v-if="weeklyStats.length">
              <BarChart :data="weeklyChartData" :options="chartOptions" />
            </div>
            <div class="empty-state" v-else>
              <span class="empty-state-icon">📊</span>
              <h3>No data yet</h3>
              <p>Weekly appointment data will appear here.</p>
            </div>
          </div>
        </div>

        <!-- Quick actions -->
        <div class="card">
          <div class="card-header">
            <div class="d-flex align-center gap-2">
              <span class="section-badge">⚡</span>
              <h3>Quick Actions</h3>
            </div>
          </div>
          <div class="card-body">
            <div class="quick-grid">
              <router-link v-for="q in quickActions" :key="q.to" :to="q.to" class="quick-btn">
                <span class="quick-icon">{{ q.icon }}</span>
                <span class="quick-label">{{ q.label }}</span>
              </router-link>
            </div>
          </div>
        </div>

      </div>
    </template>
  </div>
</template>

<script>
import { ref, computed, onMounted } from 'vue'
import axios from 'axios'
import { useToast } from '../../store/toast'
import { useAuthStore } from '../../store/auth'
import { formatCurrency, formatTime, getStatusColor } from '../../utils/helpers'

export default {
  name: 'Dashboard',
  setup() {
    const toast      = useToast()
    const authStore  = useAuthStore()
    const stats      = ref({})
    const insights   = ref([])
    const recentAppointments = ref([])
    const recentPatients     = ref([])
    const weeklyStats        = ref([])
    const loading            = ref(true)

    const greeting = computed(() => {
      const h = new Date().getHours()
      return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'
    })
    const firstName = computed(() => authStore.user?.first_name || 'Doctor')

    onMounted(async () => {
      try {
        const [{ data }, insRes] = await Promise.all([
          axios.get('/api/reports/dashboard'),
          axios.get('/api/reports/insights').catch(() => ({ data: { insights: [] } }))
        ])
        stats.value             = data.stats || {}
        recentAppointments.value = data.recentAppointments || []
        recentPatients.value    = data.recentPatients || []
        weeklyStats.value       = data.weeklyStats || []
        insights.value          = insRes.data?.insights || insRes.data || []
      } catch {
        toast.error('Failed to load dashboard data')
      } finally {
        loading.value = false
      }
    })

    const statCards = computed(() => [
      { label: 'Total Patients',        value: stats.value.totalPatients        || 0,  icon: '👥', gradient: 'linear-gradient(135deg,#ccfbf1,#99f6e4)', trend: undefined },
      { label: 'Active Doctors',        value: stats.value.totalDoctors         || 0,  icon: '👨‍⚕️', gradient: 'linear-gradient(135deg,#dbeafe,#bfdbfe)', trend: undefined },
      { label: "Today's Appointments",  value: stats.value.todayAppointments    || 0,  icon: '📅', gradient: 'linear-gradient(135deg,#ede9fe,#ddd6fe)', trend: undefined },
      { label: 'Pending',               value: stats.value.pendingAppointments  || 0,  icon: '⏳', gradient: 'linear-gradient(135deg,#fef3c7,#fde68a)', trend: undefined },
      { label: "Today's Revenue",       value: formatCurrency(stats.value.todayRevenue   || 0), icon: '💵', gradient: 'linear-gradient(135deg,#dcfce7,#bbf7d0)', trend: undefined },
      { label: 'Monthly Revenue',       value: formatCurrency(stats.value.monthlyRevenue || 0), icon: '📈', gradient: 'linear-gradient(135deg,#cffafe,#a5f3fc)', trend: undefined },
      { label: 'Unpaid Bills',          value: stats.value.pendingBills         || 0,  icon: '🧾', gradient: 'linear-gradient(135deg,#fee2e2,#fecaca)', trend: undefined },
      { label: 'Low Stock Alerts',      value: stats.value.lowStockMedications  || 0,  icon: '⚠️', gradient: 'linear-gradient(135deg,#ffedd5,#fed7aa)', trend: undefined },
    ])

    const weeklyChartData = computed(() => ({
      labels: weeklyStats.value.map(d => fmtDay(d.date)),
      datasets: [{
        label: 'Appointments',
        data: weeklyStats.value.map(d => d.count),
        backgroundColor: (ctx) => {
          const canvas = ctx.chart.ctx
          const g = canvas.createLinearGradient(0, 0, 0, 200)
          g.addColorStop(0, '#14b8a6')
          g.addColorStop(1, '#0d9488')
          return g
        },
        hoverBackgroundColor: '#5eead4',
        borderRadius: 8,
        borderSkipped: false,
        maxBarThickness: 44,
      }, {
        label: 'Completed',
        data: weeklyStats.value.map(d => d.completed || 0),
        backgroundColor: 'rgba(99,102,241,.2)',
        hoverBackgroundColor: 'rgba(99,102,241,.35)',
        borderRadius: 8,
        borderSkipped: false,
        maxBarThickness: 44,
      }]
    }))

    const chartOptions = {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', font: { family: 'Inter', size: 12 }, color: '#64748b', boxWidth: 8, padding: 16 } },
        tooltip: {
          backgroundColor: '#0f172a', titleColor: '#f1f5f9', bodyColor: '#94a3b8',
          borderColor: '#1e293b', borderWidth: 1,
          titleFont: { family: 'Inter', weight: '600' },
          bodyFont:  { family: 'Inter' },
          padding: 12, cornerRadius: 10
        }
      },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0, color: '#94a3b8', font: { family: 'Inter', size: 11 } }, grid: { color: '#f1f5f9', drawBorder: false }, border: { display: false } },
        x: { ticks: { color: '#94a3b8', font: { family: 'Inter', size: 11 } }, grid: { display: false }, border: { display: false } }
      }
    }

    const quickActions = [
      { to: '/patients',     icon: '🏥', label: 'New Patient' },
      { to: '/appointments', icon: '📅', label: 'Book Appt.' },
      { to: '/emr',          icon: '📋', label: 'New Record' },
      { to: '/pharmacy',     icon: '💊', label: 'Pharmacy' },
      { to: '/laboratory',   icon: '🧪', label: 'Lab Order' },
      { to: '/billing',      icon: '💳', label: 'New Bill' },
    ]

    const fmtDay = d => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' })

    return {
      loading, stats, statCards, insights,
      recentAppointments, recentPatients,
      weeklyStats, weeklyChartData, chartOptions,
      quickActions, greeting, firstName,
      formatTime, getStatusColor,
    }
  }
}
</script>

<style scoped>
.dashboard { animation: fadeUp .35s ease both; }
@keyframes fadeUp { from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)} }

/* Header */
.dash-header {
  display: flex; align-items: flex-start; justify-content: space-between;
  margin-bottom: 24px; gap: 16px; flex-wrap: wrap;
}
.dash-title { font-size: 22px; font-weight: 700; color: var(--gray-900); letter-spacing: -.03em; }
.dash-sub   { font-size: 13.5px; color: var(--gray-500); margin-top: 3px; }
.dash-header-actions { display: flex; gap: 8px; flex-shrink: 0; }
.btn-icon-inline { font-size: 14px; }

/* Stats grid */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
}

.stat-card {
  background: #fff;
  border-radius: 14px;
  padding: 16px 18px;
  display: flex; align-items: center; gap: 14px;
  border: 1px solid rgba(0,0,0,.04);
  box-shadow: 0 1px 3px rgba(0,0,0,.05), 0 4px 12px rgba(0,0,0,.03);
  transition: transform .2s, box-shadow .2s;
  position: relative; overflow: hidden;
}
.stat-card:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0,0,0,.08); }

.stat-icon {
  width: 48px; height: 48px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.stat-emoji { font-size: 22px; line-height: 1; }

.stat-body { flex: 1; min-width: 0; }
.stat-value { font-size: 22px; font-weight: 700; color: var(--gray-900); letter-spacing: -.03em; line-height: 1.2; }
.stat-label { font-size: 12px; color: var(--gray-500); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.stat-trend { font-size: 11px; font-weight: 600; padding: 2px 7px; border-radius: 20px; flex-shrink: 0; }
.trend-up   { background: #dcfce7; color: #166534; }
.trend-down { background: #fee2e2; color: #991b1b; }
.trend-flat { background: var(--gray-100); color: var(--gray-500); }

/* Skeleton cards */
.skeleton-card {
  background: #fff; border-radius: 14px; padding: 18px;
  border: 1px solid rgba(0,0,0,.04);
  box-shadow: 0 1px 3px rgba(0,0,0,.05);
}

/* Main grid */
.dash-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
}
.dash-insights { grid-column: 1 / -1; }

/* Card overrides */
.card { background: #fff; border-radius: 14px; border: 1px solid rgba(0,0,0,.05); box-shadow: 0 1px 3px rgba(0,0,0,.05), 0 4px 14px rgba(0,0,0,.03); overflow: hidden; }
.card-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--gray-100); gap: 10px; }
.card-header h3 { font-size: 14px; font-weight: 600; color: var(--gray-800); margin: 0; }
.card-body { padding: 16px 18px; }
.card-body.p-0 { padding: 0; }

.section-badge { font-size: 16px; line-height: 1; }
.chip { font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 20px; background: var(--gray-100); color: var(--gray-600); white-space: nowrap; }
.chip-teal { background: var(--brand-50); color: var(--brand-700); border: 1px solid var(--brand-200); }

/* Insights */
.insights-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.insight-card {
  display: flex; align-items: flex-start; gap: 11px;
  padding: 12px 14px; border-radius: 11px;
  border: 1px solid transparent; border-left-width: 3px;
  text-decoration: none;
  transition: transform .18s, box-shadow .18s;
}
.insight-card:hover { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(0,0,0,.06); }
.insight-success  { background: #f0fdf4; border-color: #86efac; border-left-color: #16a34a; }
.insight-warning  { background: #fffbeb; border-color: #fde68a; border-left-color: #d97706; }
.insight-danger   { background: #fef2f2; border-color: #fecaca; border-left-color: #dc2626; }
.insight-info     { background: #eff6ff; border-color: #bfdbfe; border-left-color: #2563eb; }
.insight-emoji { font-size: 20px; flex-shrink: 0; margin-top: 1px; line-height: 1; }
.insight-body  { flex: 1; min-width: 0; }
.insight-title { font-size: 13px; font-weight: 600; color: var(--gray-800); }
.insight-msg   { font-size: 12px; color: var(--gray-600); margin-top: 2px; line-height: 1.5; }
.insight-arrow { color: var(--gray-400); font-size: 14px; flex-shrink: 0; margin-top: 1px; }

/* Table */
.dash-table { width: 100%; border-collapse: collapse; }
.dash-table thead tr { background: var(--gray-50); }
.dash-table th { padding: 10px 16px; text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--gray-500); border-bottom: 1px solid var(--gray-200); white-space: nowrap; }
.dash-table td { padding: 12px 16px; font-size: 13.5px; color: var(--gray-700); border-bottom: 1px solid var(--gray-100); vertical-align: middle; }
.dash-table tbody tr:last-child td { border-bottom: none; }
.dash-table tbody tr:hover td { background: var(--brand-50); }

/* Patient rows */
.patient-row {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 18px; border-bottom: 1px solid var(--gray-100);
  text-decoration: none; transition: background .15s;
}
.patient-row:last-child { border-bottom: none; }
.patient-row:hover { background: var(--gray-50); }
.patient-avatar-sm {
  width: 38px; height: 38px; border-radius: 50%;
  background: linear-gradient(135deg, #14b8a6, #0d9488);
  color: #fff; display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 13px; flex-shrink: 0;
}
.patient-details { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.patient-name-text { font-size: 13.5px; font-weight: 600; color: var(--gray-800); }
.patient-meta-text { font-size: 12px; color: var(--gray-500); }

/* Chart */
.chart-container { height: 220px; padding: 4px 0; }

/* Quick actions */
.quick-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.quick-btn {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; padding: 16px 8px; border-radius: 12px;
  border: 1.5px solid var(--gray-200); text-decoration: none;
  color: var(--gray-700); transition: all .2s; background: #fff;
  font-size: 12px; font-weight: 500;
}
.quick-btn:hover { border-color: var(--brand-400); background: var(--brand-50); color: var(--brand-700); transform: translateY(-1px); box-shadow: 0 4px 12px rgba(20,184,166,.15); }
.quick-icon { font-size: 22px; line-height: 1; }
.quick-label { text-align: center; line-height: 1.3; }

/* Responsive */
@media (max-width: 1200px) { .stats-grid { grid-template-columns: repeat(4, 1fr); } }
@media (max-width: 1024px) { .stats-grid { grid-template-columns: repeat(2, 1fr); } .insights-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 768px)  {
  .stats-grid { grid-template-columns: 1fr 1fr; }
  .dash-grid  { grid-template-columns: 1fr; }
  .dash-insights { grid-column: auto; }
  .insights-grid { grid-template-columns: 1fr; }
  .quick-grid { grid-template-columns: repeat(2, 1fr); }
  .dash-header { flex-direction: column; }
}
@media (max-width: 480px) { .stats-grid { grid-template-columns: 1fr; } }
</style>
