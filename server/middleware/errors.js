// Client mistakes that surface as PostgreSQL errors (a malformed id, a reference to a
// row that does not exist, a duplicate) are 4xx responses, not server faults.
const DB_CLIENT_ERRORS = {
  '22P02': [400, 'Invalid value in request'],          // invalid_text_representation (e.g. id "abc")
  '22003': [400, 'Numeric value out of range'],        // numeric_value_out_of_range
  '22001': [400, 'Value is too long'],                 // string_data_right_truncation
  '23502': [400, 'A required value is missing'],       // not_null_violation
  '23503': [409, 'Referenced record does not exist or is still in use'], // foreign_key_violation
  '23505': [409, 'A record with these details already exists'],           // unique_violation
  '23514': [400, 'Value is not allowed'],              // check_violation
};

function errorHandler(err, req, res, next) {
  if (res.headersSent) { console.error('[unhandled error]', err); return next(err); }
  const dbClientError = !err.status && !err.statusCode && DB_CLIENT_ERRORS[err.code];
  if (dbClientError) {
    console.warn(`[request rejected by database] ${req.method} ${req.originalUrl.split('?')[0]} ${err.code}`);
    return res.status(dbClientError[0]).json({ error: dbClientError[1] });
  }
  console.error('[unhandled error]', err);
  const status = Number(err.status || err.statusCode);
  const message = process.env.NODE_ENV === 'production'
    ? 'An internal error occurred'
    : (err.message || 'An internal error occurred');
  res.status(Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500).json({ error: message });
}

module.exports = { errorHandler };
