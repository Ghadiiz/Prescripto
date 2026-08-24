import * as notificationService from '../services/notificationService.js';

// HTTP only. `req.userId` is set by authMiddleware from the verified JWT and is
// the sole source of identity here — nothing reads a user id from the body,
// the params or the query string.

export const getNotifications = async (req, res, next) => {
  try {
    const result = await notificationService.listNotifications(req.userId);

    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

// What the bell's 30-second timer hits. Kept separate from the list so a poll
// costs a count over an index rather than serialising history nobody opened.
export const getUnreadCount = async (req, res, next) => {
  try {
    const unreadCount = await notificationService.getUnreadCount(req.userId);

    res.json({ success: true, unreadCount });
  } catch (error) {
    next(error);
  }
};

export const markRead = async (req, res, next) => {
  try {
    const notificationId = Number(req.params.id);

    if (!Number.isInteger(notificationId) || notificationId <= 0) {
      return res
        .status(400)
        .json({ success: false, message: 'A valid notification id is required.' });
    }

    // Always 200, whatever happened. A wrong id, another patient's id and an
    // already-read one are deliberately indistinguishable; the count is what
    // the caller needs either way.
    const result = await notificationService.markRead(notificationId, req.userId);

    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

export const markAllRead = async (req, res, next) => {
  try {
    const result = await notificationService.markAllRead(req.userId);

    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};
