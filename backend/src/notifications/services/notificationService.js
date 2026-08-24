import * as notificationModel from '../models/notificationModel.js';

// Thin by design: every ownership guarantee is in the model's WHERE clauses,
// so there is no check to perform here and no opportunity to forget one.
//
// `userId` always arrives from req.userId, which authMiddleware sets from the
// verified JWT — never from a body, a param, or a query string.

export const listNotifications = async (userId) => {
  const [notifications, unreadCount] = await Promise.all([
    notificationModel.findNotificationsForUser(userId),
    notificationModel.countUnreadForUser(userId),
  ]);

  return { notifications, unreadCount };
};

export const getUnreadCount = async (userId) =>
  notificationModel.countUnreadForUser(userId);

// Returns the fresh count rather than a success flag, because that is what the
// caller does next: update the badge.
//
// Deliberately does NOT report whether a row changed. "Wrong id", "someone
// else's id" and "already read" are indistinguishable to the caller, which is
// the point — a 404 on the first two would confirm which ids exist.
export const markRead = async (notificationId, userId) => {
  await notificationModel.markNotificationRead(notificationId, userId);

  return { unreadCount: await notificationModel.countUnreadForUser(userId) };
};

export const markAllRead = async (userId) => {
  const marked = await notificationModel.markAllNotificationsRead(userId);

  return {
    marked,
    unreadCount: await notificationModel.countUnreadForUser(userId),
  };
};
