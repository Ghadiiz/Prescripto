import { AppError } from '../utils/AppError.js';
import { noteConnectionFailure } from '../config/mysql.js';

// `_next` rather than deleting it: Express identifies middleware by ARITY, so
// the parameter has to stay even though nothing calls it. Renaming satisfies
// the linter without changing fn.length.
export const notFound = (req, res, _next) => {
  res.status(404).json({ success: false, message: 'Route not found' });
};

// Four parameters is what makes Express treat this as an ERROR handler rather
// than ordinary middleware. Dropping the unused `next` would silently stop it
// being one, so it is renamed, not removed.
export const errorHandler = (err, req, res, _next) => {
  console.error('Error:', err);

  // The one place that already sees every thrown error, which makes it the
  // natural place to learn the database has gone away (6.6). A connection-level
  // failure marks it not-ready, so the NEXT request gets a 503 from
  // databaseReady rather than another 500 from a gate still claiming health.
  //
  // Returns false for ordinary SQL errors — a duplicate key means the database
  // answered fine, and must not flip readiness.
  if (noteConnectionFailure(err)) {
    return res.status(503).json({
      success: false,
      message: 'The database is unavailable. Please retry in a few seconds.',
    });
  }

  if (err instanceof AppError || err.isOperational) {
    return res.status(err.statusCode || 400).json({
      success: false,
      message: err.message,
      ...(err.extra && typeof err.extra === 'object' ? err.extra : {}),
    });
  }

  res.status(500).json({ success: false, message: 'Something went wrong. Please try again later.' });
};
