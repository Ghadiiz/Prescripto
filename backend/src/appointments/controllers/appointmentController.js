import * as appointmentService from '../services/appointmentService.js';

const bookAppointment = async (req, res) => {
  try {
    const { doctorId, slotDate, slotTime } = req.body;
    const userId = req.userId;

    if (!doctorId || !slotDate || !slotTime) {
      return res.status(400).json({
        success: false,
        message: 'Doctor ID, appointment date, and time are required',
      });
    }

    let appointmentDate = slotDate;

    if (slotDate.includes(',')) {
      const dateParts = slotDate.split(', ');
      const day = dateParts[0];
      const month = dateParts[1];
      const year = dateParts[2];

      const monthNames = [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
      ];
      const monthIndex = monthNames.indexOf(month) + 1;

      appointmentDate = `${year}-${monthIndex.toString().padStart(2, '0')}-${day.padStart(2, '0')}`;
    }

    const appointment = await appointmentService.bookAppointment(
      userId,
      doctorId,
      appointmentDate,
      slotTime,
    );

    res.status(201).json({
      success: true,
      message: 'Appointment booked successfully',
      appointment,
    });
  } catch (error) {
    console.error('Book appointment error:', error);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const getMyAppointments = async (req, res) => {
  try {
    const userId = req.userId;

    const appointments = await appointmentService.getUserAppointments(userId);

    res.status(200).json({
      success: true,
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

const getAppointmentById = async (req, res) => {
  try {
    const appointmentId = req.params.id;
    const userId = req.userId;

    const appointment = await appointmentService.getAppointmentDetails(
      appointmentId,
      userId,
    );

    res.status(200).json({
      success: true,
      appointment,
    });
  } catch (error) {
    console.error('Get appointment error:', error);

    if (error.message === 'Appointment not found') {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }

    if (error.message === 'Unauthorized to view this appointment') {
      return res.status(403).json({
        success: false,
        message: error.message,
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to fetch appointment details',
    });
  }
};

const cancelAppointment = async (req, res) => {
  try {
    const appointmentId = req.params.id;
    const userId = req.userId;
    const { cancellationReason } = req.body;

    const result = await appointmentService.cancelAppointment(
      appointmentId,
      userId,
      cancellationReason,
    );

    res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    console.error('Cancel appointment error:', error);

    if (error.message === 'Appointment not found') {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }

    if (error.message === 'Unauthorized to cancel this appointment') {
      return res.status(403).json({
        success: false,
        message: error.message,
      });
    }

    if (
      error.message === 'Appointment is already cancelled' ||
      error.message === 'Cannot cancel completed appointment'
    ) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to cancel appointment',
    });
  }
};

const getAvailableSlots = async (req, res) => {
  try {
    const { doctorId, date } = req.query;

    if (!doctorId || !date) {
      return res.status(400).json({
        success: false,
        message: 'Doctor ID and date are required',
      });
    }

    const availableSlots = await appointmentService.getAvailableSlots(
      doctorId,
      date,
    );

    res.status(200).json({
      success: true,
      availableSlots,
    });
  } catch (error) {
    console.error('Get available slots error:', error);
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const getCheckoutPreview = async (req, res) => {
  try {
    const userId = req.userId;
    const { doctorId, appointmentDate, appointmentTime } = req.body;

    if (!doctorId || !appointmentDate || !appointmentTime) {
      return res.status(400).json({
        success: false,
        message: 'Doctor ID, appointment date, and time are required',
      });
    }

    const preview = await appointmentService.createCheckoutPreview(
      userId,
      doctorId,
      appointmentDate,
      appointmentTime,
    );

    res.status(200).json({
      success: true,
      message: 'Checkout preview retrieved successfully',
      data: preview,
    });
  } catch (error) {
    console.error('Error getting checkout preview:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get checkout preview',
    });
  }
};

export {
  bookAppointment,
  getMyAppointments,
  getAppointmentById,
  cancelAppointment,
  getAvailableSlots,
  getCheckoutPreview,
};
