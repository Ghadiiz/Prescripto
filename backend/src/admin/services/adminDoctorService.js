import { getDB } from '../../config/mysql.js';
import { uploadToCloudinary } from '../../config/cloudinary.js';
import crypto from 'crypto';
import { sendDoctorSetPasswordEmail } from '../../utils/emailService.js';
import { AppError } from '../../utils/AppError.js';
import {
  DOCTOR_LANGUAGES,
  DOCTOR_AREAS,
  DOCTOR_GENDERS,
} from '../../constants/doctorOptions.js';

// `experience` is a display string ('4 Years'); `experience_years` is the
// integer the assistant filters on. The admin form has one dropdown, and this
// derives the second column from it so the two can never disagree. Same rule
// migration 001 used to backfill.
const toExperienceYears = (experience) => {
  const match = String(experience ?? '').match(/\d+/);
  return match ? Number(match[0]) : null;
};

// Shared by all three read-backs below. `speciality_id` is included because
// the admin edit form prefills its dropdown from it — without it the form
// falls back to General physician and silently rewrites the doctor on save.
const DOCTOR_COLUMNS = `
      d.id,
      d.name,
      d.email,
      d.image,
      d.speciality_id,
      s.name AS speciality,
      d.degree,
      d.experience,
      d.experience_years,
      d.languages,
      d.gender,
      d.about,
      d.fees,
      d.address_line1,
      d.address_line2,
      d.area,
      d.phone,
      d.available,
      d.is_verified`;

const toDoctorResponse = (doc) => ({
  id: doc.id,
  name: doc.name,
  email: doc.email,
  image: doc.image,
  speciality_id: doc.speciality_id,
  speciality: doc.speciality,
  degree: doc.degree,
  experience: doc.experience,
  experience_years: doc.experience_years,
  languages: doc.languages,
  gender: doc.gender,
  about: doc.about,
  fees: parseFloat(doc.fees),
  address: {
    line1: doc.address_line1,
    line2: doc.address_line2,
  },
  area: doc.area,
  phone: doc.phone,
  available: Boolean(doc.available),
  isVerified: Boolean(doc.is_verified),
});

// Serves the admin doctor forms their dropdown options. Specialities come from
// the table rather than a hardcoded list, and the other three from the same
// constants the validators enforce — so the options a form offers and the
// values the API accepts cannot drift apart.
export const getDoctorOptions = async () => {
  const pool = getDB();

  // ORDER BY id reproduces the order the forms used while these were hardcoded.
  const [specialities] = await pool.query(
    'SELECT id, name FROM specialities ORDER BY id',
  );

  return {
    specialities,
    areas: DOCTOR_AREAS,
    genders: DOCTOR_GENDERS,
    languages: DOCTOR_LANGUAGES,
  };
};

export const getAllDoctors = async () => {
  const pool = getDB();
  const [doctors] = await pool.query(`
    SELECT
${DOCTOR_COLUMNS}
    FROM doctors d
    JOIN specialities s ON d.speciality_id = s.id
    ORDER BY d.id DESC
  `);

  return doctors.map(toDoctorResponse);
};

export const addDoctor = async (doctorData, imageFile) => {
  const pool = getDB();
  let imageUrl = null;

  if (imageFile) {
    imageUrl = await uploadToCloudinary(imageFile.path);
  }

  const {
    name,
    email,
    speciality_id,
    degree,
    experience,
    languages,
    gender,
    about,
    fees,
    address_line1,
    address_line2,
    area,
    phone,
  } = doctorData;

  const [existing] = await pool.query('SELECT * FROM doctors WHERE email = ?', [
    email,
  ]);

  if (existing.length > 0) {
    throw new AppError('Doctor with this email already exists', 409);
  }

  const verificationToken = crypto.randomBytes(32).toString('hex');
  const tokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const [result] = await pool.query(
    `INSERT INTO doctors
    (name, email, password, image, speciality_id, degree, experience, experience_years, languages, gender, about, fees, address_line1, address_line2, area, phone, available, is_verified, verification_token, verification_token_expires)
    VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, true, 0, ?, ?)`,
    [
      name,
      email,
      imageUrl,
      speciality_id,
      degree,
      experience,
      toExperienceYears(experience),
      languages || null,
      gender || null,
      about,
      fees,
      address_line1,
      address_line2,
      area || null,
      phone,
      verificationToken,
      tokenExpires,
    ],
  );

  try {
    await sendDoctorSetPasswordEmail(email, name, verificationToken);
  } catch (emailError) {
    console.error('Failed to send doctor set password email:', emailError);
  }

  const [doctors] = await pool.query(
    `SELECT
${DOCTOR_COLUMNS}
    FROM doctors d
    JOIN specialities s ON d.speciality_id = s.id
    WHERE d.id = ?`,
    [result.insertId],
  );

  return toDoctorResponse(doctors[0]);
};

export const updateDoctor = async (doctorId, doctorData, imageFile) => {
  const pool = getDB();

  const [existingDoctor] = await pool.query(
    'SELECT * FROM doctors WHERE id = ?',
    [doctorId],
  );

  if (existingDoctor.length === 0) {
    throw new AppError('Doctor not found', 404);
  }

  let imageUrl = existingDoctor[0].image;

  if (imageFile) {
    imageUrl = await uploadToCloudinary(imageFile.path);
  }

  const {
    name,
    email,
    password,
    speciality_id,
    degree,
    experience,
    languages,
    gender,
    about,
    fees,
    address_line1,
    address_line2,
    area,
    phone,
  } = doctorData;

  let finalPassword = existingDoctor[0].password;
  if (password && password.trim() !== '') {
    const bcrypt = await import('bcrypt');
    finalPassword = await bcrypt.hash(password, 10);
  }

  await pool.query(
    `UPDATE doctors
    SET name = ?, email = ?, password = ?, image = ?, speciality_id = ?, degree = ?,
    experience = ?, experience_years = ?, languages = ?, gender = ?, about = ?, fees = ?,
    address_line1 = ?, address_line2 = ?, area = ?, phone = ?
    WHERE id = ?`,
    [
      name,
      email,
      finalPassword,
      imageUrl,
      speciality_id,
      degree,
      experience,
      toExperienceYears(experience),
      languages || null,
      gender || null,
      about,
      fees,
      address_line1,
      address_line2,
      area || null,
      phone,
      doctorId,
    ],
  );

  const [doctors] = await pool.query(
    `SELECT
${DOCTOR_COLUMNS}
    FROM doctors d
    JOIN specialities s ON d.speciality_id = s.id
    WHERE d.id = ?`,
    [doctorId],
  );

  return toDoctorResponse(doctors[0]);
};

export const deleteDoctor = async (doctorId) => {
  const pool = getDB();

  const [existingDoctor] = await pool.query(
    'SELECT * FROM doctors WHERE id = ?',
    [doctorId],
  );

  if (existingDoctor.length === 0) {
    throw new AppError('Doctor not found', 404);
  }

  const [appointments] = await pool.query(
    "SELECT COUNT(*) as count FROM appointments WHERE doctor_id = ? AND status != 'cancelled'",
    [doctorId],
  );

  if (appointments[0].count > 0) {
    throw new AppError(
      'Cannot delete doctor with existing appointments. Set as unavailable instead.',
      400,
    );
  }

  await pool.query('DELETE FROM doctors WHERE id = ?', [doctorId]);

  return { id: doctorId };
};

export const toggleDoctorAvailability = async (doctorId) => {
  const pool = getDB();

  const [existingDoctor] = await pool.query(
    'SELECT * FROM doctors WHERE id = ?',
    [doctorId],
  );

  if (existingDoctor.length === 0) {
    throw new AppError('Doctor not found', 404);
  }

  const currentStatus = existingDoctor[0].available;
  const newStatus = !currentStatus;

  await pool.query('UPDATE doctors SET available = ? WHERE id = ?', [
    newStatus,
    doctorId,
  ]);

  return {
    id: doctorId,
    available: Boolean(newStatus),
  };
};
