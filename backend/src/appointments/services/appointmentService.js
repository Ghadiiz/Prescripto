import * as appointmentModel from '../models/appointmentModel.js';

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
    throw new Error('Doctor not found');
  }

  if (!doctor.available) {
    throw new Error('Doctor is not available for appointments');
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const selectedDate = new Date(appointmentDate);

  if (selectedDate < today) {
    throw new Error('Cannot book appointments in the past');
  }

  let timeIn24Hour = appointmentTime;
  if (appointmentTime.includes('AM') || appointmentTime.includes('PM')) {
    timeIn24Hour = convertTo24Hour(appointmentTime);
  }

  const [hours] = timeIn24Hour.split(':');
  const hourNum = parseInt(hours);

  if (hourNum < 10 || hourNum >= 21) {
    throw new Error('Appointment time must be between 10:00 AM and 9:00 PM');
  }

  const bookedSlots = await appointmentModel.findAppointmentsByDoctorAndDate(
    doctorId,
    appointmentDate,
  );

  if (bookedSlots.includes(timeIn24Hour)) {
    throw new Error('This time slot is already booked');
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
    throw new Error('Appointment not found');
  }

  if (appointment.user_id !== userId) {
    throw new Error('Unauthorized to view this appointment');
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
    throw new Error('Appointment not found');
  }

  if (appointment.user_id !== userId) {
    throw new Error('Unauthorized to cancel this appointment');
  }

  if (appointment.status === 'cancelled') {
    throw new Error('Appointment is already cancelled');
  }

  if (appointment.status === 'completed') {
    throw new Error('Cannot cancel completed appointment');
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
    throw new Error('Doctor not found');
  }

  if (!doctor.available) {
    throw new Error('Doctor is not available for appointments');
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
    throw new Error('Doctor not found');
  }

  if (!fullDoctor.available) {
    throw new Error('Doctor is not available');
  }

  const userQuery = `
    SELECT id, name, email, phone, image
    FROM users
    WHERE id = ?
  `;
  const [userRows] = await pool.query(userQuery, [userId]);
  const user = userRows[0];

  if (!user) {
    throw new Error('User not found');
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
