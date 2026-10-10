import { describe, it, expect } from 'vitest'
import { phoneProblem, PHONE_MIN_DIGITS, PHONE_MAX_DIGITS } from '../src/utils/phone'

// These mirror server/utils/phone.js so a form can explain a problem while it is
// being typed. The server remains the authority and re-checks every value.

describe('phone numbers are digits only', () => {
  it('accepts a plain number', () => {
    expect(phoneProblem('0788123456')).toBe('')
    expect(phoneProblem('250788123456')).toBe('')
  })

  it('treats a blank field as acceptable, because the field is optional', () => {
    expect(phoneProblem('')).toBe('')
    expect(phoneProblem('   ')).toBe('')
    expect(phoneProblem(null)).toBe('')
    expect(phoneProblem(undefined)).toBe('')
  })

  it('refuses the formats people add for their own readability', () => {
    // Storing "+250 788 123 456" beside "0788123456" is how one person becomes two
    // rows that never match.
    for (const formatted of [
      '+250788123456',
      '0788 123 456',
      '(078) 812-3456',
      '078-812-3456',
      '0788123456 ext 4',
      '07881234a6',
      '07881234.6',
      'call-me'
    ]) {
      expect(phoneProblem(formatted)).toMatch(/digits only/i)
    }
  })

  it('holds the length to the range the server uses', () => {
    expect(phoneProblem('1'.repeat(PHONE_MIN_DIGITS - 1))).toMatch(new RegExp(`between ${PHONE_MIN_DIGITS} and ${PHONE_MAX_DIGITS}`))
    expect(phoneProblem('1'.repeat(PHONE_MAX_DIGITS + 1))).toMatch(new RegExp(`between ${PHONE_MIN_DIGITS} and ${PHONE_MAX_DIGITS}`))
    expect(phoneProblem('1'.repeat(PHONE_MIN_DIGITS))).toBe('')
    expect(phoneProblem('1'.repeat(PHONE_MAX_DIGITS))).toBe('')
  })

  it('reports the character problem before the length problem', () => {
    // "abc" is both non-numeric and too short. Telling someone it is too short
    // would send them padding a value that is wrong for a different reason.
    expect(phoneProblem('abc')).toMatch(/digits only/i)
  })
})
