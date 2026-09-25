<template>
  <div class="layout">
    <!-- Mobile backdrop -->
    <Transition name="backdrop-fade">
      <div v-if="mobileOpen" class="mobile-backdrop" @click="mobileOpen = false" />
    </Transition>

    <!-- ──── SIDEBAR ──── -->
    <aside class="sidebar" :class="{ 'is-collapsed': collapsed, 'is-open': mobileOpen }" role="navigation" aria-label="Main navigation">
      <!-- Logo -->
      <div class="sidebar-brand">
        <div class="brand-mark">
          <span v-html="icons.cross" />
        </div>
        <Transition name="label-fade">
          <div class="brand-copy" v-if="!collapsed">
            <span class="brand-name">MediCare</span>
            <span class="brand-tag">Clinical Suite</span>
          </div>
        </Transition>
        <button class="sidebar-collapse-btn" @click="toggleSidebar" :aria-label="collapsed ? 'Expand sidebar' : 'Collapse sidebar'">
          <span v-html="collapsed ? icons.chevronRight : icons.chevronLeft" />
        </button>
      </div>

      <!-- Nav -->
      <nav class="sidebar-nav">
        <template v-for="section in navSections" :key="section.title">
          <div class="nav-section-label" v-if="!collapsed">{{ section.title }}</div>
          <div class="nav-section-divider" v-else />
          <router-link
            v-for="item in section.items"
            :key="item.to"
            :to="item.to"
            class="nav-link"
            :class="{ 'nav-link--active': isActive(item) }"
            :title="collapsed ? item.label : ''"
            @click="closeMobile"
          >
            <span class="nav-link-icon" v-html="item.icon" />
            <span class="nav-link-text" v-show="!collapsed">{{ item.label }}</span>
            <span class="nav-link-badge" v-if="item.badge && !collapsed">{{ item.badge }}</span>
          </router-link>
        </template>
      </nav>

      <!-- Footer -->
      <div class="sidebar-foot" v-show="!collapsed">
        <div class="facility-status">
          <span class="facility-pulse" />
          <div class="facility-info">
            <span class="facility-name">Central General</span>
            <span class="facility-sub">Systems operational</span>
          </div>
        </div>
      </div>
    </aside>

    <!-- ──── MAIN ──── -->
    <main class="main-area" :class="{ 'main-area--wide': collapsed }">
      <!-- Top header -->
      <header class="top-bar">
        <div class="top-bar-left">
          <button class="hamburger" @click="mobileOpen = !mobileOpen" aria-label="Toggle menu">
            <span v-html="icons.menu" />
          </button>
          <div class="breadcrumb">
            <span class="breadcrumb-section">{{ pageSection }}</span>
            <span class="breadcrumb-sep" v-html="icons.chevronSmall" />
            <span class="breadcrumb-page">{{ pageTitle }}</span>
          </div>
        </div>

        <div class="top-bar-right">
          <div class="header-clock">
            <span class="clock-icon" v-html="icons.calendar" />
            {{ todayLabel }}
          </div>

          <div class="status-pill">
            <span class="status-dot" />
            Live
          </div>

          <!-- Theme toggle -->
          <button
            class="icon-btn"
            @click="uiStore.toggleDark()"
            :aria-label="uiStore.dark ? 'Switch to light mode' : 'Switch to dark mode'"
            :title="uiStore.dark ? 'Light mode' : 'Dark mode'"
          >
            <span v-html="uiStore.dark ? icons.sun : icons.moon" />
          </button>

          <!-- Notification bell -->
          <button
            class="icon-btn"
            :class="{ 'icon-btn--active': panelOpen }"
            @click="panelOpen = !panelOpen"
            aria-label="Notifications"
          >
            <span v-html="icons.bell" />
            <span class="notif-badge" v-if="unreadCount > 0">{{ unreadCount > 99 ? '99+' : unreadCount }}</span>
          </button>

          <!-- User menu -->
          <div class="user-chip" @click="dropdownOpen = !dropdownOpen" :class="{ 'user-chip--open': dropdownOpen }">
            <div class="user-avatar-wrap">
              {{ authStore.userName?.charAt(0)?.toUpperCase() || '?' }}
            </div>
            <div class="user-meta" v-if="!isMobile">
              <span class="user-display-name">{{ authStore.userName }}</span>
              <span class="user-role-tag">{{ formatRole(authStore.userRole) }}</span>
            </div>
            <span class="chevron-icon" :class="{ flipped: dropdownOpen }" v-html="icons.chevronDown" />

            <Transition name="dropdown-pop">
              <div class="user-dropdown" v-if="dropdownOpen" @click.stop>
                <div class="dropdown-profile">
                  <div class="dropdown-avatar">{{ authStore.userName?.charAt(0)?.toUpperCase() }}</div>
                  <div>
                    <div class="dropdown-name">{{ authStore.userName }}</div>
                    <div class="dropdown-email">{{ authStore.user?.email }}</div>
                  </div>
                </div>
                <div class="dropdown-divider" />
                <button class="dropdown-item dropdown-item--danger" @click="logout">
                  <span v-html="icons.logout" />
                  Sign out
                </button>
              </div>
            </Transition>
          </div>
        </div>
      </header>

      <!-- Page content -->
      <div class="page-wrap">
        <router-view v-slot="{ Component }">
          <Transition name="page-slide" mode="out-in">
            <component :is="Component" :key="route.fullPath" />
          </Transition>
        </router-view>
      </div>
    </main>

    <!-- ──── NOTIFICATION PANEL ──── -->
    <Transition name="panel-slide">
      <div class="notif-panel" v-if="panelOpen">
        <div class="notif-overlay" @click="panelOpen = false" />
        <div class="notif-drawer">
          <div class="notif-header">
            <h2 class="notif-title">Notifications</h2>
            <div class="notif-header-actions">
              <span class="unread-chip" v-if="unreadCount">{{ unreadCount }} new</span>
              <button class="btn btn-sm btn-primary" @click="markAllRead">Mark all read</button>
              <button class="icon-btn" @click="panelOpen = false" aria-label="Close notifications">
                <span v-html="icons.close" />
              </button>
            </div>
          </div>

          <div class="notif-body">
            <button
              v-for="n in notifications"
              :key="n.id"
              type="button"
              class="notif-item"
              :class="{ 'notif-item--unread': !n.is_read }"
              @click="openNotification(n)"
            >
              <span class="notif-type-dot" :class="typeColor(n.type)" />
              <span class="notif-content">
                <span class="notif-item-title">{{ n.title }}</span>
                <span class="notif-item-msg">{{ n.message }}</span>
                <span class="notif-item-time">{{ relativeTime(n.created_at) }}</span>
              </span>
            </button>

            <div class="notif-empty" v-if="notifications.length === 0">
              <span class="notif-empty-icon" v-html="icons.bellBig" />
              <p>You're all caught up</p>
              <small>No new notifications right now.</small>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../store/auth'
import { useUiStore } from '../store/ui'
import axios from 'axios'

/* ── inline SVG helper ── */
const s = (d, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`

const icons = {
  cross:        s('<path d="M12 5v14M5 12h14"/>'),
  menu:         s('<path d="M3 6h18M3 12h18M3 18h18"/>'),
  bell:         s('<path d="M18 8.5a6 6 0 1 0-12 0c0 6.5-2.5 8.5-2.5 8.5h17s-2.5-2-2.5-8.5"/><path d="M13.7 20.5a2 2 0 0 1-3.4 0"/>'),
  bellBig:      s('<path d="M18 8.5a6 6 0 1 0-12 0c0 6.5-2.5 8.5-2.5 8.5h17s-2.5-2-2.5-8.5"/><path d="M13.7 20.5a2 2 0 0 1-3.4 0"/>', 'width="40" height="40" stroke-width="1.2"'),
  close:        s('<path d="M18 6L6 18M6 6l12 12"/>'),
  logout:       s('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>'),
  chevronLeft:  s('<path d="M15 18l-6-6 6-6"/>'),
  chevronRight: s('<path d="M9 18l6-6-6-6"/>'),
  chevronDown:  s('<path d="M6 9l6 6 6-6"/>'),
  chevronSmall: s('<path d="M9 18l6-6-6-6"/>', 'width="14" height="14"'),
  calendar:     s('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
  sun:          s('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>'),
  moon:         s('<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/>'),

  // nav icons
  dashboard:    s('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
  patients:     s('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  doctors:      s('<path d="M15 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/>'),
  appointments: s('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M8.5 14h3"/>'),
  records:      s('<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1.2"/><path d="M8.5 12.5h7M8.5 16.5h4.5"/>'),
  pharmacy:     s('<path d="M10.5 20.5 3.6 13.6a4.9 4.9 0 0 1 6.9-6.9l6.9 6.9a4.9 4.9 0 0 1-6.9 6.9Z"/><path d="M8.2 8.2l6.9 6.9"/>'),
  procurement:  s('<path d="M3 21h18"/><path d="M5 21V8l7-4 7 4v13"/><path d="M9.5 11h5v4h-5z"/>'),
  ward:         s('<path d="M4 21V5.5A2.5 2.5 0 0 1 6.5 3h7A2.5 2.5 0 0 1 16 5.5V21"/><path d="M16 10h2.5A2.5 2.5 0 0 1 21 12.5V21"/><path d="M9.5 7.5h3M11 6v3"/><path d="M2 21h20"/>'),
  laboratory:   s('<path d="M9.5 2.5h5"/><path d="M10.5 2.5v6.4L5 18.2A2 2 0 0 0 6.7 21.2h10.6A2 2 0 0 0 19 18.2l-5.5-9.3V2.5"/><path d="M7.6 15h8.8"/>'),
  billing:      s('<rect x="2.5" y="5" width="19" height="14" rx="2.4"/><path d="M2.5 9.8h19"/><path d="M6.5 14.6h3.5"/>'),
  reports:      s('<path d="M3.5 3.5v17h17"/><path d="M7.5 17v-4.5M12 17V8M16.5 17v-6.5"/>'),
  ai:           s('<path d="M12 3l2 5.5 5.5 2-5.5 2L12 18l-2-5.5L4.5 10.5l5.5-2L12 3Z"/><path d="M18.6 16.4l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8.8-1.9Z"/>'),
  users:        s('<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>'),
  audit:        s('<path d="M9 4h9a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1z"/><path d="M17 5h1a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h1"/><path d="M8 11h8M8 15h5"/>'),
}

const routeMeta = [
  { prefix: '/dashboard',    label: 'Dashboard',               section: 'Overview' },
  { prefix: '/patients',     label: 'Patient Management',       section: 'Clinical' },
  { prefix: '/doctors',      label: 'Doctor Management',        section: 'Clinical' },
  { prefix: '/appointments', label: 'Appointments',             section: 'Clinical' },
  { prefix: '/emr',          label: 'Medical Records',          section: 'Clinical' },
  { prefix: '/pharmacy',     label: 'Pharmacy',                 section: 'Departments' },
  { prefix: '/procurement',  label: 'Procurement',              section: 'Departments' },
  { prefix: '/ward',         label: 'Wards & Beds',             section: 'Departments' },
  { prefix: '/laboratory',   label: 'Laboratory',               section: 'Departments' },
  { prefix: '/billing',      label: 'Billing & Payments',       section: 'Departments' },
  { prefix: '/reports',      label: 'Reports & Analytics',      section: 'Insights' },
  { prefix: '/ai-assistant', label: 'AI Assistant',             section: 'Insights' },
  { prefix: '/users',        label: 'User Management',          section: 'Administration' },
  { prefix: '/audit-log',    label: 'Audit Log',                section: 'Administration' },
]

export default {
  name: 'Layout',
  setup() {
    const route      = useRoute()
    const router     = useRouter()
    const authStore  = useAuthStore()
    const uiStore    = useUiStore()

    const collapsed = computed({
      get: () => uiStore.sidebarCollapsed,
      set: value => uiStore.setSidebarCollapsed(value)
    })
    const clockTick = ref(Date.now())
    const mobileOpen     = ref(false)
    const dropdownOpen   = ref(false)
    const panelOpen      = ref(false)
    const notifications  = ref([])
    const unreadCount    = ref(0)
    const isMobile       = ref(window.innerWidth < 768)
    let   notifTimer     = null
    let   clockTimer     = null

    /* ── nav sections ── */
    const navSections = computed(() => {
      const sections = [
        { title: 'Overview', items: [
          { to: '/dashboard', label: 'Dashboard', icon: icons.dashboard, exact: true }
        ]},
        { title: 'Clinical', items: [
          { to: '/patients', label: 'Patients', icon: icons.patients, roles: ['admin', 'receptionist', 'doctor', 'nurse'] },
          { to: '/doctors', label: 'Doctors', icon: icons.doctors },
          { to: '/appointments', label: 'Appointments', icon: icons.appointments, roles: ['admin', 'receptionist', 'doctor', 'nurse'] },
          { to: '/emr', label: 'Medical Records', icon: icons.records, roles: ['admin', 'doctor', 'nurse'] }
        ]},
        { title: 'Departments', items: [
          { to: '/pharmacy', label: 'Pharmacy', icon: icons.pharmacy, roles: ['admin', 'pharmacist'] },
          { to: '/procurement', label: 'Procurement', icon: icons.procurement, roles: ['admin', 'pharmacist'] },
          { to: '/ward', label: 'Wards & Beds', icon: icons.ward, roles: ['admin', 'receptionist', 'doctor', 'nurse'] },
          { to: '/laboratory', label: 'Laboratory', icon: icons.laboratory, roles: ['admin', 'doctor', 'nurse', 'lab_technician'] },
          { to: '/billing', label: 'Billing', icon: icons.billing, roles: ['admin', 'receptionist'] }
        ]},
        { title: 'Insights', items: [
          { to: '/reports', label: 'Reports', icon: icons.reports, roles: ['admin', 'receptionist', 'doctor', 'nurse'] },
          { to: '/ai-assistant', label: 'AI Assistant', icon: icons.ai }
        ]},
        { title: 'Admin', items: [
          { to: '/users', label: 'Users', icon: icons.users, exact: true, roles: ['admin'] },
          { to: '/audit-log', label: 'Audit Log', icon: icons.audit, roles: ['admin'] }
        ]}
      ]
      return sections
        .map(section => ({ ...section, items: section.items.filter(item => !item.roles || authStore.can(...item.roles)) }))
        .filter(section => section.items.length > 0)
    })

    const currentMeta = computed(() =>
      [...routeMeta].reverse().find(r => route.path.startsWith(r.prefix)) ||
      { label: 'Home', section: 'Overview' }
    )
    const pageTitle   = computed(() => currentMeta.value.label)
    const pageSection = computed(() => currentMeta.value.section)
    const todayLabel  = computed(() => {
      void clockTick.value
      return new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
    })

    const isActive = item => item.exact ? route.path === item.to : route.path.startsWith(item.to)

    const toggleSidebar = () => {
      if (window.innerWidth < 768) mobileOpen.value = !mobileOpen.value
      else collapsed.value = !collapsed.value
    }
    const closeMobile = () => { if (window.innerWidth < 768) mobileOpen.value = false }

    const formatRole = role => role ? role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : ''
    const typeColor = type => ({
      admission: 'dot-teal', appointment: 'dot-blue', lab: 'dot-purple',
      billing: 'dot-orange', procurement: 'dot-teal', system: 'dot-gray'
    })[type] || 'dot-gray'

    const relativeTime = dateStr => {
      if (!dateStr) return ''
      const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000)
      if (diff < 60) return 'Just now'
      if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
      if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
      return new Date(dateStr).toLocaleDateString()
    }

    const loadNotifications = async () => {
      try {
        const { data } = await axios.get('/api/notifications')
        notifications.value = data.notifications
        unreadCount.value   = data.unread_count
      } catch { /* silent */ }
    }

    const markAllRead = async () => {
      try {
        await axios.put('/api/notifications/read-all')
        notifications.value.forEach(n => (n.is_read = 1))
        unreadCount.value = 0
      } catch { /* silent */ }
    }

    const openNotification = async notification => {
      panelOpen.value = false
      if (!notification.is_read) {
        try {
          await axios.put(`/api/notifications/${notification.id}/read`)
          notification.is_read = 1
          unreadCount.value = Math.max(unreadCount.value - 1, 0)
        } catch {
          return
        }
      }
      if (typeof notification.link === 'string' && notification.link.startsWith('/')) {
        router.push(notification.link)
      }
    }

    const logout = () => { authStore.logout(); router.push('/login') }

    const onResize = () => { isMobile.value = window.innerWidth < 768; if (window.innerWidth >= 768) mobileOpen.value = false }

    /* close dropdown/panel on outside click */
    const onDocClick = e => {
      if (!e.target.closest('.user-chip'))  dropdownOpen.value = false
    }

    onMounted(() => {
      loadNotifications()
      notifTimer = setInterval(loadNotifications, 30000)
      clockTimer = setInterval(() => { clockTick.value = Date.now() }, 60000)
      window.addEventListener('resize', onResize)
      document.addEventListener('click', onDocClick)
    })
    onUnmounted(() => {
      clearInterval(notifTimer)
      clearInterval(clockTimer)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('click', onDocClick)
    })

    return {
      route,
      authStore, uiStore, collapsed, mobileOpen, dropdownOpen, panelOpen,
      notifications, unreadCount, isMobile,
      navSections, pageTitle, pageSection, todayLabel,
      isActive, toggleSidebar, closeMobile,
      formatRole, typeColor, relativeTime,
      loadNotifications, markAllRead, openNotification, logout,
      icons,
    }
  }
}
</script>

<style scoped>
/* ══════════════════════════════════════
   Layout shell
══════════════════════════════════════ */
.layout {
  display: flex;
  min-height: 100vh;
  background: var(--bg-app);
}

/* ══════════════════════════════════════
   SIDEBAR
══════════════════════════════════════ */
.sidebar {
  width: 244px;
  background: linear-gradient(180deg, #0a1a22 0%, #0d1f26 40%, #091519 100%);
  color: #fff;
  display: flex;
  flex-direction: column;
  position: fixed;
  top: 0; left: 0; bottom: 0;
  z-index: 100;
  transition: width 0.3s cubic-bezier(.4,0,.2,1), transform 0.3s ease;
  overflow: hidden;
}

/* Decorative glow behind the sidebar */
.sidebar::before {
  content: '';
  position: absolute;
  top: -80px; left: -60px;
  width: 280px; height: 280px;
  background: radial-gradient(circle, rgba(20,184,166,.18) 0%, transparent 70%);
  pointer-events: none;
  border-radius: 50%;
  animation: sideGlow 8s ease-in-out infinite alternate;
}
@keyframes sideGlow {
  0%   { transform: translate(0,0) scale(1); opacity: .8; }
  100% { transform: translate(20px,30px) scale(1.15); opacity: 1; }
}

.sidebar.is-collapsed { width: 68px; }

@media (max-width: 768px) {
  .sidebar { transform: translateX(-100%); width: 244px !important; }
  .sidebar.is-open { transform: translateX(0); box-shadow: 8px 0 40px rgba(0,0,0,.4); }
}

/* Brand */
.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 18px 14px;
  border-bottom: 1px solid rgba(255,255,255,.06);
  min-height: 64px;
  flex-shrink: 0;
}

.brand-mark {
  width: 36px; height: 36px; border-radius: 10px;
  background: linear-gradient(135deg, #14b8a6, #0d9488);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(20,184,166,.4);
}
.brand-mark :deep(svg) { width: 20px; height: 20px; stroke: #fff; stroke-width: 2.4; }

.brand-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.brand-name { font-size: 17px; font-weight: 700; letter-spacing: -.03em; white-space: nowrap; color: #fff; }
.brand-tag  { font-size: 9.5px; color: rgba(255,255,255,.4); letter-spacing: .12em; text-transform: uppercase; }

.sidebar-collapse-btn {
  margin-left: auto;
  width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,.07);
  border: none; border-radius: 7px;
  color: rgba(255,255,255,.5);
  cursor: pointer;
  transition: background .2s, color .2s;
  flex-shrink: 0;
}
.sidebar-collapse-btn:hover { background: rgba(255,255,255,.14); color: #fff; }
.sidebar-collapse-btn :deep(svg) { width: 15px; height: 15px; }

/* Nav */
.sidebar-nav {
  flex: 1;
  padding: 8px 0 16px;
  overflow-y: auto; overflow-x: hidden;
}
.sidebar-nav::-webkit-scrollbar { width: 0; }

.nav-section-label {
  padding: 14px 18px 5px;
  font-size: 9.5px; font-weight: 700;
  text-transform: uppercase; letter-spacing: .1em;
  color: rgba(255,255,255,.28);
}
.nav-section-divider {
  height: 1px; background: rgba(255,255,255,.06);
  margin: 8px 14px;
}

.nav-link {
  display: flex; align-items: center;
  gap: 11px; margin: 1px 10px;
  padding: 9px 12px;
  color: rgba(255,255,255,.65);
  text-decoration: none; border-radius: 8px;
  font-size: 13px; font-weight: 500;
  transition: background .15s, color .15s;
  position: relative;
  white-space: nowrap; overflow: hidden;
}
.nav-link:hover { background: rgba(255,255,255,.07); color: #fff; }
.nav-link--active {
  background: rgba(20,184,166,.18);
  color: #fff;
}
.nav-link--active::before {
  content: '';
  position: absolute; left: 0; top: 20%; bottom: 20%;
  width: 3px; border-radius: 0 2px 2px 0;
  background: #14b8a6;
  margin-left: -10px;
}
.nav-link-icon { width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; opacity: .75; transition: opacity .15s; }
.nav-link:hover .nav-link-icon,
.nav-link--active .nav-link-icon { opacity: 1; color: #5eead4; }
.nav-link-icon :deep(svg) { width: 17px; height: 17px; }

.nav-link-text { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.nav-link-badge { background: rgba(20,184,166,.3); color: #5eead4; font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 10px; flex-shrink: 0; }

/* collapsed overrides */
.is-collapsed .nav-link { justify-content: center; padding: 10px 0; margin: 2px 10px; gap: 0; }
.is-collapsed .nav-link::before { left: 2px; margin-left: 0; }

/* Footer */
.sidebar-foot {
  padding: 12px 14px 16px;
  border-top: 1px solid rgba(255,255,255,.06);
  flex-shrink: 0;
}
.facility-status {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 11px; border-radius: 9px;
  background: rgba(255,255,255,.04);
}
.facility-pulse {
  width: 8px; height: 8px; border-radius: 50%;
  background: #2dd4bf; flex-shrink: 0;
  animation: breathe 2.5s ease-in-out infinite;
}
@keyframes breathe { 0%,100%{box-shadow:0 0 0 0 rgba(45,212,191,.4)}50%{box-shadow:0 0 0 6px rgba(45,212,191,0)} }
.facility-info { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.facility-name { font-size: 11.5px; font-weight: 600; color: rgba(255,255,255,.8); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.facility-sub  { font-size: 10px; color: rgba(255,255,255,.35); }

/* ══════════════════════════════════════
   MAIN AREA
══════════════════════════════════════ */
.main-area {
  flex: 1;
  margin-left: 244px;
  display: flex; flex-direction: column;
  transition: margin-left 0.3s cubic-bezier(.4,0,.2,1);
  min-width: 0;
}
.main-area--wide { margin-left: 68px; }
@media (max-width: 768px) { .main-area, .main-area--wide { margin-left: 0; } }

/* ══════════════════════════════════════
   TOP BAR
══════════════════════════════════════ */
.top-bar {
  display: flex; align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 26px;
  height: 62px;
  background: var(--header-bg);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border-bottom: 1px solid var(--header-border);
  box-shadow: 0 1px 0 rgba(0,0,0,.04), 0 4px 20px rgba(0,0,0,.05);
  position: sticky; top: 0; z-index: 50;
  flex-shrink: 0;
}

.top-bar-left { display: flex; align-items: center; gap: 14px; min-width: 0; }
.top-bar-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }

.hamburger {
  display: none; background: none; border: none;
  width: 38px; height: 38px; border-radius: 9px;
  color: var(--gray-600); cursor: pointer; transition: background .2s;
  align-items: center; justify-content: center;
}
.hamburger:hover { background: var(--gray-100); }
.hamburger :deep(svg) { width: 20px; height: 20px; }
@media (max-width: 768px) { .hamburger { display: flex; } }

.breadcrumb {
  display: flex; align-items: center; gap: 6px;
  font-size: 13px;
}
.breadcrumb-section { color: var(--gray-400); font-weight: 500; }
.breadcrumb-sep { color: var(--gray-300); display: flex; align-items: center; }
.breadcrumb-sep :deep(svg) { width: 12px; height: 12px; }
.breadcrumb-page { color: var(--gray-800); font-weight: 600; }

.header-clock {
  display: flex; align-items: center; gap: 7px;
  color: var(--gray-500); font-size: 12.5px; font-weight: 500;
  padding-right: 12px; border-right: 1px solid var(--gray-200);
  white-space: nowrap;
}
.header-clock :deep(svg) { width: 14px; height: 14px; }
@media (max-width: 900px) { .header-clock { display: none; } }

.status-pill {
  display: flex; align-items: center; gap: 6px;
  background: var(--success-bg); color: var(--success-text);
  font-size: 11.5px; font-weight: 600;
  padding: 4px 10px; border-radius: var(--radius-full);
  border: 1px solid var(--success-border);
  white-space: nowrap;
}
.status-dot { width: 6px; height: 6px; border-radius: 50%; background: #16a34a; animation: breathe 2.5s ease-in-out infinite; }
@media (max-width: 768px) { .status-pill { display: none; } }

/* Icon button */
.icon-btn {
  position: relative;
  width: 38px; height: 38px;
  display: flex; align-items: center; justify-content: center;
  background: var(--white); border: 1px solid var(--gray-200);
  border-radius: 10px; color: var(--gray-600); cursor: pointer;
  transition: all .2s; flex-shrink: 0;
}
.icon-btn:hover { background: var(--gray-50); border-color: var(--gray-300); color: var(--gray-800); }
.icon-btn--active { background: var(--brand-50); border-color: var(--brand-300); color: var(--brand-700); }
.icon-btn :deep(svg) { width: 17px; height: 17px; }

.notif-badge {
  position: absolute; top: -5px; right: -5px;
  min-width: 16px; height: 16px;
  background: #ef4444; color: #fff;
  font-size: 9px; font-weight: 700;
  border-radius: var(--radius-full);
  display: flex; align-items: center; justify-content: center;
  border: 2px solid #fff;
  line-height: 1; padding: 0 3px;
}

/* User chip */
.user-chip {
  position: relative;
  display: flex; align-items: center; gap: 9px;
  padding: 5px 8px 5px 5px; border-radius: 12px;
  cursor: pointer; transition: background .2s; user-select: none;
}
.user-chip:hover { background: var(--gray-100); }
.user-chip--open { background: var(--gray-100); }

.user-avatar-wrap {
  width: 33px; height: 33px;
  background: linear-gradient(135deg, #14b8a6, #0d9488);
  color: #fff; border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 14px; flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(13,148,136,.35);
}

.user-meta { display: flex; flex-direction: column; line-height: 1.3; }
.user-display-name { font-size: 13px; font-weight: 600; color: var(--gray-800); white-space: nowrap; }
.user-role-tag { font-size: 11px; color: var(--gray-500); }

.chevron-icon { display: flex; color: var(--gray-400); transition: transform .2s; }
.chevron-icon.flipped { transform: rotate(180deg); }
.chevron-icon :deep(svg) { width: 15px; height: 15px; }

/* Dropdown */
.user-dropdown {
  position: absolute; top: calc(100% + 8px); right: 0;
  width: 240px; background: var(--white);
  border: 1px solid var(--gray-200); border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl); z-index: 60;
  overflow: hidden;
}
.dropdown-profile { display: flex; align-items: center; gap: 12px; padding: 14px 16px; }
.dropdown-avatar {
  width: 38px; height: 38px; border-radius: 10px;
  background: linear-gradient(135deg, #14b8a6, #0d9488);
  color: #fff; display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 16px; flex-shrink: 0;
}
.dropdown-name  { font-size: 13.5px; font-weight: 600; color: var(--gray-800); }
.dropdown-email { font-size: 12px; color: var(--gray-500); word-break: break-all; margin-top: 1px; }
.dropdown-divider { height: 1px; background: var(--gray-100); }
.dropdown-item {
  display: flex; align-items: center; gap: 10px;
  width: 100%; padding: 11px 16px;
  background: none; border: none; border-radius: 0;
  font-size: 13.5px; font-weight: 500;
  cursor: pointer; transition: background .15s;
  text-align: left; font-family: inherit;
}
.dropdown-item--danger { color: #b91c1c; }
.dropdown-item--danger:hover { background: var(--danger-bg); }
.dropdown-item :deep(svg) { width: 15px; height: 15px; }

/* Page wrap */
.page-wrap {
  padding: 26px;
  flex: 1;
  min-width: 0;
  background:
    radial-gradient(ellipse 80% 50% at 100% 0%,   rgba(13,148,136,.05) 0%, transparent 60%),
    radial-gradient(ellipse 60% 40% at 0%   100%,  rgba(37,99,235,.04)  0%, transparent 60%);
  min-height: calc(100vh - 62px);
}
@media (max-width: 768px) { .page-wrap { padding: 16px; } }

/* ══════════════════════════════════════
   NOTIFICATION PANEL
══════════════════════════════════════ */
.notif-panel { position: fixed; inset: 0; z-index: 200; }
.notif-overlay { position: absolute; inset: 0; background: rgba(15,23,42,.4); backdrop-filter: blur(4px); }
.notif-drawer {
  position: absolute; top: 0; right: 0; bottom: 0;
  width: 380px; max-width: 100%;
  background: var(--white);
  box-shadow: -12px 0 40px rgba(0,0,0,.16);
  display: flex; flex-direction: column;
  border-left: 1px solid var(--gray-200);
}

.notif-header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--gray-100);
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px; flex-shrink: 0;
}
.notif-title { font-size: 15px; font-weight: 700; color: var(--gray-900); }
.notif-header-actions { display: flex; align-items: center; gap: 8px; }
.unread-chip { font-size: 11px; font-weight: 600; color: var(--brand-700); background: var(--brand-50); padding: 2px 9px; border-radius: var(--radius-full); border: 1px solid var(--brand-200); }

.notif-body { flex: 1; overflow-y: auto; }

.notif-item {
  width: 100%; display: flex; gap: 12px; padding: 13px 20px;
  border: 0; border-bottom: 1px solid var(--gray-100); background: transparent;
  text-align: left; cursor: pointer;
  transition: background .15s;
}
.notif-item:hover { background: var(--gray-50); }
.notif-item--unread { background: var(--brand-50); }
.notif-item--unread:hover { background: var(--brand-100); }

.notif-type-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; margin-top: 5px; }
.dot-teal   { background: #14b8a6; }
.dot-blue   { background: #2563eb; }
.dot-purple { background: #7c3aed; }
.dot-orange { background: #ea580c; }
.dot-gray   { background: var(--gray-400); }

.notif-content { min-width: 0; display: block; }
.notif-item-title { display: block; font-size: 13px; font-weight: 600; color: var(--gray-800); }
.notif-item-msg   { display: block; font-size: 12.5px; color: var(--gray-600); margin-top: 2px; line-height: 1.5; }
.notif-item-time  { display: block; font-size: 11px; color: var(--gray-400); margin-top: 5px; }

.notif-empty {
  padding: 60px 30px; text-align: center;
  color: var(--gray-400);
  display: flex; flex-direction: column; align-items: center; gap: 6px;
}
.notif-empty-icon { color: var(--gray-300); margin-bottom: 8px; }
.notif-empty p     { font-size: 14px; font-weight: 600; color: var(--gray-600); }
.notif-empty small { font-size: 12.5px; }

/* ══════════════════════════════════════
   MOBILE BACKDROP
══════════════════════════════════════ */
.mobile-backdrop {
  position: fixed; inset: 0;
  background: rgba(0,0,0,.5);
  z-index: 99;
  display: none;
}
@media (max-width: 768px) { .mobile-backdrop { display: block; } }

/* ══════════════════════════════════════
   TRANSITIONS
══════════════════════════════════════ */
.backdrop-fade-enter-active,.backdrop-fade-leave-active { transition: opacity .25s ease; }
.backdrop-fade-enter-from,.backdrop-fade-leave-to { opacity: 0; }

.label-fade-enter-active,.label-fade-leave-active { transition: opacity .2s ease; }
.label-fade-enter-from,.label-fade-leave-to { opacity: 0; }

.dropdown-pop-enter-active { animation: dropIn .22s cubic-bezier(.34,1.46,.64,1); }
.dropdown-pop-leave-active { animation: dropOut .15s ease; }
@keyframes dropIn  { from{opacity:0;transform:translateY(-8px) scale(.97)}to{opacity:1;transform:none} }
@keyframes dropOut { to{opacity:0;transform:translateY(-6px) scale(.97)} }

.panel-slide-enter-active,.panel-slide-leave-active { transition: opacity .25s ease; }
.panel-slide-enter-active .notif-drawer,
.panel-slide-leave-active .notif-drawer { transition: transform .3s cubic-bezier(.4,0,.2,1); }
.panel-slide-enter-from .notif-drawer,.panel-slide-leave-to .notif-drawer { transform: translateX(100%); }
.panel-slide-enter-from,.panel-slide-leave-to { opacity: 0; }

.page-slide-enter-active,.page-slide-leave-active { transition: opacity .2s ease, transform .2s ease; }
.page-slide-enter-from { opacity:0; transform:translateY(8px); }
.page-slide-leave-to   { opacity:0; transform:translateY(-6px); }
</style>
