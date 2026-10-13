import { describe, it, expect } from 'vitest'
import {
  parseServerValue, formatDate, formatDateTime, formatClockTime,
  setDisplayZone, getDisplayZone
} from '../src/utils/datetime'

// The API stores instants in UTC and sends them as 'YYYY-MM-DD HH:MM:SS' with
// no offset marker. A date library reads a bare timestamp as *local* time, so
// before this module every clinical and financial timestamp rendered hours early
// and rolled the date over at the wrong moment. These tests pin the two rules
// that prevent that: read instants as UTC, and never convert a calendar date.

describe('display timezone', () => {
  it('defaults to the browser zone until the server reports one', () => {
    expect(typeof getDisplayZone()).toBe('string')
    expect(getDisplayZone().length).toBeGreaterThan(0)
  })

  it('uses the zone the server reports', () => {
    setDisplayZone('Africa/Kigali')
    expect(getDisplayZone()).toBe('Africa/Kigali')
    setDisplayZone('Europe/London')
    expect(getDisplayZone()).toBe('Europe/London')
  })

  it('ignores a blank zone rather than rendering in nothing', () => {
    setDisplayZone('Africa/Kigali')
    setDisplayZone('   ')
    expect(getDisplayZone()).toBe('Africa/Kigali')
  })
})

describe('reading an instant stored in UTC', () => {
  it('moves a late-evening UTC timestamp into the next local day', () => {
    setDisplayZone('Africa/Kigali') // UTC+2 all year
    // 22:30 UTC is 00:30 the following day in Kigali.
    expect(formatDateTime('2026-01-15 22:30:00')).toContain('Jan 16, 2026')
    expect(formatDateTime('2026-01-15 22:30:00')).toContain('12:30 AM')
  })

  it('leaves a mid-afternoon UTC timestamp on the same local day', () => {
    setDisplayZone('Africa/Kigali')
    expect(formatDateTime('2026-01-15 12:00:00')).toContain('Jan 15, 2026')
    expect(formatDateTime('2026-01-15 12:00:00')).toContain('2:00 PM')
  })

  it('honours a zone with a different offset', () => {
    setDisplayZone('Asia/Tokyo') // UTC+9
    expect(formatDateTime('2026-01-15 12:00:00')).toContain('9:00 PM')
    setDisplayZone('America/New_York') // UTC-5 in January
    expect(formatDateTime('2026-01-15 12:00:00')).toContain('7:00 AM')
  })

  it('treats a value that already carries an offset the same way', () => {
    setDisplayZone('Africa/Kigali')
    const bare = formatDateTime('2026-01-15 22:30:00')
    const marked = formatDateTime('2026-01-15T22:30:00Z')
    expect(marked).toBe(bare)
  })

  it('respects daylight saving when a zone observes it', () => {
    setDisplayZone('Europe/London')
    // GMT in January, BST in July: same UTC instant, different local hour.
    expect(formatDateTime('2026-01-15 12:00:00')).toContain('12:00 PM')
    expect(formatDateTime('2026-07-15 12:00:00')).toContain('1:00 PM')
  })
})

describe('a bare date is a calendar day and must never shift', () => {
  const dates = ['2026-01-01', '2026-03-31', '2026-06-15', '2026-12-31', '2026-11-01']

  for (const zone of ['Africa/Kigali', 'Pacific/Auckland', 'America/Los_Angeles', 'UTC']) {
    it(`stays put in ${zone}`, () => {
      setDisplayZone(zone)
      for (const date of dates) {
        const parsed = parseServerValue(date)
        expect(parsed.format('YYYY-MM-DD'), `${date} shifted in ${zone}`).toBe(date)
      }
    })
  }

  it('does not roll a year boundary back a day in a negative offset zone', () => {
    setDisplayZone('America/Los_Angeles')
    expect(formatDate('2026-01-01')).toBe('Jan 1, 2026')
  })
})

describe('missing and unusable values', () => {
  it('renders a dash rather than "Invalid Date"', () => {
    setDisplayZone('Africa/Kigali')
    for (const empty of [null, undefined, '']) {
      expect(formatDate(empty)).toBe('-')
      expect(formatDateTime(empty)).toBe('-')
    }
  })

  it('returns null for values it cannot parse', () => {
    expect(parseServerValue(null)).toBeNull()
    expect(parseServerValue('')).toBeNull()
  })
})

describe('wall-clock times', () => {
  // Appointment slots are clock times, not instants, so they must never be
  // shifted by a timezone.
  it('passes a slot time through untouched', () => {
    setDisplayZone('Africa/Kigali')
    expect(formatClockTime('09:30:00')).toBe('09:30')
    expect(formatClockTime('9:05')).toBe('09:05')
    expect(formatClockTime('23:59:00')).toBe('23:59')
  })

  it('does not convert a slot time even in a far-away zone', () => {
    setDisplayZone('Pacific/Auckland')
    expect(formatClockTime('09:30:00')).toBe('09:30')
  })
})
