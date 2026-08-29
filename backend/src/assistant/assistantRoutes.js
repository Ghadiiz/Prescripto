import express from 'express';

import * as assistantController from './assistantController.js';
import { authMiddleware } from '../auth/middleware/authMiddleware.js';

const router = express.Router();

// authMiddleware is the whole gate: it verifies the JWT signature and rejects
// any role that is not `patient`. The controller builds ctx from what it sets,
// and from nothing else. There is deliberately no unauthenticated route here —
// every tool the assistant can reach is scoped to an identity.
/**
 * @openapi
 * /api/assistant/chat:
 *   post:
 *     tags: [Assistant]
 *     summary: Ask the assistant a question
 *     description: >
 *       Requires a patient token and answers with a `text/event-stream`. The
 *       assistant answers about doctors, availability and the caller's own
 *       appointments; it is read-only except for joining a waitlist, which
 *       requires an explicit confirmation in the conversation. Usage is rate
 *       limited per patient.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message:
 *                 type: string
 *                 example: Which dermatologists do you have in Khalda?
 *     responses:
 *       200:
 *         description: A server-sent event stream.
 *         content:
 *           text/event-stream:
 *             schema: { type: string }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/TooManyRequests' }
 *       503: { $ref: '#/components/responses/ServiceUnavailable' }
 */
router.post('/chat', authMiddleware, assistantController.chat);

export default router;
