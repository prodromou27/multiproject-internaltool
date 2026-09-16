function errorHandler(err, req, res, next) {
  console.error('[unhandled error]', err);
  if (res.headersSent) return next(err);
  const status = Number(err.status || err.statusCode);
  const message = process.env.NODE_ENV === 'production'
    ? 'An internal error occurred'
    : (err.message || 'An internal error occurred');
  res.status(Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500).json({ error: message });
}

module.exports = { errorHandler };
