import React, { useEffect, useState } from 'react';

// What fills the wait.
//
// This is not decoration. A measured live turn took 42.5 seconds to reach its
// first token — three tool rounds, with nothing on screen but one static line
// reading "Looking up search doctors…". The thresholds below are set against
// that measurement rather than guessed.

// Tool names are database identifiers. `search_doctors` with the underscores
// swapped for spaces was a placeholder, not a label.
const TOOL_LABELS = {
  search_doctors: 'Searching for doctors',
  get_doctor: 'Looking up the doctor',
  check_availability: 'Checking availability',
  list_specialities: 'Checking our specialities',
  suggest_speciality: 'Working out which speciality fits',
  my_appointments: 'Looking up your appointments',
};

const SHOW_ELAPSED_AFTER_MS = 8000;
const REASSURE_AFTER_MS = 20000;

const ThinkingIndicator = ({ status, startedAt }) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const elapsed = startedAt ? now - startedAt : 0;

  const label = status
    ? (TOOL_LABELS[status] ?? 'Looking that up')
    : 'Thinking';

  return (
    <div className="flex items-center gap-2 text-xs text-gray-500">
      <span className="flex gap-1" aria-hidden="true">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>

      <span>
        {label}
        {elapsed >= SHOW_ELAPSED_AFTER_MS && ` · ${Math.round(elapsed / 1000)}s`}
      </span>

      {elapsed >= REASSURE_AFTER_MS && (
        <span className="text-gray-400">
          — still working, this can take a minute
        </span>
      )}
    </div>
  );
};

export default ThinkingIndicator;
