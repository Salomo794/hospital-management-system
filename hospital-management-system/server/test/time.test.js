const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.NODE_ENV = 'test';

const time = require('../config/time');

// The hospital runs on one calendar even though the server usually does not.
// These tests pin the conversions that decide which day a timestamp belongs to,
// because getting that wrong silently misfiles lab results and cash takings.

test('a UTC instant resolves to the hospital calendar day', () => {
  // Kigali is UTC+2 all year, so late-evening UTC is already the next local day.
  assert.equal(time.zonedDate(new Date('2026-01-15T22:30:00Z'), 'Africa/Kigali'), '2026-01-16');
  assert.equal(
    time.zonedDateTime(new Date('2026-01-15T22:30:00Z'), 'Africa/Kigali'),
    '2026-01-16 00:30:00'
  );
  assert.equal(time.zonedDate(new Date('2026-01-15T23:00:00Z'), 'Africa/Kigali'), '2026-01-16');
  assert.equal(time.zonedDate(new Date('2026-01-15T21:59:00Z'), 'Africa/Kigali'), '2026-01-15');
});

test('a local day is converted to the right UTC window', () => {
  const range = time.zonedDayRange('2026-01-16', 'Africa/Kigali');
  // 00:00 local on the 16th is 22:00 UTC on the 15th.
  assert.equal(range.start, '2026-01-15 22:00:00');
  assert.equal(range.end, '2026-01-16 22:00:00');
});

test('daylight saving days are not assumed to be 24 hours', () => {
  const lengthInHours = (iso, zone) => {
    const { start, end } = time.zonedDayRange(iso, zone);
    return (Date.parse(`${end}Z`) - Date.parse(`${start}Z`)) / 3600000;
  };
  // BST begins on 2026-03-29, so that local day is 23 hours long.
  assert.equal(lengthInHours('2026-03-29', 'Europe/London'), 23);
  assert.equal(lengthInHours('2026-03-28', 'Europe/London'), 24);
  assert.equal(lengthInHours('2026-10-25', 'Europe/London'), 25);
  assert.equal(lengthInHours('2026-01-16', 'Africa/Kigali'), 24);
});

test('a local wall clock maps back to the instant that produced it', () => {
  const instant = time.instantFromZoned(
    { year: 2026, month: 7, day: 4, hour: 9, minute: 30 },
    'Africa/Kigali'
  );
  assert.equal(instant.toISOString(), '2026-07-04T07:30:00.000Z');
  // And the round trip returns the same wall clock it started from.
  assert.equal(time.zonedDateTime(instant, 'Africa/Kigali'), '2026-07-04 09:30:00');
});

test('a spring-forward gap still produces an ordered range', () => {
  // Local midnight does not exist on this date in Sao Paulo, so the conversion
  // has to land somewhere sane rather than produce a negative window.
  const { start, end } = time.zonedDayRange('2018-11-04', 'America/Sao_Paulo');
  assert.ok(Date.parse(`${start}Z`) < Date.parse(`${end}Z`));
});

test('an unrecognised APP_TIMEZONE falls back instead of throwing', () => {
  const previous = process.env.APP_TIMEZONE;
  try {
    process.env.APP_TIMEZONE = 'Not/ARealZone';
    assert.equal(time.appTimezone(), time.DEFAULT_TIMEZONE);
    process.env.APP_TIMEZONE = 'Europe/Paris';
    assert.equal(time.appTimezone(), 'Europe/Paris');
  } finally {
    if (previous === undefined) delete process.env.APP_TIMEZONE;
    else process.env.APP_TIMEZONE = previous;
  }
});

test('addDays crosses month and year boundaries', () => {
  assert.equal(time.addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(time.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(time.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(time.addDays('2028-03-01', -1), '2028-02-29');
});
