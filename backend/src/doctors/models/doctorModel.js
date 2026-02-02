import { getDB } from '../../config/mysql.js';

export const getAllDoctors = async (speciality = null) => {
  const db = getDB();

  let query = `
    SELECT
      d.id,
      d.name,
      d.email,
      d.image,
      s.name AS speciality,
      d.degree,
      d.experience,
      d.about,
      d.fees,
      d.address_line1,
      d.address_line2,
      d.available
    FROM doctors d
    JOIN specialities s ON d.speciality_id = s.id
    WHERE d.available = true
  `;

  const params = [];

  if (speciality) {
    query += ' AND s.name = ?';
    params.push(speciality);
  }

  const [doctors] = await db.query(query, params);
  return doctors;
};

export const getDoctorById = async (id) => {
  const db = getDB();

  const query = `
    SELECT
      d.id,
      d.name,
      d.email,
      d.image,
      s.name AS speciality,
      d.degree,
      d.experience,
      d.about,
      d.fees,
      d.address_line1,
      d.address_line2,
      d.available
    FROM doctors d
    JOIN specialities s ON d.speciality_id = s.id
    WHERE d.id = ?
  `;

  const [doctors] = await db.query(query, [id]);
  return doctors[0];
};

export const getAllSpecialities = async () => {
  const db = getDB();
  const [specialities] = await db.query('SELECT * FROM specialities');
  return specialities;
};

export const searchDoctors = async (query) => {
  const db = getDB();
  const searchQuery = `%${query}%`;

  const [doctors] = await db.query(
    `SELECT d.*, s.name as speciality 
     FROM doctors d 
     LEFT JOIN specialities s ON d.speciality_id = s.id 
     WHERE d.name LIKE ? OR s.name LIKE ?
     ORDER BY d.name ASC`,
    [searchQuery, searchQuery],
  );

  return doctors;
};
