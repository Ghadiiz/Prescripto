import { getDB } from '../../config/mysql.js';
import { uploadToCloudinary } from '../../config/cloudinary.js';
import crypto from 'crypto';
import { sendDoctorSetPasswordEmail } from '../../utils/emailService.js';
import { AppError } from '../../utils/AppError.js';

export const getAllDoctors = async () => {
  const pool = getDB();
  const [doctors] = await pool.query(`
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
      d.phone,
      d.available,
      d.is_verified
    FROM doctors d
    JOIN specialities s ON d.speciality_id = s.id
    ORDER BY d.id DESC
  `);

  return doctors.map((doc) => ({
    id: doc.id,
    name: doc.name,
    email: doc.email,
    image: doc.image,
    speciality: doc.speciality,
    degree: doc.degree,
    experience: doc.experience,
    about: doc.about,
    fees: parseFloat(doc.fees),
    address: {
      line1: doc.address_line1,
      line2: doc.address_line2,
    },
    phone: doc.phone,
    available: Boolean(doc.available),
    isVerified: Boolean(doc.is_verified),
  }));
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
    about,
    fees,
    address_line1,
    address_line2,
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
    (name, email, password, image, speciality_id, degree, experience, about, fees, address_line1, address_line2, phone, available, is_verified, verification_token, verification_token_expires)
    VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, true, 0, ?, ?)`,
    [
      name,
      email,
      imageUrl,
      speciality_id,
      degree,
      experience,
      about,
      fees,
      address_line1,
      address_line2,
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
      d.available,
      d.is_verified
    FROM doctors d
    JOIN specialities s ON d.speciality_id = s.id
    WHERE d.id = ?`,
    [result.insertId],
  );

  const doc = doctors[0];

  return {
    id: doc.id,
    name: doc.name,
    email: doc.email,
    image: doc.image,
    speciality: doc.speciality,
    degree: doc.degree,
    experience: doc.experience,
    about: doc.about,
    fees: parseFloat(doc.fees),
    address: {
      line1: doc.address_line1,
      line2: doc.address_line2,
    },
    available: Boolean(doc.available),
    isVerified: Boolean(doc.is_verified),
  };
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
    about,
    fees,
    address_line1,
    address_line2,
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
    experience = ?, about = ?, fees = ?, address_line1 = ?, address_line2 = ?, phone = ?
    WHERE id = ?`,
    [
      name,
      email,
      finalPassword,
      imageUrl,
      speciality_id,
      degree,
      experience,
      about,
      fees,
      address_line1,
      address_line2,
      phone,
      doctorId,
    ],
  );

  const [doctors] = await pool.query(
    `SELECT
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
      d.phone,
      d.available,
      d.is_verified
    FROM doctors d
    JOIN specialities s ON d.speciality_id = s.id
    WHERE d.id = ?`,
    [doctorId],
  );

  const doc = doctors[0];

  return {
    id: doc.id,
    name: doc.name,
    email: doc.email,
    image: doc.image,
    speciality: doc.speciality,
    degree: doc.degree,
    experience: doc.experience,
    about: doc.about,
    fees: parseFloat(doc.fees),
    address: {
      line1: doc.address_line1,
      line2: doc.address_line2,
    },
    phone: doc.phone,
    available: Boolean(doc.available),
    isVerified: Boolean(doc.is_verified),
  };
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
