import { describe, it, expect } from 'vitest'
import { formatMoney, currencyCode } from '../src/utils/currency'
import { formatCurrency } from '../src/utils/helpers'

const usd = { currency: 'USD', locale: 'en-US' }
const rwf = { currency: 'RWF', locale: 'en-US' }

describe('formatMoney', () => {
  it('keeps the original USD output by default', () => {
    expect(formatMoney(1234.5, { config: usd })).toBe('$1,234.50')
    expect(formatMoney(0, { config: usd })).toBe('$0.00')
    // The app-wide helper is built on it, so existing screens do not change.
    expect(formatCurrency(1234.5)).toBe('$1,234.50')
  })

  it('formats Rwandan francs without decimals', () => {
    expect(formatMoney(1850000, { config: rwf })).toMatch(/1,850,000$/)
    expect(formatMoney(1850000, { config: rwf })).not.toMatch(/\.\d\d$/)
    expect(formatMoney(1850000, { config: rwf })).toMatch(/RF|FRw|RWF/)
  })

  it('rounds to whole units on request', () => {
    expect(formatMoney(1850000.75, { whole: true, config: usd })).toBe('$1,850,001')
  })

  it('treats anything that is not a number as zero', () => {
    expect(formatMoney('not a number', { config: usd })).toBe('$0.00')
    expect(formatMoney(undefined, { config: usd })).toBe('$0.00')
    expect(formatMoney(NaN, { whole: true, config: usd })).toBe('$0')
  })

  it('falls back to USD instead of throwing on a mistyped currency code', () => {
    expect(formatMoney(5, { config: { currency: 'NOT-A-CODE', locale: 'en-US' } })).toBe('$5.00')
  })

  it('reports the configured currency code', () => {
    expect(currencyCode(rwf)).toBe('RWF')
  })
})
