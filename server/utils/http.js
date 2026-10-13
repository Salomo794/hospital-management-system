class ApiError extends Error {
  constructor(status, message, details = undefined) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function parseInteger(value, name, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null || value === '') {
    throw new ApiError(400, `${name} is required`);
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ApiError(400, `${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function getPagination(query, defaultLimit = 20, maxLimit = 100) {
  const page = parseInteger(query.page ?? 1, 'page', { min: 1, max: 1_000_000 });
  const limit = parseInteger(query.limit ?? defaultLimit, 'limit', { min: 1, max: maxLimit });
  return { page, limit, offset: (page - 1) * limit };
}

function parseFiniteNumber(value, name, { min = -Infinity, max = Infinity } = {}) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new ApiError(400, `${name} must be a finite number between ${min} and ${max}`);
  }
  return parsed;
}

function isDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isTodayOrFuture(value) {
  if (!isDateOnly(value)) return false;
  const today = new Date().toISOString().slice(0, 10);
  return value >= today;
}

async function withTransaction(database, callback) {
  if (typeof database.runTransaction === 'function') {
    return database.runTransaction(callback);
  }

  const connection = await database.getConnection();
  let transactionOpen = false;
  try {
    await connection.beginTransaction();
    transactionOpen = true;
    const result = await callback(connection);
    await connection.commit();
    transactionOpen = false;
    return result;
  } catch (error) {
    if (transactionOpen) {
      try {
        await connection.rollback();
      } catch (_) {
        // Preserve the original database error.
      }
    }
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  ApiError,
  asyncHandler,
  getPagination,
  parseFiniteNumber,
  parseInteger,
  isDateOnly,
  isTodayOrFuture,
  withTransaction,
};
