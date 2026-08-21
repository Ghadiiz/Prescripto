import express from 'express';

import * as assistantController from './assistantController.js';
import { authMiddleware } from '../auth/middleware/authMiddleware.js';

const router = express.Router();

// authMiddleware is the whole gate: it verifies the JWT signature and rejects
// any role that is not `patient`. The controller builds ctx from what it sets,
// and from nothing else. There is deliberately no unauthenticated route here —
// every tool the assistant can reach is scoped to an identity.
router.post('/chat', authMiddleware, assistantController.chat);

export default router;
