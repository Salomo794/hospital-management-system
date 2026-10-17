<template>
  <teleport to="body">
    <transition-group name="toast-anim" tag="div" class="toast-stack">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="toast-item"
        :class="`toast-${t.type}`"
        role="status"
      >
        <span class="toast-icon"><AppIcon :name="iconMap[t.type]" :size="16" :stroke-width="2" /></span>
        <span class="toast-text">{{ t.message }}</span>
        <button
          v-if="t.action"
          type="button"
          class="toast-action"
          @click.stop="runAction(t)"
        >
          {{ t.action.label }}
        </button>
        <button class="toast-close" type="button" aria-label="Dismiss" @click.stop="remove(t.id)">
          <AppIcon name="x" :size="14" :stroke-width="2.2" />
        </button>
      </div>
    </transition-group>
  </teleport>
</template>

<script>
import { useToast } from '../store/toast'
import AppIcon from './AppIcon.vue'

export default {
  name: 'ToastContainer',
  components: { AppIcon },
  setup() {
    const { toasts, remove } = useToast()
    const iconMap = { success: 'check', danger: 'alert-triangle', warning: 'alert-triangle', info: 'info' }

    // The toast closes itself first, so the action runs against a screen the
    // user can already see the result on.
    const runAction = (t) => {
      remove(t.id)
      t.action?.onClick?.()
    }

    return { toasts, remove, iconMap, runAction }
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
  padding: 13px 14px 13px 16px;
  border-radius: 12px;
  font-size: 13.5px; font-weight: 500;
  box-shadow: 0 8px 30px rgba(0,0,0,.18), 0 2px 8px rgba(0,0,0,.10);
  border: 1px solid rgba(255,255,255,.15);
  backdrop-filter: blur(10px);
  min-width: 260px;
}

.toast-success { background: #14532d; color: #d1fae5; }
.toast-danger  { background: #7f1d1d; color: #fee2e2; }
.toast-warning { background: #78350f; color: #fef3c7; }
.toast-info    { background: #1e3a5f; color: #bfdbfe; }

.toast-icon { display: flex; flex-shrink: 0; opacity: .9; }
.toast-text { flex: 1; line-height: 1.4; }

.toast-action {
  flex-shrink: 0;
  padding: 4px 10px;
  font: inherit;
  font-weight: 700;
  color: inherit;
  background: rgba(255,255,255,.14);
  border: 1px solid rgba(255,255,255,.22);
  border-radius: 7px;
  cursor: pointer;
  transition: background .15s ease, border-color .15s ease;
}
.toast-action:hover { background: rgba(255,255,255,.24); border-color: rgba(255,255,255,.35); }

.toast-close {
  display: flex; align-items: center; justify-content: center;
  width: 22px; height: 22px;
  background: none; border: none; border-radius: 6px;
  cursor: pointer; opacity: .55; color: inherit;
  flex-shrink: 0;
  transition: opacity .15s ease, background .15s ease;
}
.toast-close:hover { opacity: 1; background: rgba(255,255,255,.14); }

.toast-anim-enter-active { animation: tIn .3s cubic-bezier(.34,1.46,.64,1); }
.toast-anim-leave-active { animation: tOut .2s ease forwards; position: absolute; right: 0; }
.toast-anim-move { transition: transform .25s ease; }

@keyframes tIn  { from{opacity:0;transform:translateX(60px) scale(.95)} to{opacity:1;transform:none} }
@keyframes tOut { to{opacity:0;transform:translateX(60px) scale(.95)} }

@media (max-width: 480px) {
  .toast-stack { left: 12px; right: 12px; max-width: 100%; }
}
</style>
