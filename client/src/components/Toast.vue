<template>
  <teleport to="body">
    <transition-group name="toast" tag="div" class="toast-container">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="'toast-' + t.type" @click="remove(t.id)">
        <span class="toast-icon">{{ iconMap[t.type] }}</span>
        <span class="toast-msg">{{ t.message }}</span>
      </div>
    </transition-group>
  </teleport>
</template>

<script>
import { useToast } from '../store/toast'

export default {
  name: 'ToastContainer',
  setup() {
    const { toasts, remove } = useToast()
    const iconMap = { success: '\u2713', danger: '\u2717', warning: '\u26A0', info: '\u2139' }
    return { toasts, remove, iconMap }
  }
}
</script>

<style scoped>
.toast-container {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 380px;
}
.toast {
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  box-shadow: 0 8px 24px rgba(0,0,0,0.15);
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  animation: toastSlideIn 0.3s ease;
}
.toast-success { background: #16a34a; color: white; }
.toast-danger { background: #dc2626; color: white; }
.toast-warning { background: #f59e0b; color: #1e293b; }
.toast-info { background: #0ea5e9; color: white; }
.toast-icon { font-size: 16px; flex-shrink: 0; }
.toast-msg { flex: 1; }
.toast-enter-active { animation: toastSlideIn 0.3s ease; }
.toast-leave-active { animation: toastSlideOut 0.2s ease; }
@keyframes toastSlideIn { from { opacity: 0; transform: translateX(60px); } to { opacity: 1; transform: translateX(0); } }
@keyframes toastSlideOut { to { opacity: 0; transform: translateX(60px); } }
</style>
