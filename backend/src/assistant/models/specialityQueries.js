import { getDB } from '../../config/mysql.js';

// SQL for the assistant's speciality tools. Same contract as doctorQueries.js:
// explicit column lists, parameterised values, never `SELECT *`.
//
// 1.5's `speciality_keywords` lookup will live here too.

// `image` is omitted — the assistant has no use for it, and every column left
// out is one that cannot leak.
export const listSpecialities = async () => {
  const db = getDB();

  const [specialities] = await db.query(
    'SELECT id, name FROM specialities ORDER BY name',
  );

  return specialities;
};

// The whole keyword table — 55 rows, so one fetch is cheaper than a query per
// candidate and keeps the matching logic in JS where it can be tested.
//
// Longest keyword first, so a match on `stomach ache` is found before the
// shorter `stomach` and the more specific keyword wins.
export const listSpecialityKeywords = async () => {
  const db = getDB();

  const [keywords] = await db.query(
    `SELECT k.keyword, k.speciality_id, s.name AS speciality
     FROM speciality_keywords k
     JOIN specialities s ON s.id = k.speciality_id
     ORDER BY CHAR_LENGTH(k.keyword) DESC, k.keyword`,
  );

  return keywords;
};
