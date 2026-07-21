import { getDB } from '../../config/mysql.js';
import { APPOINTMENT_STATUS } from '../../constants/appointmentStatus.js';

export const getDoctorAppointments = async (doctorId, status = null) => {
  const db = getDB();

  let query = `
    SELECT a.*, 
           u.name as patient_name, 
           u.email as patient_email,
           u.image as patient_image,
           d.name as doctor_name,
           d.fees as appointment_fee
    FROM appointments a
    LEFT JOIN users u ON a.user_id = u.id
    LEFT JOIN doctors d ON a.doctor_id = d.id
    WHERE a.doctor_id = ?
  `;

  const params = [doctorId];

  if (status) {
    query += ' AND a.status = ?';
    params.push(status);
  }

  query += ' ORDER BY a.appointment_date DESC, a.appointment_time DESC';

  const [appointments] = await db.query(query, params);

  return appointments.map((apt) => ({
    _id: apt.id.toString(),
    userId: apt.user_id,
    doctorId: apt.doctor_id,
    patientName: apt.patient_name,
    patientEmail: apt.patient_email,
    patientImage: apt.patient_image,
    doctorName: apt.doctor_name,
    appointmentDate: apt.appointment_date,
    appointmentTime: apt.appointment_time,
    amount: apt.appointment_fee,
    status: apt.status,
    cancellationReason: apt.cancellation_reason,
    createdAt: apt.created_at,
  }));
};

export const completeAppointment = async (appointmentId, doctorId) => {
  const db = getDB();

  const [appointments] = await db.query(
    'SELECT * FROM appointments WHERE id = ? AND doctor_id = ?',
    [appointmentId, doctorId],
  );

  if (appointments.length === 0) {
    throw new Error('Appointment not found or unauthorized');
  }

  const appointment = appointments[0];

  if (appointment.status === APPOINTMENT_STATUS.CANCELLED) {
    throw new Error('Cannot complete a cancelled appointment');
  }

  if (appointment.status === APPOINTMENT_STATUS.COMPLETED) {
    throw new Error('Appointment already completed');
  }

  await db.query('UPDATE appointments SET status = ? WHERE id = ?', [
    APPOINTMENT_STATUS.COMPLETED,
    appointmentId,
  ]);

  return true;
};

export const cancelAppointment = async (appointmentId, doctorId) => {
  const db = getDB();

  const [appointments] = await db.query(
    'SELECT * FROM appointments WHERE id = ? AND doctor_id = ?',
    [appointmentId, doctorId],
  );

  if (appointments.length === 0) {
    throw new Error('Appointment not found or unauthorized');
  }

  const appointment = appointments[0];

  if (appointment.status === APPOINTMENT_STATUS.COMPLETED) {
    throw new Error('Cannot cancel a completed appointment');
  }

  if (appointment.status === APPOINTMENT_STATUS.CANCELLED) {
    throw new Error('Appointment already cancelled');
  }

  await db.query('UPDATE appointments SET status = ? WHERE id = ?', [
    APPOINTMENT_STATUS.CANCELLED,
    appointmentId,
  ]);

  return true;
};

export const getDoctorDashboard = async (doctorId) => {
  const db = getDB();

  const [earnings] = await db.query(
    `SELECT COALESCE(SUM(d.fees), 0) as total_earnings
     FROM appointments a
     JOIN doctors d ON a.doctor_id = d.id
     WHERE a.doctor_id = ? AND a.status = ?`,
    [doctorId, APPOINTMENT_STATUS.COMPLETED],
  );

  const [totalApts] = await db.query(
    'SELECT COUNT(*) as total FROM appointments WHERE doctor_id = ?',
    [doctorId],
  );

  const [totalPatients] = await db.query(
    'SELECT COUNT(DISTINCT user_id) as total FROM appointments WHERE doctor_id = ?',
    [doctorId],
  );

  const recentAppointments = await getDoctorAppointments(doctorId);

  return {
    earnings: parseFloat(earnings[0].total_earnings),
    appointments: totalApts[0].total,
    patients: totalPatients[0].total,
    latestAppointments: recentAppointments.slice(0, 5),
  };
};
