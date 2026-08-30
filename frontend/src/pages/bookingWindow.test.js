import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { BOOKABLE_DAYS } from './Appointment';

// The one test in the repo that deliberately reads ACROSS the two npm roots.
//
// Until 7.4, `BOOKABLE_DAYS` here was 7 and `MAX_WINDOW_DAYS` in the backend's
// join_waitlist tool was 30 — two independent numbers that disagreed. The
// consequence was not theoretical: a patient could be waitlisted for a date,
// notified when it freed, and then land on a booking page that would not show
// that date. 7.1 could only add an honest notice about it; the plan doc
// recorded that "they disagree at all is the bug".
//
// They are one number now. Production code stays decoupled — the two packages
// share no module and should not — so the guard lives here, where a test is
// allowed to know about both sides. Drift in either direction fails loudly
// instead of quietly reopening the gap.

// A path relative to the package root, NOT `import.meta.url`: Vite rewrites
// that to an http URL inside the module graph, and readFileSync wants a file.
// Vitest runs with the cwd at the package root, which is what this leans on.
const TOOL = '../backend/src/assistant/tools/joinWaitlist.js';

const backendWindowDays = () => {
  const source = readFileSync(TOOL, 'utf8');
  const match = source.match(/const MAX_WINDOW_DAYS = (\d+);/);

  // A rename is drift too. If this stops matching, the guard has silently
  // stopped guarding, so it fails rather than passing vacuously.
  expect(match, 'MAX_WINDOW_DAYS not found in joinWaitlist.js').not.toBeNull();

  return Number(match[1]);
};

describe('the booking window and the waitlist window', () => {
  it('are the same number', () => {
    expect(BOOKABLE_DAYS).toBe(backendWindowDays());
  });

  it('is 30 days, the value 7.4 settled on', () => {
    // Pinned so that changing it is a deliberate act with a test to update,
    // rather than a quiet edit on one side.
    expect(BOOKABLE_DAYS).toBe(30);
  });
});
