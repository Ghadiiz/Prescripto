import { getDB } from '../../config/mysql.js';
import { uploadToCloudinary } from '../../config/cloudinary.js';
import bcrypt from 'bcrypt';

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
      d.available
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
    available: Boolean(doc.available),
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
    password,
    speciality_id,
    degree,
    experience,
    about,
    fees,
    address_line1,
    address_line2,
  } = doctorData;

  const hashedPassword = await bcrypt.hash(password, 10);

  const [result] = await pool.query(
    `INSERT INTO doctors
    (name, email, password, image, speciality_id, degree, experience, about, fees, address_line1, address_line2, available)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, true)`,
    [
      name,
      email,
      hashedPassword,
      imageUrl,
      speciality_id,
      degree,
      experience,
      about,
      fees,
      address_line1,
      address_line2,
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
      d.available
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
  };
};

export const updateDoctor = async (doctorId, doctorData, imageFile) => {
  const pool = getDB();

  const [existingDoctor] = await pool.query(
    'SELECT * FROM doctors WHERE id = ?',
    [doctorId],
  );

  if (existingDoctor.length === 0) {
    throw new Error('Doctor not found');
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
  } = doctorData;

  let finalPassword = existingDoctor[0].password;
  if (password && password.trim() !== '') {
    finalPassword = await bcrypt.hash(password, 10);
  }

  await pool.query(
    `UPDATE doctors
    SET name = ?, email = ?, password = ?, image = ?, speciality_id = ?, degree = ?,
    experience = ?, about = ?, fees = ?, address_line1 = ?, address_line2 = ?
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
      d.available
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
    available: Boolean(doc.available),
  };
};

export const deleteDoctor = async (doctorId) => {
  const pool = getDB();

  const [existingDoctor] = await pool.query(
    'SELECT * FROM doctors WHERE id = ?',
    [doctorId],
  );

  if (existingDoctor.length === 0) {
    throw new Error('Doctor not found');
  }

  const [appointments] = await pool.query(
    'SELECT COUNT(*) as count FROM appointments WHERE doctor_id = ?',
    [doctorId],
  );

  if (appointments[0].count > 0) {
    throw new Error(
      'Cannot delete doctor with existing appointments. Set as unavailable instead.',
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
    throw new Error('Doctor not found');
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
