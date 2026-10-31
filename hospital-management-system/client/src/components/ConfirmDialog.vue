<template>
  <teleport to="body">
    <transition name="fade">
      <div class="modal-overlay" v-if="show" @click.self="handleCancel">
        <div
          class="modal modal-sm confirm-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          aria-describedby="confirm-message"
        >
          <div class="modal-body confirm-body">
            <div class="confirm-badge" :class="`is-${tone}`">
              <AppIcon :name="tone === 'danger' ? 'alert-triangle' : 'check'" :size="26" />
            </div>
            <h3 id="confirm-title" class="confirm-title">{{ title }}</h3>
            <p id="confirm-message" class="confirm-message">{{ message }}</p>
          </div>
          <div class="modal-footer confirm-footer">
            <button ref="cancelBtn" type="button" class="btn btn-secondary" @click="handleCancel">
              Cancel
            </button>
            <button type="button" class="btn" :class="confirmClass" @click="handleConfirm">
              {{ confirmText }}
            </button>
          </div>
        </div>
      </div>
    </transition>
  </teleport>
</template>

<script>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useConfirm } from '../store/confirm'
import AppIcon from './AppIcon.vue'

export default {
  name: 'ConfirmDialog',
  components: { AppIcon },
  setup() {
    const { show, title, message, confirmText, confirmClass, handleConfirm, handleCancel } = useConfirm()

    // Danger confirmations get the warning glyph in a red ring; everything else
    // gets a check in a teal ring. Tone comes from the caller's button class, so
    // existing callers did not have to change.
    const tone = computed(() => (confirmClass.value === 'btn-danger' ? 'danger' : 'success'))

    // Keyboard support: Escape cancels, and focus lands on the safe (cancel)
    // option so Enter never destroys anything by accident.
    const cancelBtn = ref(null)
    watch(show, async (visible) => {
      if (visible) {
        await nextTick()
        cancelBtn.value?.focus()
      }
    })
    const onKeydown = (e) => {
      if (e.key === 'Escape' && show.value) handleCancel()
    }
    onMounted(() => window.addEventListener('keydown', onKeydown))
    onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

    return { show, title, message, confirmText, confirmClass, handleConfirm, handleCancel, tone, cancelBtn }
  }
}
</script>

<style scoped>
.confirm-dialog { max-width: 400px; }
.confirm-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 32px 28px 24px;
}
.confirm-badge {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
}
.confirm-badge.is-danger { background: var(--danger-bg); color: var(--danger); }
.confirm-badge.is-success { background: var(--success-bg); color: var(--success); }
.confirm-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 8px;
  letter-spacing: -0.02em;
}
.confirm-message { font-size: 13.5px; color: var(--text-muted); line-height: 1.65; margin: 0; }
.confirm-footer { justify-content: center; padding: 14px 24px 20px; background: transparent; border-top: none; }
</style>
