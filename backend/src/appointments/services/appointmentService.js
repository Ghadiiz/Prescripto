import * as appointmentModel from '../models/appointmentModel.js';
import { APPOINTMENT_STATUS } from '../../constants/appointmentStatus.js';
import { AppError } from '../../utils/AppError.js';
import { getDB } from '../../config/mysql.js';

const convertTo12Hour = (time24h) => {
  const [hours, minutes] = time24h.split(':');
  const hour = parseInt(hours);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12.toString().padStart(2, '0')}:${minutes} ${ampm}`;
};

const convertTo24Hour = (time12h) => {
  const [time, modifier] = time12h.split(' ');
  let [hours, minutes] = time.split(':');

  if (hours === '12') {
    hours = '00';
  }

  if (modifier === 'PM') {
    hours = parseInt(hours, 10) + 12;
  }

  return `${hours}:${minutes}:00`;
};

const formatDate = (dateString) => {
  const date = new Date(dateString);
  const day = date.getDate();
  const month = date.toLocaleString('en-US', { month: 'long' });
  const year = date.getFullYear();
  return `${day}, ${month}, ${year}`;
};

const formatAppointmentResponse = (appointment) => {
  return {
    _id: appointment._id,
    slotDate: formatDate(appointment.appointment_date),
    slotTime: convertTo12Hour(appointment.appointment_time),
    status: appointment.status,
    amount: appointment.amount,
    cancellationReason: appointment.cancellation_reason || null,
    doctor: {
      _id: appointment.doctor__id,
      name: appointment.doctor_name,
      speciality: appointment.doctor_speciality,
      image: appointment.doctor_image,
      degree: appointment.doctor_degree,
      fees: appointment.doctor_fees,
      address: {
        line1: appointment.doctor_address_line1,
        line2: appointment.doctor_address_line2,
      },
      phone: appointment.doctor_phone,
    },
  };
};

const bookAppointment = async (
  userId,
  doctorId,
  appointmentDate,
  appointmentTime,
) => {
  const doctor = await appointmentModel.checkDoctorAvailability(doctorId);

  if (!doctor) {
    throw new AppError('Doctor not found', 404);
  }

  if (!doctor.available) {
    throw new AppError('Doctor is not available for appointments', 400);
  }

  const db = getDB();
  const [userRows] = await db.query(
    'SELECT dob FROM users WHERE id = ?',
    [userId],
  );
  if (!userRows[0] || !userRows[0].dob) {
    throw new AppError(
      'Please add your date of birth in My Profile before booking an appointment',
      400,
    );
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const selectedDate = new Date(appointmentDate);

  if (selectedDate < today) {
    throw new AppError('Cannot book appointments in the past', 400);
  }

  let timeIn24Hour = appointmentTime;
  if (appointmentTime.includes('AM') || appointmentTime.includes('PM')) {
    timeIn24Hour = convertTo24Hour(appointmentTime);
  }

  const [hours] = timeIn24Hour.split(':');
  const hourNum = parseInt(hours);

  if (hourNum < 10 || hourNum >= 21) {
    throw new AppError('Appointment time must be between 10:00 AM and 9:00 PM', 400);
  }

  const bookedSlots = await appointmentModel.findAppointmentsByDoctorAndDate(
    doctorId,
    appointmentDate,
  );

  if (bookedSlots.includes(timeIn24Hour)) {
    throw new AppError('This time slot is already booked', 400);
  }

  const appointmentId = await appointmentModel.createAppointment(
    userId,
    doctorId,
    appointmentDate,
    timeIn24Hour,
    doctor.fees || 0,
  );

  const appointment = await appointmentModel.findAppointmentById(appointmentId);
  return formatAppointmentResponse(appointment);
};

const getUserAppointments = async (userId) => {
  const appointments = await appointmentModel.findUserAppointments(userId);
  return appointments.map(formatAppointmentResponse);
};

const getAppointmentDetails = async (appointmentId, userId) => {
  const appointment = await appointmentModel.findAppointmentById(appointmentId);

  if (!appointment) {
    throw new AppError('Appointment not found', 404);
  }

  if (appointment.user_id !== userId) {
    throw new AppError('Unauthorized to view this appointment', 403);
  }

  return formatAppointmentResponse(appointment);
};

const cancelAppointment = async (
  appointmentId,
  userId,
  cancellationReason = null,
) => {
  const appointment = await appointmentModel.findAppointmentById(appointmentId);

  if (!appointment) {
    throw new AppError('Appointment not found', 404);
  }

  if (appointment.user_id !== userId) {
    throw new AppError('Unauthorized to cancel this appointment', 403);
  }

  if (appointment.status === APPOINTMENT_STATUS.CANCELLED) {
    throw new AppError('Appointment is already cancelled', 400);
  }

  if (appointment.status === APPOINTMENT_STATUS.COMPLETED) {
    throw new AppError('Cannot cancel completed appointment', 400);
  }

  if (appointment.is_past) {
    throw new AppError('Cannot cancel an appointment that has already passed', 400);
  }

  const success = await appointmentModel.cancelAppointment(
    appointmentId,
    cancellationReason,
  );

  if (!success) {
    throw new Error('Failed to cancel appointment');
  }

  return { message: 'Appointment cancelled successfully' };
};

const getAvailableSlots = async (doctorId, date) => {
  const doctor = await appointmentModel.checkDoctorAvailability(doctorId);

  if (!doctor) {
    throw new AppError('Doctor not found', 404);
  }

  if (!doctor.available) {
    throw new AppError('Doctor is not available for appointments', 400);
  }

  const bookedSlots = await appointmentModel.findAppointmentsByDoctorAndDate(
    doctorId,
    date,
  );

  const slots = [];
  const start = new Date();
  start.setHours(10, 0, 0, 0);

  const end = new Date();
  end.setHours(21, 0, 0, 0);

  const now = new Date();
  const selectedDate = new Date(date);
  const isToday = selectedDate.toDateString() === now.toDateString();

  if (isToday && now > start) {
    start.setTime(now.getTime());

    const minutes = start.getMinutes();
    if (minutes < 30) {
      start.setMinutes(30);
    } else {
      start.setHours(start.getHours() + 1);
      start.setMinutes(0);
    }
    start.setSeconds(0);
  }

  while (start < end) {
    const timeSlot = start.toTimeString().slice(0, 8);

    if (!bookedSlots.includes(timeSlot)) {
      slots.push(convertTo12Hour(timeSlot));
    }

    start.setMinutes(start.getMinutes() + 30);
  }

  return slots;
};

const createCheckoutPreview = async (
  userId,
  doctorId,
  appointmentDate,
  appointmentTime,
) => {
  const { getDB } = await import('../../config/mysql.js');
  const pool = getDB();

  const doctorQuery = `
    SELECT d.*, s.name as speciality_name
    FROM doctors d
    JOIN specialities s ON d.speciality_id = s.id
    WHERE d.id = ?
  `;
  const [doctorRows] = await pool.query(doctorQuery, [doctorId]);
  const fullDoctor = doctorRows[0];

  if (!fullDoctor) {
    throw new AppError('Doctor not found', 404);
  }

  if (!fullDoctor.available) {
    throw new AppError('Doctor is not available', 400);
  }

  const userQuery = `
    SELECT id, name, email, phone, image
    FROM users
    WHERE id = ?
  `;
  const [userRows] = await pool.query(userQuery, [userId]);
  const user = userRows[0];

  if (!user) {
    throw new AppError('User not found', 404);
  }

  let timeIn24Hour = appointmentTime;
  if (appointmentTime.includes('AM') || appointmentTime.includes('PM')) {
    timeIn24Hour = convertTo24Hour(appointmentTime);
  }

  return {
    doctor: {
      _id: fullDoctor.id,
      name: fullDoctor.name,
      speciality: fullDoctor.speciality_name,
      degree: fullDoctor.degree,
      experience: fullDoctor.experience,
      about: fullDoctor.about,
      fees: parseFloat(fullDoctor.fees),
      image: fullDoctor.image,
      address: {
        line1: fullDoctor.address_line1,
        line2: fullDoctor.address_line2,
      },
    },
    patient: {
      _id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      image: user.image,
    },
    appointment: {
      date: formatDate(appointmentDate),
      time: convertTo12Hour(timeIn24Hour),
      rawDate: appointmentDate,
      rawTime: appointmentTime,
    },
    payment: {
      method: 'cash',
      amount: parseFloat(fullDoctor.fees),
      currency: 'USD',
      status: 'pending',
    },
    total: parseFloat(fullDoctor.fees),
  };
};

export {
  bookAppointment,
  getUserAppointments,
  getAppointmentDetails,
  cancelAppointment,
  getAvailableSlots,
  createCheckoutPreview,
};
