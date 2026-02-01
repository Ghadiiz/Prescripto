import express from 'express';
import * as appointmentController from '../controllers/appointmentController.js';
import { authMiddleware } from '../../auth/middleware/authMiddleware.js';

const router = express.Router();

router.get('/available-slots', appointmentController.getAvailableSlots);
router.post(
  '/checkout/preview',
  authMiddleware,
  appointmentController.getCheckoutPreview,
);

router.post('/', authMiddleware, appointmentController.bookAppointment);
router.get(
  '/my-appointments',
  authMiddleware,
  appointmentController.getMyAppointments,
);
router.get('/:id', authMiddleware, appointmentController.getAppointmentById);
router.put(
  '/:id/cancel',
  authMiddleware,
  appointmentController.cancelAppointment,
);

export default router;
