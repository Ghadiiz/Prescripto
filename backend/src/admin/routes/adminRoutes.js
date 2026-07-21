import express from 'express';
import * as adminAuthController from '../controllers/adminAuthController.js';
import * as adminDoctorController from '../controllers/adminDoctorController.js';
import { adminAuthMiddleware } from '../middleware/adminAuthMiddleware.js';
import { upload } from '../middleware/upload.js';
import * as adminDashboardController from '../controllers/adminDashboardController.js';
import { authLimiter } from '../../middleware/rateLimiters.js';

const router = express.Router();

router.post('/login', authLimiter, adminAuthController.login);

router.post(
  '/create-admin',
  adminAuthMiddleware,
  adminAuthController.createAdmin,
);

router.get('/profile', adminAuthMiddleware, adminAuthController.getProfile);

router.put('/profile', adminAuthMiddleware, adminAuthController.updateProfile);

router.put(
  '/change-password',
  adminAuthMiddleware,
  adminAuthController.changePassword,
);

router.get(
  '/doctors',
  adminAuthMiddleware,
  adminDoctorController.getAllDoctors,
);

router.post(
  '/doctors',
  adminAuthMiddleware,
  upload.single('image'),
  adminDoctorController.addDoctor,
);

router.put(
  '/doctors/:id',
  adminAuthMiddleware,
  upload.single('image'),
  adminDoctorController.updateDoctor,
);

router.delete(
  '/doctors/:id',
  adminAuthMiddleware,
  adminDoctorController.deleteDoctor,
);

router.put(
  '/doctors/:id/toggle',
  adminAuthMiddleware,
  adminDoctorController.toggleAvailability,
);

router.get(
  '/dashboard',
  adminAuthMiddleware,
  adminDashboardController.getDashboardStats,
);

router.get(
  '/appointments',
  adminAuthMiddleware,
  adminDashboardController.getAllAppointments,
);

export default router;
