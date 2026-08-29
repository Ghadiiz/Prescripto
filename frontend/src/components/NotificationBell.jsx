import React, { useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { AppContext } from '../context/AppContext';
import { useNotifications } from '../hooks/useNotifications';
import { isCalendarDate } from '../utils/dates';

// The bell, its badge, and the dropdown.
//
// Inline SVG rather than an image: there is no bell in assets/, and a
// two-path icon does not justify adding a binary to the repo.

const BellIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

// Notifications are minutes-to-days old, so a relative time reads better than
// a date. Falls back to the date once that stops being useful.
const timeAgo = (iso) => {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

  return new Date(iso).toLocaleDateString();
};

// The payload is written by the server (5.4) and rendered here. React escapes
// it, and it only ever holds fields the patient is entitled to see.
const describe = (notification) => {
  const { type, payload } = notification;

  if (type === 'waitlist_slot_open') {
    const doctor = payload?.doctor_name ?? 'A doctor you are waiting on';
    const date = payload?.date
      ? new Date(`${payload.date}T00:00:00`).toLocaleDateString(undefined, {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        })
      : 'a date you asked about';

    return `${doctor} has a slot free on ${date}.`;
  }

  return payload?.message ?? 'You have a new notification.';
};

// Where a notification takes you, or null when it takes you nowhere.
//
// The payload is written by the server, but it is still DATA: it reaches here
// through a JSON column, and this is the boundary where it becomes a URL. So
// the doctor id is encoded and the date has to look like a calendar date —
// a malformed one drops the parameter rather than travelling into the address
// bar. Only `waitlist_slot_open` has a destination; anything else stays a
// plain message that marks itself read.
const targetFor = (notification) => {
  if (notification.type !== 'waitlist_slot_open') return null;

  const doctorId = notification.payload?.doctor_id;
  if (doctorId === undefined || doctorId === null || doctorId === '') {
    return null;
  }

  const path = `/appointment/${encodeURIComponent(doctorId)}`;
  const date = notification.payload?.date;

  return isCalendarDate(date)
    ? `${path}?date=${encodeURIComponent(date)}`
    : path;
};

const NotificationBell = () => {
  const { token } = useContext(AppContext);
  const navigate = useNavigate();
  const { unreadCount, notifications, isLoading, loadList, markRead, markAllRead } =
    useNotifications();

  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  // Clicking anywhere else closes the panel, which is what every dropdown in
  // every app does and what people expect.
  useEffect(() => {
    if (!isOpen) return undefined;

    const onPointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) setIsOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  if (!token) return null;

  const toggle = () => {
    const next = !isOpen;
    setIsOpen(next);
    // The list is fetched on open, not polled. See useNotifications.
    if (next) loadList();
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : 'Notifications'
        }
        aria-expanded={isOpen}
        className="relative flex items-center text-gray-600 hover:text-primary"
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-8 z-30 w-80 rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
            <p className="text-sm font-medium">Notifications</p>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-xs text-primary hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {isLoading && notifications.length === 0 && (
              <p className="px-3 py-4 text-xs text-gray-500">Loading…</p>
            )}

            {!isLoading && notifications.length === 0 && (
              <p className="px-3 py-4 text-xs text-gray-500">
                Nothing yet. If a doctor you are waiting on frees up a slot,
                you will hear about it here.
              </p>
            )}

            {notifications.map((notification) => (
              <button
                key={notification.id}
                type="button"
                onClick={() => {
                  if (!notification.read_at) markRead(notification.id);

                  // Marking read is fire-and-forget in the hook, so navigating
                  // straight away does not race it — the optimistic update has
                  // already happened locally.
                  const target = targetFor(notification);
                  if (target) {
                    setIsOpen(false);
                    navigate(target);
                  }
                }}
                className={`block w-full border-b border-gray-50 px-3 py-2.5 text-left last:border-b-0 hover:bg-gray-50 ${
                  notification.read_at ? 'opacity-60' : ''
                }`}
              >
                <div className="flex items-start gap-2">
                  {!notification.read_at && (
                    <span
                      className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary"
                      aria-label="Unread"
                    />
                  )}
                  <div className={notification.read_at ? 'pl-3.5' : ''}>
                    <p className="text-xs text-gray-800">{describe(notification)}</p>
                    <p className="mt-0.5 text-[11px] text-gray-400">
                      {timeAgo(notification.created_at)}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
