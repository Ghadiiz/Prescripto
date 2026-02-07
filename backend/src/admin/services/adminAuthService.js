import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { getDB } from '../../config/mysql.js';
import { sendAdminCreatedEmail } from '../../utils/emailService.js';

export const loginAdmin = async (email, password) => {
  const pool = getDB();

  const [users] = await pool.query(
    'SELECT * FROM users WHERE email = ? AND role = ?',
    [email, 'admin'],
  );

  if (users.length === 0) {
    throw new Error('Invalid credentials or not an admin');
  }

  const admin = users[0];

  const isPasswordValid = await bcrypt.compare(password, admin.password);

  if (!isPasswordValid) {
    throw new Error('Invalid credentials');
  }

  const token = jwt.sign(
    {
      id: admin.id,
      email: admin.email,
      role: admin.role,
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' },
  );

  return {
    token,
    admin: {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
    },
  };
};

export const createAdmin = async (adminData) => {
  const pool = getDB();
  const { name, email, password } = adminData;

  const [existing] = await pool.query('SELECT * FROM users WHERE email = ?', [
    email,
  ]);

  if (existing.length > 0) {
    throw new Error('EMAIL_EXISTS');
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  await pool.query(
    'INSERT INTO users (name, email, password, role, is_verified) VALUES (?, ?, ?, ?, ?)',
    [name, email, hashedPassword, 'admin', 1],
  );

  try {
    await sendAdminCreatedEmail(email, name, password);
  } catch (emailError) {
    console.error('Failed to send admin creation email:', emailError);
  }

  return { success: true };
};

export const getAdminProfile = async (adminId) => {
  const pool = getDB();

  const [admins] = await pool.query(
    'SELECT id, name, email, role FROM users WHERE id = ? AND role = ?',
    [adminId, 'admin'],
  );

  if (admins.length === 0) {
    throw new Error('Admin not found');
  }

  return admins[0];
};

export const updateAdminProfile = async (adminId, profileData) => {
  const pool = getDB();
  const { name, email } = profileData;

  if (email) {
    const [existing] = await pool.query(
      'SELECT * FROM users WHERE email = ? AND id != ?',
      [email, adminId],
    );

    if (existing.length > 0) {
      throw new Error('EMAIL_EXISTS');
    }
  }

  await pool.query('UPDATE users SET name = ?, email = ? WHERE id = ?', [
    name,
    email,
    adminId,
  ]);
  return await getAdminProfile(adminId);
};

export const changeAdminPassword = async (
  adminId,
  oldPassword,
  newPassword,
) => {
  const pool = getDB();

  const [admins] = await pool.query('SELECT * FROM users WHERE id = ?', [
    adminId,
  ]);

  if (admins.length === 0) {
    throw new Error('Admin not found');
  }

  const admin = admins[0];

  const isPasswordValid = await bcrypt.compare(oldPassword, admin.password);

  if (!isPasswordValid) {
    throw new Error('INVALID_PASSWORD');
  }

  const hashedNewPassword = await bcrypt.hash(newPassword, 10);

  await pool.query('UPDATE users SET password = ? WHERE id = ?', [
    hashedNewPassword,
    adminId,
  ]);

  return { success: true };
};
