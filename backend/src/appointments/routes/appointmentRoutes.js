import express from 'express';
import * as appointmentController from '../controllers/appointmentController.js';
import { authMiddleware } from '../../auth/middleware/authMiddleware.js';

const router = express.Router();

/**
 * @openapi
 * /api/appointments/available-slots:
 *   get:
 *     tags: [Appointments]
 *     summary: Free half-hour slots for a doctor on a date
 *     description: >
 *       Consulting hours are the same for every doctor. The response is a
 *       snapshot taken when the request was served, not a reservation — a slot
 *       can be taken by someone else before you book it.
 *     parameters:
 *       - in: query
 *         name: doctorId
 *         required: true
 *         schema: { type: integer }
 *         example: 12
 *       - in: query
 *         name: date
 *         required: true
 *         schema: { type: string, format: date }
 *         example: '2031-03-04'
 *     responses:
 *       200:
 *         description: The free slots.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { type: string, example: '10:30 AM' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/available-slots', appointmentController.getAvailableSlots);
/**
 * @openapi
 * /api/appointments/checkout/preview:
 *   post:
 *     tags: [Appointments]
 *     summary: What booking this slot would cost
 *     description: Writes nothing.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [doctorId, date, time]
 *             properties:
 *               doctorId: { type: integer, example: 12 }
 *               date: { type: string, format: date, example: '2031-03-04' }
 *               time: { type: string, example: '10:30:00' }
 *     responses:
 *       200: { description: The preview. }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post(
  '/checkout/preview',
  authMiddleware,
  appointmentController.getCheckoutPreview,
);

/**
 * @openapi
 * /api/appointments:
 *   post:
 *     tags: [Appointments]
 *     summary: Book an appointment
 *     description: >
 *       The slot is claimed atomically, so two people booking the same slot
 *       resolve to one success and one 409.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [doctorId, date, time]
 *             properties:
 *               doctorId: { type: integer, example: 12 }
 *               date: { type: string, format: date, example: '2031-03-04' }
 *               time: { type: string, example: '10:30:00' }
 *     responses:
 *       201:
 *         description: Booked.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Appointment' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       409:
 *         description: That slot was taken first.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.post('/', authMiddleware, appointmentController.bookAppointment);
/**
 * @openapi
 * /api/appointments/my-appointments:
 *   get:
 *     tags: [Appointments]
 *     summary: The signed-in patient's own appointments
 *     security: [{ bearerAuth: [] }]
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
router.get(
  '/my-appointments',
  authMiddleware,
  appointmentController.getMyAppointments,
);
/**
 * @openapi
 * /api/appointments/{id}:
 *   get:
 *     tags: [Appointments]
 *     summary: One of the signed-in patient's own appointments
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
router.get('/:id', authMiddleware, appointmentController.getAppointmentById);
/**
 * @openapi
 * /api/appointments/{id}/cancel:
 *   put:
 *     tags: [Appointments]
 *     summary: Cancel one of the signed-in patient's own appointments
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         example: 481
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason: { type: string, example: Changed my mind }
 *     responses:
 *       200: { description: Cancelled. }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.put(
  '/:id/cancel',
  authMiddleware,
  appointmentController.cancelAppointment,
);

export default router;
