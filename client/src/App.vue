<template>
  <router-view />
  <ToastContainer />
  <ConfirmDialog />
</template>

<script>
import ToastContainer from './components/Toast.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'

export default {
  name: 'App',
  components: { ToastContainer, ConfirmDialog }
}
</script>
