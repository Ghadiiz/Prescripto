import express from 'express';
import * as adminAuthController from '../controllers/adminAuthController.js';
import * as adminDoctorController from '../controllers/adminDoctorController.js';
import { adminAuthMiddleware } from '../middleware/adminAuthMiddleware.js';
import { upload } from '../middleware/upload.js';
import * as adminDashboardController from '../controllers/adminDashboardController.js';
import { authLimiter } from '../../middleware/rateLimiters.js';

const router = express.Router();

/**
 * @openapi
 * /api/admin/login:
 *   post:
 *     tags: [Admin]
 *     summary: Sign in as an administrator
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email, example: admin@example.invalid }
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
 *                   description: Bearer token for admin endpoints.
 *                   example: <an-opaque-access-token>
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/TooManyRequests' }
 */
router.post('/login', authLimiter, adminAuthController.login);

/**
 * @openapi
 * /api/admin/create-admin:
 *   post:
 *     tags: [Admin]
 *     summary: Create another administrator
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password]
 *             properties:
 *               name: { type: string, example: Example Admin }
 *               email: { type: string, format: email, example: admin2@example.invalid }
 *               password: { type: string, format: password, example: <a-strong-password> }
 *     responses:
 *       201: { description: Created. }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post(
  '/create-admin',
  adminAuthMiddleware,
  adminAuthController.createAdmin,
);

/**
 * @openapi
 * /api/admin/profile:
 *   get:
 *     tags: [Admin]
 *     summary: The signed-in administrator's own profile
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: The profile. }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/profile', adminAuthMiddleware, adminAuthController.getProfile);

/**
 * @openapi
 * /api/admin/profile:
 *   put:
 *     tags: [Admin]
 *     summary: Update the signed-in administrator's own profile
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string, example: Example Admin }
 *     responses:
 *       200: { description: Updated. }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.put('/profile', adminAuthMiddleware, adminAuthController.updateProfile);

/**
 * @openapi
 * /api/admin/change-password:
 *   put:
 *     tags: [Admin]
 *     summary: Change the signed-in administrator's own password
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword]
 *             properties:
 *               currentPassword: { type: string, format: password, example: <current-password> }
 *               newPassword: { type: string, format: password, example: <a-strong-password> }
 *     responses:
 *       200: { description: Changed. }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.put(
  '/change-password',
  adminAuthMiddleware,
  adminAuthController.changePassword,
);

/**
 * @openapi
 * /api/admin/doctor-options:
 *   get:
 *     tags: [Admin]
 *     summary: Allowed values for the doctor form
 *     description: Specialities, areas, languages and genders the doctor form accepts.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: The option lists. }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get(
  '/doctor-options',
  adminAuthMiddleware,
  adminDoctorController.getDoctorOptions,
);

/**
 * @openapi
 * /api/admin/doctors:
 *   get:
 *     tags: [Admin]
 *     summary: Every doctor, including those not accepting appointments
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: All doctors.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Doctor' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get(
  '/doctors',
  adminAuthMiddleware,
  adminDoctorController.getAllDoctors,
);

/**
 * @openapi
 * /api/admin/doctors:
 *   post:
 *     tags: [Admin]
 *     summary: Add a doctor
 *     description: Emails the doctor a link to set their password.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [name, email, speciality_id]
 *             properties:
 *               name: { type: string, example: Dr. Placeholder Example }
 *               email: { type: string, format: email, example: doctor@example.invalid }
 *               speciality_id: { type: integer, example: 3 }
 *               degree: { type: string, example: MBBS }
 *               experience: { type: string, example: 5 Years }
 *               fees: { type: number, example: 50 }
 *               image: { type: string, format: binary }
 *     responses:
 *       201: { description: Created. }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post(
  '/doctors',
  adminAuthMiddleware,
  upload.single('image'),
  adminDoctorController.addDoctor,
);

/**
 * @openapi
 * /api/admin/doctors/{id}:
 *   put:
 *     tags: [Admin]
 *     summary: Update a doctor
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         example: 12
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string, example: Dr. Placeholder Example }
 *               fees: { type: number, example: 60 }
 *               image: { type: string, format: binary }
 *     responses:
 *       200: { description: Updated. }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.put(
  '/doctors/:id',
  adminAuthMiddleware,
  upload.single('image'),
  adminDoctorController.updateDoctor,
);

/**
 * @openapi
 * /api/admin/doctors/{id}:
 *   delete:
 *     tags: [Admin]
 *     summary: Remove a doctor
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         example: 12
 *     responses:
 *       200: { description: Removed. }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.delete(
  '/doctors/:id',
  adminAuthMiddleware,
  adminDoctorController.deleteDoctor,
);

/**
 * @openapi
 * /api/admin/doctors/{id}/toggle:
 *   put:
 *     tags: [Admin]
 *     summary: Turn a doctor's availability on or off
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         example: 12
 *     responses:
 *       200: { description: Toggled. }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.put(
  '/doctors/:id/toggle',
  adminAuthMiddleware,
  adminDoctorController.toggleAvailability,
);

/**
 * @openapi
 * /api/admin/dashboard:
 *   get:
 *     tags: [Admin]
 *     summary: Clinic-wide totals
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Doctor, patient and appointment counts. }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get(
  '/dashboard',
  adminAuthMiddleware,
  adminDashboardController.getDashboardStats,
);

/**
 * @openapi
 * /api/admin/appointments:
 *   get:
 *     tags: [Admin]
 *     summary: Every appointment in the clinic
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: All appointments.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Appointment' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get(
  '/appointments',
  adminAuthMiddleware,
  adminDashboardController.getAllAppointments,
);

export default router;
