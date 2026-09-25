import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(relativeTime)

// The API stores every instant in UTC but sends it as 'YYYY-MM-DD HH:MM:SS',
// with no timezone marker. Day.js reads a string like that as *local* time, so
// displaying these values unchanged showed every clinical and financial
// timestamp hours early and rolled the date over at the wrong moment.
//
// Two kinds of value arrive from the API and they must be treated differently:
//
//   '2026-01-16 02:30:00'   an instant, stored in UTC  -> convert
//   '2026-01-16'            a calendar date, not an instant -> never convert
//
// The second case matters: a date of birth or an appointment date is a day on a
// calendar, not a moment in time. Shifting it by an offset would move a
// birthday to the previous day for anyone west of UTC.

// Times are shown in the hospital's timezone so two staff members always agree
// on what time it is, even if one is working remotely. Falls back to the
// browser's own zone until the API tells us better.
let displayZone = null

export function setDisplayZone(zone) {
  if (typeof zone === 'string' && zone.trim()) displayZone = zone.trim()
}

export function getDisplayZone() {
  if (displayZone) return displayZone
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/
// An instant with no offset, which is how the API writes UTC.
const NAIVE_INSTANT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/
const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i

// Returns a dayjs object, or null when there is nothing to format.
export function parseServerValue(value) {
  if (value === null || value === undefined || value === '') return null

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : dayjs(value).tz(getDisplayZone())
  }

  if (typeof value === 'number') return dayjs(value).tz(getDisplayZone())

  const text = String(value).trim()

  // A bare date is a calendar day. Parsing it in the display zone keeps it on
  // the calendar day it names instead of shifting it across midnight.
  if (CALENDAR_DATE.test(text)) return dayjs.tz(text, getDisplayZone())

  // A timestamp the API wrote as UTC but sent without a marker.
  if (NAIVE_INSTANT.test(text)) return dayjs.utc(text.replace(' ', 'T')).tz(getDisplayZone())

  // Anything already carrying an offset, e.g. from an external feed.
  if (HAS_OFFSET.test(text)) return dayjs(text).tz(getDisplayZone())

  const parsed = dayjs(text)
  return parsed.isValid() ? parsed.tz(getDisplayZone()) : null
}

export function formatDate(value) {
  const parsed = parseServerValue(value)
  return parsed ? parsed.format('MMM D, YYYY') : '-'
}

export function formatDateTime(value) {
  const parsed = parseServerValue(value)
  return parsed ? parsed.format('MMM D, YYYY h:mm A') : '-'
}

export function formatTimeOnly(value) {
  const parsed = parseServerValue(value)
  return parsed ? parsed.format('HH:mm') : ''
}

export function timeAgo(value) {
  const parsed = parseServerValue(value)
  return parsed ? parsed.fromNow() : ''
}

// 'HH:mm' for a plain time-of-day column such as appointments.appointment_time,
// which is a wall-clock string rather than an instant.
export function formatClockTime(value) {
  if (!value) return ''
  const text = String(value)
  const match = text.match(/(\d{1,2}):(\d{2})/)
  if (!match) return text
  return `${String(match[1]).padStart(2, '0')}:${match[2]}`
}
