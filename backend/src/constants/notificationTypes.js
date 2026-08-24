// The `type` column on `notifications` is a VARCHAR, not an ENUM, so that a new
// kind needs no migration. These constants are what keeps the writer (5.4) and
// the renderer (5.2's bell) agreeing on the string.
export const NOTIFICATION_TYPE = {
  // A doctor a patient was waiting on has freed a slot in their window.
  WAITLIST_SLOT_OPEN: 'waitlist_slot_open',
};
