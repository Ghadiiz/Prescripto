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
/**
 * @openapi
 * /api/notifications/unread-count:
 *   get:
 *     tags: [Notifications]
 *     summary: How many unread notifications the signed-in patient has
 *     description: Count only — cheap enough to poll.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: The count.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 unreadCount: { type: integer, example: 2 }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/unread-count', notificationController.getUnreadCount);
/**
 * @openapi
 * /api/notifications/read-all:
 *   patch:
 *     tags: [Notifications]
 *     summary: Mark every notification read
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: The refreshed count.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 marked: { type: integer, example: 2 }
 *                 unreadCount: { type: integer, example: 0 }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.patch('/read-all', notificationController.markAllRead);

/**
 * @openapi
 * /api/notifications:
 *   get:
 *     tags: [Notifications]
 *     summary: The signed-in patient's own notifications
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Their notifications and unread count.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 notifications:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/Notification' }
 *                 unreadCount: { type: integer, example: 2 }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/', notificationController.getNotifications);
/**
 * @openapi
 * /api/notifications/{id}/read:
 *   patch:
 *     tags: [Notifications]
 *     summary: Mark one notification read
 *     description: >
 *       Always answers 200 with the caller's refreshed unread count. An id that
 *       does not exist, one belonging to someone else, and one already read are
 *       not distinguished.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *         example: 91
 *     responses:
 *       200:
 *         description: The refreshed count.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 unreadCount: { type: integer, example: 1 }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.patch('/:id/read', notificationController.markRead);

export default router;
