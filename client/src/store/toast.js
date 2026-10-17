import { ref } from 'vue'

const toasts = ref([])
let toastId = 0

export function useToast() {
  // `action` is an optional { label, onClick } pair, which is how an undo or a
  // retry is offered without stacking a second dialog on top of the screen.
  function add(message, type = 'info', duration = 4000, action = null) {
    const id = ++toastId
    toasts.value.push({ id, message, type, action })
    // An actionable toast is given a little longer, since it asks the user to
    // make a decision rather than just read it.
    const lifetime = action ? Math.max(duration, 7000) : duration
    if (lifetime > 0) {
      setTimeout(() => {
        const idx = toasts.value.findIndex(t => t.id === id)
        if (idx !== -1) toasts.value.splice(idx, 1)
      }, lifetime)
    }
    return id
  }

  function remove(id) {
    const idx = toasts.value.findIndex(t => t.id === id)
    if (idx !== -1) toasts.value.splice(idx, 1)
  }

  return {
    toasts,
    success: (msg, action) => add(msg, 'success', 4000, action),
    error: (msg, action) => add(msg, 'danger', 5000, action),
    warning: (msg, action) => add(msg, 'warning', 5000, action),
    info: (msg, action) => add(msg, 'info', 4000, action),
    remove
  }
}
