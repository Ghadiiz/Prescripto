import { connectDB } from '../backend/src/config/mysql.js';

// Connected lazily, on the first tool call, and never at startup.
//
// connectDB retries 10 times at 5s intervals. Spending up to 50 seconds before
// the transport comes up would look to the host like a server that will not
// start, with the reason buried in stderr — the same failure mode 4.1's stdout
// work and 4.2's non-fatal auth both exist to avoid. Connecting late turns a
// database outage into an actionable tool error instead.

let connection = null;

export const ensureDatabase = async () => {
  // The PROMISE is cached, not the result: two tool calls arriving together
  // must not start two connection attempts.
  if (!connection) {
    connection = connectDB().catch((error) => {
      // Cleared so a later call can retry rather than being stuck with a
      // rejected promise for the life of the process.
      connection = null;
      throw error;
    });
  }

  return connection;
};

// Exported for the smoke check, which needs a clean slate between cases.
export const resetDatabase = () => {
  connection = null;
};
