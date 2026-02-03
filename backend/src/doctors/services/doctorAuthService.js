import { getDB } from '../../config/mysql.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

export const loginDoctor = async (email, password) => {
  const db = getDB();

  const [doctors] = await db.query('SELECT * FROM doctors WHERE email = ?', [
    email,
  ]);

  if (doctors.length === 0) {
    throw new Error('Invalid credentials');
  }

  const doctor = doctors[0];

  const isPasswordValid = await bcrypt.compare(password, doctor.password);

  if (!isPasswordValid) {
    throw new Error('Invalid credentials');
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
    throw new Error('Doctor not found');
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

export const updateDoctorProfile = async (doctorId, updates) => {
  const db = getDB();

  const allowedFields = [
    'name',
    'about',
    'fees',
    'address_line1',
    'address_line2',
    'available',
  ];
  const updateFields = [];
  const values = [];

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key) && value !== undefined) {
      updateFields.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (updateFields.length === 0) {
    throw new Error('No valid fields to update');
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
    throw new Error('Available must be a boolean value');
  }

  await db.query('UPDATE doctors SET available = ? WHERE id = ?', [
    available,
    doctorId,
  ]);

  return true;
};
