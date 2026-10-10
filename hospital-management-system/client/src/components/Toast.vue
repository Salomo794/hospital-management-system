<template>
  <teleport to="body">
    <transition-group name="toast-anim" tag="div" class="toast-stack">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="toast-item"
        :class="`toast-${t.type}`"
        role="alert"
        @click="remove(t.id)"
      >
        <span class="toast-icon">{{ iconMap[t.type] }}</span>
        <span class="toast-text">{{ t.message }}</span>
        <button class="toast-close" aria-label="Dismiss">×</button>
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
    const iconMap = { success: '✓', danger: '✕', warning: '⚠', info: 'ℹ' }
    return { toasts, remove, iconMap }
  }
}
</script>

<style scoped>
.toast-stack {
  position: fixed;
  top: 20px; right: 20px;
  z-index: 9999;
  display: flex; flex-direction: column; gap: 8px;
  max-width: 380px;
}

.toast-item {
  display: flex; align-items: center; gap: 10px;
  padding: 13px 16px;
  border-radius: 12px;
  font-size: 13.5px; font-weight: 500;
  box-shadow: 0 8px 30px rgba(0,0,0,.18), 0 2px 8px rgba(0,0,0,.10);
  cursor: pointer;
  border: 1px solid rgba(255,255,255,.15);
  backdrop-filter: blur(10px);
  min-width: 260px;
}

.toast-success { background: #14532d; color: #d1fae5; }
.toast-danger  { background: #7f1d1d; color: #fee2e2; }
.toast-warning { background: #78350f; color: #fef3c7; }
.toast-info    { background: #1e3a5f; color: #bfdbfe; }

.toast-icon { font-size: 15px; flex-shrink: 0; opacity: .9; }
.toast-text { flex: 1; line-height: 1.4; }
.toast-close {
  background: none; border: none; font-size: 18px; line-height: 1;
  cursor: pointer; opacity: .6; padding: 0 2px; color: inherit;
  margin-left: 4px; flex-shrink: 0;
}
.toast-close:hover { opacity: 1; }

.toast-anim-enter-active { animation: tIn .3s cubic-bezier(.34,1.46,.64,1); }
.toast-anim-leave-active { animation: tOut .2s ease forwards; position: absolute; right: 0; }
.toast-anim-move { transition: transform .25s ease; }

@keyframes tIn  { from{opacity:0;transform:translateX(60px) scale(.95)} to{opacity:1;transform:none} }
@keyframes tOut { to{opacity:0;transform:translateX(60px) scale(.95)} }

@media (max-width: 480px) {
  .toast-stack { left: 12px; right: 12px; max-width: 100%; }
}
</style>
