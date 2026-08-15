import { isDBReady } from '../config/mysql.js';

// `connectDB()` is deliberately not awaited in server.js, so the port binds
// immediately and platform health checks pass. This gate covers the window
// between listening and the connection resolving — which can be ~50s on a cold
// boot, since connectDB retries 10 times with a 5s delay while a sleeping
// managed database wakes.
//
// Without it, requests reach getDB(), which throws a plain Error. That is not
// an AppError, so the central handler reports it as a generic 500 and the
// caller cannot tell a booting server from a broken one.
export const databaseReady = (req, res, next) => {
  if (isDBReady()) {
    return next();
  }

  // Matches the 5s delay in connectDB's retry loop, so a client honouring the
  // header retries roughly in step with the reconnection attempts.
  res.set('Retry-After', '5');

  return res.status(503).json({
    success: false,
    message: 'Server is starting up. Please retry in a few seconds.',
  });
};
