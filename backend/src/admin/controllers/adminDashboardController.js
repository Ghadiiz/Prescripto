import * as adminDashboardService from '../services/adminDashboardService.js';

export const getDashboardStats = async (req, res) => {
  try {
    const stats = await adminDashboardService.getDashboardStats();

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard statistics',
    });
  }
};

export const getAllAppointments = async (req, res) => {
  try {
    const appointments = await adminDashboardService.getAllAppointments();

    res.status(200).json({
      success: true,
      count: appointments.length,
      data: appointments,
    });
  } catch (error) {
    console.error('Error fetching appointments:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch appointments',
    });
  }
};
