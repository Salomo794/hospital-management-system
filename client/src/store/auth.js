import { defineStore } from 'pinia'
import axios from 'axios'
import { getStoredItem, getStoredJson, removeStoredItem, setStoredItem, setStoredJson } from '../utils/storage'

let interceptorsInstalled = false

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: getStoredJson('user', user => !!user && typeof user === 'object' && typeof user.role === 'string'),
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
      setStoredItem('token', data.token)
      setStoredJson('user', data.user)
      axios.defaults.headers.common.Authorization = `Bearer ${data.token}`
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
