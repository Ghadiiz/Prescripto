import * as doctorAuthService from '../services/doctorAuthService.js';
import * as doctorAppointmentService from '../services/doctorAppointmentService.js';
import { getDB as pool } from '../../config/mysql.js';

export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required',
      });
    }

    const { token, doctorId } = await doctorAuthService.loginDoctor(
      email,
      password,
    );

    res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      doctorId,
    });
  } catch (error) {
    next(error);
  }
};

export const getProfile = async (req, res, next) => {
  try {
    const doctorId = req.doctor.id;
    const profile = await doctorAuthService.getDoctorProfile(doctorId);

    res.status(200).json({
      success: true,
      doctor: profile,
    });
  } catch (error) {
    next(error);
  }
};

export const updateProfile = async (req, res, next) => {
  try {
    const doctorId = req.doctor.id;
    const updates = req.body;

    await doctorAuthService.updateDoctorProfile(doctorId, updates);

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
    });
  } catch (error) {
    next(error);
  }
};

export const getAppointments = async (req, res, next) => {
  try {
    const doctorId = req.doctor.id;
    const { status } = req.query;

    const appointments = await doctorAppointmentService.getDoctorAppointments(
      doctorId,
      status,
    );

    res.status(200).json({
      success: true,
      count: appointments.length,
      appointments,
    });
  } catch (error) {
    next(error);
  }
};

export const completeAppointment = async (req, res, next) => {
  try {
    const doctorId = req.doctor.id;
    const { id } = req.params;

    await doctorAppointmentService.completeAppointment(id, doctorId);

    res.status(200).json({
      success: true,
      message: 'Appointment marked as completed',
    });
  } catch (error) {
    next(error);
  }
};

export const cancelAppointment = async (req, res, next) => {
  try {
    const doctorId = req.doctor.id;
    const { id } = req.params;

    await doctorAppointmentService.cancelAppointment(id, doctorId);

    res.status(200).json({
      success: true,
      message: 'Appointment cancelled successfully',
    });
  } catch (error) {
    next(error);
  }
};

export const getDashboard = async (req, res, next) => {
  try {
    const doctorId = req.doctor.id;

    const dashboardData =
      await doctorAppointmentService.getDoctorDashboard(doctorId);

    res.status(200).json({
      success: true,
      data: dashboardData,
    });
  } catch (error) {
    next(error);
  }
};

export const getAppointmentDetails = async (req, res, next) => {
  try {
    const appointmentId = req.params.id;
    const doctorId = req.doctor.id;

    const query = `
      SELECT 
        a.id,
        a.user_id as userId,
        a.doctor_id as doctorId,
        a.appointment_date as appointmentDate,
        a.appointment_time as appointmentTime,
        a.status,
        u.name as patientName,
        u.email as patientEmail,
        u.image as patientImage,
        u.phone as patientPhone,
        u.address_line1 as patientAddressLine1,
        u.address_line2 as patientAddressLine2,
        u.gender as patientGender,
        DATE_FORMAT(u.dob, '%Y-%m-%d') as patientDob,
        d.name as doctorName,
        s.name as speciality,
        d.degree,
        d.experience,
        d.fees as amount
      FROM appointments a
      JOIN users u ON a.user_id = u.id
      JOIN doctors d ON a.doctor_id = d.id
      JOIN specialities s ON d.speciality_id = s.id
      WHERE a.id = ? AND a.doctor_id = ?
    `;

    const db = pool();
    const [appointments] = await db.query(query, [appointmentId, doctorId]);

    if (appointments.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found or unauthorized',
      });
    }

    res.json({
      success: true,
      appointment: appointments[0],
    });
  } catch (error) {
    next(error);
  }
};

export const updateAvailability = async (req, res, next) => {
  try {
    const doctorId = req.doctor.id;
    const { available } = req.body;

    if (typeof available !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'Available must be a boolean value (true or false)',
      });
    }

    await doctorAuthService.toggleDoctorAvailability(doctorId, available);

    res.status(200).json({
      success: true,
      message: `Availability ${available ? 'enabled' : 'disabled'} successfully`,
    });
  } catch (error) {
    next(error);
  }
};

export const setPassword = async (req, res, next) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        success: false,
        message: 'Token and password are required',
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long',
      });
    }

    await doctorAuthService.setDoctorPassword(token, password);

    res.status(200).json({
      success: true,
      message: 'Password set successfully! You can now login.',
    });
  } catch (error) {
    next(error);
  }
};
