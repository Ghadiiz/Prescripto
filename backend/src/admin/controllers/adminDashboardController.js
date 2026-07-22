import * as adminDashboardService from '../services/adminDashboardService.js';

export const getDashboardStats = async (req, res, next) => {
  try {
    const stats = await adminDashboardService.getDashboardStats();

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    next(error);
  }
};

export const getAllAppointments = async (req, res, next) => {
  try {
    const appointments = await adminDashboardService.getAllAppointments();

    res.status(200).json({
      success: true,
      count: appointments.length,
      data: appointments,
    });
  } catch (error) {
    next(error);
  }
};
