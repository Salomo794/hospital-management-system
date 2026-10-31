import { defineStore } from 'pinia'
import { getStoredItem, setStoredItem } from '../utils/storage'
import { DEFAULT_LOCALE, isSupportedLocale } from '../i18n/locales'

const storedLocale = () => {
  const code = getStoredItem('locale')
  return isSupportedLocale(code) ? code : DEFAULT_LOCALE
}

export const useUiStore = defineStore('ui', {
  state: () => ({
    dark: getStoredItem('theme-dark') === '1',
    sidebarCollapsed: getStoredItem('sidebar-collapsed') === '1',
    locale: storedLocale()
  }),
  actions: {
    toggleDark() {
      this.dark = !this.dark
      setStoredItem('theme-dark', this.dark ? '1' : '0')
      this.applyTheme()
    },
    applyTheme() {
      document.documentElement.setAttribute('data-theme', this.dark ? 'dark' : 'light')
      document.documentElement.setAttribute('lang', this.locale)
    },
    setLocale(code) {
      if (!isSupportedLocale(code)) return
      this.locale = code
      setStoredItem('locale', code)
      document.documentElement.setAttribute('lang', code)
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
