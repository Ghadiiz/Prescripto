import express from 'express';

import {
  getAllDoctors,
  getDoctorById,
  getAllSpecialities,
  searchDoctors,
} from '../controllers/doctorController.js';

const router = express.Router();

router.get('/', getAllDoctors);
router.get('/specialities', getAllSpecialities);
router.get('/search', searchDoctors);
router.get('/:id', getDoctorById);

export default router;
