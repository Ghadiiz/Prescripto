import { getDB } from '../../config/mysql.js';

export const findUserByEmail = async (email) => {
  const db = getDB();
  const [users] = await db.query('SELECT * FROM users WHERE email = ?', [
    email,
  ]);
  return users[0];
};

export const findUserById = async (id) => {
  const db = getDB();
  const [users] = await db.query(
    "SELECT id, name, email, phone, address_line1, address_line2, gender, DATE_FORMAT(dob, '%Y-%m-%d') AS dob, image FROM users WHERE id = ?",
    [id],
  );
  return users[0];
};

export const createUser = async (userData) => {
  const {
    name,
    email,
    hashedPassword,
    phone,
    address_line1,
    address_line2,
    gender,
    dob,
  } = userData;

  const db = getDB();
  const [result] = await db.query(
    'INSERT INTO users (name, email, password, phone, address_line1, address_line2, gender, dob, role) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      name,
      email,
      hashedPassword,
      phone,
      address_line1,
      address_line2,
      gender,
      dob,
      'user',
    ],
  );
  return result.insertId;
};

// Every column a profile update may touch, mapped to its fixed SET fragment.
// The SQL text lives here rather than being assembled by the caller: before
// 6.10 this function took an array of already-built fragments, so the model
// executed whatever SQL a service handed it and the safety of the statement
// depended on a convention two modules apart. Now the caller chooses among
// these strings and cannot supply one.
const UPDATABLE_COLUMNS = {
  name: 'name = ?',
  phone: 'phone = ?',
  address_line1: 'address_line1 = ?',
  address_line2: 'address_line2 = ?',
  gender: 'gender = ?',
  dob: 'dob = ?',
};

// `fields` is a plain object of column -> new value. Which fields belong in it
// is the service's decision (some columns clear on an empty string, others
// only change when truthy); this function's job is that nothing outside the
// map above can reach the statement.
export const updateUser = async (userId, fields) => {
  const db = getDB();

  const setClauses = [];
  const values = [];

  for (const column of Object.keys(UPDATABLE_COLUMNS)) {
    if (fields[column] !== undefined) {
      setClauses.push(UPDATABLE_COLUMNS[column]);
      values.push(fields[column]);
    }
  }

  // Unreachable through the service, which rejects an empty update with a 400.
  // Kept because the alternative is emitting `SET  WHERE`, and a caller that
  // passes only unknown keys deserves to be told rather than to see a syntax
  // error from MySQL.
  if (setClauses.length === 0) {
    throw new Error('updateUser called with no updatable fields');
  }

  await db.query(`UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`, [
    ...values,
    userId,
  ]);
  return findUserById(userId);
};

export const updateUserImage = async (userId, imageUrl) => {
  const db = getDB();
  const [result] = await db.query('UPDATE users SET image = ? WHERE id = ?', [
    imageUrl,
    userId,
  ]);
  return result.affectedRows > 0;
};
