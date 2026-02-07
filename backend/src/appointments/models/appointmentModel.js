import { getDB } from '../../config/mysql.js';

const createAppointment = async (
  userId,
  doctorId,
  appointmentDate,
  appointmentTime,
  amount = 0,
) => {
  const pool = getDB();
  const query = `
    INSERT INTO appointments (user_id, doctor_id, appointment_date, appointment_time, status)
    VALUES (?, ?, ?, ?, 'pending')
  `;

  const [result] = await pool.query(query, [
    userId,
    doctorId,
    appointmentDate,
    appointmentTime,
    amount,
  ]);
  return result.insertId;
};

const findAppointmentById = async (appointmentId) => {
  const pool = getDB();
  const query = `
    SELECT 
      a.id AS _id,
      a.user_id,
      a.doctor_id,
      a.appointment_date,
      a.appointment_time,
      a.status,
      a.cancellation_reason,
      a.created_at,
      d.id AS doctor__id,
      d.name AS doctor_name,
      d.image AS doctor_image,
      d.degree AS doctor_degree,
      d.fees AS doctor_fees,
      d.address_line1 AS doctor_address_line1,
      d.address_line2 AS doctor_address_line2,
      s.name AS doctor_speciality
    FROM appointments a
    JOIN doctors d ON a.doctor_id = d.id
    JOIN specialities s ON d.speciality_id = s.id
    WHERE a.id = ?
  `;

  const [rows] = await pool.query(query, [appointmentId]);
  return rows[0];
};

const findUserAppointments = async (userId) => {
  const pool = getDB();
  const query = `
    SELECT 
      a.id AS _id,
      a.user_id,
      a.doctor_id,
      a.appointment_date,
      a.appointment_time,
      a.status,
      a.cancellation_reason,
      a.created_at,
      d.id AS doctor__id,
      d.name AS doctor_name,
      d.image AS doctor_image,
      d.degree AS doctor_degree,
      d.fees AS doctor_fees,
      d.address_line1 AS doctor_address_line1,
      d.address_line2 AS doctor_address_line2,
      s.name AS doctor_speciality
    FROM appointments a
    JOIN doctors d ON a.doctor_id = d.id
    JOIN specialities s ON d.speciality_id = s.id
    WHERE a.user_id = ?
    ORDER BY a.appointment_date DESC, a.appointment_time DESC
  `;

  const [rows] = await pool.query(query, [userId]);
  return rows;
};

const findAppointmentsByDoctorAndDate = async (doctorId, appointmentDate) => {
  const pool = getDB();
  const query = `
    SELECT appointment_time
    FROM appointments
    WHERE doctor_id = ? 
    AND appointment_date = ?
    AND status IN ('pending', 'confirmed')
  `;

  const [rows] = await pool.query(query, [doctorId, appointmentDate]);
  return rows.map((row) => row.appointment_time);
};

const cancelAppointment = async (appointmentId, cancellationReason) => {
  const pool = getDB();
  const query = `
    UPDATE appointments
    SET status = 'cancelled', cancellation_reason = ?
    WHERE id = ?
  `;

  const [result] = await pool.query(query, [cancellationReason, appointmentId]);
  return result.affectedRows > 0;
};

const checkDoctorAvailability = async (doctorId) => {
  const pool = getDB();
  const query = `
    SELECT id, available
    FROM doctors
    WHERE id = ?
  `;

  const [rows] = await pool.query(query, [doctorId]);
  return rows[0];
};

export {
  createAppointment,
  findAppointmentById,
  findUserAppointments,
  findAppointmentsByDoctorAndDate,
  cancelAppointment,
  checkDoctorAvailability,
};
