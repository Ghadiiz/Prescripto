import React from 'react';

import { isImportant, formatWait } from '../utils/turnPresentation';

// How a turn ENDED, rendered honestly.
//
// The server sends a stoppedReason with every `done` event; before 3.5 the
// panel ignored it, so a fixed safety response telling someone to call 911
// looked exactly like a list of dermatologists.
//
// Two treatments, and the difference matters:
//
//   important — the emergency response. Set apart so it cannot be skimmed
//               past, but deliberately NOT an alarm: the same styling carries
//               the gentle self-harm wording as well as the urgent physical
//               one, and a red klaxon would be wrong for the former.
//
//   notice    — the app speaking rather than the assistant: an hourly limit, a
//               daily budget, a loop that gave up. Muted, so it reads as a
//               status rather than an opinion.

const TurnNotice = ({ stoppedReason, retryAfterSeconds, children }) => {
  const wait = formatWait(retryAfterSeconds);

  if (isImportant(stoppedReason)) {
    return (
      <div
        role="alert"
        className="rounded-lg border-l-4 border-amber-400 bg-amber-50 px-3 py-2.5 text-sm text-gray-800"
      >
        <p className="whitespace-pre-wrap">{children}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-600">
      <p className="whitespace-pre-wrap">{children}</p>
      {wait && <p className="mt-1 text-gray-500">You can ask again in {wait}.</p>}
    </div>
  );
};

export default TurnNotice;
