<template>
  <router-view />
  <ToastContainer />
  <ConfirmDialog />
</template>

<script>
import { onMounted } from 'vue'
import { useAuthStore } from './store/auth'
import ToastContainer from './components/Toast.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import axios from 'axios'

export default {
  name: 'App',
  components: { ToastContainer, ConfirmDialog },
  setup() {
    const authStore = useAuthStore()
    onMounted(() => {
      authStore.initAxios()
    })
    axios.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401 && !error.config?.url?.includes('/api/auth/')) {
          authStore.logout()
          window.location.href = '/login'
        }
        return Promise.reject(error)
      }
    )
  }
}
</script>
