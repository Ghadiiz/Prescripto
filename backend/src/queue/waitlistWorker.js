import { pathToFileURL } from 'node:url';

import { Worker } from 'bullmq';

import {
  createQueueConnection,
  createThrottledErrorLogger,
  WORKER_DRAIN_DELAY_SECONDS,
} from './connection.js';
import { WAITLIST_QUEUE_NAME } from './waitlistQueue.js';
import { notifyWaitlistForFreedSlot } from '../notifications/services/waitlistNotifier.js';
import { connectDB } from '../config/mysql.js';

// The worker that actually sends what 5.4 used to send inline.
//
// It calls notifyWaitlistForFreedSlot — the UNWRAPPED function, not
// notifyWaitlistSafely. That is the whole point: the safe wrapper swallows
// errors so a cancellation cannot fail, and swallowing here would defeat the
// retry by reporting success for work that did not happen. In this process a
// throw is the correct outcome, because BullMQ is listening for it.
//
// Idempotency is INHERITED rather than re-implemented: a retry re-runs the
// same 5.4 matching, including findUsersWithUnreadSlotNotice, which skips any
// patient already holding an unread notice for that doctor and date.
//
// Honest limit, unchanged from 5.4: that dedupe is on UNREAD notices. A retry
// after the patient has read the first one can produce a second. Two separate
// cancellations behave the same way today, and the result is a duplicate
// notification, never a duplicate booking.

let workerConnection = null;

export const createWaitlistWorker = () => {
  const connection = createQueueConnection();

  if (!connection) return null;

  workerConnection = connection;

  const worker = new Worker(
    WAITLIST_QUEUE_NAME,
    async (job) => {
      const { doctorId, date, excludeUserId } = job.data;

      return notifyWaitlistForFreedSlot({ doctorId, date, excludeUserId });
    },
    {
      connection,
      // One at a time. These are small database writes and the ordering costs
      // nothing at this scale.
      concurrency: 1,
      drainDelay: WORKER_DRAIN_DELAY_SECONDS,
    },
  );

  // A job that has exhausted its attempts is not retried again. Saying so on
  // stderr is what makes it findable, since nothing else reports it.
  worker.on('failed', (job, error) => {
    const attempts = job?.attemptsMade ?? 0;
    const limit = job?.opts?.attempts ?? 1;

    console.error(
      `Waitlist notification job ${job?.id} failed on attempt ` +
        `${attempts}/${limit}: ${error.message}` +
        (attempts >= limit
          ? ' — no further retries; the notification was NOT delivered.'
          : ' — will retry.'),
    );
  });

  // Throttled for the same reason as the connection's own stream: BullMQ
  // re-emits a worker error on every reconnect attempt, and an unreachable
  // Redis retries forever by design.
  const log = createThrottledErrorLogger('Waitlist worker');
  worker.on('error', log.onError);
  worker.on('ready', log.onReady);

  return worker;
};

// Closes the worker AND the connection under it — see the note in
// waitlistQueue.js. `worker.close()` alone leaves the socket open and the
// process alive.
export const closeWaitlistWorker = async (worker) => {
  if (worker) await worker.close();

  const open = workerConnection;
  workerConnection = null;

  if (open) {
    try {
      await open.quit();
    } catch {
      open.disconnect();
    }
  }
};

// Standalone entry point.
//
// The worker runs INSIDE the web process today (see server.js) because
// Render's free tier has no background worker service. This entry point exists
// so that moving it to a real one later is a start command, not a rewrite:
// `npm run worker`.
const main = async () => {
  await connectDB();

  const worker = createWaitlistWorker();

  if (!worker) {
    console.error('REDIS_URL is not set — there is no queue to work on.');
    process.exit(1);
  }

  console.error(`Waitlist worker listening on "${WAITLIST_QUEUE_NAME}".`);

  const shutdown = async () => {
    await closeWaitlistWorker(worker);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

// NOT `import.meta.main`: undefined on this Node (22.17.0), as 4.3 measured.
const isEntryPoint =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  main().catch((error) => {
    console.error('Failed to start the waitlist worker:', error);
    process.exit(1);
  });
}
