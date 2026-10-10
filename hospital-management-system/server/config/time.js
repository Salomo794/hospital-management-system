const { loadEnvironment } = require('./environment');

// The hospital operates in one timezone even though the server almost always
// does not. Anything that means "today" to staff - the day's takings, the
// current check-in queue, tonight's overdue medicines - has to be resolved
// against the hospital's calendar, not the server's UTC one.
//
// Timestamps are still stored in UTC, which is correct. This module only
// converts between a UTC instant and the hospital's wall clock, and it does so
// through real instants so daylight saving is handled properly rather than with
// a fixed offset that silently drifts twice a year.

const DEFAULT_TIMEZONE = 'Africa/Kigali';

function appTimezone() {
  loadEnvironment();
  const configured = String(process.env.APP_TIMEZONE || '').trim();
  if (!configured) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: configured });
    return configured;
  } catch {
    console.warn(`[time] APP_TIMEZONE "${configured}" is not a known IANA zone; using ${DEFAULT_TIMEZONE}.`);
    return DEFAULT_TIMEZONE;
  }
}

// The calendar fields of an instant as seen in a timezone. hourCycle 'h23'
// rather than hour12:false, because some ICU builds render midnight as hour 24.
function zonedParts(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const field = type => parts.find(part => part.type === type).value;
  return {
    year: Number(field('year')),
    month: Number(field('month')),
    day: Number(field('day')),
    hour: Number(field('hour')),
    minute: Number(field('minute')),
    second: Number(field('second')),
  };
}

// How far ahead of UTC a timezone is at a given instant, in milliseconds.
function offsetMsAt(instant, timeZone) {
  const p = zonedParts(instant, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Drop sub-second noise so the two instants describe the same whole second.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

// The UTC instant of a wall-clock time in a timezone. Inverted in two passes so
// a daylight-saving boundary resolves to the right side of the jump.
function instantFromZoned({ year, month, day, hour = 0, minute = 0, second = 0 }, timeZone) {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  let instant = new Date(naive - offsetMsAt(new Date(naive), timeZone));
  const corrected = new Date(naive - offsetMsAt(instant, timeZone));
  if (corrected.getTime() !== instant.getTime()) instant = corrected;
  return instant;
}

// 'YYYY-MM-DD' for the hospital's current day.
function zonedDate(instant = new Date(), timeZone = appTimezone()) {
  const p = zonedParts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

// 'YYYY-MM-DD HH:MM:SS' for the hospital's current wall clock.
function zonedDateTime(instant = new Date(), timeZone = appTimezone()) {
  const p = zonedParts(instant, timeZone);
  return `${zonedDate(instant, timeZone)} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}:${String(p.second).padStart(2, '0')}`;
}

function addDays(dateString, days) {
  const moved = new Date(`${dateString}T00:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}

// The UTC half-open range covering one calendar day in the hospital's timezone.
// Comparing timestamps against these bounds keeps a payment made at 01:00 local
// on the right day, which a DATE(column) = ? comparison against a UTC calendar
// date gets wrong for every instant between local midnight and the UTC offset.
function zonedDayRange(dateString, timeZone = appTimezone()) {
  const toUtcFields = iso => {
    const [year, month, day] = iso.split('-').map(Number);
    return { year, month, day };
  };
  const start = instantFromZoned(toUtcFields(dateString), timeZone);
  const end = instantFromZoned(toUtcFields(addDays(dateString, 1)), timeZone);
  const toSql = d => d.toISOString().replace('T', ' ').slice(0, 19);
  return { start: toSql(start), end: toSql(end) };
}

module.exports = {
  DEFAULT_TIMEZONE,
  appTimezone,
  zonedParts,
  zonedDate,
  zonedDateTime,
  zonedDayRange,
  addDays,
  instantFromZoned,
};
