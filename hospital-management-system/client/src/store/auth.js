import { defineStore } from 'pinia'
import axios from 'axios'
import { getStoredItem, getStoredJson, removeStoredItem, setStoredItem, setStoredJson } from '../utils/storage'
import { setDisplayZone } from '../utils/datetime'

let interceptorsInstalled = false

// Times are rendered in the hospital's timezone. The server reports it on
// sign-in and on /me; a stored value from a previous session is applied
// immediately so the first paint is already correct.
const storedUser = getStoredJson('user', user => !!user && typeof user === 'object' && typeof user.role === 'string')
if (storedUser?.timezone) setDisplayZone(storedUser.timezone)

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: storedUser,
    token: getStoredItem('token')
  }),
  getters: {
    isAuthenticated: state => !!state.token && !!state.user,
    userRole: state => state.user?.role || null,
    userName: state => state.user ? `${state.user.first_name || ''} ${state.user.last_name || ''}`.trim() : ''
  },
  actions: {
    can(...roles) {
      return roles.length === 0 || roles.includes(this.userRole)
    },
    async login(email, password) {
      const { data } = await axios.post('/api/auth/login', { email, password })
      this.token = data.token
      this.user = data.user
      if (data.user?.timezone) setDisplayZone(data.user.timezone)
      setStoredItem('token', data.token)
      setStoredJson('user', data.user)
      axios.defaults.headers.common.Authorization = `Bearer ${data.token}`
    },
    // Updates the signed-in user's own display name and phone. The server
    // re-reads the user on every request, so the new name applies immediately
    // everywhere; the cached copy is updated here so the header does not have to
    // wait for a reload.
    async updateProfile({ first_name, last_name, phone }) {
      const { data } = await axios.put('/api/auth/me', { first_name, last_name, phone })
      this.user = { ...this.user, ...data }
      setStoredJson('user', this.user)
      return data
    },
    // Keeps the display timezone in step with the server, in case APP_TIMEZONE
    // changed since the stored session was written.
    async refreshTimezone() {
      try {
        const { data } = await axios.get('/api/auth/me')
        if (data?.timezone) {
          setDisplayZone(data.timezone)
          if (this.user) {
            this.user = { ...this.user, timezone: data.timezone }
            setStoredJson('user', this.user)
          }
        }
      } catch {
        // The browser's own zone remains in use, which is a safe fallback.
      }
    },
    logout() {
      this.token = null
      this.user = null
      removeStoredItem('token')
      removeStoredItem('user')
      delete axios.defaults.headers.common.Authorization
    },
    initAxios() {
      axios.interceptors.request.use(config => {
        const token = this.token || getStoredItem('token')
        if (token) {
          config.headers = config.headers || {}
          if (!config.headers.Authorization) config.headers.Authorization = `Bearer ${token}`
        }
        return config
      })

      if (!interceptorsInstalled) {
        axios.interceptors.response.use(
          response => response,
          error => {
            const url = String(error.config?.url || '')
            const isPublicAuthRequest = /\/api\/auth\/(login|register)(?:\?|$)/.test(url)
            if (error.response?.status === 401 && !isPublicAuthRequest) {
              this.logout()
              if (window.location.pathname !== '/login') {
                window.location.assign('/login?session=expired')
              }
            }
            return Promise.reject(error)
          }
        )
        interceptorsInstalled = true
      }

      if (this.token) {
        axios.defaults.headers.common.Authorization = `Bearer ${this.token}`
      } else {
        delete axios.defaults.headers.common.Authorization
      }
    }
  }
})
