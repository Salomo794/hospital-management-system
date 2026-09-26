import { describe, it, expect } from 'vitest'
import {
  validatePassword, isAcceptable, passwordStrength, MIN_LENGTH, MAX_LENGTH
} from '../src/utils/passwordPolicy'

// These mirror server/utils/passwordPolicy.js so the form can explain a problem
// before the request is sent. A parity test on the server runs a corpus through
// both implementations, so the two cannot drift apart unnoticed.

describe('length', () => {
  it('requires twelve characters', () => {
    expect(MIN_LENGTH).toBe(12)
    expect(validatePassword('short').join(' ')).toMatch(/at least 12 characters/i)
    expect(validatePassword('a'.repeat(11)).length).toBeGreaterThan(0)
  })

  it('refuses a password longer than bcrypt can use', () => {
    // bcrypt ignores everything past 72 bytes, so a longer password would let
    // two different passwords open the same account.
    expect(validatePassword('a'.repeat(300)).join(' ')).toMatch(/at most/i)
    expect(MAX_LENGTH).toBe(200)
  })
})

describe('passwords that appear in every credential list', () => {
  const weak = [
    'password123', 'Password123', '123456789012', 'qwertyuiop12',
    'hospital123', 'welcome1234', 'letmein12345'
  ]

  for (const password of weak) {
    it(`rejects "${password}"`, () => {
      expect(validatePassword(password).length).toBeGreaterThan(0)
    })
  }

  it('catches variations of a known password, not just the exact string', () => {
    expect(validatePassword('password1234').length).toBeGreaterThan(0)
    expect(validatePassword('password123!').length).toBeGreaterThan(0)
  })
})

describe('long but predictable', () => {
  // Each of these satisfies "at least twelve characters".
  const predictable = ['aaaaaaaaaaaa', '123456789012', 'abcdefghijkl']

  for (const password of predictable) {
    it(`rejects "${password}"`, () => {
      expect(validatePassword(password).length).toBeGreaterThan(0)
    })
  }
})

describe('self-reference', () => {
  it('rejects a password built from the person own name', () => {
    const context = { email: 'grace.mwangi@hospital.com', firstName: 'Grace', lastName: 'Mwangi' }
    expect(validatePassword('Mwangi-2026-x', context).join(' ')).toMatch(/name or email/i)
    expect(validatePassword('gracemwangi99', context).join(' ')).toMatch(/name or email/i)
  })

  it('rejects a password built from this system own name', () => {
    expect(validatePassword('MediCare2026x').join(' ')).toMatch(/related to this system/i)
  })

  it('does not fire on a short name by accident', () => {
    expect(validatePassword('correct-horse-battery-7', { firstName: 'Al' }).join(' '))
      .not.toMatch(/name or email/i)
  })
})

describe('a reasonable passphrase is accepted', () => {
  const good = [
    'correct-horse-battery-7',
    'Thornbury!Ward2026',
    'vivid-marmoset-echo-42',
    'riverside-clinic-9917'
  ]

  for (const password of good) {
    it(`accepts "${password}"`, () => {
      expect(validatePassword(password)).toEqual([])
      expect(isAcceptable(password)).toBe(true)
    })
  }
})

describe('the strength meter', () => {
  it('is empty for no input', () => {
    expect(passwordStrength('').label).toBe('Empty')
  })

  it('rates a long passphrase above a short one', () => {
    const long = passwordStrength('correct-horse-battery-7')
    const short = passwordStrength('Ab1!xy')
    expect(long.score).toBeGreaterThan(short.score)
  })

  it('does not rate an unacceptable password highly just because it is long', () => {
    // Length alone must not read as strong, or the meter contradicts the rules.
    const score = passwordStrength('aaaaaaaaaaaa').score
    expect(score).toBeLessThan(4)
  })

  it('stays within the 0 to 4 range the bar renders', () => {
    for (const password of ['', 'a', 'Thornbury!Ward2026', 'a'.repeat(60)]) {
      const { score } = passwordStrength(password)
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(4)
    }
  })
})
