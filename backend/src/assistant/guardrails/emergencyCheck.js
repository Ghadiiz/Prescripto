import {
  PHYSICAL_EMERGENCY_PHRASES,
  SELF_HARM_PHRASES,
  PHYSICAL_EMERGENCY_RESPONSE,
  SELF_HARM_RESPONSE,
} from './emergencyPhrases.js';

// Runs on every message BEFORE any provider call or tool call. If it trips,
// the turn ends with a fixed response and the model is never consulted — which
// is the whole point: the model cannot be the safety net for a situation where
// its failure mode is a plausible-sounding wrong answer.
//
// Deterministic and synchronous. No I/O, no database, no network. The only
// decision it makes is which of two fixed strings to return.

// Contractions and possessives are stripped rather than kept, so `can't
// breathe`, `cant breathe` and `cannot breathe` all normalise to a form the
// phrase list can match.
const normalise = (text) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Whole-word containment, checked against a token list rather than a regex
// built from list data — the approach 1.5 proved. `stroke` must match "I think
// he had a stroke" but never "backstrokes".
const containsPhrase = (tokens, phrase) => {
  const phraseTokens = phrase.split(' ');

  return tokens.some((_, index) =>
    phraseTokens.every((word, offset) => tokens[index + offset] === word),
  );
};

const matchPhrases = (tokens, phrases) =>
  phrases.filter((phrase) => containsPhrase(tokens, normalise(phrase)));

export const emergencyCheck = (text) => {
  const tokens = normalise(text).split(' ').filter(Boolean);

  const selfHarmMatches = matchPhrases(tokens, SELF_HARM_PHRASES);
  const physicalMatches = matchPhrases(tokens, PHYSICAL_EMERGENCY_PHRASES);

  // Self-harm wins when both trip. It is the more sensitive case, and its
  // response already covers immediate physical danger by naming 911 — whereas
  // the physical response says nothing useful to someone in crisis.
  if (selfHarmMatches.length > 0) {
    return {
      tripped: true,
      category: 'self_harm',
      matched: [...selfHarmMatches, ...physicalMatches],
      response: SELF_HARM_RESPONSE,
    };
  }

  if (physicalMatches.length > 0) {
    return {
      tripped: true,
      category: 'physical',
      matched: physicalMatches,
      response: PHYSICAL_EMERGENCY_RESPONSE,
    };
  }

  return { tripped: false, category: null, matched: [], response: null };
};
