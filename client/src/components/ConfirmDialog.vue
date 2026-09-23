<template>
  <teleport to="body">
    <transition name="fade">
      <div class="modal-overlay" v-if="show" @click.self="handleCancel">
        <div class="modal modal-sm">
          <div class="modal-body" style="text-align:center;padding:32px 24px">
            <div class="confirm-icon" :class="'icon-' + confirmClass.replace('btn-', '')" v-if="confirmIcon">{{ confirmIcon }}</div>
            <h3 style="margin-bottom:8px;color:var(--gray-800)">{{ title }}</h3>
            <p class="confirm-message">{{ message }}</p>
          </div>
          <div class="modal-footer" style="justify-content:center">
            <button class="btn btn-secondary" @click="handleCancel">Cancel</button>
            <button class="btn" :class="confirmClass" @click="handleConfirm">{{ confirmText }}</button>
          </div>
        </div>
      </div>
    </transition>
  </teleport>
</template>

<script>
import { useConfirm } from '../store/confirm'

export default {
  name: 'ConfirmDialog',
  setup() {
    const { show, title, message, confirmText, confirmClass, confirmIcon, handleConfirm, handleCancel } = useConfirm()
    return { show, title, message, confirmText, confirmClass, confirmIcon, handleConfirm, handleCancel }
  }
}
</script>

<style scoped>
.confirm-message { font-size: 14px; color: var(--gray-500); line-height: 1.6; margin: 0; }
.confirm-icon { font-size: 40px; margin-bottom: 12px; }
.icon-danger { color: #dc2626; }
.icon-primary { color: #0d9488; }
</style>
