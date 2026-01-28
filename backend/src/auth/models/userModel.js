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
    'SELECT id, name, email, phone, address_line1, address_line2, gender, dob, image FROM users WHERE id = ?',
    [id],
  );
  return users[0];
};

export const createUser = async (name, email, hashedPassword) => {
  const db = getDB();
  const [result] = await db.query(
    'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
    [name, email, hashedPassword],
  );
  return result.insertId;
};

export const updateUser = async (userId, updates, values) => {
  const db = getDB();
  await db.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, [
    ...values,
    userId,
  ]);
  return findUserById(userId);
};
