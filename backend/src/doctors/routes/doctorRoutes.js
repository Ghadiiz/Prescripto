import express from 'express';

import {
  getAllDoctors,
  getDoctorById,
  getAllSpecialities,
  searchDoctors,
} from '../controllers/doctorController.js';

const router = express.Router();

/**
 * @openapi
 * /api/doctors:
 *   get:
 *     tags: [Doctors]
 *     summary: List doctors currently accepting appointments
 *     responses:
 *       200:
 *         description: The public directory.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Doctor' }
 *       503: { $ref: '#/components/responses/ServiceUnavailable' }
 */
router.get('/', getAllDoctors);

/**
 * @openapi
 * /api/doctors/specialities:
 *   get:
 *     tags: [Doctors]
 *     summary: List the specialities doctors can be filtered by
 *     responses:
 *       200:
 *         description: All specialities.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Speciality' }
 */
router.get('/specialities', getAllSpecialities);

/**
 * @openapi
 * /api/doctors/search:
 *   get:
 *     tags: [Doctors]
 *     summary: Search the directory
 *     parameters:
 *       - in: query
 *         name: speciality
 *         schema: { type: string }
 *         example: Dermatologist
 *       - in: query
 *         name: area
 *         schema: { type: string }
 *         example: Khalda
 *       - in: query
 *         name: q
 *         description: Free-text match against the doctor's name.
 *         schema: { type: string }
 *         example: example
 *     responses:
 *       200:
 *         description: Matching doctors.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/Doctor' }
 */
router.get('/search', searchDoctors);

/**
 * @openapi
 * /api/doctors/{id}:
 *   get:
 *     tags: [Doctors]
 *     summary: Fetch one doctor
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         example: 12
 *     responses:
 *       200:
 *         description: The doctor.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Doctor' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:id', getDoctorById);

export default router;
