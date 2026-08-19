import {
  OFF_TOPIC_PHRASES,
  MEDICAL_ADVICE_PHRASES,
  OUT_OF_SCOPE_RESPONSE,
} from './scopePhrases.js';

// Runs after emergencyCheck and before any provider call. Deterministic and
// synchronous — no I/O, no database, no network.
//
// Precision-favouring: this gate refuses to answer, so a false positive costs
// the user a real booking question. Anything arguable is left to the model,
// where 2.3's system prompt already declines out-of-scope requests.

const normalise = (text) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Whole-word containment against a token list, same as emergencyCheck.
const containsPhrase = (tokens, phrase) => {
  const phraseTokens = phrase.split(' ');

  return tokens.some((_, index) =>
    phraseTokens.every((word, offset) => tokens[index + offset] === word),
  );
};

const matchPhrases = (tokens, phrases) =>
  phrases.filter((phrase) => containsPhrase(tokens, normalise(phrase)));

export const scopeCheck = (text) => {
  const tokens = normalise(text).split(' ').filter(Boolean);

  // Off-topic first: it is the axis this gate exists for. Medical advice is a
  // backup behind a prompt that already handles it.
  const offTopicMatches = matchPhrases(tokens, OFF_TOPIC_PHRASES);

  if (offTopicMatches.length > 0) {
    return {
      inScope: false,
      category: 'off_topic',
      matched: offTopicMatches,
      response: OUT_OF_SCOPE_RESPONSE,
    };
  }

  const medicalMatches = matchPhrases(tokens, MEDICAL_ADVICE_PHRASES);

  if (medicalMatches.length > 0) {
    return {
      inScope: false,
      category: 'medical_advice',
      matched: medicalMatches,
      response: OUT_OF_SCOPE_RESPONSE,
    };
  }

  return { inScope: true, category: null, matched: [], response: null };
};
