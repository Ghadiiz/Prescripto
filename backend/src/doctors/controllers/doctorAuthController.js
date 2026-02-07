import * as doctorAuthService from '../services/doctorAuthService.js';
import * as doctorAppointmentService from '../services/doctorAppointmentService.js';
import { getDB as pool } from '../../config/mysql.js';

export const login = async (req, res) => {
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
    console.error('Doctor login error:', error);
    res.status(401).json({
      success: false,
      message: error.message || 'Login failed',
    });
  }
};

export const getProfile = async (req, res) => {
  try {
    const doctorId = req.doctor.id;
    const profile = await doctorAuthService.getDoctorProfile(doctorId);

    res.status(200).json({
      success: true,
      doctor: profile,
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch profile',
    });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const doctorId = req.doctor.id;
    const updates = req.body;

    await doctorAuthService.updateDoctorProfile(doctorId, updates);

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update profile',
    });
  }
};

export const getAppointments = async (req, res) => {
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
    console.error('Get appointments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch appointments',
    });
  }
};

export const completeAppointment = async (req, res) => {
  try {
    const doctorId = req.doctor.id;
    const { id } = req.params;

    await doctorAppointmentService.completeAppointment(id, doctorId);

    res.status(200).json({
      success: true,
      message: 'Appointment marked as completed',
    });
  } catch (error) {
    console.error('Complete appointment error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to complete appointment',
    });
  }
};

export const cancelAppointment = async (req, res) => {
  try {
    const doctorId = req.doctor.id;
    const { id } = req.params;

    await doctorAppointmentService.cancelAppointment(id, doctorId);

    res.status(200).json({
      success: true,
      message: 'Appointment cancelled successfully',
    });
  } catch (error) {
    console.error('Cancel appointment error:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to cancel appointment',
    });
  }
};

export const getDashboard = async (req, res) => {
  try {
    const doctorId = req.doctor.id;

    const dashboardData =
      await doctorAppointmentService.getDoctorDashboard(doctorId);

    res.status(200).json({
      success: true,
      data: dashboardData,
    });
  } catch (error) {
    console.error('Get dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard data',
    });
  }
};

export const getAppointmentDetails = async (req, res) => {
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
        u.dob as patientDob,
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
    console.error('Get appointment details error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
};

export const updateAvailability = async (req, res) => {
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
    console.error('Update availability error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update availability',
    });
  }
};

export const setPassword = async (req, res) => {
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
    if (error.message === 'INVALID_TOKEN') {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired token',
      });
    }

    console.error('Set password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to set password',
    });
  }
};
