import express from 'express';
import {
  registerUser,
  loginUser,
  getUserProfile,
  updateUserProfile,
  uploadProfileImage,
  verifyEmail,
  resendVerificationEmail,
  forgotPassword,
  resetPassword,
} from '../controllers/authController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { authLimiter, registerLimiter } from '../../middleware/rateLimiters.js';
import { upload } from '../../admin/middleware/upload.js';

const router = express.Router();

router.post('/register', registerLimiter, registerUser);
router.post('/login', authLimiter, loginUser);
router.get('/profile', authMiddleware, getUserProfile);
router.put('/profile', authMiddleware, updateUserProfile);
router.post(
  '/profile/image',
  authMiddleware,
  upload.single('image'),
  uploadProfileImage,
);
router.post('/verify-email', verifyEmail);
router.post('/resend-verification', authLimiter, resendVerificationEmail);
router.post('/forgot-password', authLimiter, forgotPassword);
router.post('/reset-password', resetPassword);

export default router;
