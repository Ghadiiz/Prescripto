import express from 'express';
import * as doctorAuthController from '../controllers/doctorAuthController.js';
import { authenticateDoctor } from '../middleware/doctorAuthMiddleware.js';
import { authLimiter } from '../../middleware/rateLimiters.js';
import {
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

/**
 * @openapi
 * /api/doctor/login:
 *   post:
 *     tags: [Doctor panel]
 *     summary: Sign in as a doctor
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email, example: doctor@example.invalid }
 *               password: { type: string, format: password, example: <your-password> }
 *     responses:
 *       200:
 *         description: Signed in.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                   description: Bearer token for doctor-panel endpoints.
 *                   example: <an-opaque-access-token>
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { $ref: '#/components/responses/TooManyRequests' }
 */
router.post('/login', authLimiter, doctorAuthController.login);
/**
 * @openapi
 * /api/doctor/set-password:
 *   post:
 *     tags: [Doctor panel]
 *     summary: Set the initial password using the emailed token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, password]
 *             properties:
 *               token: { type: string, example: <token-from-the-email> }
 *               password: { type: string, format: password, example: <a-strong-password> }
 *     responses:
 *       200: { description: Password set. }
 *       400: { $ref: '#/components/responses/BadRequest' }
 */
router.post('/set-password', setPassword);

/**
 * @openapi
 * /api/doctor/profile:
 *   get:
 *     tags: [Doctor panel]
 *     summary: The signed-in doctor's own profile
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: The profile.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Doctor' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/profile', authenticateDoctor, getProfile);
/**
 * @openapi
 * /api/doctor/profile:
 *   put:
 *     tags: [Doctor panel]
 *     summary: Update the signed-in doctor's own profile
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               about: { type: string, example: Short profile text. }
 *               fees: { type: number, example: 50 }
 *               address_line1: { type: string, example: 1 Example Street }
 *               address_line2: { type: string, example: Khalda Amman }
 *     responses:
 *       200: { description: Updated. }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.put('/profile', authenticateDoctor, updateProfile);

/**
 * @openapi
 * /api/doctor/dashboard:
 *   get:
 *     tags: [Doctor panel]
 *     summary: Totals for the signed-in doctor's own practice
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Earnings, appointment and patient counts, and recent appointments.
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/dashboard', authenticateDoctor, getDashboard);

/**
 * @openapi
 * /api/doctor/appointments:
 *   get:
 *     tags: [Doctor panel]
 *     summary: The signed-in doctor's own appointments
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, completed, cancelled] }
 *     responses:
 *       200:
 *         description: Their appointments.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Appointment' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/appointments', authenticateDoctor, getAppointments);
/**
 * @openapi
 * /api/doctor/appointments/{id}/complete:
 *   put:
 *     tags: [Doctor panel]
 *     summary: Mark one of the doctor's own appointments completed
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         example: 481
 *     responses:
 *       200: { description: Completed. }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.put(
  '/appointments/:id/complete',
  authenticateDoctor,
  completeAppointment,
);
/**
 * @openapi
 * /api/doctor/appointments/{id}/cancel:
 *   put:
 *     tags: [Doctor panel]
 *     summary: Cancel one of the doctor's own appointments
 *     description: Frees the slot. Patients waiting for that day may be notified.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         example: 481
 *     responses:
 *       200: { description: Cancelled. }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.put('/appointments/:id/cancel', authenticateDoctor, cancelAppointment);
/**
 * @openapi
 * /api/doctor/appointments/{id}:
 *   get:
 *     tags: [Doctor panel]
 *     summary: One of the doctor's own appointments
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         example: 481
 *     responses:
 *       200:
 *         description: The appointment.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Appointment' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/appointments/:id', authenticateDoctor, getAppointmentDetails);
/**
 * @openapi
 * /api/doctor/availability:
 *   put:
 *     tags: [Doctor panel]
 *     summary: Turn accepting-appointments on or off
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [available]
 *             properties:
 *               available: { type: boolean, example: true }
 *     responses:
 *       200: { description: Updated. }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.put('/availability', authenticateDoctor, updateAvailability);

export default router;
