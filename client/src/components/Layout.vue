<template>
  <div class="layout">
    <!-- Mobile Backdrop -->
    <div
      v-if="mobileOpen"
      class="backdrop"
      @click="mobileOpen = false"
    ></div>

    <!-- Sidebar -->
    <aside
      class="sidebar"
      :class="{ collapsed: sidebarCollapsed, 'mobile-open': mobileOpen }"
    >
      <div class="sidebar-header">
        <div class="logo">
          <span class="logo-icon" v-html="logoIcon"></span>
          <span class="logo-lockup" v-show="!sidebarCollapsed">
            <span class="logo-text">MediCare</span>
            <span class="logo-subtitle">Clinical operations</span>
          </span>
        </div>
        <button
          class="sidebar-toggle"
          @click="toggleSidebar"
          :aria-label="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        >
          <span v-if="sidebarCollapsed || mobileOpen">&#10005;</span>
          <span v-else>&#9776;</span>
        </button>
      </div>

      <nav class="sidebar-nav">
        <template v-for="section in navSections" :key="section.title">
          <div
            class="sidebar-section-title"
            v-if="section.items.length"
          >
            {{ section.title }}
          </div>
          <router-link
            v-for="item in section.items"
            :key="item.to"
            :to="item.to"
            class="nav-item"
            :class="{ active: isActive(item) }"
            :title="sidebarCollapsed ? item.label : ''"
            @click="closeMobileSidebar"
          >
            <span class="nav-icon" v-html="item.icon"></span>
            <span class="nav-text" v-show="!sidebarCollapsed">{{ item.label }}</span>
          </router-link>
        </template>
      </nav>

      <div class="sidebar-footer" v-show="!sidebarCollapsed">
        <div class="facility-chip">
          <span class="facility-dot"></span>
          <span class="facility-text">
            <strong>Central General Hospital</strong>
            <small>Ward capacity 78%</small>
          </span>
        </div>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="main-content" :class="{ expanded: sidebarCollapsed }">
      <!-- Top Header -->
      <header class="top-header">
        <div class="header-left">
          <button class="mobile-menu-btn" @click="mobileOpen = !mobileOpen">
            &#9776;
          </button>
          <div class="page-heading">
            <span class="page-kicker">{{ pageKicker }}</span>
            <h1 class="page-title">{{ pageTitle }}</h1>
          </div>
        </div>
        <div class="header-right">
          <div class="header-date">{{ todayLabel }}</div>
          <div class="system-status"><span class="status-pulse"></span> Systems operational</div>

          <!-- Notification Bell -->
          <button class="notification-bell" @click="showNotifications = !showNotifications" aria-label="Notifications">
            <span v-html="bellIcon"></span>
            <span class="notification-badge" v-if="unreadCount > 0">{{ unreadCount > 99 ? '99+' : unreadCount }}</span>
          </button>

          <!-- User Dropdown -->
          <div class="user-dropdown" @click="showDropdown = !showDropdown">
            <div class="user-avatar">{{ authStore.userName.charAt(0) }}</div>
            <div class="user-info">
              <span class="user-name">{{ authStore.userName }}</span>
              <span class="user-role">{{ authStore.userRole }}</span>
            </div>
            <span class="chevron" :class="{ open: showDropdown }" v-html="chevronIcon"></span>
            <div class="dropdown-menu" v-show="showDropdown">
              <div class="dropdown-head">
                <span class="dropdown-name">{{ authStore.userName }}</span>
                <span class="dropdown-mail">{{ authStore.user?.email || '' }}</span>
              </div>
              <a href="#" @click.prevent="logout"><span v-html="logoutIcon"></span> Sign out</a>
            </div>
          </div>
        </div>
      </header>

      <!-- Page Content -->
      <div class="page-content">
        <router-view v-slot="{ Component }">
          <transition name="page-fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </div>
    </main>

    <!-- Notification Panel -->
    <div class="notification-panel" v-show="showNotifications" @click.self="showNotifications = false">
      <div class="notification-drawer">
        <div class="drawer-header">
          <h3>Notifications</h3>
          <div class="drawer-actions">
            <span class="drawer-count" v-if="unreadCount">{{ unreadCount }} new</span>
            <button class="btn btn-sm btn-mark" @click="markAllRead">Mark all read</button>
          </div>
        </div>
        <div class="notification-list">
          <div v-for="n in notifications" :key="n.id" class="notification-item" :class="{ unread: !n.is_read }">
            <span class="notification-dot" v-if="!n.is_read"></span>
            <div class="notification-body">
              <div class="notification-title">{{ n.title }}</div>
              <div class="notification-message">{{ n.message }}</div>
              <div class="notification-time">{{ formatTime(n.created_at) }}</div>
            </div>
          </div>
          <div v-if="notifications.length === 0" class="notification-empty">
            <span class="empty-bell" v-html="bellIcon"></span>
            <p>You're all caught up</p>
            <small>No new notifications right now.</small>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../store/auth'
import axios from 'axios'

const svg = (body) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`

const icons = {
  dashboard: svg('<rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/>'),
  patients: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  doctors: svg('<path d="M15 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/>'),
  appointments: svg('<rect x="3" y="4.5" width="18" height="17" rx="2.2"/><path d="M16 2.5v4M8 2.5v4M3 10h18"/><path d="M8.5 14.5h3"/>'),
  records: svg('<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2.5" width="8" height="4" rx="1.2"/><path d="M8.5 12.5h7M8.5 16.5h4.5"/>'),
  pharmacy: svg('<path d="M10.5 20.5 3.6 13.6a4.9 4.9 0 0 1 6.9-6.9l6.9 6.9a4.9 4.9 0 0 1-6.9 6.9Z"/><path d="M8.2 8.2l6.9 6.9"/>'),
  ward: svg('<path d="M4 21V5.5A2.5 2.5 0 0 1 6.5 3h7A2.5 2.5 0 0 1 16 5.5V21"/><path d="M16 10h2.5A2.5 2.5 0 0 1 21 12.5V21"/><path d="M9.5 7.5h3M11 6v3"/><path d="M2 21h20"/>'),
  laboratory: svg('<path d="M9.5 2.5h5"/><path d="M10.5 2.5v6.4L5 18.2A2 2 0 0 0 6.7 21.2h10.6A2 2 0 0 0 19 18.2l-5.5-9.3V2.5"/><path d="M7.6 15h8.8"/>'),
  billing: svg('<rect x="2.5" y="5" width="19" height="14" rx="2.4"/><path d="M2.5 9.8h19"/><path d="M6.5 14.6h3.5"/>'),
  reports: svg('<path d="M3.5 3.5v17h17"/><path d="M7.5 17v-4.5M12 17V8M16.5 17v-6.5"/>'),
  ai: svg('<path d="M12 3.2l1.8 4.4 4.4 1.8-4.4 1.8L12 15.6l-1.8-4.4L5.8 9.4l4.4-1.8L12 3.2Z"/><path d="M18.6 15.4l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8.8-1.9Z"/>'),
  users: svg('<circle cx="12" cy="12" r="3.1"/><path d="M19.1 14.4a1.6 1.6 0 0 0 .32 1.76l.06.06a1.94 1.94 0 1 1-2.74 2.74l-.06-.06a1.6 1.6 0 0 0-1.76-.32 1.6 1.6 0 0 0-.97 1.46v.17a1.94 1.94 0 1 1-3.88 0v-.09a1.6 1.6 0 0 0-1.04-1.46 1.6 1.6 0 0 0-1.76.32l-.06.06a1.94 1.94 0 1 1-2.74-2.74l.06-.06a1.6 1.6 0 0 0 .32-1.76 1.6 1.6 0 0 0-1.46-.97H3.3a1.94 1.94 0 1 1 0-3.88h.09a1.6 1.6 0 0 0 1.46-1.04 1.6 1.6 0 0 0-.32-1.76l-.06-.06a1.94 1.94 0 1 1 2.74-2.74l.06.06a1.6 1.6 0 0 0 1.76.32h.08A1.6 1.6 0 0 0 10.1 4.4v-.17a1.94 1.94 0 1 1 3.88 0v.09a1.6 1.6 0 0 0 .97 1.46 1.6 1.6 0 0 0 1.76-.32l.06-.06a1.94 1.94 0 1 1 2.74 2.74l-.06.06a1.6 1.6 0 0 0-.32 1.76v.08a1.6 1.6 0 0 0 1.46.97h.17a1.94 1.94 0 1 1 0 3.88h-.09a1.6 1.6 0 0 0-1.46.97Z"/>')
}

export default {
  name: 'Layout',
  setup() {
    const route = useRoute()
    const router = useRouter()
    const authStore = useAuthStore()

    const sidebarCollapsed = ref(false)
    const mobileOpen = ref(false)
    const showDropdown = ref(false)
    const showNotifications = ref(false)
    const notifications = ref([])
    const unreadCount = ref(0)
    let notificationInterval = null

    const logoIcon = svg('<path d="M12 6v12M6 12h12"/>')
    const bellIcon = svg('<path d="M18 8.5a6 6 0 1 0-12 0c0 6.5-2.5 8.5-2.5 8.5h17S18 15 18 8.5"/><path d="M13.7 20.5a2 2 0 0 1-3.4 0"/>')
    const chevronIcon = svg('<path d="M6 9.5l6 6 6-6"/>')
    const logoutIcon = svg('<path d="M9.5 21H5.5A1.5 1.5 0 0 1 4 19.5v-15A1.5 1.5 0 0 1 5.5 3h4"/><path d="M16 16.5l4.5-4.5L16 7.5"/><path d="M20.5 12H9.5"/>')

    const navSections = computed(() => {
      const sections = [
        {
          title: 'Overview',
          items: [
            { to: '/dashboard', label: 'Dashboard', icon: icons.dashboard, exact: true }
          ]
        },
        {
          title: 'Clinical',
          items: [
            { to: '/patients', label: 'Patients', icon: icons.patients },
            { to: '/doctors', label: 'Doctors', icon: icons.doctors },
            { to: '/appointments', label: 'Appointments', icon: icons.appointments },
            { to: '/emr', label: 'Medical Records', icon: icons.records }
          ]
        },
        {
          title: 'Departments',
          items: [
            { to: '/pharmacy', label: 'Pharmacy', icon: icons.pharmacy },
            { to: '/ward', label: 'Wards & Beds', icon: icons.ward },
            { to: '/laboratory', label: 'Laboratory', icon: icons.laboratory },
            { to: '/billing', label: 'Billing', icon: icons.billing }
          ]
        },
        {
          title: 'Insights',
          items: [
            { to: '/reports', label: 'Reports', icon: icons.reports },
            { to: '/ai-assistant', label: 'AI Assistant', icon: icons.ai }
          ]
        },
        {
          title: 'Administration',
          items: authStore.userRole === 'admin'
            ? [{ to: '/users', label: 'User Management', icon: icons.users, exact: true }]
            : []
        }
      ]
      return sections.filter(s => s.items.length)
    })

    const routeLabels = [
      { prefix: '/dashboard', label: 'Dashboard', section: 'Overview' },
      { prefix: '/patients', label: 'Patient Management', section: 'Clinical' },
      { prefix: '/doctors', label: 'Doctor Management', section: 'Clinical' },
      { prefix: '/appointments', label: 'Appointments', section: 'Clinical' },
      { prefix: '/emr', label: 'Electronic Medical Records', section: 'Clinical' },
      { prefix: '/pharmacy', label: 'Pharmacy Management', section: 'Departments' },
      { prefix: '/ward', label: 'Wards & Beds', section: 'Departments' },
      { prefix: '/laboratory', label: 'Laboratory Management', section: 'Departments' },
      { prefix: '/billing', label: 'Billing & Payments', section: 'Departments' },
      { prefix: '/reports', label: 'Reports & Analytics', section: 'Insights' },
      { prefix: '/ai-assistant', label: 'AI Assistant', section: 'Insights' },
      { prefix: '/users', label: 'User Management', section: 'Administration' }
    ]

    const routeMeta = computed(() => {
      const match = [...routeLabels].reverse().find(r => route.path.startsWith(r.prefix))
      return match || { label: 'Hospital Management System', section: 'Workspace' }
    })

    const pageTitle = computed(() => routeMeta.value.label)
    const pageKicker = computed(() => `${routeMeta.value.section} / Live view`)

    const todayLabel = computed(() =>
      new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    )

    const isActive = (item) =>
      item.exact ? route.path === item.to : route.path.startsWith(item.to)

    const toggleSidebar = () => {
      if (window.innerWidth < 768) {
        mobileOpen.value = !mobileOpen.value
      } else {
        sidebarCollapsed.value = !sidebarCollapsed.value
      }
    }

    const closeMobileSidebar = () => {
      if (window.innerWidth < 768) {
        mobileOpen.value = false
      }
    }

    const loadNotifications = async () => {
      try {
        const { data } = await axios.get('/api/notifications')
        notifications.value = data.notifications
        unreadCount.value = data.unread_count
      } catch (e) { /* silent */ }
    }

    const markAllRead = async () => {
      try {
        await axios.put('/api/notifications/read-all')
        notifications.value.forEach(n => n.is_read = true)
        unreadCount.value = 0
      } catch (e) { /* silent */ }
    }

    const formatTime = (dateStr) => {
      const d = new Date(dateStr)
      const now = new Date()
      const diff = Math.floor((now - d) / 1000)
      if (diff < 60) return 'Just now'
      if (diff < 3600) return `${Math.floor(diff/60)}m ago`
      if (diff < 86400) return `${Math.floor(diff/3600)}h ago`
      return d.toLocaleDateString()
    }

    const logout = () => {
      authStore.logout()
      router.push('/login')
    }

    const handleResize = () => {
      if (window.innerWidth >= 768) {
        mobileOpen.value = false
      }
    }

    onMounted(() => {
      loadNotifications()
      notificationInterval = setInterval(loadNotifications, 30000)
      window.addEventListener('resize', handleResize)
    })

    onUnmounted(() => {
      if (notificationInterval) {
        clearInterval(notificationInterval)
      }
      window.removeEventListener('resize', handleResize)
    })

    return {
      authStore,
      sidebarCollapsed,
      mobileOpen,
      showDropdown,
      showNotifications,
      notifications,
      unreadCount,
      pageTitle,
      pageKicker,
      todayLabel,
      navSections,
      isActive,
      toggleSidebar,
      closeMobileSidebar,
      loadNotifications,
      markAllRead,
      formatTime,
      logout,
      logoIcon,
      bellIcon,
      chevronIcon,
      logoutIcon
    }
  }
}
</script>

<style scoped>
.layout {
  display: flex;
  min-height: 100vh;
  background: #f5f7f4;
}

.backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 99;
  display: none;
}

@media (max-width: 768px) {
  .backdrop {
    display: block;
  }
}

.sidebar {
  width: 248px;
  background: #14252b;
  color: white;
  display: flex;
  flex-direction: column;
  position: fixed;
  height: 100vh;
  z-index: 100;
  transition: width 0.3s ease, transform 0.3s ease;
}

.sidebar.collapsed {
  width: 76px;
}

@media (max-width: 768px) {
  .sidebar {
    transform: translateX(-100%);
  }

  .sidebar.mobile-open {
    transform: translateX(0);
  }
}

.sidebar-header {
  padding: 20px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(255, 255, 255, 0.09);
  min-height: 68px;
}

.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.logo-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: #75e0cf;
  color: #14252b;
  flex-shrink: 0;
}

.logo-icon :deep(svg) {
  width: 19px;
  height: 19px;
  stroke-width: 2.4;
}

.logo-lockup {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.logo-text {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.02em;
  white-space: nowrap;
}

.logo-subtitle {
  color: rgba(255, 255, 255, 0.48);
  font-size: 9px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  white-space: nowrap;
}

.sidebar-toggle {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.7);
  font-size: 17px;
  cursor: pointer;
  padding: 6px;
  border-radius: 6px;
  line-height: 1;
  transition: background 0.2s, color 0.2s;
}

.sidebar-toggle:hover {
  background: rgba(255, 255, 255, 0.12);
  color: white;
}

.sidebar-nav {
  flex: 1;
  padding: 8px 0 16px;
  overflow-y: auto;
  overflow-x: hidden;
}

.sidebar-section-title {
  padding: 16px 20px 7px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: rgba(255, 255, 255, 0.34);
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 2px 12px;
  padding: 10px 12px;
  color: rgba(255, 255, 255, 0.78);
  text-decoration: none;
  transition: background 0.18s, color 0.18s;
  border-left: 2px solid transparent;
  border-radius: 8px;
  font-size: 13.5px;
  font-weight: 500;
}

.nav-item:hover {
  background: rgba(117, 224, 207, 0.09);
  color: white;
}

.nav-item.active {
  background: rgba(117, 224, 207, 0.15);
  color: white;
  border-left-color: #75e0cf;
  font-weight: 600;
}

.nav-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  color: rgba(255, 255, 255, 0.62);
  transition: color 0.18s;
}

.nav-item:hover .nav-icon,
.nav-item.active .nav-icon {
  color: #75e0cf;
}

.nav-icon :deep(svg) {
  width: 19px;
  height: 19px;
}

.nav-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar.collapsed .nav-item {
  justify-content: center;
  margin: 2px 10px;
  padding: 11px 0;
}

.sidebar.collapsed .sidebar-section-title {
  font-size: 0;
  letter-spacing: 0;
  padding: 0;
  margin: 10px 16px;
  height: 1px;
}

.nav-item + .sidebar-section-title {
  border-top: 1px solid rgba(255, 255, 255, 0.07);
}

.sidebar.collapsed .nav-item + .sidebar-section-title {
  padding: 0;
}

.sidebar-footer {
  padding: 14px 14px 18px;
  border-top: 1px solid rgba(255, 255, 255, 0.09);
}

.facility-chip {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.05);
}

.facility-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #2fbf91;
  box-shadow: 0 0 0 3px rgba(47, 191, 145, 0.18);
  flex-shrink: 0;
}

.facility-text {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
  min-width: 0;
}

.facility-text strong {
  font-size: 11.5px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.88);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.facility-text small {
  font-size: 10.5px;
  color: rgba(255, 255, 255, 0.42);
}

.main-content {
  flex: 1;
  margin-left: 248px;
  display: flex;
  flex-direction: column;
  transition: margin-left 0.3s ease;
}

.main-content.expanded {
  margin-left: 76px;
}

.top-header {
  background: rgba(255, 255, 255, 0.92);
  padding: 13px 28px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  border-bottom: 1px solid rgba(20, 37, 43, 0.08);
  box-shadow: 0 4px 18px rgba(20, 37, 43, 0.04);
  backdrop-filter: blur(16px);
  position: sticky;
  top: 0;
  z-index: 50;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
}

.mobile-menu-btn {
  display: none;
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  padding: 4px;
  color: var(--gray-700);
}

.page-title {
  font-size: 22px;
  font-weight: 700;
  line-height: 1.15;
  color: #14252b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.page-heading {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.page-kicker {
  color: #0b8f87;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.13em;
  text-transform: uppercase;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-shrink: 0;
}

.header-date {
  color: var(--gray-500);
  font-size: 12px;
  font-weight: 500;
  padding-right: 16px;
  border-right: 1px solid var(--gray-200);
  white-space: nowrap;
}

.system-status {
  display: flex;
  align-items: center;
  gap: 7px;
  color: #5c6472;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.status-pulse {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #2fbf91;
  box-shadow: 0 0 0 4px rgba(47, 191, 145, 0.12);
}

.notification-bell {
  position: relative;
  cursor: pointer;
  padding: 9px;
  border: 1px solid var(--gray-200);
  border-radius: 10px;
  background: white;
  color: var(--gray-600);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s, border-color 0.2s, color 0.2s;
}

.notification-bell:hover {
  background: var(--gray-50);
  border-color: var(--gray-300);
  color: var(--gray-800);
}

.notification-bell :deep(svg) {
  width: 18px;
  height: 18px;
}

.notification-badge {
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  background: #ef4444;
  color: white;
  font-size: 9.5px;
  font-weight: 700;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid white;
  line-height: 1;
}

.user-dropdown {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  padding: 5px 8px 5px 5px;
  border-radius: 10px;
  transition: background 0.2s;
}

.user-dropdown:hover {
  background: var(--gray-100);
}

.user-avatar {
  width: 34px;
  height: 34px;
  background: #0b8f87;
  color: white;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 14px;
}

.user-info {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}

.user-name {
  font-size: 13px;
  font-weight: 600;
  color: #1e293b;
}

.user-role {
  font-size: 11px;
  color: #64748b;
  text-transform: capitalize;
}

.chevron {
  display: flex;
  color: var(--gray-400);
  transition: transform 0.2s;
}

.chevron.open {
  transform: rotate(180deg);
}

.chevron :deep(svg) {
  width: 15px;
  height: 15px;
}

.dropdown-menu {
  position: absolute;
  top: 100%;
  right: 0;
  background: white;
  border: 1px solid var(--gray-200);
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
  min-width: 230px;
  margin-top: 8px;
  overflow: hidden;
  z-index: 60;
}

.dropdown-head {
  padding: 13px 16px;
  border-bottom: 1px solid var(--gray-100);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dropdown-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--gray-800);
}

.dropdown-mail {
  font-size: 12px;
  color: var(--gray-500);
  word-break: break-all;
}

.dropdown-menu a {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  color: #b91c1c;
  text-decoration: none;
  font-size: 13.5px;
  font-weight: 500;
  transition: background 0.2s;
}

.dropdown-menu a:hover {
  background: var(--danger-bg);
}

.dropdown-menu a :deep(svg) {
  width: 16px;
  height: 16px;
}

.page-content {
  padding: 28px;
  flex: 1;
}

.page-fade-enter-active,
.page-fade-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}

.page-fade-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.page-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.notification-panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background: rgba(0, 0, 0, 0.3);
  z-index: 200;
}

.notification-drawer {
  position: absolute;
  top: 0;
  right: 0;
  width: 370px;
  height: 100%;
  background: white;
  box-shadow: -14px 0 40px rgba(20, 37, 43, 0.14);
  display: flex;
  flex-direction: column;
}

.drawer-header {
  padding: 18px 20px;
  border-bottom: 1px solid var(--gray-200);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.drawer-header h3 {
  font-size: 15px;
  font-weight: 700;
  color: var(--gray-800);
}

.drawer-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.drawer-count {
  font-size: 11px;
  font-weight: 600;
  color: var(--primary);
  background: var(--primary-bg);
  padding: 3px 9px;
  border-radius: 20px;
}

.btn-mark {
  padding: 6px 12px;
  font-size: 12px;
  background: #0d9488;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-mark:hover {
  background: #0f766e;
}

.notification-list {
  flex: 1;
  overflow-y: auto;
}

.notification-item {
  display: flex;
  gap: 10px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--gray-100);
  transition: background 0.2s;
}

.notification-item:hover {
  background: var(--gray-50);
}

.notification-item.unread {
  background: #f0fdfa;
}

.notification-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--primary);
  flex-shrink: 0;
  margin-top: 6px;
}

.notification-body {
  min-width: 0;
}

.notification-title {
  font-weight: 600;
  font-size: 13px;
  color: #1e293b;
}

.notification-message {
  font-size: 12px;
  color: #64748b;
  margin-top: 2px;
  line-height: 1.5;
}

.notification-time {
  font-size: 11px;
  color: #94a3b8;
  margin-top: 5px;
}

.notification-empty {
  padding: 60px 30px;
  text-align: center;
  color: #94a3b8;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.empty-bell {
  color: var(--gray-300);
  margin-bottom: 8px;
}

.empty-bell :deep(svg) {
  width: 42px;
  height: 42px;
  stroke-width: 1.2;
}

.notification-empty p {
  font-size: 14px;
  font-weight: 600;
  color: var(--gray-600);
}

.notification-empty small {
  font-size: 12.5px;
}

@media (max-width: 768px) {
  .main-content,
  .main-content.expanded {
    margin-left: 0;
  }

  .page-content {
    padding: 16px;
  }

  .top-header {
    padding: 12px 16px;
  }

  .notification-drawer {
    width: 100%;
    max-width: 100%;
  }

  .user-info,
  .system-status,
  .header-date,
  .chevron {
    display: none;
  }

  .page-title {
    font-size: 17px;
  }

  .page-kicker {
    font-size: 9px;
  }
}
</style>
