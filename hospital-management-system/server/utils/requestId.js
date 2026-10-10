const { randomUUID } = require('crypto');
const { ApiError } = require('./http');

function getRequestId(req, field = 'request_id', { required = false } = {}) {
  const supplied = req.body?.[field];
  if (supplied !== undefined && typeof supplied !== 'string') {
    throw new ApiError(400, `${field} must be a string`);
  }
  const bodyId = typeof supplied === 'string' ? supplied.trim() : '';
  if (supplied !== undefined && !bodyId) {
    throw new ApiError(400, `${field} cannot be blank`);
  }
  const headerId = (req.get('X-Request-ID') || '').trim();
  const requestId = bodyId || headerId || (required ? '' : randomUUID());
  if (!requestId) {
    throw new ApiError(400, `${field} is required in the request body or X-Request-ID header`);
  }
  if (requestId.length > 100) throw new ApiError(400, `${field} is too long`);
  return requestId;
}

module.exports = { getRequestId };
