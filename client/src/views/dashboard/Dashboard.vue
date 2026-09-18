<template>
  <div class="dashboard">
    <div v-if="loading" class="loading-spinner">
      <div class="spinner"></div>
      <p>Loading dashboard...</p>
    </div>
    <template v-else>
      <div class="stats-grid">
        <div class="stats-card" v-for="stat in statsCards" :key="stat.label">
          <div class="stats-icon" :style="{ background: stat.color }">{{ stat.icon }}</div>
          <div class="stats-info">
            <div class="stats-value" :style="{ '--target': stat.rawValue }">{{ stat.value }}</div>
            <div class="stats-label">{{ stat.label }}</div>
          </div>
        </div>
      </div>

      <div class="dashboard-grid">
        <div class="card insights-card" v-if="insights.length">
          <div class="card-header full">
            <h3>Smart Insights</h3>
            <span class="insights-badge">AI-powered</span>
          </div>
          <div class="card-body">
            <div class="insights-list">
              <div v-for="(ins, i) in insights" :key="i" class="insight-item" :class="'insight-' + ins.severity">
                <span class="insight-icon">{{ ins.icon }}</span>
                <div class="insight-body">
                  <div class="insight-title">{{ ins.title }}</div>
                  <div class="insight-message">{{ ins.message }}</div>
                </div>
                <router-link v-if="ins.link" :to="ins.link" class="btn btn-sm insight-action">View &#8594;</router-link>
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3>Today's Appointments</h3>
            <router-link to="/appointments" class="btn btn-sm">View All</router-link>
          </div>
          <div class="card-body">
            <table v-if="recentAppointments.length" class="data-table">
              <thead>
                <tr><th>Time</th><th>Patient</th><th>Doctor</th><th>Status</th></tr>
              </thead>
              <tbody>
                <tr v-for="a in recentAppointments" :key="a.id">
                  <td>{{ formatTime(a.appointment_time) }}</td>
                  <td>{{ a.patient_first_name }} {{ a.patient_last_name }}</td>
                  <td>Dr. {{ a.doctor_first_name }} {{ a.doctor_last_name }}</td>
                  <td>
                    <span class="status-badge" :class="'badge-' + getStatusColor(a.status)">
                      <span class="status-dot"></span>
                      {{ a.status ? a.status.replace(/_/g, ' ') : '' }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-else class="empty-state">
              <span class="empty-icon">&#128197;</span>
              <h3>No Appointments Today</h3>
              <p>There are no appointments scheduled for today.</p>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3>Recent Patients</h3>
            <router-link to="/patients" class="btn btn-sm">View All</router-link>
          </div>
          <div class="card-body">
            <div v-if="recentPatients.length" class="patient-list">
              <div class="patient-item" v-for="p in recentPatients" :key="p.id">
                <div class="patient-avatar">{{ p.first_name.charAt(0) }}{{ p.last_name.charAt(0) }}</div>
                <div class="patient-info">
                  <div class="patient-name">{{ p.first_name }} {{ p.last_name }}</div>
                  <div class="patient-meta">{{ p.mrn }} | {{ p.phone || 'No phone' }}</div>
                </div>
                <router-link :to="`/patients/${p.id}`" class="btn btn-sm btn-outline">View</router-link>
              </div>
            </div>
            <div v-else class="empty-state">
              <span class="empty-icon">&#128100;</span>
              <h3>No Recent Patients</h3>
              <p>Recently registered patients will appear here.</p>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3>Weekly Overview</h3>
          </div>
          <div class="card-body">
            <div v-if="weeklyStats.length" class="chart-placeholder">
              <div class="bar-chart">
                <div v-for="day in weeklyStats" :key="day.date" class="bar-group">
                  <div class="bar" :style="{ height: Math.max((day.count / maxWeekly * 120), 4) + 'px' }">
                    <span class="bar-value">{{ day.count }}</span>
                  </div>
                  <div class="bar-label">{{ formatDay(day.date) }}</div>
                </div>
              </div>
            </div>
            <div v-else class="empty-state">
              <span class="empty-icon">&#128200;</span>
              <h3>No Weekly Data</h3>
              <p>Weekly appointment overview will appear here.</p>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3>Quick Actions</h3>
          </div>
          <div class="card-body">
            <div class="quick-actions">
              <router-link to="/patients" class="action-btn">
                <span class="action-icon">&#9823;</span>
                <span>New Patient</span>
              </router-link>
              <router-link to="/appointments" class="action-btn">
                <span class="action-icon">&#128197;</span>
                <span>Book Appointment</span>
              </router-link>
              <router-link to="/emr" class="action-btn">
                <span class="action-icon">&#128203;</span>
                <span>New Record</span>
              </router-link>
              <router-link to="/pharmacy" class="action-btn">
                <span class="action-icon">&#9764;</span>
                <span>Pharmacy</span>
              </router-link>
              <router-link to="/laboratory" class="action-btn">
                <span class="action-icon">&#9879;</span>
                <span>Lab Order</span>
              </router-link>
              <router-link to="/billing" class="action-btn">
                <span class="action-icon">&#128176;</span>
                <span>New Bill</span>
              </router-link>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script>
import { ref, onMounted, computed } from 'vue'
import axios from 'axios'
import { useToast } from '../../store/toast'
import { formatDate, formatCurrency, formatTime, getStatusColor } from '../../utils/helpers'

export default {
  name: 'Dashboard',
  setup() {
    const toast = useToast()
    const stats = ref({})
    const recentAppointments = ref([])
    const recentPatients = ref([])
    const weeklyStats = ref([])
    const loading = ref(false)
    const insights = ref([])

    onMounted(async () => {
      loading.value = true
      try {
        const [{ data }, insightsRes] = await Promise.all([
          axios.get('/api/reports/dashboard'),
          axios.get('/api/reports/insights').catch(() => ({ data: [] }))
        ])
        stats.value = data.stats
        recentAppointments.value = data.recentAppointments
        recentPatients.value = data.recentPatients
        weeklyStats.value = data.weeklyStats || []
        insights.value = insightsRes.data || []
      } catch (e) {
        toast.error('Failed to load dashboard data')
      } finally {
        loading.value = false
      }
    })

    const maxWeekly = computed(() => Math.max(...weeklyStats.value.map(d => d.count), 1))

    const statsCards = computed(() => [
      { label: 'Total Patients', value: stats.value.totalPatients || 0, rawValue: stats.value.totalPatients || 0, icon: '👥', color: '#0d9488' },
      { label: 'Active Doctors', value: stats.value.totalDoctors || 0, rawValue: stats.value.totalDoctors || 0, icon: '👨‍⚕️', color: '#3b82f6' },
      { label: "Today's Appointments", value: stats.value.todayAppointments || 0, rawValue: stats.value.todayAppointments || 0, icon: '📅', color: '#8b5cf6' },
      { label: 'Pending Appointments', value: stats.value.pendingAppointments || 0, rawValue: stats.value.pendingAppointments || 0, icon: '⏳', color: '#f59e0b' },
      { label: "Today's Revenue", value: formatCurrency(stats.value.todayRevenue || 0), rawValue: stats.value.todayRevenue || 0, icon: '💰', color: '#10b981' },
      { label: 'Monthly Revenue', value: formatCurrency(stats.value.monthlyRevenue || 0), rawValue: stats.value.monthlyRevenue || 0, icon: '📈', color: '#06b6d4' },
      { label: 'Pending Bills', value: stats.value.pendingBills || 0, rawValue: stats.value.pendingBills || 0, icon: '📋', color: '#ef4444' },
      { label: 'Low Stock Alerts', value: stats.value.lowStockMedications || 0, rawValue: stats.value.lowStockMedications || 0, icon: '⚠️', color: '#f97316' }
    ])

    const formatDay = (d) => new Date(d).toLocaleDateString('en', { weekday: 'short' })

    return { statsCards, recentAppointments, recentPatients, weeklyStats, maxWeekly, loading, insights, formatDate, formatCurrency, formatTime, formatDay, getStatusColor }
  }
}
</script>

<style scoped>
.loading-spinner { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 80px 20px; }
.spinner { width: 40px; height: 40px; border: 3px solid #e2e8f0; border-top-color: #0d9488; border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 14px; }
@keyframes spin { to { transform: rotate(360deg); } }
.loading-spinner p { color: #94a3b8; font-size: 14px; margin: 0; }

.stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
.stats-card {
  background: white; border-radius: 12px; padding: 20px;
  display: flex; align-items: center; gap: 16px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08); transition: transform 0.2s, box-shadow 0.2s;
}
.stats-card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.12); }
.stats-icon {
  width: 48px; height: 48px; border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  font-size: 22px; flex-shrink: 0;
}
.stats-value { font-size: 22px; font-weight: 700; color: #1e293b; animation: countUp 0.6s ease-out; }
.stats-label { font-size: 13px; color: #64748b; }

@keyframes countUp {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

.dashboard-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }

.insights-card .card-header.full { justify-content: space-between; }
.insights-badge { font-size: 11px; font-weight: 600; color: #0d9488; background: #f0fdfa; padding: 4px 10px; border-radius: 20px; }
.insights-list { display: flex; flex-direction: column; gap: 8px; }
.insight-item { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 10px; border: 1px solid #e2e8f0; border-left-width: 4px; }
.insight-icon { font-size: 22px; flex-shrink: 0; }
.insight-body { flex: 1; }
.insight-title { font-size: 13px; font-weight: 600; color: #1e293b; }
.insight-message { font-size: 12px; color: #64748b; margin-top: 2px; }
.insight-action { flex-shrink: 0; }
.insight-success { border-left-color: #10b981; background: #f0fdf4; }
.insight-success .insight-title { color: #047857; }
.insight-warning { border-left-color: #f59e0b; background: #fffbeb; }
.insight-warning .insight-title { color: #b45309; }
.insight-danger { border-left-color: #ef4444; background: #fef2f2; }
.insight-danger .insight-title { color: #b91c1c; }
.insight-info { border-left-color: #3b82f6; background: #eff6ff; }
.insight-info .insight-title { color: #1d4ed8; }

.card { background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); overflow: hidden; }
.card-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid #f1f5f9; }
.card-header h3 { margin: 0; font-size: 15px; font-weight: 600; color: #1e293b; }
.card-body { padding: 16px 20px; }

.data-table { width: 100%; border-collapse: collapse; }
.data-table th { text-align: left; font-size: 12px; font-weight: 600; color: #94a3b8; text-transform: uppercase; padding: 8px 0; border-bottom: 1px solid #f1f5f9; }
.data-table td { padding: 10px 0; font-size: 14px; color: #334155; border-bottom: 1px solid #f8fafc; }
.data-table tr:last-child td { border-bottom: none; }

.status-badge {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 500;
}
.status-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.badge-success { background: #ecfdf5; color: #059669; }
.badge-success .status-dot { background: #059669; }
.badge-warning { background: #fffbeb; color: #d97706; }
.badge-warning .status-dot { background: #d97706; }
.badge-danger { background: #fef2f2; color: #dc2626; }
.badge-danger .status-dot { background: #dc2626; }
.badge-info { background: #eff6ff; color: #2563eb; }
.badge-info .status-dot { background: #2563eb; }
.badge-gray { background: #f8fafc; color: #64748b; }
.badge-gray .status-dot { background: #64748b; }

.patient-list { display: flex; flex-direction: column; gap: 8px; }
.patient-item {
  display: flex; align-items: center; gap: 12px;
  padding: 10px; border-radius: 8px; transition: background 0.2s;
}
.patient-item:hover { background: #f8fafc; }
.patient-avatar {
  width: 40px; height: 40px; border-radius: 50%; background: #0d9488;
  color: white; display: flex; align-items: center;
  justify-content: center; font-weight: 600; font-size: 13px; flex-shrink: 0;
}
.patient-name { font-weight: 500; font-size: 14px; color: #1e293b; }
.patient-meta { font-size: 12px; color: #94a3b8; }

.chart-placeholder { padding: 10px 0; }
.bar-chart { display: flex; align-items: flex-end; gap: 12px; height: 160px; padding: 20px 0; }
.bar-group { display: flex; flex-direction: column; align-items: center; gap: 4px; flex: 1; }
.bar {
  width: 100%; max-width: 40px; background: linear-gradient(180deg, #0d9488, #14b8a6);
  border-radius: 4px 4px 0 0; transition: height 0.4s ease; position: relative;
  min-height: 4px;
}
.bar-value { position: absolute; top: -18px; font-size: 11px; font-weight: 600; color: #1e293b; }
.bar-label { font-size: 11px; color: #94a3b8; }

.quick-actions { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.action-btn {
  display: flex; flex-direction: column; align-items: center;
  gap: 8px; padding: 16px; border-radius: 10px;
  border: 1px solid #e2e8f0; text-decoration: none;
  color: #1e293b; transition: all 0.2s; font-size: 12px; font-weight: 500;
}
.action-btn:hover { border-color: #0d9488; background: #f0fdfa; }
.action-icon { font-size: 24px; }

.empty-state { text-align: center; padding: 32px 20px; }
.empty-icon { font-size: 42px; display: block; margin-bottom: 10px; opacity: 0.6; }
.empty-state h3 { font-size: 15px; font-weight: 600; color: #475569; margin: 0 0 6px; }
.empty-state p { font-size: 13px; color: #94a3b8; margin: 0; }

.btn-outline { border: 1px solid #e2e8f0; background: white; color: #475569; }
.btn { padding: 6px 14px; border-radius: 6px; font-size: 13px; font-weight: 500; text-decoration: none; transition: all 0.2s; }
.btn-sm { font-size: 12px; padding: 5px 12px; }
.btn:hover { opacity: 0.85; }

@media (max-width: 1024px) { .stats-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 768px) {
  .dashboard-grid { grid-template-columns: 1fr; }
  .stats-grid { grid-template-columns: 1fr; }
  .quick-actions { grid-template-columns: repeat(2, 1fr); }
}
</style>
