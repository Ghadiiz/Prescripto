// Local-date helpers shared by the tools that reason about calendar days.
//
// Extracted from checkAvailability.js rather than copied into joinWaitlist.js.
// The local-vs-UTC decision below is a real correctness detail, not a style
// choice, and two copies of it would eventually disagree.
//
// Slots are generated against the server's clock in appointmentService, so
// date comparisons here use local time too — using UTC would disagree with the
// service by up to a day near midnight.

export const toDateString = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const atMidnight = (dateString) => {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, month - 1, day);
};

export const addDays = (dateString, offset) => {
  const date = atMidnight(dateString);
  date.setDate(date.getDate() + offset);
  return date;
};

export const isBeforeToday = (dateString) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return atMidnight(dateString) < today;
};

// Whole days from one date to another; 0 when they are the same day.
export const daysBetween = (fromDateString, toDateString_) => {
  const from = atMidnight(fromDateString);
  const to = atMidnight(toDateString_);
  return Math.round((to - from) / 86400000);
};
