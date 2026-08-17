import { getDB } from '../../config/mysql.js';

// SQL for the assistant's doctor tools.
//
// Kept apart from the doctors feature module on purpose: these queries carry
// guarantees the HTTP-facing ones do not — an explicit column list that never
// exposes `password`, `email` or either token column, and no `SELECT *` under
// any circumstances. Anything added here inherits that contract.

// The only columns a tool result may contain. `email` is excluded along with
// the credentials: the 1.8 guardrail tests assert no tool result carries it.
// `about` is excluded too — a list view has no use for a free-text bio, and
// leaving it out keeps attacker-controlled text out of this result entirely.
const DOCTOR_LIST_COLUMNS = `
      d.id,
      d.name,
      s.name AS speciality,
      d.degree,
      d.experience_years,
      d.languages,
      d.gender,
      d.fees,
      d.address_line1,
      d.address_line2,
      d.area,
      d.image`;

// A broad search must not be able to dump the table into the prompt.
export const SEARCH_RESULT_LIMIT = 20;

export const searchDoctors = async (filters = {}) => {
  const db = getDB();

  const conditions = ['d.available = TRUE'];
  const params = [];

  if (filters.speciality) {
    conditions.push('s.name = ?');
    params.push(filters.speciality);
  }

  if (filters.min_experience_years !== undefined) {
    conditions.push('d.experience_years >= ?');
    params.push(filters.min_experience_years);
  }

  if (filters.max_fees !== undefined) {
    conditions.push('d.fees <= ?');
    params.push(filters.max_fees);
  }

  if (filters.language) {
    // `languages` is a comma-separated list with no spaces (migration 002).
    conditions.push('FIND_IN_SET(?, d.languages)');
    params.push(filters.language);
  }

  if (filters.gender) {
    conditions.push('d.gender = ?');
    params.push(filters.gender);
  }

  if (filters.area) {
    conditions.push('d.area = ?');
    params.push(filters.area);
  }

  // Deterministic ordering so results are stable and assertable.
  const [doctors] = await db.query(
    `SELECT
${DOCTOR_LIST_COLUMNS}
     FROM doctors d
     JOIN specialities s ON d.speciality_id = s.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY d.experience_years DESC, d.fees ASC, d.name ASC
     LIMIT ${SEARCH_RESULT_LIMIT}`,
    params,
  );

  return doctors;
};

// Deliberately not filtered on `available`: asking about a specific doctor
// should say they exist but aren't taking appointments, rather than pretending
// they don't exist. `available` is returned so the caller can say which.
//
// `about` is included here and nowhere else — it is free text an admin
// controls, so every caller must truncate and label it (rule 5).
export const getDoctorById = async (doctorId) => {
  const db = getDB();

  const [doctors] = await db.query(
    `SELECT
${DOCTOR_LIST_COLUMNS},
      d.about,
      d.available
     FROM doctors d
     JOIN specialities s ON d.speciality_id = s.id
     WHERE d.id = ?
     LIMIT 1`,
    [doctorId],
  );

  return doctors[0];
};
