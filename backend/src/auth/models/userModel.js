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

export const updateUser = async (userId, updates, values) => {
  const db = getDB();
  await db.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, [
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
