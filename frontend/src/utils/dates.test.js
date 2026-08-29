import { describe, it, expect, afterEach, vi } from 'vitest';

import { isCalendarDate, toLocalDateString } from './dates';

// The bug this helper exists to fix, pinned in the timezone where it bites.
//
// Amman is UTC+3, so between local midnight and 03:00 a local date and its UTC
// date are different days. `toISOString().split('T')[0]` returns the UTC one —
// which is why the booking page's first chip was YESTERDAY for three hours
// every night, and why a notification's date never matched the strip.

// `vi.stubEnv` rather than touching `process.env` directly: these files are
// linted with browser globals, where `process` does not exist, and the stub is
// restored for us.
afterEach(() => {
  vi.unstubAllEnvs();
});

const inTimezone = (tz, fn) => {
  vi.stubEnv('TZ', tz);
  try {
    return fn();
  } finally {
    vi.unstubAllEnvs();
  }
};

describe('toLocalDateString', () => {
  it('returns the LOCAL day when UTC has already rolled over', () => {
    inTimezone('Asia/Amman', () => {
      // 01:30 local on Aug 30 is 22:30 UTC on Aug 29.
      const earlyMorning = new Date('2026-08-29T22:30:00Z');

      expect(earlyMorning.getDate()).toBe(30); // local: the 30th
      expect(earlyMorning.toISOString().split('T')[0]).toBe('2026-08-29');
      expect(toLocalDateString(earlyMorning)).toBe('2026-08-30');
    });
  });

  it('agrees with toISOString when local and UTC are the same day', () => {
    inTimezone('Asia/Amman', () => {
      const midMorning = new Date('2026-08-30T06:00:00Z');

      expect(toLocalDateString(midMorning)).toBe('2026-08-30');
      expect(midMorning.toISOString().split('T')[0]).toBe('2026-08-30');
    });
  });

  it('pads single-digit months and days', () => {
    inTimezone('UTC', () => {
      expect(toLocalDateString(new Date('2026-01-05T12:00:00Z'))).toBe(
        '2026-01-05',
      );
    });
  });

  it('handles a timezone BEHIND UTC, where the shift goes the other way', () => {
    inTimezone('America/New_York', () => {
      // 20:00 local on Aug 30 is 00:00 UTC on Aug 31.
      const evening = new Date('2026-08-31T00:00:00Z');

      expect(evening.toISOString().split('T')[0]).toBe('2026-08-31');
      expect(toLocalDateString(evening)).toBe('2026-08-30');
    });
  });
});

describe('isCalendarDate', () => {
  it('accepts a plain YYYY-MM-DD', () => {
    expect(isCalendarDate('2026-08-30')).toBe(true);
  });

  it('rejects anything that is not one', () => {
    for (const value of [
      '2026-8-3',
      '30-08-2026',
      '2026-08-30T10:00:00Z',
      'javascript:alert(1)',
      '../../etc/passwd',
      '',
      null,
      undefined,
      20260830,
      { toString: () => '2026-08-30' },
    ]) {
      expect(isCalendarDate(value)).toBe(false);
    }
  });
});
