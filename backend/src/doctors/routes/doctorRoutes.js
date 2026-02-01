import express from 'express';
import {
  getAllDoctors,
  getDoctorById,
  getAllSpecialities,
} from '../controllers/doctorController.js';

const router = express.Router();

router.get('/', getAllDoctors);
router.get('/specialities', getAllSpecialities);
router.get('/:id', getDoctorById);

export default router;
