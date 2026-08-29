import { getDB } from '../../config/mysql.js';
import { APPOINTMENT_STATUS } from '../../constants/appointmentStatus.js';
import { AppError } from '../../utils/AppError.js';
import { notifyWaitlistSafely } from '../../notifications/services/waitlistNotifier.js';

export const getDoctorAppointments = async (doctorId, status = null) => {
  const db = getDB();

  let query = `
    SELECT a.*,
           TIMESTAMP(a.appointment_date, a.appointment_time) <= NOW() AS is_past,
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
    isPast: Boolean(apt.is_past),
    cancellationReason: apt.cancellation_reason,
    createdAt: apt.created_at,
  }));
};

export const completeAppointment = async (appointmentId, doctorId) => {
  const db = getDB();

  const [appointments] = await db.query(
    'SELECT *, TIMESTAMP(appointment_date, appointment_time) <= NOW() AS is_past FROM appointments WHERE id = ? AND doctor_id = ?',
    [appointmentId, doctorId],
  );

  if (appointments.length === 0) {
    throw new AppError('Appointment not found or unauthorized', 404);
  }

  const appointment = appointments[0];

  if (appointment.status === APPOINTMENT_STATUS.CANCELLED) {
    throw new AppError('Cannot complete a cancelled appointment', 400);
  }

  if (appointment.status === APPOINTMENT_STATUS.COMPLETED) {
    throw new AppError('Appointment already completed', 400);
  }

  if (!appointment.is_past) {
    throw new AppError('Cannot complete an appointment before its scheduled time', 400);
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
    throw new AppError('Appointment not found or unauthorized', 404);
  }

  const appointment = appointments[0];

  if (appointment.status === APPOINTMENT_STATUS.COMPLETED) {
    throw new AppError('Cannot cancel a completed appointment', 400);
  }

  if (appointment.status === APPOINTMENT_STATUS.CANCELLED) {
    throw new AppError('Appointment already cancelled', 400);
  }

  await db.query('UPDATE appointments SET status = ? WHERE id = ?', [
    APPOINTMENT_STATUS.CANCELLED,
    appointmentId,
  ]);

  // The other cancel path (5.4). A doctor cancelling is arguably the more
  // likely reason a slot opens, so hooking only the patient service would
  // leave the common case silent.
  //
  // No excludeUserId: the doctor is not a patient, and the patient whose
  // appointment this was may well want the next opening.
  await notifyWaitlistSafely({
    doctorId: appointment.doctor_id,
    date: appointment.appointment_date,
    // 7.2: which half-hour opened, not just which day.
    time: appointment.appointment_time,
  });

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
