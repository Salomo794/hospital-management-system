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
  { value: 'mobile_money', label: 'Mobile Money' },
  { value: 'upi', label: 'UPI / QR' },
  { value: 'online', label: 'Online' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cheque', label: 'Cheque / Demand Draft' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'other', label: 'Other' },
]

let cache = null

// Mobile money is a different shape of payment, not just another dropdown
// value: the customer approves a prompt on their own handset, so the bill is
// not settled when the request is sent. The server decides whether the rail is
// available at all, and the payment forms use this to decide whether to offer
// it. A disabled rail is the normal case and must not look like an error.
const MOBILE_MONEY_METHOD = 'mobile_money'
const disabledMobileMoney = { enabled: false, provider: null, networks: [] }

export async function fetchMobileMoneyConfig() {
  try {
    const { data } = await axios.get('/api/billing/mobile-money/config')
    if (!data?.enabled) return disabledMobileMoney
    return {
      enabled: true,
      provider: data.provider,
      currency: data.currency || 'NGN',
      networks: Array.isArray(data.networks) ? data.networks : []
    }
  } catch {
    return disabledMobileMoney
  }
}

export { MOBILE_MONEY_METHOD, disabledMobileMoney }

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
