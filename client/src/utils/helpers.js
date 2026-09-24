import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)

export function formatDate(date) {
  if (!date) return '-'
  return dayjs(date).format('MMM D, YYYY')
}

export function formatDateTime(date) {
  if (!date) return '-'
  return dayjs(date).format('MMM D, YYYY h:mm A')
}

export function formatTime(time) {
  if (!time) return ''
  const t = String(time)
  return t.substring(0, 5)
}

export function formatCurrency(amount) {
  const value = Number(amount)
  if (!Number.isFinite(value)) return '$0.00'
  return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function timeAgo(date) {
  if (!date) return ''
  return dayjs(date).fromNow()
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
