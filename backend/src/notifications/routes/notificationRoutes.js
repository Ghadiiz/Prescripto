import express from 'express';

import * as notificationController from '../controllers/notificationController.js';
import { authMiddleware } from '../../auth/middleware/authMiddleware.js';

const router = express.Router();

// authMiddleware on every route: it verifies the JWT and rejects any role that
// is not `patient`, which matches the table — 006's notifications are
// patient-only and carry a foreign key to `users`.
router.use(authMiddleware);

// ORDER MATTERS. Both of these are single literal segments that would
// otherwise be captured by a `:id` route as an id. Declared first so they can
// never be shadowed by one added later.
router.get('/unread-count', notificationController.getUnreadCount);
router.patch('/read-all', notificationController.markAllRead);

router.get('/', notificationController.getNotifications);
router.patch('/:id/read', notificationController.markRead);

export default router;
