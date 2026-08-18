import { z } from 'zod';
import {
  listSpecialities,
  listSpecialityKeywords,
} from '../models/specialityQueries.js';

// The term is echoed back in the result, so it is bounded: an unbounded string
// is free prompt space.
const TERM_MAX_CHARS = 200;

const NOTE_MATCHED =
  'Administrative routing only, based on a fixed keyword list — not a ' +
  'diagnosis or medical opinion. Confirm with the patient before searching.';

const NOTE_NO_MATCH =
  'No keyword matched, so every speciality is listed. Do NOT pick one: ask ' +
  'the patient what they need help with, or offer the list. This is ' +
  'administrative routing, never a diagnosis.';

// Lowercased, punctuation-stripped, whitespace-collapsed. Apostrophes survive
// so `women's health` still matches.
const normalise = (text) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Whole-word containment, checked against a token list rather than a regex
// built from table data: a keyword is untrusted input to a regex, and
// `women's health` already contains a character worth not thinking about.
const containsPhrase = (tokens, keyword) => {
  const keywordTokens = keyword.split(' ');

  return tokens.some((_, index) =>
    keywordTokens.every((word, offset) => tokens[index + offset] === word),
  );
};

export default {
  name: 'suggest_speciality',
  description:
    'Map a patient\'s own words about what they need (e.g. "rash", "back ' +
    'pain", "vaccination") to the clinic specialities that handle it, using a ' +
    'fixed keyword list. This is administrative routing, not a diagnosis. If ' +
    'nothing matches, every speciality is returned and you must ask the ' +
    'patient rather than choosing one yourself.',
  schema: z
    .object({
      term: z.string().min(1).max(TERM_MAX_CHARS),
    })
    .strict(),
  mutates: false,

  // ctx is unused: the keyword list is the same for everyone.
  handler: async (ctx, args) => {
    const term = normalise(args.term);
    const tokens = term.split(' ').filter(Boolean);

    const keywords = await listSpecialityKeywords();

    // Every match is a keyword that literally exists in the table. Nothing is
    // inferred, so the tool cannot invent a speciality.
    const matches = keywords.filter(
      (row) =>
        row.keyword.toLowerCase() === term ||
        containsPhrase(tokens, row.keyword.toLowerCase()),
    );

    if (matches.length === 0) {
      return {
        term: args.term.slice(0, TERM_MAX_CHARS),
        matched: false,
        matched_keywords: [],
        specialities: await listSpecialities(),
        note: NOTE_NO_MATCH,
      };
    }

    const specialities = [];
    for (const match of matches) {
      if (!specialities.some((item) => item.id === match.speciality_id)) {
        specialities.push({ id: match.speciality_id, name: match.speciality });
      }
    }

    return {
      term: args.term.slice(0, TERM_MAX_CHARS),
      matched: true,
      matched_keywords: [...new Set(matches.map((match) => match.keyword))],
      specialities,
      note: NOTE_MATCHED,
    };
  },
};
