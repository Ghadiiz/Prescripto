import { getDB } from '../../config/mysql.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { AppError } from '../../utils/AppError.js';

export const loginDoctor = async (email, password) => {
  const db = getDB();

  const [doctors] = await db.query('SELECT * FROM doctors WHERE email = ?', [
    email,
  ]);

  if (doctors.length === 0) {
    throw new AppError('Invalid credentials', 401);
  }

  const doctor = doctors[0];

  if (!doctor.password) {
    throw new AppError(
      'Please set your password first. Check your email for the setup link.',
      403,
    );
  }

  if (!doctor.is_verified) {
    throw new AppError('Please verify your email and set password first.', 403);
  }

  const isPasswordValid = await bcrypt.compare(password, doctor.password);

  if (!isPasswordValid) {
    throw new AppError('Invalid credentials', 401);
  }

  const token = jwt.sign(
    { id: doctor.id, email: doctor.email, role: 'doctor' },
    process.env.JWT_SECRET,
    { expiresIn: '7d' },
  );

  return { token, doctorId: doctor.id };
};

export const getDoctorProfile = async (doctorId) => {
  const db = getDB();

  const [doctors] = await db.query(
    `SELECT d.id, d.name, d.email, d.image, d.speciality_id, 
            s.name as speciality, d.degree, d.experience, 
            d.about, d.fees, d.address_line1, d.address_line2, 
            d.available
     FROM doctors d
     LEFT JOIN specialities s ON d.speciality_id = s.id
     WHERE d.id = ?`,
    [doctorId],
  );

  if (doctors.length === 0) {
    throw new AppError('Doctor not found', 404);
  }

  const doctor = doctors[0];

  return {
    _id: doctor.id.toString(),
    name: doctor.name,
    email: doctor.email,
    image: doctor.image,
    speciality: doctor.speciality,
    specialityId: doctor.speciality_id,
    degree: doctor.degree,
    experience: doctor.experience,
    about: doctor.about,
    fees: doctor.fees,
    address: {
      line1: doctor.address_line1,
      line2: doctor.address_line2,
    },
    available: Boolean(doctor.available),
  };
};

// The columns a doctor may change about themselves, mapped to their fixed SET
// fragments. This replaces an `allowedFields` array paired with a
// `${key} = ?` template: the allowlist and the SQL were two lists that had to
// agree, and the statement's text came partly from the request body. Now there
// is one list, and the key only chooses among strings written here.
const UPDATABLE_COLUMNS = {
  name: 'name = ?',
  about: 'about = ?',
  fees: 'fees = ?',
  address_line1: 'address_line1 = ?',
  address_line2: 'address_line2 = ?',
  available: 'available = ?',
};

export const updateDoctorProfile = async (doctorId, updates) => {
  const db = getDB();

  const updateFields = [];
  const values = [];

  for (const column of Object.keys(UPDATABLE_COLUMNS)) {
    if (updates[column] !== undefined) {
      updateFields.push(UPDATABLE_COLUMNS[column]);
      values.push(updates[column]);
    }
  }

  if (updateFields.length === 0) {
    throw new AppError('No valid fields to update', 400);
  }

  values.push(doctorId);

  await db.query(
    `UPDATE doctors SET ${updateFields.join(', ')} WHERE id = ?`,
    values,
  );

  return true;
};

export const toggleDoctorAvailability = async (doctorId, available) => {
  const db = getDB();

  if (typeof available !== 'boolean') {
    throw new AppError('Available must be a boolean value', 400);
  }

  await db.query('UPDATE doctors SET available = ? WHERE id = ?', [
    available,
    doctorId,
  ]);

  return true;
};

export const setDoctorPassword = async (token, password) => {
  const db = getDB();

  const [doctors] = await db.query(
    'SELECT * FROM doctors WHERE verification_token = ? AND verification_token_expires > NOW()',
    [token],
  );

  if (doctors.length === 0) {
    throw new AppError('Invalid or expired token', 400);
  }

  const doctor = doctors[0];

  const hashedPassword = await bcrypt.hash(password, 10);

  await db.query(
    `UPDATE doctors 
     SET password = ?, 
         is_verified = 1, 
         verification_token = NULL, 
         verification_token_expires = NULL 
     WHERE id = ?`,
    [hashedPassword, doctor.id],
  );

  return { success: true };
};
