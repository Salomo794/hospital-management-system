// One place that decides how money is written.
//
// Deployments choose the currency with VITE_CURRENCY (an ISO 4217 code, for
// example RWF) and, optionally, VITE_CURRENCY_LOCALE for digit grouping. The
// default is USD formatted for en-US, which is what the screens showed before
// this was configurable, so existing installs see no change.
//
// Intl knows how many decimals each currency uses: USD gets two, RWF none.

const DEFAULT_CURRENCY = 'USD'
const DEFAULT_LOCALE = 'en-US'

const clean = value => (typeof value === 'string' && value.trim() ? value.trim() : '')

function readConfig() {
  const env = (typeof import.meta !== 'undefined' && import.meta.env) || {}
  return {
    currency: clean(env.VITE_CURRENCY).toUpperCase() || DEFAULT_CURRENCY,
    locale: clean(env.VITE_CURRENCY_LOCALE) || DEFAULT_LOCALE
  }
}

const formatterCache = new Map()

function getFormatter({ currency, locale }, whole) {
  const key = `${locale}|${currency}|${whole ? 'w' : 'f'}`
  if (!formatterCache.has(key)) {
    const options = { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }
    if (whole) {
      options.minimumFractionDigits = 0
      options.maximumFractionDigits = 0
    }
    try {
      formatterCache.set(key, new Intl.NumberFormat(locale, options))
    } catch {
      // A mistyped code or locale must not blank every price on screen.
      formatterCache.set(key, new Intl.NumberFormat(DEFAULT_LOCALE, {
        style: 'currency', currency: DEFAULT_CURRENCY, currencyDisplay: 'narrowSymbol',
        ...(whole ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {})
      }))
    }
  }
  return formatterCache.get(key)
}

// `config` is only passed by tests; the app uses the build-time settings.
export function formatMoney(amount, { whole = false, config = readConfig() } = {}) {
  const value = Number(amount)
  return getFormatter(config, whole).format(Number.isFinite(value) ? value : 0)
}

export const currencyCode = (config = readConfig()) => config.currency
