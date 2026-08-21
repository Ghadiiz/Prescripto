// How a turn's `stoppedReason` maps to how it should be presented.
//
// Kept out of the component file deliberately: a module that exports both a
// component and plain helpers breaks Fast Refresh, and eslint says so
// (react-refresh/only-export-components). These are decisions about meaning,
// not markup, so they belong beside the other utils anyway.

// The emergency response — set apart so it cannot be skimmed past. One
// treatment covers both the urgent physical wording and the deliberately
// gentle self-harm wording, which is why the server never has to send the
// category: an alarm styling would be wrong for the second.
export const isImportant = (stoppedReason) => stoppedReason === 'emergency';

// Reasons where the content IS the whole message, so a notice REPLACES the
// bubble rather than joining it.
//
// `iteration_cap` is deliberately absent: its content is `lastText ||
// CAP_MESSAGE`, so usually the model's own partial answer. Dressing that up as
// a system message would misrepresent it — it gets a bubble plus the
// explanation below instead.
export const REPLACES_BUBBLE = ['emergency', 'rate_limited', 'at_capacity'];

// A short line shown ALONGSIDE content that is a real answer.
export const stopExplanation = (stoppedReason) =>
  stoppedReason === 'iteration_cap'
    ? 'The assistant stopped after several steps. Try asking about one thing at a time.'
    : null;

export const formatWait = (seconds) => {
  if (!seconds || seconds <= 0) return null;
  if (seconds < 90) return 'about a minute';

  const minutes = Math.round(seconds / 60);
  return `about ${minutes} minute${minutes === 1 ? '' : 's'}`;
};
