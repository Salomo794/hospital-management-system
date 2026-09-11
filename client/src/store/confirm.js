import { ref } from 'vue'

const show = ref(false)
const title = ref('Confirm')
const message = ref('')
const confirmText = ref('Confirm')
const confirmClass = ref('btn-primary')
const confirmIcon = ref('')
let resolvePromise = null

export function useConfirm() {
  async function confirm(opts = {}) {
    title.value = opts.title || 'Confirm'
    message.value = opts.message || 'Are you sure?'
    confirmText.value = opts.confirmText || 'Confirm'
    confirmClass.value = opts.confirmClass || 'btn-primary'
    confirmIcon.value = opts.icon || ''
    show.value = true
    return new Promise((resolve) => {
      resolvePromise = resolve
    })
  }

  function handleConfirm() {
    show.value = false
    if (resolvePromise) resolvePromise(true)
    resolvePromise = null
  }

  function handleCancel() {
    show.value = false
    if (resolvePromise) resolvePromise(false)
    resolvePromise = null
  }

  return { show, title, message, confirmText, confirmClass, confirmIcon, confirm, handleConfirm, handleCancel }
}
