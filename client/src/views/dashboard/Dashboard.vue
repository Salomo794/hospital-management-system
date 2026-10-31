<template>
  <div class="dashboard">

    <!-- ── Page header ────────────────────────────────────── -->
    <header class="page-header">
      <div class="page-identity">
        <h1 class="page-title">{{ greetingText }}</h1>
        <p class="page-sub">{{ todayLong }} · {{ roleLabel }}</p>
      </div>

      <div class="page-actions">
        <span class="updated" role="status">
          <span class="status-dot" :class="{ busy: refreshing }" aria-hidden="true" />
          <template v-if="refreshing">{{ t('dash.refreshing') }}</template>
          <template v-else>{{ t('dash.updated', { when: updatedLabel }) }}</template>
        </span>
        <button
          type="button"
          class="btn btn-secondary btn-compact"
          :class="{ spinning: refreshing }"
          :disabled="refreshing"
          @click="refresh"
        >
          <AppIcon name="refresh" :size="15" /> {{ t('dash.refresh') }}
        </button>
        <router-link to="/ai-assistant" class="btn btn-secondary btn-compact">
          <AppIcon name="sparkles" :size="15" /> {{ t('dash.aiAssistant') }}
        </router-link>
        <router-link v-if="canViewReports" to="/reports" class="btn btn-primary btn-compact">
          <AppIcon name="bar-chart" :size="15" /> {{ t('dash.viewReports') }}
        </router-link>
      </div>
    </header>

    <!-- ── KPI strip ──────────────────────────────────────── -->
    <section class="kpi-wrap" :aria-label="t('dash.kpiLabel')">
      <div class="kpi-grid" :style="{ '--kpi-cols': loading ? 4 : kpiColumns }">
        <template v-if="loading">
          <div v-for="i in 4" :key="i" class="kpi-cell kpi-skeleton">
            <div class="skeleton skeleton-line" style="width:48%" />
            <div class="skeleton skeleton-value" />
            <div class="skeleton skeleton-line" style="width:64%" />
          </div>
        </template>
        <article
          v-else
          v-for="s in statCards"
          :key="s.key"
          class="kpi-cell"
          :class="[`tone-${s.tone}`, { attention: s.attention && s.value > 0 }]"
        >
          <div class="kpi-head">
            <span class="kpi-label">{{ s.label }}</span>
            <span class="kpi-icon"><AppIcon :name="s.icon" :size="16" /></span>
          </div>
          <div class="kpi-value">{{ formatValue(s) }}</div>
          <div class="kpi-caption">{{ s.caption }}</div>
        </article>
      </div>
    </section>

    <!-- ── Body ───────────────────────────────────────────── -->
    <div class="dash-grid">
      <div class="dash-main">

        <!-- Insights -->
        <section v-if="!loading && canViewClinical && insights.length" class="panel">
          <div class="panel-header">
            <div class="panel-title"><span class="panel-title-icon"><AppIcon name="sparkles" :size="16" /></span> {{ t('dash.insights') }}</div>
          </div>
          <div class="insights-grid">
            <template v-for="(ins, i) in insights" :key="i">
              <router-link
                v-if="ins.link && canAccessInsight(ins)"
                :to="ins.link"
                class="insight-card"
                :class="`insight-${ins.severity}`"
              >
                <span class="insight-icon"><AppIcon :name="insightIcon(ins)" :size="16" /></span>
                <div class="insight-body">
                  <div class="insight-title">{{ ins.title }}</div>
                  <div class="insight-msg">{{ ins.message }}</div>
                </div>
                <AppIcon name="chevron-right" :size="15" class="insight-arrow" />
              </router-link>
              <div v-else class="insight-card" :class="`insight-${ins.severity}`">
                <span class="insight-icon"><AppIcon :name="insightIcon(ins)" :size="16" /></span>
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
              <span class="panel-title-icon"><AppIcon name="calendar" :size="16" /></span>
              {{ t('dash.appointments') }}
              <span class="count-pill" v-if="recentAppointments.length">{{ recentAppointments.length }}</span>
            </div>
            <router-link to="/appointments" class="panel-link">
              {{ t('common.viewAll') }} <AppIcon name="chevron-right" :size="14" />
            </router-link>
          </div>
          <div class="table-wrap">
            <table class="appt-table" v-if="recentAppointments.length">
              <thead>
                <tr>
                  <th>{{ t('dash.col.time') }}</th>
                  <th>{{ t('dash.col.patient') }}</th>
                  <th>{{ t('dash.col.doctor') }}</th>
                  <th>{{ t('dash.col.status') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="a in recentAppointments" :key="a.id">
                  <td class="time-cell">{{ formatTime(a.appointment_time) }}</td>
                  <td>
                    <div class="person-cell">
                      <span class="mini-avatar" aria-hidden="true">{{ initials(a.patient_first_name, a.patient_last_name) }}</span>
                      <span class="person-name">{{ a.patient_first_name }} {{ a.patient_last_name }}</span>
                    </div>
                  </td>
                  <td class="text-muted">{{ t('dash.doctorPrefix', { name: a.doctor_last_name }) }}</td>
                  <td>
                    <span class="badge" :class="`badge-${getStatusColor(a.status)}`">
                      {{ a.status?.replace(/_/g, ' ') }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
            <div class="empty-state" v-else>
              <span class="empty-state-icon"><AppIcon name="inbox" :size="28" /></span>
              <h3>{{ t('dash.noAppointments') }}</h3>
              <p>{{ t('dash.noAppointments.hint') }}</p>
            </div>
          </div>
        </section>

        <!-- Weekly overview -->
        <section class="panel" v-if="canViewClinical">
          <div class="panel-header">
            <div class="panel-title">
              <span class="panel-title-icon"><AppIcon name="bar-chart" :size="16" /></span>
              {{ t('dash.weekly') }}
            </div>
            <span class="chip">{{ t('dash.last7') }}</span>
          </div>
          <div class="card-body">
            <div class="chart-container" v-if="weeklyStats.length">
              <BarChart :key="`${uiStore.dark ? 'dark' : 'light'}-${uiStore.locale}`" :data="weeklyChartData" :options="chartOptions" />
            </div>
            <div class="empty-state" v-else>
              <span class="empty-state-icon"><AppIcon name="bar-chart" :size="28" /></span>
              <h3>{{ t('dash.noWeekly') }}</h3>
              <p>{{ t('dash.noWeekly.hint') }}</p>
            </div>
          </div>
        </section>
      </div>

      <!-- Side column -->
      <aside class="dash-side">
        <!-- Recent patients -->
        <section class="panel" v-if="canViewClinical">
          <div class="panel-header">
            <div class="panel-title"><span class="panel-title-icon"><AppIcon name="users" :size="16" /></span> {{ t('dash.recentPatients') }}</div>
            <router-link to="/patients" class="panel-link">
              {{ t('common.viewAll') }} <AppIcon name="chevron-right" :size="14" />
            </router-link>
          </div>
          <div v-if="recentPatients.length" class="patients-list">
            <router-link
              v-for="p in recentPatients"
              :key="p.id"
              :to="`/patients/${p.id}`"
              class="patient-row"
            >
              <span class="patient-avatar" aria-hidden="true">{{ initials(p.first_name, p.last_name) }}</span>
              <span class="patient-details">
                <span class="patient-name">{{ p.first_name }} {{ p.last_name }}</span>
                <span class="patient-meta">{{ p.mrn }} · {{ p.phone || t('dash.noPhone') }}</span>
              </span>
              <span class="badge" :class="p.status === 'active' ? 'badge-success' : 'badge-gray'">{{ p.status }}</span>
            </router-link>
          </div>
          <div class="empty-state" v-else>
            <span class="empty-state-icon"><AppIcon name="users" :size="28" /></span>
            <h3>{{ t('dash.noPatients') }}</h3>
            <p>{{ t('dash.noPatients.hint') }}</p>
          </div>
        </section>

        <!-- Quick actions -->
        <section class="panel">
          <div class="panel-header">
            <div class="panel-title"><span class="panel-title-icon"><AppIcon name="activity" :size="16" /></span> {{ t('dash.quickActions') }}</div>
          </div>
          <div class="quick-grid">
            <router-link v-for="q in quickActions" :key="q.to" :to="q.to" class="quick-item">
              <span class="quick-icon"><AppIcon :name="q.icon" :size="16" /></span>
              <span class="quick-label">{{ q.label }}</span>
            </router-link>
          </div>
        </section>
      </aside>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import axios from 'axios'
import { useToast } from '../../store/toast'
import { useAuthStore } from '../../store/auth'
import { useUiStore } from '../../store/ui'
import { formatTime, getStatusColor } from '../../utils/helpers'
import { formatMoney } from '../../utils/currency'
import { useI18n } from '../../i18n'
import { localeTag } from '../../i18n/locales'
import AppIcon from '../../components/AppIcon.vue'

export default {
  name: 'Dashboard',
  components: { AppIcon },
  setup() {
    const toast      = useToast()
    const authStore  = useAuthStore()
    const uiStore    = useUiStore()
    const { t } = useI18n()
    const tag = computed(() => localeTag(uiStore.locale))
    const stats      = ref({})
    const insights   = ref([])
    const recentAppointments = ref([])
    const recentPatients     = ref([])
    const weeklyStats        = ref([])
    const loading            = ref(true)
    const refreshing         = ref(false)
    const lastUpdated        = ref(null)
    // Ticks twice a minute: enough to keep the greeting and "Updated Xm ago"
    // label honest without a clock that redraws every second.
    const clockTick = ref(Date.now())
    let clockTimer = null

    const firstName = computed(() => authStore.user?.first_name || authStore.userName || '')
    const greetingText = computed(() => {
      void clockTick.value
      const h = new Date().getHours()
      const period = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'
      // With no name on file, drop the ", name" tail instead of printing "there".
      const text = t(`dash.greeting.${period}`, { name: firstName.value })
      return firstName.value ? text : text.replace(/[,\s]*$/, '').replace(/,\s*$/, '')
    })
    const roleLabel = computed(() => {
      const role = authStore.user?.role
      return role ? role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Staff'
    })
    const todayLong = computed(() => {
      void clockTick.value
      return new Date().toLocaleDateString(tag.value, {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
      })
    })
    const updatedLabel = computed(() => {
      if (!lastUpdated.value) return t('dash.justNow')
      const seconds = Math.max(0, Math.round((clockTick.value - lastUpdated.value.getTime()) / 1000))
      if (seconds < 60) return t('dash.justNow')
      const minutes = Math.floor(seconds / 60)
      return minutes < 60 ? t('dash.minAgo', { n: minutes }) : t('dash.hoursAgo', { n: Math.floor(minutes / 60) })
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

    // `attention` marks the figures that mean "something needs doing" when they
    // are above zero. Everything else stays neutral so those few stand out.
    const statCards = computed(() => [
      { key: 'patients', label: t('kpi.patients'), caption: t('kpi.patients.caption'), value: stats.value.totalPatients || 0, icon: 'users', tone: 'teal', format: 'number', roles: ['admin', 'receptionist', 'doctor', 'nurse'] },
      { key: 'doctors', label: t('kpi.doctors'), caption: t('kpi.doctors.caption'), value: stats.value.totalDoctors || 0, icon: 'stethoscope', tone: 'blue', format: 'number' },
      { key: 'today', label: t('kpi.today'), caption: t('kpi.today.caption'), value: stats.value.todayAppointments || 0, icon: 'calendar', tone: 'violet', format: 'number', roles: ['admin', 'receptionist', 'doctor', 'nurse'] },
      { key: 'pending', label: t('kpi.pending'), caption: t('kpi.pending.caption'), value: stats.value.pendingAppointments || 0, icon: 'clock', tone: 'amber', format: 'number', roles: ['admin', 'receptionist', 'doctor', 'nurse'] },
      { key: 'todayRevenue', label: t('kpi.todayRevenue'), caption: t('kpi.todayRevenue.caption'), value: stats.value.todayRevenue || 0, icon: 'dollar', tone: 'green', format: 'currency', roles: ['admin', 'receptionist'] },
      { key: 'monthlyRevenue', label: t('kpi.monthlyRevenue'), caption: t('kpi.monthlyRevenue.caption'), value: stats.value.monthlyRevenue || 0, icon: 'trending-up', tone: 'cyan', format: 'currency', roles: ['admin', 'receptionist'] },
      { key: 'bills', label: t('kpi.bills'), caption: t('kpi.bills.caption'), value: stats.value.pendingBills || 0, icon: 'receipt', tone: 'red', attention: true, format: 'number', roles: ['admin', 'receptionist'] },
      { key: 'lab', label: t('kpi.lab'), caption: t('kpi.lab.caption'), value: stats.value.pendingLabOrders || 0, icon: 'flask', tone: 'violet', format: 'number', roles: ['admin', 'doctor', 'nurse', 'lab_technician'] },
      { key: 'stock', label: t('kpi.stock'), caption: t('kpi.stock.caption'), value: stats.value.lowStockMedications || 0, icon: 'alert-triangle', tone: 'orange', attention: true, format: 'number', roles: ['admin', 'pharmacist'] }
    ].filter(card => !card.roles || authStore.can(...card.roles)))

    // Pick a column count that divides the cards evenly so the last row is never
    // a single orphan cell (9 cards -> 3x3, 8 -> 4x2, 5 -> one row of 5).
    const kpiColumns = computed(() => {
      const n = statCards.value.length
      return [4, 3, 5, 2].find(c => n >= c && n % c === 0) || 4
    })

    // The API sends emoji for each insight; render a matching vector icon instead.
    const INSIGHT_ICONS = {
      '\u{1F3E5}': 'bed', '\u{1F6A8}': 'alert-triangle', '⏳': 'clock',
      '⚠️': 'alert-triangle', '\u{1F4C5}': 'calendar', '\u{1F4B0}': 'dollar',
      '\u{1F9EA}': 'flask', '\u{1F4C8}': 'trending-up'
    }
    const insightIcon = ins => INSIGHT_ICONS[ins.icon]
      || (ins.severity === 'danger' || ins.severity === 'warning' ? 'alert-triangle'
        : ins.severity === 'success' ? 'check-circle' : 'info')

    // Money on a dashboard is read at a glance, so whole units only; exact
    // amounts with cents live on the billing screens. The currency itself is
    // configurable (VITE_CURRENCY), see utils/currency.js.
    const formatValue = card => card.format === 'currency'
      ? formatMoney(card.value, { whole: true })
      : Math.round(Number(card.value) || 0).toLocaleString(tag.value)

    const weeklyChartData = computed(() => ({
      labels: weeklyStats.value.map(d => fmtDay(d.date)),
      datasets: [
        {
          label: t('dash.chart.completed'),
          data: weeklyStats.value.map(d => d.completed || 0),
          backgroundColor: '#0f766e',
          hoverBackgroundColor: '#0d9488',
          borderRadius: 3,
          borderSkipped: false,
          maxBarThickness: 30,
          stack: 'appointments'
        },
        {
          label: t('dash.chart.other'),
          data: weeklyStats.value.map(d => Math.max(0, (d.count || 0) - (d.completed || 0) - (d.cancelled || 0))),
          backgroundColor: '#94a3b8',
          hoverBackgroundColor: '#64748b',
          borderRadius: 3,
          borderSkipped: false,
          maxBarThickness: 30,
          stack: 'appointments'
        },
        {
          label: t('dash.chart.cancelled'),
          data: weeklyStats.value.map(d => d.cancelled || 0),
          backgroundColor: '#dc2626',
          hoverBackgroundColor: '#b91c1c',
          borderRadius: 3,
          borderSkipped: false,
          maxBarThickness: 30,
          stack: 'appointments'
        }
      ]
    }))

    const chartOptions = computed(() => {
      const dark = uiStore.dark
      const tick = dark ? '#8b95a5' : '#64748b'
      return {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, position: 'top', align: 'start', labels: { usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 9, boxHeight: 9, padding: 16, font: { family: 'Inter', size: 12 }, color: tick } },
          tooltip: {
            backgroundColor: dark ? '#0a1019' : '#0f172a', titleColor: '#f1f5f9', bodyColor: '#cbd5e1',
            borderColor: dark ? '#2a3444' : '#1e293b', borderWidth: 1,
            titleFont: { family: 'Inter', weight: '600' },
            bodyFont: { family: 'Inter' },
            padding: 10, cornerRadius: 6, boxPadding: 5, usePointStyle: true
          }
        },
        scales: {
          y: { stacked: true, beginAtZero: true, ticks: { precision: 0, color: tick, font: { family: 'Inter', size: 11 } }, grid: { color: dark ? '#2a3444' : '#e2e8f0', drawBorder: false }, border: { display: false } },
          x: { stacked: true, ticks: { color: tick, font: { family: 'Inter', size: 11 } }, grid: { display: false }, border: { color: dark ? '#2a3444' : '#cbd5e1' } }
        }
      }
    })

    const quickActions = computed(() => [
      { to: '/patients', icon: 'users', label: t('nav.patients'), roles: ['admin', 'receptionist', 'doctor', 'nurse'] },
      { to: '/appointments', icon: 'calendar', label: t('nav.appointments'), roles: ['admin', 'receptionist', 'doctor', 'nurse'] },
      { to: '/emr', icon: 'clipboard', label: t('nav.records'), roles: ['admin', 'doctor', 'nurse'] },
      { to: '/pharmacy', icon: 'pill', label: t('nav.pharmacy'), roles: ['admin', 'pharmacist'] },
      { to: '/laboratory', icon: 'flask', label: t('nav.laboratory'), roles: ['admin', 'doctor', 'nurse', 'lab_technician'] },
      { to: '/billing', icon: 'credit-card', label: t('nav.billing'), roles: ['admin', 'receptionist'] }
    ].filter(action => authStore.can(...action.roles)))

    const fmtDay = d => new Date(d + 'T00:00:00').toLocaleDateString(tag.value, { weekday: 'short' })

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
        toast.error(t('dash.loadFailed'))
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
      clockTimer = setInterval(() => { clockTick.value = Date.now() }, 30000)
      loadDashboard()
    })

    onUnmounted(() => {
      if (clockTimer) clearInterval(clockTimer)
    })

    return {
      loading, refreshing, stats, statCards, kpiColumns, insightIcon, insights,
      recentAppointments, recentPatients,
      weeklyStats, weeklyChartData, chartOptions,
      quickActions, greetingText, firstName, roleLabel, todayLong, updatedLabel, t,
      uiStore, canViewClinical, canViewReports,
      canAccessInsight, formatTime, getStatusColor, formatValue, initials, refresh,
    }
  }
}
</script>

<style scoped>
.dashboard { animation: dashIn .3s ease both; }
@keyframes dashIn { from { opacity: 0; } to { opacity: 1; } }

/* ── Page header ────────────────────────────────────── */
.page-header {
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px; flex-wrap: wrap;
  margin-bottom: 20px;
}
.page-title { font-size: 22px; font-weight: 650; letter-spacing: -.02em; line-height: 1.25; color: var(--gray-900); }
.page-sub { font-size: 13px; color: var(--text-muted); margin-top: 3px; }
.page-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.btn-compact { padding: 7px 13px; font-size: 13px; text-decoration: none; }
.btn-compact:hover { transform: none; }
.btn-primary.btn-compact { color: #fff; }
.btn-primary.btn-compact:hover { color: #fff; }
.btn-secondary.btn-compact { color: var(--gray-700); }

.updated {
  display: inline-flex; align-items: center; gap: 7px;
  font-size: 12px; color: var(--text-muted); margin-right: 6px;
}
.status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--success); flex-shrink: 0; }
.status-dot.busy { background: var(--warning); }
.spinning :deep(.app-icon) { animation: spin .8s linear infinite; }

/* ── KPI strip ──────────────────────────────────────── */
.kpi-wrap {
  background: var(--surface);
  border: 1px solid var(--gray-200);
  border-radius: 12px;
  box-shadow: var(--shadow-xs);
  overflow: hidden;
  margin-bottom: 20px;
}
/* Each cell draws its right and bottom rule; the negative margin pushes the
   outermost rules under the wrapper's own border so no edge is doubled. */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(var(--kpi-cols, 4), minmax(0, 1fr));
  margin: 0 -1px -1px 0;
}
.kpi-cell {
  padding: 16px 20px 15px;
  border-right: 1px solid var(--gray-200);
  border-bottom: 1px solid var(--gray-200);
  min-width: 0;
}
.kpi-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.kpi-label { font-size: 12.5px; font-weight: 500; color: var(--text-muted); }
.kpi-icon { display: inline-flex; color: var(--text-subtle); flex-shrink: 0; }
.kpi-value {
  font-size: 26px; font-weight: 650; color: var(--gray-900);
  letter-spacing: -.03em; margin-top: 8px; line-height: 1.15;
  font-variant-numeric: tabular-nums;
}
.kpi-caption { font-size: 12px; color: var(--text-subtle); margin-top: 3px; }

/* Only figures that need action pick up colour. */
.kpi-cell.attention .kpi-icon { color: var(--tone); }
.kpi-cell.attention .kpi-caption { color: var(--tone); font-weight: 500; }

.kpi-skeleton { display: flex; flex-direction: column; gap: 10px; }
.skeleton-line { height: 12px; margin: 0; }
.skeleton-value { height: 26px; width: 42%; margin: 0; }

/* Tones are only used for the attention state, so keep text-safe shades. */
.tone-red    { --tone: #b91c1c; }
.tone-orange { --tone: #c2410c; }
[data-theme="dark"] .tone-red    { --tone: #fca5a5; }
[data-theme="dark"] .tone-orange { --tone: #fdba74; }

/* ── Layout ─────────────────────────────────────────── */
.dash-grid {
  display: grid;
  grid-template-columns: minmax(0, 2.1fr) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}
.dash-main, .dash-side { display: flex; flex-direction: column; gap: 20px; min-width: 0; }

/* ── Panels ─────────────────────────────────────────── */
.panel {
  background: var(--surface);
  border-radius: 12px;
  border: 1px solid var(--gray-200);
  box-shadow: var(--shadow-xs);
  overflow: hidden;
}
.panel-header {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 13px 18px; border-bottom: 1px solid var(--gray-200);
}
.panel-title { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; color: var(--gray-900); }
.panel-title-icon { display: inline-flex; color: var(--text-subtle); }
.count-pill {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; height: 20px; padding: 0 6px; border-radius: 9999px;
  background: var(--gray-100); color: var(--gray-600);
  font-size: 11.5px; font-weight: 600; font-variant-numeric: tabular-nums;
}
.panel-link {
  display: inline-flex; align-items: center; gap: 2px;
  font-size: 12.5px; font-weight: 600; color: var(--brand-700); text-decoration: none;
  white-space: nowrap;
}
.panel-link:hover { color: var(--brand-800); text-decoration: underline; }
[data-theme="dark"] .panel-link { color: var(--brand-300); }
[data-theme="dark"] .panel-link:hover { color: var(--brand-200); }

.chip {
  font-size: 11.5px; font-weight: 500; padding: 3px 10px; border-radius: 6px;
  background: var(--gray-100); color: var(--gray-600); white-space: nowrap;
}

/* ── Insights ───────────────────────────────────────── */
.insights-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; padding: 16px 18px; }
.insight-card {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 12px 14px; border-radius: 8px;
  background: var(--surface); border: 1px solid var(--gray-200); border-left-width: 3px;
  text-decoration: none; transition: border-color .15s, background-color .15s;
}
a.insight-card:hover { border-color: var(--gray-300); background: var(--gray-50); }
.insight-success { border-left-color: var(--success-fg); }
.insight-warning { border-left-color: var(--warning-fg); }
.insight-danger  { border-left-color: var(--danger-fg); }
.insight-info    { border-left-color: var(--info-fg); }
.insight-icon { flex-shrink: 0; margin-top: 1px; display: flex; color: var(--text-muted); }
.insight-success .insight-icon { color: var(--success-fg); }
.insight-warning .insight-icon { color: var(--warning-fg); }
.insight-danger  .insight-icon { color: var(--danger-fg); }
.insight-info    .insight-icon { color: var(--info-fg); }
.insight-body { flex: 1; min-width: 0; }
.insight-title { font-size: 13px; font-weight: 600; color: var(--gray-900); }
.insight-msg { font-size: 12.5px; color: var(--text-muted); margin-top: 2px; line-height: 1.5; }
.insight-arrow { color: var(--text-subtle); flex-shrink: 0; margin-top: 2px; }

/* ── Appointment table ──────────────────────────────── */
.table-wrap { overflow-x: auto; }
.appt-table { width: 100%; border-collapse: collapse; }
.appt-table thead th {
  padding: 9px 18px; text-align: left;
  font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em;
  color: var(--text-muted); background: var(--gray-50);
  border-bottom: 1px solid var(--gray-200); white-space: nowrap;
}
.appt-table tbody td {
  padding: 11px 18px; font-size: 13.5px; color: var(--gray-700);
  border-bottom: 1px solid var(--gray-100); vertical-align: middle;
}
.appt-table tbody tr { transition: background .15s ease; }
.appt-table tbody tr:hover { background: var(--gray-50); }
.appt-table tbody tr:last-child td { border-bottom: none; }

.time-cell { font-weight: 600; color: var(--gray-900); font-variant-numeric: tabular-nums; white-space: nowrap; }
.person-cell { display: flex; align-items: center; gap: 10px; }
.mini-avatar, .patient-avatar {
  border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: var(--gray-100); color: var(--gray-600);
  border: 1px solid var(--gray-200);
  font-weight: 600;
}
.mini-avatar { width: 28px; height: 28px; font-size: 10.5px; }
.person-name { font-weight: 500; color: var(--gray-900); }

/* ── Recent patients ────────────────────────────────── */
.patients-list { display: flex; flex-direction: column; }
.patient-row {
  display: flex; align-items: center; gap: 12px;
  padding: 11px 18px; text-decoration: none;
  border-bottom: 1px solid var(--gray-100); transition: background .15s ease;
}
.patient-row:last-child { border-bottom: none; }
.patient-row:hover { background: var(--gray-50); }
.patient-avatar { width: 34px; height: 34px; font-size: 11.5px; }
.patient-details { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.patient-name { font-size: 13.5px; font-weight: 600; color: var(--gray-900); }
.patient-meta { font-size: 12px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ── Chart ──────────────────────────────────────────── */
.card-body { padding: 14px 18px 16px; }
.chart-container { height: 260px; }

/* ── Quick actions ──────────────────────────────────── */
.quick-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; padding: 16px 18px; }
.quick-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border-radius: 8px;
  border: 1px solid var(--gray-200); background: var(--surface);
  text-decoration: none; color: var(--gray-800);
  transition: border-color .15s ease, background-color .15s ease;
}
.quick-item:hover { border-color: var(--brand-600); background: var(--gray-50); }
.quick-icon { display: inline-flex; color: var(--brand-700); flex-shrink: 0; }
.quick-label { font-size: 13px; font-weight: 500; line-height: 1.3; min-width: 0; overflow-wrap: anywhere; }

/* ── Empty state ────────────────────────────────────── */
.empty-state { text-align: center; color: var(--text-muted); padding: 36px 24px; }
.empty-state-icon { display: inline-flex; margin-bottom: 10px; color: var(--text-subtle); }
.empty-state h3 { font-size: 14px; font-weight: 600; color: var(--gray-800); margin-bottom: 4px; }
.empty-state p { font-size: 13px; max-width: 320px; margin: 0 auto; }

@keyframes spin { to { transform: rotate(360deg); } }

/* ── Responsive ─────────────────────────────────────── */
@media (max-width: 1080px) {
  .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dash-grid { grid-template-columns: 1fr; }
  .insights-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 768px) {
  .page-title { font-size: 20px; }
  .insights-grid { grid-template-columns: 1fr; }
  .appt-table thead th, .appt-table tbody td { padding: 10px 14px; }
  .person-cell .person-name { display: none; }
}
@media (max-width: 480px) {
  .kpi-grid { grid-template-columns: 1fr; }
  .page-actions { width: 100%; }
  .page-actions .btn { flex: 1; }
  .updated { width: 100%; margin-right: 0; }
}
</style>
