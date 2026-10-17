<template>
  <div class="dashboard">

    <!-- ── Hero ───────────────────────────────────────────── -->
    <header class="hero">
      <div class="hero-main">
        <div class="hero-identity">
          <span class="hero-eyebrow">{{ todayLong }}</span>
          <h1 class="hero-title">Good {{ greeting }}, {{ firstName }}</h1>
          <p class="hero-sub">{{ roleLabel }} workspace · Here is the hospital overview for today.</p>
        </div>

        <div class="hero-actions">
          <router-link to="/ai-assistant" class="hero-btn hero-btn-ghost">
            <AppIcon name="sparkles" :size="16" /> AI Assistant
          </router-link>
          <router-link v-if="canViewReports" to="/reports" class="hero-btn hero-btn-solid">
            <AppIcon name="bar-chart" :size="16" /> View Reports
          </router-link>
        </div>
      </div>

      <div class="hero-footer">
        <span class="hero-updated">
          <span class="live-dot" />
          <template v-if="refreshing">Refreshing data…</template>
          <template v-else>Data updated {{ updatedLabel }}</template>
        </span>
        <div class="hero-clock">
          <AppIcon name="clock" :size="15" />
          <span class="hero-clock-time">{{ clockTime }}</span>
        </div>
        <button
          type="button"
          class="hero-refresh"
          :class="{ spinning: refreshing }"
          :disabled="refreshing"
          @click="refresh"
        >
          <AppIcon name="refresh" :size="15" /> Refresh
        </button>
      </div>
    </header>

    <!-- ── KPI cards ──────────────────────────────────────── -->
    <section class="kpi-grid" aria-label="Key hospital metrics">
      <template v-if="loading">
        <div v-for="i in 4" :key="i" class="kpi-card kpi-skeleton">
          <div class="skeleton skeleton-line" style="width:48%" />
          <div class="skeleton skeleton-value" />
          <div class="skeleton skeleton-line" style="width:64%" />
        </div>
      </template>
      <article
        v-else
        v-for="(s, i) in statCards"
        :key="s.key"
        class="kpi-card"
        :class="`tone-${s.tone}`"
        :style="{ animationDelay: `${i * 45}ms` }"
      >
        <div class="kpi-head">
          <span class="kpi-label">{{ s.label }}</span>
          <span class="kpi-icon"><AppIcon :name="s.icon" :size="18" /></span>
        </div>
        <div class="kpi-value">{{ formatValue(s) }}</div>
        <div class="kpi-foot">
          <span class="kpi-caption">{{ s.caption }}</span>
        </div>
      </article>
    </section>

    <!-- ── Body ───────────────────────────────────────────── -->
    <div class="dash-grid">
      <div class="dash-main">

        <!-- Smart insights -->
        <section v-if="!loading && canViewClinical && insights.length" class="panel insights-panel">
          <div class="panel-header">
            <div class="panel-title"><span class="panel-title-icon"><AppIcon name="sparkles" :size="17" /></span> Smart Insights</div>
            <span class="chip chip-teal">AI-powered</span>
          </div>
          <div class="insights-grid">
            <template v-for="(ins, i) in insights" :key="i">
              <router-link
                v-if="ins.link && canAccessInsight(ins)"
                :to="ins.link"
                class="insight-card"
                :class="`insight-${ins.severity}`"
              >
                <span class="insight-emoji">{{ ins.icon }}</span>
                <div class="insight-body">
                  <div class="insight-title">{{ ins.title }}</div>
                  <div class="insight-msg">{{ ins.message }}</div>
                </div>
                <AppIcon name="chevron-right" :size="16" class="insight-arrow" />
              </router-link>
              <div v-else class="insight-card" :class="`insight-${ins.severity}`">
                <span class="insight-emoji">{{ ins.icon }}</span>
                <div class="insight-body">
                  <div class="insight-title">{{ ins.title }}</div>
                  <div class="insight-msg">{{ ins.message }}</div>
                </div>
              </div>
            </template>
          </div>
        </section>

        <!-- Today's appointments -->
        <section class="panel" v-if="canViewClinical">
          <div class="panel-header">
            <div class="panel-title">
              <span class="panel-title-icon"><AppIcon name="calendar" :size="17" /></span>
              Today's Appointments
              <span class="count-pill" v-if="recentAppointments.length">{{ recentAppointments.length }}</span>
            </div>
            <router-link to="/appointments" class="panel-link">
              View all <AppIcon name="chevron-right" :size="14" />
            </router-link>
          </div>
          <div class="table-wrap">
            <table class="appt-table" v-if="recentAppointments.length">
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
                  <td><span class="time-chip">{{ formatTime(a.appointment_time) }}</span></td>
                  <td>
                    <div class="person-cell">
                      <span class="mini-avatar">{{ initials(a.patient_first_name, a.patient_last_name) }}</span>
                      <span class="person-name">{{ a.patient_first_name }} {{ a.patient_last_name }}</span>
                    </div>
                  </td>
                  <td class="text-muted">Dr. {{ a.doctor_last_name }}</td>
                  <td>
                    <span class="badge" :class="`badge-${getStatusColor(a.status)}`">
                      {{ a.status?.replace(/_/g, ' ') }}
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
        </section>

        <!-- Weekly overview -->
        <section class="panel" v-if="canViewClinical">
          <div class="panel-header">
            <div class="panel-title">
              <span class="panel-title-icon"><AppIcon name="bar-chart" :size="17" /></span>
              Weekly Overview
            </div>
            <span class="chip">Last 7 days</span>
          </div>
          <div class="card-body">
            <div class="chart-container" v-if="weeklyStats.length">
              <BarChart :key="uiStore.dark ? 'dark' : 'light'" :data="weeklyChartData" :options="chartOptions" />
            </div>
            <div class="empty-state" v-else>
              <span class="empty-state-icon">📊</span>
              <h3>No data yet</h3>
              <p>Weekly appointment data will appear here.</p>
            </div>
          </div>
        </section>
      </div>

      <!-- Side column -->
      <aside class="dash-side">
        <!-- Recent patients -->
        <section class="panel" v-if="canViewClinical">
          <div class="panel-header">
            <div class="panel-title"><span class="panel-title-icon"><AppIcon name="users" :size="17" /></span> Recent Patients</div>
            <router-link to="/patients" class="panel-link">
              View all <AppIcon name="chevron-right" :size="14" />
            </router-link>
          </div>
          <div v-if="recentPatients.length" class="patients-list">
            <router-link
              v-for="p in recentPatients"
              :key="p.id"
              :to="`/patients/${p.id}`"
              class="patient-row"
            >
              <span class="patient-avatar">{{ initials(p.first_name, p.last_name) }}</span>
              <span class="patient-details">
                <span class="patient-name">{{ p.first_name }} {{ p.last_name }}</span>
                <span class="patient-meta">{{ p.mrn }} · {{ p.phone || 'No phone' }}</span>
              </span>
              <span class="badge" :class="p.status === 'active' ? 'badge-success' : 'badge-gray'">{{ p.status }}</span>
            </router-link>
          </div>
          <div class="empty-state" v-else>
            <span class="empty-state-icon">👥</span>
            <h3>No recent patients</h3>
            <p>Newly registered patients appear here.</p>
          </div>
        </section>

        <!-- Quick actions -->
        <section class="panel">
          <div class="panel-header">
            <div class="panel-title"><span class="panel-title-icon"><AppIcon name="activity" :size="17" /></span> Quick Actions</div>
          </div>
          <div class="quick-grid">
            <router-link v-for="q in quickActions" :key="q.to" :to="q.to" class="quick-item">
              <span class="quick-icon" :class="`tone-${q.tone}`"><AppIcon :name="q.icon" :size="17" /></span>
              <span class="quick-label">{{ q.label }}</span>
              <AppIcon name="chevron-right" :size="15" class="quick-arrow" />
            </router-link>
          </div>
        </section>
      </aside>
    </div>
  </div>
</template>

<script>
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
import axios from 'axios'
import { useToast } from '../../store/toast'
import { useAuthStore } from '../../store/auth'
import { useUiStore } from '../../store/ui'
import { formatCurrency, formatTime, getStatusColor } from '../../utils/helpers'
import AppIcon from '../../components/AppIcon.vue'

export default {
  name: 'Dashboard',
  components: { AppIcon },
  setup() {
    const toast      = useToast()
    const authStore  = useAuthStore()
    const uiStore    = useUiStore()
    const stats      = ref({})
    const insights   = ref([])
    const recentAppointments = ref([])
    const recentPatients     = ref([])
    const weeklyStats        = ref([])
    const loading            = ref(true)
    const refreshing         = ref(false)
    const lastUpdated        = ref(null)
    const clockTick = ref(Date.now())
    let clockTimer = null

    const greeting = computed(() => {
      void clockTick.value
      const h = new Date().getHours()
      return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'
    })
    const firstName = computed(() => authStore.user?.first_name || authStore.userName || 'there')
    const roleLabel = computed(() => {
      const role = authStore.user?.role
      return role ? role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Staff'
    })
    const todayLong = computed(() => new Date().toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
    }))
    const clockTime = computed(() => {
      void clockTick.value
      return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    })
    const updatedLabel = computed(() => {
      if (!lastUpdated.value) return 'just now'
      const seconds = Math.max(0, Math.round((clockTick.value - lastUpdated.value.getTime()) / 1000))
      if (seconds < 10) return 'just now'
      if (seconds < 60) return `${seconds}s ago`
      return `${Math.floor(seconds / 60)}m ago`
    })

    const clinicalRoles = ['admin', 'receptionist', 'doctor', 'nurse']
    const canViewClinical = computed(() => authStore.can(...clinicalRoles))
    const canViewReports = computed(() => authStore.can(...clinicalRoles))
    const insightLinkRoles = {
      '/appointments': clinicalRoles,
      '/billing': ['admin', 'receptionist'],
      '/laboratory': ['admin', 'doctor', 'nurse', 'lab_technician'],
      '/pharmacy': ['admin', 'pharmacist'],
      '/reports': clinicalRoles,
      '/ward': clinicalRoles
    }
    const canAccessInsight = ins => {
      const link = ins?.link
      if (typeof link !== 'string' || !link.startsWith('/')) return false
      const path = link.split(/[?#]/)[0].replace(/\/+$/, '') || '/'
      const roles = insightLinkRoles[path]
      return !!roles && authStore.can(...roles)
    }

    const initials = (first, last) =>
      `${(first || '').charAt(0)}${(last || '').charAt(0)}`.toUpperCase() || '?'

    // Numbers count up once, which reads as data arriving rather than a static
    // label and is cheap to implement with a single rAF loop per card.
    const animated = reactive({})
    const easeOut = t => 1 - Math.pow(1 - t, 3)
    const animateValue = (key, target) => {
      const from = Number(animated[key]) || 0
      const to = Number(target) || 0
      if (from === to) { animated[key] = to; return }
      const started = performance.now()
      const duration = 650
      const step = now => {
        const p = Math.min(1, (now - started) / duration)
        animated[key] = from + (to - from) * easeOut(p)
        if (p < 1) requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    }

    const statCards = computed(() => [
      { key: 'patients', label: 'Total Patients', caption: 'Active records', value: stats.value.totalPatients || 0, icon: 'users', tone: 'teal', format: 'number', roles: ['admin', 'receptionist', 'doctor', 'nurse'] },
      { key: 'doctors', label: 'Active Doctors', caption: 'On staff', value: stats.value.totalDoctors || 0, icon: 'stethoscope', tone: 'blue', format: 'number' },
      { key: 'today', label: "Today's Appointments", caption: 'Scheduled for today', value: stats.value.todayAppointments || 0, icon: 'calendar', tone: 'violet', format: 'number', roles: ['admin', 'receptionist', 'doctor', 'nurse'] },
      { key: 'pending', label: 'Pending Appointments', caption: 'Awaiting confirmation', value: stats.value.pendingAppointments || 0, icon: 'clock', tone: 'amber', format: 'number', roles: ['admin', 'receptionist', 'doctor', 'nurse'] },
      { key: 'todayRevenue', label: "Today's Revenue", caption: 'Collected today', value: stats.value.todayRevenue || 0, icon: 'dollar', tone: 'green', format: 'currency', roles: ['admin', 'receptionist'] },
      { key: 'monthlyRevenue', label: 'Monthly Revenue', caption: 'Month to date', value: stats.value.monthlyRevenue || 0, icon: 'trending-up', tone: 'cyan', format: 'currency', roles: ['admin', 'receptionist'] },
      { key: 'bills', label: 'Unpaid Bills', caption: 'Outstanding balance', value: stats.value.pendingBills || 0, icon: 'receipt', tone: 'red', format: 'number', roles: ['admin', 'receptionist'] },
      { key: 'lab', label: 'Pending Lab Orders', caption: 'Awaiting results', value: stats.value.pendingLabOrders || 0, icon: 'flask', tone: 'violet', format: 'number', roles: ['admin', 'doctor', 'nurse', 'lab_technician'] },
      { key: 'stock', label: 'Low Stock Alerts', caption: 'Needs restocking', value: stats.value.lowStockMedications || 0, icon: 'alert-triangle', tone: 'orange', format: 'number', roles: ['admin', 'pharmacist'] }
    ].filter(card => !card.roles || authStore.can(...card.roles)))

    watch(statCards, cards => {
      cards.forEach(card => animateValue(card.key, card.value))
    }, { immediate: true })

    const formatValue = card => {
      const raw = animated[card.key] ?? card.value
      if (card.format === 'currency') return formatCurrency(raw)
      return Math.round(Number(raw) || 0).toLocaleString('en-US')
    }

    const weeklyChartData = computed(() => ({
      labels: weeklyStats.value.map(d => fmtDay(d.date)),
      datasets: [
        {
          label: 'Completed',
          data: weeklyStats.value.map(d => d.completed || 0),
          backgroundColor: '#0d9488',
          hoverBackgroundColor: '#14b8a6',
          borderRadius: 6,
          borderSkipped: false,
          maxBarThickness: 34,
          stack: 'appointments'
        },
        {
          label: 'Other',
          data: weeklyStats.value.map(d => Math.max(0, (d.count || 0) - (d.completed || 0) - (d.cancelled || 0))),
          backgroundColor: 'rgba(99,102,241,.55)',
          hoverBackgroundColor: 'rgba(99,102,241,.75)',
          borderRadius: 6,
          borderSkipped: false,
          maxBarThickness: 34,
          stack: 'appointments'
        },
        {
          label: 'Cancelled',
          data: weeklyStats.value.map(d => d.cancelled || 0),
          backgroundColor: 'rgba(248,113,113,.7)',
          hoverBackgroundColor: 'rgba(248,113,113,.9)',
          borderRadius: 6,
          borderSkipped: false,
          maxBarThickness: 34,
          stack: 'appointments'
        }
      ]
    }))

    const chartOptions = computed(() => {
      const dark = uiStore.dark
      return {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, position: 'top', align: 'end', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, padding: 16, font: { family: 'Inter', size: 11.5 }, color: dark ? '#8b95a5' : '#64748b' } },
          tooltip: {
            backgroundColor: dark ? '#0a1019' : '#0f172a', titleColor: '#f1f5f9', bodyColor: '#cbd5e1',
            borderColor: dark ? '#2a3444' : '#1e293b', borderWidth: 1,
            titleFont: { family: 'Inter', weight: '600' },
            bodyFont: { family: 'Inter' },
            padding: 12, cornerRadius: 10, boxPadding: 5, usePointStyle: true
          }
        },
        scales: {
          y: { stacked: true, beginAtZero: true, ticks: { precision: 0, color: '#94a3b8', font: { family: 'Inter', size: 11 } }, grid: { color: dark ? '#2a3444' : '#f1f5f9', drawBorder: false }, border: { display: false } },
          x: { stacked: true, ticks: { color: '#94a3b8', font: { family: 'Inter', size: 11 } }, grid: { display: false }, border: { display: false } }
        }
      }
    })

    const quickActions = computed(() => [
      { to: '/patients', icon: 'users', label: 'Patients', tone: 'teal', roles: ['admin', 'receptionist', 'doctor', 'nurse'] },
      { to: '/appointments', icon: 'calendar', label: 'Appointments', tone: 'violet', roles: ['admin', 'receptionist', 'doctor', 'nurse'] },
      { to: '/emr', icon: 'clipboard', label: 'Medical Records', tone: 'blue', roles: ['admin', 'doctor', 'nurse'] },
      { to: '/pharmacy', icon: 'pill', label: 'Pharmacy', tone: 'green', roles: ['admin', 'pharmacist'] },
      { to: '/laboratory', icon: 'flask', label: 'Laboratory', tone: 'amber', roles: ['admin', 'doctor', 'nurse', 'lab_technician'] },
      { to: '/billing', icon: 'credit-card', label: 'Billing', tone: 'cyan', roles: ['admin', 'receptionist'] }
    ].filter(action => authStore.can(...action.roles)))

    const fmtDay = d => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' })

    const loadDashboard = async (silent = false) => {
      if (silent) refreshing.value = true
      try {
        const [{ data }, insRes] = await Promise.all([
          axios.get('/api/reports/dashboard'),
          canViewClinical.value
            ? axios.get('/api/reports/insights').catch(() => ({ data: { insights: [] } }))
            : Promise.resolve({ data: { insights: [] } })
        ])
        stats.value = data.stats || {}
        recentAppointments.value = canViewClinical.value ? data.recentAppointments || [] : []
        recentPatients.value = canViewClinical.value ? data.recentPatients || [] : []
        weeklyStats.value = canViewClinical.value ? data.weeklyStats || [] : []
        const insightData = insRes.data?.insights
        insights.value = Array.isArray(insightData)
          ? insightData
          : (Array.isArray(insRes.data) ? insRes.data : [])
        lastUpdated.value = new Date()
      } catch {
        toast.error('Failed to load dashboard data')
      } finally {
        loading.value = false
        refreshing.value = false
      }
    }

    const refresh = () => {
      if (loading.value || refreshing.value) return
      loadDashboard(true)
    }

    onMounted(() => {
      clockTimer = setInterval(() => { clockTick.value = Date.now() }, 1000)
      loadDashboard()
    })

    onUnmounted(() => {
      if (clockTimer) clearInterval(clockTimer)
    })

    return {
      loading, refreshing, stats, statCards, insights,
      recentAppointments, recentPatients,
      weeklyStats, weeklyChartData, chartOptions,
      quickActions, greeting, firstName, roleLabel, todayLong, clockTime, updatedLabel,
      uiStore, canViewClinical, canViewReports,
      canAccessInsight, formatTime, getStatusColor, formatValue, initials, refresh,
    }
  }
}
</script>

<style scoped>
.dashboard { animation: dashIn .35s ease both; }
@keyframes dashIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

/* ── Hero ───────────────────────────────────────────── */
.hero {
  position: relative;
  overflow: hidden;
  border-radius: 20px;
  padding: 22px 24px 16px;
  margin-bottom: 20px;
  color: #fff;
  background:
    radial-gradient(110% 150% at 100% 0%, rgba(45,212,191,.38) 0%, transparent 52%),
    radial-gradient(90% 130% at 0% 120%, rgba(56,130,246,.30) 0%, transparent 55%),
    linear-gradient(135deg, #115e59 0%, #0f766e 42%, #0e7490 100%);
  box-shadow: 0 12px 32px -14px rgba(13,148,136,.6), inset 0 1px 0 rgba(255,255,255,.14);
  animation: heroIn .45s cubic-bezier(.22,1,.36,1) both;
}
@keyframes heroIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }

.hero-main {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 20px; flex-wrap: wrap; position: relative; z-index: 1;
}
.hero-eyebrow {
  display: block; font-size: 11px; font-weight: 600; letter-spacing: .12em;
  text-transform: uppercase; color: rgba(255,255,255,.7); margin-bottom: 7px;
}
.hero-title { font-size: 23px; font-weight: 700; letter-spacing: -.03em; line-height: 1.2; }
.hero-sub { font-size: 13.5px; color: rgba(255,255,255,.78); margin-top: 5px; }
.hero-actions { display: flex; gap: 9px; align-items: center; flex-shrink: 0; }

.hero-btn {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 9px 15px; border-radius: 10px; font-size: 13px; font-weight: 600;
  cursor: pointer; text-decoration: none; transition: all .2s ease; white-space: nowrap;
}
.hero-btn-ghost {
  background: rgba(255,255,255,.13); color: #fff;
  border: 1px solid rgba(255,255,255,.24);
}
.hero-btn-ghost:hover { background: rgba(255,255,255,.22); color: #fff; }
.hero-btn-solid {
  background: linear-gradient(135deg, #ffffff, #f0fdfa); color: var(--brand-700); border: 1px solid #ffffff;
  box-shadow: 0 4px 14px rgba(3,40,38,.25);
}
.hero-btn-solid:hover { background: linear-gradient(135deg, #f8fffd, #dcfce7); color: var(--brand-800); transform: translateY(-1px); }

.hero-footer {
  display: flex; align-items: center; gap: 16px;
  margin-top: 18px; padding-top: 13px;
  border-top: 1px solid rgba(255,255,255,.16);
  position: relative; z-index: 1;
  font-size: 12px; color: rgba(255,255,255,.8);
}
.hero-updated { display: inline-flex; align-items: center; gap: 7px; }
.live-dot {
  width: 7px; height: 7px; border-radius: 50%; background: #5eead4;
  box-shadow: 0 0 0 0 rgba(94,234,212,.7); animation: livePulse 2s infinite;
}
@keyframes livePulse {
  0% { box-shadow: 0 0 0 0 rgba(94,234,212,.6); }
  70% { box-shadow: 0 0 0 7px rgba(94,234,212,0); }
  100% { box-shadow: 0 0 0 0 rgba(94,234,212,0); }
}
.hero-clock { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; color: rgba(255,255,255,.9); }
.hero-clock-time { font-variant-numeric: tabular-nums; font-weight: 600; letter-spacing: .02em; }
.hero-refresh {
  display: inline-flex; align-items: center; gap: 6px;
  background: rgba(255,255,255,.1); color: rgba(255,255,255,.92);
  border: 1px solid rgba(255,255,255,.2); border-radius: 8px;
  padding: 5px 11px; font-size: 12px; font-weight: 500; cursor: pointer;
  transition: all .2s ease;
}
.hero-refresh:hover:not(:disabled) { background: rgba(255,255,255,.2); color: #fff; }
.hero-refresh:disabled { cursor: default; opacity: .75; }
.hero-refresh.spinning :deep(.app-icon) { animation: spin .8s linear infinite; }

/* ── KPI cards ──────────────────────────────────────── */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 20px;
}
.kpi-card {
  position: relative;
  background: var(--surface);
  border: 1px solid rgba(0,0,0,.05);
  border-radius: 16px;
  padding: 15px 17px 14px;
  box-shadow: var(--shadow-card);
  overflow: hidden;
  transition: transform .2s ease, box-shadow .25s ease;
  animation: kpiIn .45s cubic-bezier(.22,1,.36,1) both;
}
@keyframes kpiIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
.kpi-card::before {
  content: '';
  position: absolute; top: 0; left: 0; right: 0; height: 3px;
  background: linear-gradient(90deg, var(--tone), transparent 92%);
}
.kpi-card:hover { transform: translateY(-3px); box-shadow: var(--shadow-card-hover); }

.kpi-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.kpi-label { font-size: 12px; font-weight: 600; color: var(--text-muted); }
.kpi-icon {
  width: 34px; height: 34px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  background: var(--tone-bg); color: var(--tone); flex-shrink: 0;
}
.kpi-value {
  font-size: 26px; font-weight: 700; color: var(--gray-900);
  letter-spacing: -.035em; margin-top: 9px; line-height: 1.15;
  font-variant-numeric: tabular-nums;
}
.kpi-foot { margin-top: 4px; }
.kpi-caption { font-size: 11.5px; color: var(--text-subtle); }

.kpi-skeleton { display: flex; flex-direction: column; gap: 10px; animation: none; }
.skeleton-line { height: 12px; margin: 0; }
.skeleton-value { height: 26px; width: 42%; margin: 0; }

/* Tone palette — tuned per theme so the tint stays legible on both surfaces */
.tone-teal  { --tone: #0d9488; --tone-bg: #f0fdfa; }
.tone-blue  { --tone: #2563eb; --tone-bg: #eff6ff; }
.tone-violet{ --tone: #7c3aed; --tone-bg: #f5f3ff; }
.tone-amber { --tone: #b45309; --tone-bg: #fffbeb; }
.tone-green { --tone: #16a34a; --tone-bg: #f0fdf4; }
.tone-cyan  { --tone: #0e7490; --tone-bg: #ecfeff; }
.tone-red   { --tone: #dc2626; --tone-bg: #fef2f2; }
.tone-orange{ --tone: #ea580c; --tone-bg: #fff7ed; }

[data-theme="dark"] .tone-teal  { --tone: #5eead4; --tone-bg: rgba(13,148,136,.16); }
[data-theme="dark"] .tone-blue  { --tone: #93c5fd; --tone-bg: rgba(37,99,235,.18); }
[data-theme="dark"] .tone-violet{ --tone: #c4b5fd; --tone-bg: rgba(124,58,237,.18); }
[data-theme="dark"] .tone-amber { --tone: #fcd34d; --tone-bg: rgba(217,119,6,.18); }
[data-theme="dark"] .tone-green { --tone: #86efac; --tone-bg: rgba(22,163,74,.16); }
[data-theme="dark"] .tone-cyan  { --tone: #67e8f9; --tone-bg: rgba(14,116,144,.2); }
[data-theme="dark"] .tone-red   { --tone: #fca5a5; --tone-bg: rgba(220,38,38,.16); }
[data-theme="dark"] .tone-orange{ --tone: #fdba74; --tone-bg: rgba(234,88,12,.18); }

/* ── Layout ─────────────────────────────────────────── */
.dash-grid {
  display: grid;
  grid-template-columns: minmax(0, 2.1fr) minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}
.dash-main, .dash-side { display: flex; flex-direction: column; gap: 18px; min-width: 0; }

/* ── Panels ─────────────────────────────────────────── */
.panel {
  background: var(--surface);
  border-radius: 16px;
  border: 1px solid rgba(0,0,0,.05);
  box-shadow: var(--shadow-card);
  overflow: hidden;
}
.panel-header {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 14px 20px; border-bottom: 1px solid var(--gray-100);
}
.panel-title { display: flex; align-items: center; gap: 9px; font-size: 14px; font-weight: 600; color: var(--gray-800); }
.panel-title-icon { display: inline-flex; color: var(--brand-600); }
.count-pill {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 22px; height: 20px; padding: 0 7px; border-radius: 9999px;
  background: var(--brand-50); color: var(--brand-700);
  font-size: 11px; font-weight: 700;
}
.panel-link {
  display: inline-flex; align-items: center; gap: 2px;
  font-size: 12.5px; font-weight: 600; color: var(--brand-600); text-decoration: none;
  white-space: nowrap;
}
.panel-link:hover { color: var(--brand-700); }

.chip {
  font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 9999px;
  background: var(--gray-100); color: var(--gray-600); white-space: nowrap;
}
.chip-teal { background: var(--brand-50); color: var(--brand-700); border: 1px solid var(--brand-200); }

/* ── Insights ───────────────────────────────────────── */
.insights-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; padding: 16px 20px; }
.insight-card {
  display: flex; align-items: flex-start; gap: 11px;
  padding: 12px 14px; border-radius: 12px;
  border: 1px solid transparent; border-left-width: 3px;
  text-decoration: none; transition: transform .18s, box-shadow .18s;
}
.insight-card:hover { transform: translateY(-2px); box-shadow: 0 6px 18px rgba(0,0,0,.07); }
.insight-success { background: var(--success-bg); border-color: #86efac; border-left-color: var(--success-fg); }
.insight-warning { background: var(--warning-bg); border-color: #fde68a; border-left-color: var(--warning-fg); }
.insight-danger  { background: var(--danger-bg);  border-color: #fecaca; border-left-color: var(--danger-fg); }
.insight-info    { background: var(--info-bg);    border-color: #bfdbfe; border-left-color: var(--info-fg); }
.insight-emoji { font-size: 20px; flex-shrink: 0; margin-top: 1px; line-height: 1; }
.insight-body { flex: 1; min-width: 0; }
.insight-title { font-size: 13px; font-weight: 600; color: var(--gray-800); }
.insight-msg { font-size: 12px; color: var(--text-muted); margin-top: 2px; line-height: 1.5; }
.insight-arrow { color: var(--text-subtle); flex-shrink: 0; margin-top: 2px; }

/* ── Appointment table ──────────────────────────────── */
.table-wrap { overflow-x: auto; }
.appt-table { width: 100%; border-collapse: collapse; }
.appt-table thead th {
  padding: 10px 20px; text-align: left;
  font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em;
  color: var(--text-muted); background: var(--gray-50);
  border-bottom: 1px solid var(--gray-200); white-space: nowrap;
}
.appt-table tbody td {
  padding: 12px 20px; font-size: 13.5px; color: var(--gray-700);
  border-bottom: 1px solid var(--gray-100); vertical-align: middle;
}
.appt-table tbody tr { transition: background .15s ease; }
.appt-table tbody tr:hover { background: var(--brand-50); }
.appt-table tbody tr:last-child td { border-bottom: none; }

.time-chip {
  display: inline-flex; align-items: center;
  padding: 3px 9px; border-radius: 8px;
  background: var(--brand-50); color: var(--brand-700);
  font-size: 12.5px; font-weight: 700; font-variant-numeric: tabular-nums;
}
.person-cell { display: flex; align-items: center; gap: 10px; }
.mini-avatar {
  width: 30px; height: 30px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, var(--brand-500), var(--brand-700));
  color: #fff; font-size: 11px; font-weight: 700; flex-shrink: 0;
}
.person-name { font-weight: 500; color: var(--gray-800); }

/* ── Recent patients ────────────────────────────────── */
.patients-list { display: flex; flex-direction: column; }
.patient-row {
  display: flex; align-items: center; gap: 12px;
  padding: 11px 20px; text-decoration: none;
  border-bottom: 1px solid var(--gray-100); transition: background .15s ease;
}
.patient-row:last-child { border-bottom: none; }
.patient-row:hover { background: var(--gray-50); }
.patient-avatar {
  width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, var(--brand-500), var(--brand-700));
  color: #fff; font-size: 12px; font-weight: 700;
}
.patient-details { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.patient-name { font-size: 13.5px; font-weight: 600; color: var(--gray-800); }
.patient-meta { font-size: 11.5px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ── Chart ──────────────────────────────────────────── */
.card-body { padding: 16px 20px; }
.chart-container { height: 250px; padding: 4px 0; }

/* ── Quick actions ──────────────────────────────────── */
.quick-grid { display: flex; flex-direction: column; gap: 8px; padding: 14px 16px 16px; }
.quick-item {
  display: flex; align-items: center; gap: 11px;
  padding: 11px 12px; border-radius: 11px;
  border: 1px solid var(--gray-200); background: var(--surface);
  text-decoration: none; color: var(--gray-700);
  transition: all .18s ease;
}
.quick-item:hover { border-color: var(--brand-400); background: var(--brand-50); transform: translateX(2px); }
.quick-icon {
  width: 32px; height: 32px; border-radius: 9px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: var(--tone-bg); color: var(--tone);
}
.quick-label { flex: 1; font-size: 13px; font-weight: 500; }
.quick-arrow { color: var(--text-subtle); }
.quick-item:hover .quick-arrow { color: var(--brand-600); }

/* ── Empty state ────────────────────────────────────── */
.empty-state { text-align: center; color: var(--text-muted); padding: 40px 24px; }
.empty-state-icon { font-size: 40px; display: block; margin-bottom: 12px; opacity: .55; }
.empty-state h3 { font-size: 15px; font-weight: 600; color: var(--gray-700); margin-bottom: 6px; }
.empty-state p { font-size: 13px; max-width: 320px; margin: 0 auto; }

@keyframes spin { to { transform: rotate(360deg); } }

/* ── Responsive ─────────────────────────────────────── */
@media (max-width: 1280px) { .kpi-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
@media (max-width: 1080px) {
  .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dash-grid { grid-template-columns: 1fr; }
  .insights-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 768px) {
  .hero { padding: 18px 18px 14px; }
  .hero-title { font-size: 20px; }
  .hero-footer { flex-wrap: wrap; gap: 10px; }
  .hero-clock { margin-left: 0; }
  .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .insights-grid { grid-template-columns: 1fr; }
  .appt-table thead th, .appt-table tbody td { padding: 10px 14px; }
  .person-cell .person-name { display: none; }
}
@media (max-width: 480px) {
  .kpi-grid { grid-template-columns: 1fr; }
  .hero-actions { width: 100%; }
  .hero-btn { flex: 1; justify-content: center; }
}
</style>
