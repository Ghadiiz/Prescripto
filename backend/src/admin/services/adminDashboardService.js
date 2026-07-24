import { getDB } from '../../config/mysql.js';

export const getDashboardStats = async () => {
  const pool = getDB();

  const [totalDoctorsResult] = await pool.query(
    'SELECT COUNT(*) as count FROM doctors',
  );
  const totalDoctors = totalDoctorsResult[0].count;

  const [activeDoctorsResult] = await pool.query(
    'SELECT COUNT(*) as count FROM doctors WHERE available = true',
  );
  const activeDoctors = activeDoctorsResult[0].count;

  const [totalAppointmentsResult] = await pool.query(
    'SELECT COUNT(*) as count FROM appointments',
  );
  const totalAppointments = totalAppointmentsResult[0].count;

  const [pendingAppointmentsResult] = await pool.query(
    "SELECT COUNT(*) as count FROM appointments WHERE status = 'pending'",
  );
  const pendingAppointments = pendingAppointmentsResult[0].count;

  const [completedAppointmentsResult] = await pool.query(
    "SELECT COUNT(*) as count FROM appointments WHERE status = 'completed'",
  );
  const completedAppointments = completedAppointmentsResult[0].count;

  const [cancelledAppointmentsResult] = await pool.query(
    "SELECT COUNT(*) as count FROM appointments WHERE status = 'cancelled'",
  );
  const cancelledAppointments = cancelledAppointmentsResult[0].count;

  const [totalUsersResult] = await pool.query(
    "SELECT COUNT(*) as count FROM users WHERE role = 'user' OR role = 'patient'",
  );
  const totalUsers = totalUsersResult[0].count;

  const [revenueResult] = await pool.query(`
    SELECT SUM(d.fees) as revenue
    FROM appointments a
    JOIN doctors d ON a.doctor_id = d.id
    WHERE a.status = 'completed'
  `);
  const totalRevenue = revenueResult[0].revenue || 0;

  return {
    totalDoctors,
    activeDoctors,
    inactiveDoctors: totalDoctors - activeDoctors,
    totalAppointments,
    pendingAppointments,
    completedAppointments,
    cancelledAppointments,
    totalUsers,
    totalRevenue: parseFloat(totalRevenue),
  };
};

export const getAllAppointments = async () => {
  const pool = getDB();

  const [appointments] = await pool.query(`
    SELECT 
      a.id,
      a.appointment_date as appointmentDate,
      a.appointment_time as appointmentTime,
      a.status,
      u.id as patientId,
      u.name as patientName,
      u.email as patientEmail,
      u.phone as patientPhone,
      DATE_FORMAT(u.dob, '%Y-%m-%d') as patientDob,
      d.id as doctorId,
      d.name as doctorName,
      s.name as doctorSpeciality,
      d.fees as doctorFees
    FROM appointments a
    JOIN users u ON a.user_id = u.id
    JOIN doctors d ON a.doctor_id = d.id
    JOIN specialities s ON d.speciality_id = s.id
    ORDER BY a.appointment_date DESC, a.appointment_time DESC
  `);

  return appointments.map((apt) => ({
    id: apt.id,
    appointmentDate: apt.appointmentDate,
    appointmentTime: apt.appointmentTime,
    status: apt.status,
    patient: {
      id: apt.patientId,
      name: apt.patientName,
      email: apt.patientEmail,
      phone: apt.patientPhone,
      dob: apt.patientDob,
    },
    doctor: {
      id: apt.doctorId,
      name: apt.doctorName,
      speciality: apt.doctorSpeciality,
      fees: apt.doctorFees,
    },
  }));
};
