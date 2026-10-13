const { ApiError } = require('../utils/http');

function notFound(req, res) {
  res.status(404).json({ message: 'API route not found' });
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  if (error instanceof SyntaxError && error.status === 400 && Object.prototype.hasOwnProperty.call(error, 'body')) {
    return res.status(400).json({ message: 'Request body contains invalid JSON' });
  }

  if (error.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Request body is too large' });
  }

  if (error instanceof ApiError) {
    const payload = { message: error.message };
    if (error.details !== undefined) payload.errors = error.details;
    return res.status(error.status).json(payload);
  }

  if (String(error.code || '').startsWith('SQLITE_CONSTRAINT')) {
    const message = String(error.message || '');
    let friendly = 'The request conflicts with existing data';
    if (/UNIQUE/i.test(message)) friendly = 'A record with these values already exists';
    else if (/FOREIGN KEY/i.test(message)) friendly = 'A related record was not found';
    else if (/CHECK/i.test(message)) friendly = 'One or more values are invalid';
    return res.status(409).json({ message: friendly });
  }

  console.error(`[${req.method} ${req.path}]`, error);
  return res.status(500).json({ message: 'Internal server error' });
}

module.exports = { notFound, errorHandler };
