import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import axios from 'axios';

import { AppContext } from '../context/AppContext';

// The bell's data.
//
// Two endpoints on purpose. The 30-second timer hits `/unread-count`, which is
// a count over an index and returns a single number; the list is fetched only
// when someone actually opens the bell. Polling the full list instead would
// serialise and transfer a patient's notification history 2,880 times a day per
// open tab to render one badge.

const POLL_INTERVAL_MS = 30_000;

export const useNotifications = () => {
  const { backendUrl, token } = useContext(AppContext);

  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const authHeader = useCallback(
    () => ({ headers: { Authorization: `Bearer ${token}` } }),
    [token],
  );

  // A 401 is already handled globally by the axios interceptor, which clears
  // the session and redirects. Anything else is not worth interrupting someone
  // for: a bell that silently fails to update beats a toast every 30 seconds
  // when the API is briefly down.
  const refreshCount = useCallback(async () => {
    if (!token) return;

    try {
      const { data } = await axios.get(
        `${backendUrl}/api/notifications/unread-count`,
        authHeader(),
      );
      if (data.success) setUnreadCount(data.unreadCount);
    } catch {
      /* leave the last known count in place */
    }
  }, [authHeader, backendUrl, token]);

  const loadList = useCallback(async () => {
    if (!token) return;

    setIsLoading(true);
    try {
      const { data } = await axios.get(`${backendUrl}/api/notifications`, authHeader());
      if (data.success) {
        setNotifications(data.notifications);
        setUnreadCount(data.unreadCount);
      }
    } catch {
      /* the panel shows whatever it last had */
    } finally {
      setIsLoading(false);
    }
  }, [authHeader, backendUrl, token]);

  const markRead = useCallback(
    async (id) => {
      // Optimistic: the badge and the row update immediately, and the server's
      // count replaces the guess a moment later.
      setNotifications((current) =>
        current.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)),
      );
      setUnreadCount((current) => Math.max(0, current - 1));

      try {
        const { data } = await axios.patch(
          `${backendUrl}/api/notifications/${id}/read`,
          {},
          authHeader(),
        );
        if (data.success) setUnreadCount(data.unreadCount);
      } catch {
        refreshCount();
      }
    },
    [authHeader, backendUrl, refreshCount],
  );

  const markAllRead = useCallback(async () => {
    setNotifications((current) =>
      current.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })),
    );
    setUnreadCount(0);

    try {
      const { data } = await axios.patch(
        `${backendUrl}/api/notifications/read-all`,
        {},
        authHeader(),
      );
      if (data.success) setUnreadCount(data.unreadCount);
    } catch {
      refreshCount();
    }
  }, [authHeader, backendUrl, refreshCount]);

  const timerRef = useRef(null);

  useEffect(() => {
    if (!token) {
      setUnreadCount(0);
      setNotifications([]);
      return undefined;
    }

    const stop = () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };

    const start = () => {
      stop();
      timerRef.current = setInterval(refreshCount, POLL_INTERVAL_MS);
    };

    // A hidden tab polls nobody's benefit — the badge is not on screen. Every
    // background tab left open would otherwise keep asking forever.
    const onVisibilityChange = () => {
      if (document.hidden) {
        stop();
      } else {
        refreshCount();
        start();
      }
    };

    refreshCount();
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refreshCount, token]);

  return {
    unreadCount,
    notifications,
    isLoading,
    loadList,
    markRead,
    markAllRead,
    POLL_INTERVAL_MS,
  };
};

export default useNotifications;
