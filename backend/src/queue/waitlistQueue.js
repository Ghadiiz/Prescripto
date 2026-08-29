import { Queue } from 'bullmq';

import { createQueueConnection } from './connection.js';

// The queue that makes 5.4's notification durable.
//
// Before this, notifyWaitlistSafely caught every error and lost the
// notification — a cost 5.4 accepted in writing because the alternative was
// failing a cancellation that had already committed. A queued job is retried
// instead, so the notification survives a database blip.

export const WAITLIST_QUEUE_NAME = 'waitlist-notifications';
export const NOTIFY_JOB = 'notify-freed-slot';

// Bounded on every axis, because an unbounded queue in Redis is a slow leak.
//
// `attempts: 3` with exponential backoff means a genuinely broken job stops
// after three tries and lands in the failed set, where it can be inspected —
// rather than retrying forever and costing a command every time.
export const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { age: 60 * 60, count: 100 },
  // Kept longer than completed jobs: a failure is the one you want to still be
  // able to look at tomorrow morning.
  removeOnFail: { age: 24 * 60 * 60, count: 100 },
};

let queue = null;
let connection = null;

// Created on first ENQUEUE, never at import.
//
// Constructing a Queue opens a Redis connection, and a module that opens one
// just by being imported would hold the test runner's process open in every
// suite that touches the notifier — and would connect on machines that have no
// Redis at all.
export const getWaitlistQueue = () => {
  if (queue) return queue;

  connection = createQueueConnection();
  if (!connection) return null;

  queue = new Queue(WAITLIST_QUEUE_NAME, { connection });

  return queue;
};

// Returns the job when it was queued, or null when Redis is not configured.
//
// Null is not an error: it is the DISABLED state 6.1 established, and it tells
// the caller to do the work inline instead. A genuine failure THROWS, so the
// caller can tell "no queue here" from "the queue is broken" — they lead to
// the same fallback but only one of them deserves a log line.
export const enqueueWaitlistNotification = async ({
  doctorId,
  date,
  time = null,
  excludeUserId = null,
}) => {
  const target = getWaitlistQueue();

  if (!target) return null;

  // The payload is three identifiers, a date and a clock time. NO patient
  // names, no recipient list, no email. A freed slot's time says nothing about
  // who held it — the appointment is already cancelled — so this does not
  // change what rests in Redis in any way that matters.
  //
  // The worker calls the same notifyWaitlistForFreedSlot the inline path does,
  // which resolves the recipients and sanitises the doctor's name at write
  // time. So the matching and the rule-5 sanitisation stay in ONE place, and
  // nothing about a patient ever rests in Redis — which matters more than
  // usual here, because Redis is a third party in production.
  return target.add(
    NOTIFY_JOB,
    { doctorId, date, time, excludeUserId },
    // Deliberately no deterministic jobId. Keying on doctor+date would look
    // like helpful deduplication and would in fact DROP a second, legitimate
    // cancellation's notification whenever the first job was still within its
    // retention window. The database dedupe in 5.4 understands the semantics;
    // the queue does not.
    JOB_OPTIONS,
  );
};

// Closes the queue AND the connection under it.
//
// BullMQ only closes connections it created itself; one passed in stays the
// caller's responsibility. Missing that leaves an open socket that keeps the
// process alive forever — which is exactly how this suite first behaved:
// every test passed and then the runner hung until it was killed.
export const closeWaitlistQueue = async () => {
  const openQueue = queue;
  const openConnection = connection;

  queue = null;
  connection = null;

  if (openQueue) await openQueue.close();
  if (openConnection) {
    try {
      await openConnection.quit();
    } catch {
      openConnection.disconnect();
    }
  }
};
