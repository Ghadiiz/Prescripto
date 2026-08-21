import React from 'react';

// Availability, rendered as what it actually is: a snapshot.
//
// Rule 7 — availability is never a promise. The server refuses to send slot
// counts without the moment they were true, and this component refuses to show
// them without saying so. The caveat is not decoration: between this render
// and the patient reaching the booking page, someone else can take the slot.

const REASONS = {
  date_in_past: 'in the past',
  not_accepting: 'not accepting appointments',
};

const formatDate = (iso) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

const formatTime = (iso) =>
  new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });

const AvailabilityCard = ({ availability }) => {
  const { doctorName, acceptingAppointments, checkedAt, dates } = availability;

  return (
    <article className="rounded-lg border border-gray-200 bg-white p-3">
      <p className="font-medium text-gray-800">{doctorName}</p>

      {!acceptingAppointments ? (
        <p className="mt-1 text-xs text-gray-600">
          ✗ Not currently accepting appointments
        </p>
      ) : (
        <ul className="mt-1 space-y-1">
          {dates.map((day) => (
            <li
              key={day.date}
              className="flex items-center justify-between text-xs"
            >
              <span className="text-gray-600">{formatDate(day.date)}</span>
              <span
                className={
                  day.available ? 'text-green-600' : 'text-gray-400'
                }
              >
                {day.available
                  ? `✓ ${day.freeSlotCount} ${
                      day.freeSlotCount === 1 ? 'slot' : 'slots'
                    } free`
                  : `✗ none free${
                      day.reason ? ` — ${REASONS[day.reason] ?? day.reason}` : ''
                    }`}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Never rendered conditionally on anything: if a count is on screen,
          so is the time it was true and the fact that nothing is held. */}
      <p className="mt-2 border-t border-gray-100 pt-2 text-[11px] text-gray-400">
        Checked at {formatTime(checkedAt)} — slots are not held until you book.
      </p>
    </article>
  );
};

export default AvailabilityCard;
