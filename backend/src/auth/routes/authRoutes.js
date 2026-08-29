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

/**
 * @openapi
 * /api/auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Create a patient account
 *     description: Sends a verification email. The account cannot sign in until verified.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password]
 *             properties:
 *               name: { type: string, example: Example Patient }
 *               email: { type: string, format: email, example: patient@example.invalid }
 *               password: { type: string, format: password, example: <a-strong-password> }
 *     responses:
 *       201: { description: Created. A verification email has been sent. }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       429: { $ref: '#/components/responses/TooManyRequests' }
 */
router.post('/register', registerLimiter, registerUser);
/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Sign in as a patient
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email, example: patient@example.invalid }
 *               password: { type: string, format: password, example: <your-password> }
 *     responses:
 *       200:
 *         description: Signed in.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 token:
 *                   type: string
 *                   description: Bearer token for patient endpoints.
 *                   example: <an-opaque-access-token>
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/TooManyRequests' }
 */
router.post('/login', authLimiter, loginUser);
/**
 * @openapi
 * /api/auth/profile:
 *   get:
 *     tags: [Auth]
 *     summary: The signed-in patient's own profile
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: The profile. }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/profile', authMiddleware, getUserProfile);
/**
 * @openapi
 * /api/auth/profile:
 *   put:
 *     tags: [Auth]
 *     summary: Update the signed-in patient's own profile
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string, example: Example Patient }
 *               phone: { type: string, example: '+000000000000' }
 *               gender: { type: string, example: Female }
 *               dob: { type: string, format: date, example: '1990-01-01' }
 *     responses:
 *       200: { description: Updated. }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.put('/profile', authMiddleware, updateUserProfile);
/**
 * @openapi
 * /api/auth/profile/image:
 *   post:
 *     tags: [Auth]
 *     summary: Upload a profile picture
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               image: { type: string, format: binary }
 *     responses:
 *       200: { description: Uploaded. }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post(
  '/profile/image',
  authMiddleware,
  upload.single('image'),
  uploadProfileImage,
);
/**
 * @openapi
 * /api/auth/verify-email:
 *   post:
 *     tags: [Auth]
 *     summary: Verify an address using the emailed token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token: { type: string, example: <token-from-the-email> }
 *     responses:
 *       200: { description: Verified. }
 *       400: { $ref: '#/components/responses/BadRequest' }
 */
router.post('/verify-email', verifyEmail);
/**
 * @openapi
 * /api/auth/resend-verification:
 *   post:
 *     tags: [Auth]
 *     summary: Send the verification email again
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email, example: patient@example.invalid }
 *     responses:
 *       200: { description: Accepted. }
 *       429: { $ref: '#/components/responses/TooManyRequests' }
 */
router.post('/resend-verification', authLimiter, resendVerificationEmail);
/**
 * @openapi
 * /api/auth/forgot-password:
 *   post:
 *     tags: [Auth]
 *     summary: Begin a password reset
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email, example: patient@example.invalid }
 *     responses:
 *       200: { description: Accepted. }
 *       429: { $ref: '#/components/responses/TooManyRequests' }
 */
router.post('/forgot-password', authLimiter, forgotPassword);
/**
 * @openapi
 * /api/auth/reset-password:
 *   post:
 *     tags: [Auth]
 *     summary: Complete a password reset
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
 *       200: { description: Password changed. }
 *       400: { $ref: '#/components/responses/BadRequest' }
 */
router.post('/reset-password', resetPassword);

export default router;
