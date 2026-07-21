import express from 'express';
import * as doctorAuthController from '../controllers/doctorAuthController.js';
import { authenticateDoctor } from '../middleware/doctorAuthMiddleware.js';
import { authLimiter } from '../../middleware/rateLimiters.js';
import {
  login,
  getProfile,
  updateProfile,
  getAppointments,
  completeAppointment,
  cancelAppointment,
  getDashboard,
  getAppointmentDetails,
  updateAvailability,
  setPassword,
} from '../controllers/doctorAuthController.js';

const router = express.Router();

router.post('/login', authLimiter, doctorAuthController.login);
router.post('/set-password', setPassword);

router.get('/profile', authenticateDoctor, getProfile);
router.put('/profile', authenticateDoctor, updateProfile);

router.get('/dashboard', authenticateDoctor, getDashboard);

router.get('/appointments', authenticateDoctor, getAppointments);
router.put(
  '/appointments/:id/complete',
  authenticateDoctor,
  completeAppointment,
);
router.put('/appointments/:id/cancel', authenticateDoctor, cancelAppointment);
router.get('/appointments/:id', authenticateDoctor, getAppointmentDetails);
router.put('/availability', authenticateDoctor, updateAvailability);

export default router;
