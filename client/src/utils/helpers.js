// Timestamps are formatted through utils/datetime.js. The API stores instants in
// UTC and sends them without a marker, so they have to be read as UTC and shown
// in the hospital's timezone; doing that inline in every view is how the offset
// bug spread in the first place.
export {
  formatDate,
  formatDateTime,
  formatTimeOnly,
  formatClockTime,
  timeAgo,
  setDisplayZone,
  getDisplayZone,
} from './datetime'

// Appointment and slot times are wall-clock strings rather than instants, so
// they are trimmed to HH:mm without any timezone conversion.
export function formatTime(time) {
  return formatClockTime(time)
}

export function formatCurrency(amount) {
  const value = Number(amount)
  if (!Number.isFinite(value)) return '$0.00'
  return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function getStatusColor(status) {
  const map = {
    scheduled: 'info',
    confirmed: 'info',
    in_progress: 'warning',
    completed: 'success',
    cancelled: 'danger',
    no_show: 'danger',
    active: 'success',
    inactive: 'danger',
    paid: 'success',
    partial: 'warning',
    pending: 'danger',
    overpaid: 'info',
    refunded: 'gray',
    ordered: 'info',
    admitted: 'info',
    discharged: 'success',
    transferred: 'warning',
    final: 'success',
    draft: 'warning',
    amended: 'info'
  }
  return map[status] || 'info'
}

export function getStatusLabel(status) {
  return status ? status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : ''
}

export function hasAllergy(value) {
  if (value === null || value === undefined) return false
  return !/^(?:\s*none|\s*n\/?a|\s*nil|\s*no known allergies|\s*no allergies)\s*$/i.test(String(value))
}

export function debounce(fn, delay = 300) {
  let timer
  const debounced = (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      Promise.resolve(fn(...args)).catch(error => console.error('Debounced callback failed:', error))
    }, delay)
  }
  debounced.cancel = () => clearTimeout(timer)
  return debounced
}

export function generateMRN() {
  const prefix = 'MRN'
  const ts = Date.now().toString(36).toUpperCase()
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `${prefix}-${ts.slice(-4)}${rand}`
}
