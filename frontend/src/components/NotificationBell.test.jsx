import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import axios from 'axios';

import NotificationBell from './NotificationBell';
import Appointment from '../pages/Appointment';
import { AppContext } from '../context/AppContext';
import { toLocalDateString } from '../utils/dates';

// 7.1: clicking a slot notification takes the patient to that doctor's booking
// page with the freed date attached, instead of leaving them to find the
// doctor themselves.
//
// The routing here is REAL — a MemoryRouter with real Routes — so the assertion
// is on the URL the app actually navigated to, not on a mocked navigate spy.
// A spy would pass just as happily if the route did not exist.

vi.mock('axios');
vi.mock('react-toastify', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const markRead = vi.fn();
const loadList = vi.fn();
const markAllRead = vi.fn();
let mockNotifications = [];

vi.mock('../hooks/useNotifications', () => ({
  useNotifications: () => ({
    unreadCount: mockNotifications.filter((n) => !n.read_at).length,
    notifications: mockNotifications,
    isLoading: false,
    loadList,
    markRead,
    markAllRead,
  }),
}));

const LocationProbe = () => {
  const location = useLocation();
  return (
    <span data-testid="url">{`${location.pathname}${location.search}`}</span>
  );
};

const renderBell = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <AppContext.Provider value={{ token: 'a-token' }}>
        <NotificationBell />
        <LocationProbe />
        <Routes>
          <Route path="/" element={<p>home</p>} />
          <Route path="/appointment/:docId" element={<p>booking page</p>} />
        </Routes>
      </AppContext.Provider>
    </MemoryRouter>,
  );

// Renders and opens the dropdown. Set `mockNotifications` before calling it —
// the hook is read at render.
const openBell = async () => {
  renderBell();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /notifications/i }));
  return user;
};

const slotNotice = (overrides = {}) => ({
  id: 1,
  type: 'waitlist_slot_open',
  read_at: null,
  created_at: new Date().toISOString(),
  payload: {
    doctor_id: 393,
    doctor_name: 'Dr. Placeholder Example',
    date: '2026-09-04',
  },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockNotifications = [];
});

describe('NotificationBell click-through', () => {
  it('navigates to the doctor with the freed date attached', async () => {
    mockNotifications = [slotNotice()];
    const user = await openBell();

    await user.click(screen.getByText(/has a slot free on/i));

    expect(screen.getByTestId('url')).toHaveTextContent(
      '/appointment/393?date=2026-09-04',
    );
    expect(screen.getByText('booking page')).toBeInTheDocument();
  });

  it('marks the notification read as well as navigating', async () => {
    mockNotifications = [slotNotice()];
    const user = await openBell();

    await user.click(screen.getByText(/has a slot free on/i));

    expect(markRead).toHaveBeenCalledWith(1);
  });

  it('does not mark an already-read notification again', async () => {
    mockNotifications = [slotNotice({ read_at: new Date().toISOString() })];
    const user = await openBell();

    await user.click(screen.getByText(/has a slot free on/i));

    expect(markRead).not.toHaveBeenCalled();
    // Still navigates — a read notification is still a useful link.
    expect(screen.getByTestId('url')).toHaveTextContent('/appointment/393');
  });

  it('drops a malformed date rather than putting it in the URL', async () => {
    mockNotifications = [
      slotNotice({ payload: { doctor_id: 393, date: 'tomorrow-ish' } }),
    ];
    const user = await openBell();

    await user.click(screen.getByText(/has a slot free on|A doctor you are/i));

    expect(screen.getByTestId('url')).toHaveTextContent('/appointment/393');
    expect(screen.getByTestId('url')).not.toHaveTextContent('tomorrow-ish');
  });

  it('stays put when the payload names no doctor', async () => {
    mockNotifications = [slotNotice({ payload: { date: '2026-09-04' } })];
    const user = await openBell();

    await user.click(screen.getByText(/has a slot free on|A doctor you are/i));

    expect(screen.getByTestId('url')).toHaveTextContent('/');
    expect(screen.getByText('home')).toBeInTheDocument();
    // The click still counts as reading it.
    expect(markRead).toHaveBeenCalledWith(1);
  });

  it('stays put for a notification type with no destination', async () => {
    mockNotifications = [
      slotNotice({
        type: 'something_else',
        payload: { message: 'Just so you know.', doctor_id: 393 },
      }),
    ];
    const user = await openBell();

    await user.click(screen.getByText('Just so you know.'));

    expect(screen.getByTestId('url')).toHaveTextContent('/');
    expect(screen.getByText('home')).toBeInTheDocument();
  });

  it('closes the dropdown on navigating', async () => {
    mockNotifications = [slotNotice()];
    const user = await openBell();

    expect(screen.getByText('Notifications')).toBeInTheDocument();
    await user.click(screen.getByText(/has a slot free on/i));

    expect(screen.queryByText('Notifications')).not.toBeInTheDocument();
  });
});

// The two halves of 7.1 wired together: the real booking page behind the real
// route, reached by clicking the real notification.
//
// Honest about what this adds. Renaming the query parameter on either side is
// caught by the unit suites too — checked by mutation, since both assert the
// literal `?date=`. What only this test covers is the pair actually composing:
// that the URL the bell builds is one the page's router matches and its
// `useSearchParams` can read, with no unit test's hand-written URL standing in
// between. It is the difference between two contracts that look compatible and
// two that are.
describe('bell to booking page, end to end', () => {
  it('lands on the booking page with the freed date already selected', async () => {
    const freedDate = (() => {
      const date = new Date();
      date.setDate(date.getDate() + 2);
      return toLocalDateString(date);
    })();

    axios.get.mockImplementation((url) => {
      if (String(url).includes('/api/appointments/available-slots')) {
        return Promise.resolve({
          data: { success: true, availableSlots: ['10:00 AM', '10:30 AM'] },
        });
      }
      return Promise.resolve({
        data: {
          success: true,
          doctor: {
            _id: '393',
            name: 'Dr. Placeholder Example',
            image: 'https://cdn.example.invalid/d.jpg',
            speciality: 'General physician',
            degree: 'MBBS',
            experience: '4 Years',
            about: 'Short profile text.',
            fees: 50,
            address: { line1: '1 Example Street', line2: 'Khalda, Amman' },
            available: true,
          },
        },
      });
    });

    mockNotifications = [
      slotNotice({ payload: { doctor_id: 393, date: freedDate } }),
    ];

    render(
      <MemoryRouter initialEntries={['/']}>
        <AppContext.Provider
          value={{
            token: 'a-token',
            backendUrl: 'http://api.example.invalid',
            currencySymbol: '$',
            doctors: [],
          }}
        >
          <NotificationBell />
          <Routes>
            <Route path="/" element={<p>home</p>} />
            <Route path="/appointment/:docId" element={<Appointment />} />
          </Routes>
        </AppContext.Provider>
      </MemoryRouter>,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /notifications/i }));
    await user.click(screen.getByText(/has a slot free on/i));

    await waitFor(() =>
      expect(screen.getByText('Booking slots')).toBeInTheDocument(),
    );

    // The page asked the server for the freed date, not for today.
    const askedFor = axios.get.mock.calls
      .filter(([url]) => String(url).includes('/available-slots'))
      .map(([, config]) => config?.params?.date);

    expect(askedFor).toContain(freedDate);
    expect(askedFor).not.toContain(toLocalDateString(new Date()));
    expect(screen.queryByText(/further ahead than/i)).not.toBeInTheDocument();
  });
});
