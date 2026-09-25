import axios from 'axios'

// Mirrors server/config/paymentMethods.js. The API is the source of truth, but
// keeping a local copy means the payment forms still render if the request
// fails, and gives paymentMethodLabel() something to work with for methods
// recorded before a rename.
const FALLBACK_PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'mobile_wallet', label: 'Mobile Wallet' },
  { value: 'upi', label: 'UPI / QR' },
  { value: 'online', label: 'Online' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cheque', label: 'Cheque / Demand Draft' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'other', label: 'Other' },
]

let cache = null

export function paymentMethodLabel(value) {
  const match = FALLBACK_PAYMENT_METHODS.find(method => method.value === value)
  if (match) return match.label
  return String(value || '')
    .split('_')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

// Resolves once per page load to the server's configured payment methods.
export async function fetchPaymentMethods() {
  if (cache) return cache
  cache = axios
    .get('/api/billing/payment-methods')
    .then(response => {
      const methods = Array.isArray(response.data?.payment_methods) ? response.data.payment_methods : []
      return methods.length > 0
        ? methods.map(method => ({ value: method.value, label: method.label }))
        : FALLBACK_PAYMENT_METHODS
    })
    .catch(() => FALLBACK_PAYMENT_METHODS)
  return cache
}
