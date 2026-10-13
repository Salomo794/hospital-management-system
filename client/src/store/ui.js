import { defineStore } from 'pinia'
import { getStoredItem, setStoredItem } from '../utils/storage'

export const useUiStore = defineStore('ui', {
  state: () => ({
    dark: getStoredItem('theme-dark') === '1',
    sidebarCollapsed: getStoredItem('sidebar-collapsed') === '1'
  }),
  actions: {
    toggleDark() {
      this.dark = !this.dark
      setStoredItem('theme-dark', this.dark ? '1' : '0')
      this.applyTheme()
    },
    applyTheme() {
      document.documentElement.setAttribute('data-theme', this.dark ? 'dark' : 'light')
    },
    setSidebarCollapsed(value) {
      this.sidebarCollapsed = Boolean(value)
      setStoredItem('sidebar-collapsed', this.sidebarCollapsed ? '1' : '0')
    },
    toggleSidebar() {
      this.setSidebarCollapsed(!this.sidebarCollapsed)
    }
  }
})
