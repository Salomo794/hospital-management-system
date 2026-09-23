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
          <span class="logo-icon">&#x2695;</span>
          <span class="logo-lockup" v-show="!sidebarCollapsed">
            <span class="logo-text">MediCare</span>
            <span class="logo-subtitle">Clinical operations</span>
          </span>
        </div>
        <button class="sidebar-toggle" @click="toggleSidebar">
          <span v-if="sidebarCollapsed || mobileOpen">&#10005;</span>
          <span v-else>&#9776;</span>
        </button>
      </div>
      <nav class="sidebar-nav">
        <router-link 
          to="/dashboard" 
          class="nav-item" 
          :class="{ active: $route.path === '/dashboard' }"
          @click="closeMobileSidebar"
        >
          <span class="nav-icon">&#9632;</span>
          <span class="nav-text" v-show="!sidebarCollapsed">Dashboard</span>
        </router-link>
        <router-link 
          to="/patients" 
          class="nav-item" 
          :class="{ active: $route.path.startsWith('/patients') }"
          @click="closeMobileSidebar"
        >
          <span class="nav-icon">&#9823;</span>
          <span class="nav-text" v-show="!sidebarCollapsed">Patients</span>
        </router-link>
        <router-link 
          to="/doctors" 
          class="nav-item" 
          :class="{ active: $route.path.startsWith('/doctors') }"
          @click="closeMobileSidebar"
        >
          <span class="nav-icon">&#9877;</span>
          <span class="nav-text" v-show="!sidebarCollapsed">Doctors</span>
        </router-link>
        <router-link 
          to="/appointments" 
          class="nav-item" 
          :class="{ active: $route.path.startsWith('/appointments') }"
          @click="closeMobileSidebar"
        >
          <span class="nav-icon">&#128197;</span>
          <span class="nav-text" v-show="!sidebarCollapsed">Appointments</span>
        </router-link>
        <router-link 
          to="/emr" 
          class="nav-item" 
          :class="{ active: $route.path.startsWith('/emr') }"
          @click="closeMobileSidebar"
        >
          <span class="nav-icon">&#128203;</span>
          <span class="nav-text" v-show="!sidebarCollapsed">Medical Records</span>
        </router-link>
        <router-link 
          to="/pharmacy" 
          class="nav-item" 
          :class="{ active: $route.path.startsWith('/pharmacy') }"
          @click="closeMobileSidebar"
        >
          <span class="nav-icon">&#9764;</span>
          <span class="nav-text" v-show="!sidebarCollapsed">Pharmacy</span>
        </router-link>
        <router-link 
          to="/ward" 
          class="nav-item" 
          :class="{ active: $route.path.startsWith('/ward') }"
          @click="closeMobileSidebar"
        >
          <span class="nav-icon">&#127973;</span>
          <span class="nav-text" v-show="!sidebarCollapsed">Wards & Beds</span>
        </router-link>
        <router-link 
          to="/laboratory" 
          class="nav-item" 
          :class="{ active: $route.path.startsWith('/laboratory') }"
          @click="closeMobileSidebar"
        >
          <span class="nav-icon">&#9879;</span>
          <span class="nav-text" v-show="!sidebarCollapsed">Laboratory</span>
        </router-link>
        <router-link 
          to="/billing" 
          class="nav-item" 
          :class="{ active: $route.path.startsWith('/billing') }"
          @click="closeMobileSidebar"
        >
          <span class="nav-icon">&#128176;</span>
          <span class="nav-text" v-show="!sidebarCollapsed">Billing</span>
        </router-link>
        <router-link 
          to="/reports" 
          class="nav-item" 
          :class="{ active: $route.path.startsWith('/reports') }"
          @click="closeMobileSidebar"
        >
          <span class="nav-icon">&#128200;</span>
          <span class="nav-text" v-show="!sidebarCollapsed">Reports</span>
        </router-link>
        <router-link 
          to="/ai-assistant" 
          class="nav-item" 
          :class="{ active: $route.path.startsWith('/ai') }"
          @click="closeMobileSidebar"
        >
          <span class="nav-icon">&#129302;</span>
          <span class="nav-text" v-show="!sidebarCollapsed">AI Assistant</span>
        </router-link>
        <router-link 
          v-if="authStore.userRole === 'admin'" 
          to="/users" 
          class="nav-item" 
          :class="{ active: $route.path === '/users' }"
          @click="closeMobileSidebar"
        >
          <span class="nav-icon">&#9881;</span>
          <span class="nav-text" v-show="!sidebarCollapsed">User Management</span>
        </router-link>
      </nav>
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
            <span class="page-kicker">Workspace / Live view</span>
            <h1 class="page-title">{{ pageTitle }}</h1>
          </div>
        </div>
        <div class="header-right">
          <div class="system-status"><span class="status-pulse"></span> Systems operational</div>
          <!-- Notification Bell -->
          <div class="notification-bell" @click="showNotifications = !showNotifications">
            <span>&#128276;</span>
            <span class="notification-badge" v-if="unreadCount > 0">{{ unreadCount }}</span>
          </div>

          <!-- User Dropdown -->
          <div class="user-dropdown" @click="showDropdown = !showDropdown">
            <div class="user-avatar">{{ authStore.userName.charAt(0) }}</div>
            <div class="user-info">
              <span class="user-name">{{ authStore.userName }}</span>
              <span class="user-role">{{ authStore.userRole }}</span>
            </div>
            <div class="dropdown-menu" v-show="showDropdown">
              <a href="#" @click.prevent="logout">&#128682; Logout</a>
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
          <button class="btn btn-sm" @click="markAllRead">Mark all read</button>
        </div>
        <div class="notification-list">
          <div v-for="n in notifications" :key="n.id" class="notification-item" :class="{ unread: !n.is_read }">
            <div class="notification-title">{{ n.title }}</div>
            <div class="notification-message">{{ n.message }}</div>
            <div class="notification-time">{{ formatTime(n.created_at) }}</div>
          </div>
          <div v-if="notifications.length === 0" class="notification-empty">No notifications</div>
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

    const pageTitle = computed(() => {
      const titles = {
        '/dashboard': 'Dashboard',
        '/patients': 'Patient Management',
        '/doctors': 'Doctor Management',
        '/appointments': 'Appointments',
        '/emr': 'Electronic Medical Records',
        '/pharmacy': 'Pharmacy Management',
        '/ward': 'Wards & Beds',
        '/laboratory': 'Laboratory Management',
        '/billing': 'Billing & Payments',
        '/reports': 'Reports & Analytics',
        '/ai-assistant': 'AI Assistant',
        '/users': 'User Management'
      }
      return titles[route.path] || 'Hospital Management System'
    })

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
      toggleSidebar,
      closeMobileSidebar,
      loadNotifications, 
      markAllRead, 
      formatTime, 
      logout 
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
  width: 70px;
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
  padding: 22px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(255, 255, 255, 0.09);
}

.logo {
  display: flex;
  align-items: center;
  gap: 10px;
}

.logo-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: #75e0cf;
  color: #14252b;
  font-size: 19px;
}

.logo-lockup {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.logo-text {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 19px;
  font-weight: 700;
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
  color: white;
  font-size: 18px;
  cursor: pointer;
  padding: 5px;
  border-radius: 4px;
}

.sidebar-toggle:hover {
  background: rgba(255, 255, 255, 0.2);
}

.sidebar-nav {
  flex: 1;
  padding: 10px 0;
  overflow-y: auto;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 3px 12px;
  padding: 11px 12px;
  color: rgba(255, 255, 255, 0.8);
  text-decoration: none;
  transition: all 0.2s;
  border-left: 2px solid transparent;
  border-radius: 8px;
  font-size: 14px;
}

.nav-item:hover {
  background: rgba(117, 224, 207, 0.08);
  color: white;
}

.nav-item.active {
  background: rgba(117, 224, 207, 0.14);
  color: white;
  border-left-color: #75e0cf;
  font-weight: 600;
}

.nav-icon {
  font-size: 18px;
  width: 24px;
  text-align: center;
}

.nav-text {
  white-space: nowrap;
}

.main-content {
  flex: 1;
  margin-left: 248px;
  display: flex;
  flex-direction: column;
  transition: margin-left 0.3s ease;
}

.main-content.expanded {
  margin-left: 70px;
}

@media (max-width: 768px) {
  .main-content {
    margin-left: 0;
  }
  
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

  .user-info {
    display: none;
  }

  .system-status {
    display: none;
  }

  .page-title {
    font-size: 17px;
  }
}

.top-header {
  background: rgba(255, 255, 255, 0.9);
  padding: 14px 28px;
  display: flex;
  align-items: center;
  justify-content: space-between;
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
}

.mobile-menu-btn {
  display: none;
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  padding: 4px;
}

@media (max-width: 768px) {
  .mobile-menu-btn {
    display: block;
  }
}

.page-title {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 23px;
  font-weight: 700;
  line-height: 1.1;
  color: #14252b;
}

.page-heading {
  display: flex;
  flex-direction: column;
  gap: 3px;
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
  gap: 18px;
}

.system-status {
  display: flex;
  align-items: center;
  gap: 7px;
  color: #5c6472;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
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
  font-size: 20px;
  padding: 8px;
  border-radius: 50%;
  transition: background 0.2s;
}

.notification-bell:hover {
  background: #f1f5f9;
}

.notification-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  background: #ef4444;
  color: white;
  font-size: 10px;
  border-radius: 10px;
  font-weight: 600;
}

.user-dropdown {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}

.user-avatar {
  width: 36px;
  height: 36px;
  background: #0b8f87;
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 14px;
}

.user-info {
  display: flex;
  flex-direction: column;
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

.dropdown-menu {
  position: absolute;
  top: 100%;
  right: 0;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  min-width: 160px;
  margin-top: 8px;
  overflow: hidden;
}

.dropdown-menu a {
  display: block;
  padding: 10px 16px;
  color: #1e293b;
  text-decoration: none;
  font-size: 14px;
  transition: background 0.2s;
}

.dropdown-menu a:hover {
  background: #f1f5f9;
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
  width: 360px;
  height: 100%;
  background: white;
  box-shadow: -14px 0 40px rgba(20, 37, 43, 0.14);
  display: flex;
  flex-direction: column;
  transform: translateX(0);
  transition: transform 0.3s ease;
}

.drawer-header {
  padding: 16px 20px;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.btn-sm {
  padding: 6px 12px;
  font-size: 12px;
  background: #0d9488;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.btn-sm:hover {
  background: #0f766e;
}

.notification-list {
  flex: 1;
  overflow-y: auto;
}

.notification-item {
  padding: 12px 20px;
  border-bottom: 1px solid #f1f5f9;
}

.notification-item.unread {
  background: #f0fdfa;
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
}

.notification-time {
  font-size: 11px;
  color: #94a3b8;
  margin-top: 4px;
}

.notification-empty {
  padding: 40px;
  text-align: center;
  color: #94a3b8;
}
</style>
