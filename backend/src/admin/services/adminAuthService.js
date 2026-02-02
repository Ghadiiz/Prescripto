import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { getDB } from '../../config/mysql.js';

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
