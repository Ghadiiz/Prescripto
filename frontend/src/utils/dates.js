// Local calendar dates, as 'YYYY-MM-DD'.
//
// `toISOString().split('T')[0]` is the tempting one-liner and it is WRONG for
// this: it converts to UTC first. In Amman (UTC+3) that means between local
// midnight and 03:00 it returns YESTERDAY — so the booking page's date strip
// opened on a past date for three hours every night, and `bookAppointment`
// posted that string as `slotDate`.
//
// The backend already reaches for local parts rather than UTC in
// `assistant/tools/dates.js` and `systemPrompt.js`. This is the same helper on
// the other side of the wire, which matters because the two have to agree: a
// notification's `date` is written by the server as a local calendar day, and
// 7.1 matches it against the strip.

export const toLocalDateString = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
};

// Whether a string is a calendar date we are willing to put in a URL or match
// against the strip. Deliberately strict: notification payloads are DATA, and
// this is the boundary where a malformed one stops rather than being pasted
// into an address bar.
export const isCalendarDate = (value) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

// A booking-grid slot label, exactly as the backend's `convertTo12Hour`
// writes it: a zero-padded 12-hour clock, '10:30 AM' / '02:00 PM'.
//
// This VALIDATES the shape; it never produces one. 7.2 deliberately keeps the
// only formatter on the backend, so the string in a notification and the
// strings on the booking page come from the same line of code and cannot
// drift. Re-implementing the conversion here is what this comment exists to
// stop.
export const isSlotTime = (value) =>
  typeof value === 'string' && /^\d{2}:\d{2} (AM|PM)$/.test(value);
