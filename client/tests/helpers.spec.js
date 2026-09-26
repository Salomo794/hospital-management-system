import { describe, it, expect } from 'vitest'
import { formatDate, formatDateTime, formatTime, formatCurrency, getStatusColor } from '../src/utils/helpers'
import { setDisplayZone } from '../src/utils/datetime'

// helpers.js re-exports the datetime functions and defines formatTime on top of
// them. formatTime used to reference a re-exported binding that was never in
// scope, which the bundler did not catch and which would have thrown at runtime
// the first time an appointment time was rendered. These tests pin that it works.

describe('formatTime', () => {
  it('trims an appointment slot to HH:mm', () => {
    expect(formatTime('09:30:00')).toBe('09:30')
    expect(formatTime('9:05')).toBe('09:05')
    expect(formatTime('23:59:00')).toBe('23:59')
  })

  it('returns an empty string for nothing', () => {
    expect(formatTime('')).toBe('')
    expect(formatTime(null)).toBe('')
    expect(formatTime(undefined)).toBe('')
  })
})

describe('formatDate and formatDateTime read UTC instants', () => {
  it('renders an instant in the hospital timezone', () => {
    setDisplayZone('Africa/Kigali')
    expect(formatDateTime('2026-01-15 22:30:00')).toContain('Jan 16, 2026')
    expect(formatDate('2026-01-15 22:30:00')).toBe('Jan 16, 2026')
  })

  it('leaves a bare calendar date alone', () => {
    setDisplayZone('America/Los_Angeles')
    expect(formatDate('2026-01-01')).toBe('Jan 1, 2026')
  })

  it('shows a dash rather than an invalid date', () => {
    expect(formatDate(null)).toBe('-')
    expect(formatDateTime(undefined)).toBe('-')
  })
})

describe('formatCurrency', () => {
  it('renders two decimal places', () => {
    expect(formatCurrency(1234.5)).toBe('$1,234.50')
    expect(formatCurrency(0)).toBe('$0.00')
  })

  it('does not print NaN', () => {
    expect(formatCurrency('not a number')).toBe('$0.00')
    expect(formatCurrency(undefined)).toBe('$0.00')
  })
})

describe('getStatusColor', () => {
  it('has a colour for the statuses the views rely on', () => {
    for (const status of ['scheduled', 'completed', 'cancelled', 'paid', 'partial', 'pending', 'admitted']) {
      expect(getStatusColor(status), status).toBeTruthy()
    }
  })

  it('falls back for an unknown status', () => {
    expect(getStatusColor('something-new')).toBeTruthy()
  })
})
