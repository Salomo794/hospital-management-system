const { ApiError } = require('./http');

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function parseSchedule(value) {
  if (!value) return null;
  let schedule = value;
  if (typeof schedule === 'string') {
    try {
      schedule = JSON.parse(value);
    } catch (_) {
      throw new ApiError(400, 'Doctor schedule is not valid JSON');
    }
  }
  if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) return null;
  return schedule;
}

function normalizeSchedule(value) {
  if (value === undefined || value === null || value === '') return null;
  const schedule = parseSchedule(value);
  if (!schedule) throw new ApiError(400, 'schedule must be a valid object keyed by weekday');
  for (const [day, ranges] of Object.entries(schedule)) {
    if (!DAYS.includes(day) || !Array.isArray(ranges)) {
      throw new ApiError(400, 'schedule contains an invalid weekday or range list');
    }
    for (const range of ranges) {
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d-(?:[01]\d|2[0-3]):[0-5]\d$/.test(range)) {
        throw new ApiError(400, `Invalid schedule range for ${day}`);
      }
      const [start, end] = range.split('-');
      if (start >= end) throw new ApiError(400, `Schedule range must end after it starts for ${day}`);
    }
  }
  return JSON.stringify(schedule);
}

function toMinutes(time) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function toTime(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function buildSlots(scheduleValue, date, intervalMinutes = 30) {
  const schedule = parseSchedule(scheduleValue);
  if (!schedule) return [];

  const day = DAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  const ranges = schedule[day] || [];
  const slots = [];
  for (const range of ranges) {
    const [start, end] = range.split('-');
    for (let minute = toMinutes(start); minute + intervalMinutes <= toMinutes(end); minute += intervalMinutes) {
      slots.push(toTime(minute));
    }
  }
  return [...new Set(slots)].sort();
}

module.exports = { DAYS, parseSchedule, normalizeSchedule, buildSlots };
