import { defineStore } from 'pinia'

export const useUiStore = defineStore('ui', {
  state: () => ({
    dark: localStorage.getItem('theme-dark') === '1',
    sidebarCollapsed: localStorage.getItem('sidebar-collapsed') === '1'
  }),
  actions: {
    toggleDark() {
      this.dark = !this.dark
      localStorage.setItem('theme-dark', this.dark ? '1' : '0')
      this.applyTheme()
    },
    applyTheme() {
      document.documentElement.setAttribute('data-theme', this.dark ? 'dark' : 'light')
    },
    setSidebarCollapsed(v) {
      this.sidebarCollapsed = v
      localStorage.setItem('sidebar-collapsed', v ? '1' : '0')
    }
  }
})
