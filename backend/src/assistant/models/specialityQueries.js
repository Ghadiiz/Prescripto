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
