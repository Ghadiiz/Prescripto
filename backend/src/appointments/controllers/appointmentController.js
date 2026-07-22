import * as appointmentService from '../services/appointmentService.js';

const bookAppointment = async (req, res, next) => {
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
    next(error);
  }
};

const getMyAppointments = async (req, res, next) => {
  try {
    const userId = req.userId;

    const appointments = await appointmentService.getUserAppointments(userId);

    res.status(200).json({
      success: true,
      appointments,
    });
  } catch (error) {
    next(error);
  }
};

const getAppointmentById = async (req, res, next) => {
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
    next(error);
  }
};

const cancelAppointment = async (req, res, next) => {
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
    next(error);
  }
};

const getAvailableSlots = async (req, res, next) => {
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
    next(error);
  }
};

const getCheckoutPreview = async (req, res, next) => {
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
    next(error);
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
