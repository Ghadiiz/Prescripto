import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import axios from 'axios';

import Appointment from './Appointment';
import { AppContext } from '../context/AppContext';
import { toLocalDateString } from '../utils/dates';

// 7.1: the booking page has to open on the date a notification named, say so
// when it cannot, and stop offering a picker for a doctor who is not
// accepting.
//
// Assertions are on OBSERVABLE output — which date the page asks the server
// for, and what it renders — rather than on state or Tailwind classes. The
// exception is `aria-current="date"`, which 7.1 added precisely so the visible
// highlight has a name.

vi.mock('axios');
vi.mock('react-toastify', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const BACKEND = 'http://api.example.invalid';
const DOC_ID = '393';

const DOCTOR = {
  _id: DOC_ID,
  name: 'Dr. Placeholder Example',
  image: 'https://cdn.example.invalid/d.jpg',
  speciality: 'General physician',
  degree: 'MBBS',
  experience: '4 Years',
  about: 'Short profile text.',
  fees: 50,
  address: { line1: '1 Example Street', line2: 'Khalda, Amman' },
  available: true,
};

const SLOTS = ['10:00 AM', '10:30 AM', '11:00 AM'];

const mockApi = (doctor = DOCTOR) => {
  axios.get.mockImplementation((url) => {
    if (String(url).includes('/api/appointments/available-slots')) {
      return Promise.resolve({
        data: { success: true, availableSlots: SLOTS },
      });
    }
    return Promise.resolve({ data: { success: true, doctor } });
  });
};

const renderAt = (search = '') =>
  render(
    <MemoryRouter initialEntries={[`/appointment/${DOC_ID}${search}`]}>
      <AppContext.Provider
        value={{
          currencySymbol: '$',
          backendUrl: BACKEND,
          token: 'a-token',
          doctors: [],
        }}
      >
        <Routes>
          <Route path="/appointment/:docId" element={<Appointment />} />
        </Routes>
      </AppContext.Provider>
    </MemoryRouter>,
  );

// The date the page asked the server about — the least brittle signal for
// "which day is selected", and the one that actually matters.
const requestedSlotDates = () =>
  axios.get.mock.calls
    .filter(([url]) => String(url).includes('/available-slots'))
    .map(([, config]) => config?.params?.date);

const daysFromToday = (n) => {
  const date = new Date();
  date.setDate(date.getDate() + n);
  return toLocalDateString(date);
};

beforeEach(() => {
  vi.clearAllMocks();
  mockApi();
});

afterEach(() => {
  // `vi.stubEnv` rather than `process.env` directly: these files are linted
  // with browser globals, where `process` does not exist.
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('Appointment date selection', () => {
  it('opens on today when no date is requested', async () => {
    renderAt();

    await waitFor(() => expect(requestedSlotDates()).toContain(daysFromToday(0)));
  });

  it('opens on the requested date when it is inside the window', async () => {
    const wanted = daysFromToday(3);
    renderAt(`?date=${wanted}`);

    await waitFor(() => expect(requestedSlotDates()).toContain(wanted));
    // And never asked about the default day, so this is a real preselection
    // rather than a second render that happened to land there.
    expect(requestedSlotDates()).not.toContain(daysFromToday(0));
  });

  it('marks the requested day as the current one', async () => {
    const wanted = daysFromToday(3);
    renderAt(`?date=${wanted}`);

    await waitFor(() => expect(screen.getByText('Booking slots')).toBeInTheDocument());

    const current = document.querySelectorAll('[aria-current="date"]');
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain(String(new Date(`${wanted}T00:00:00`).getDate()));
  });

  it('falls back to today and says so when the date is beyond the window', async () => {
    // Past 30 days now: 7.4 widened the strip to match the waitlist window, so
    // the old fixture date (20 days out) is inside it and would preselect.
    const wanted = daysFromToday(40);
    renderAt(`?date=${wanted}`);

    await waitFor(() =>
      expect(screen.getByText(/further ahead than the 30 days/i)).toBeInTheDocument(),
    );
    expect(requestedSlotDates()).toContain(daysFromToday(0));
  });

  it('ignores a malformed date rather than acting on it', async () => {
    renderAt('?date=not-a-date');

    await waitFor(() => expect(requestedSlotDates()).toContain(daysFromToday(0)));
    // Not treated as an out-of-window date either — there was no date at all.
    expect(screen.queryByText(/further ahead than/i)).not.toBeInTheDocument();
  });
});

describe('Appointment date generation across the UTC boundary', () => {
  it('offers TODAY, not yesterday, at 01:30 in a UTC+3 timezone', async () => {
    vi.stubEnv('TZ', 'Asia/Amman');
    // 22:30 UTC on Aug 29 is 01:30 local on Aug 30 — the window in which
    // toISOString() returned the previous day.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-29T22:30:00Z'));

    renderAt();

    await waitFor(() => expect(requestedSlotDates().length).toBeGreaterThan(0));
    expect(requestedSlotDates()).toContain('2026-08-30');
    expect(requestedSlotDates()).not.toContain('2026-08-29');
  });

  it('matches a notification date named on that same local day', async () => {
    vi.stubEnv('TZ', 'Asia/Amman');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-29T22:30:00Z'));

    renderAt('?date=2026-08-30');

    await waitFor(() => expect(requestedSlotDates()).toContain('2026-08-30'));
    // The date is inside the window, so no notice.
    expect(screen.queryByText(/further ahead than/i)).not.toBeInTheDocument();
  });
});

// 7.2. The notification names a half-hour, so the click should land on it —
// but only if the server still offers it.
describe('Appointment time preselection', () => {
  const selectedTimes = () =>
    [...document.querySelectorAll('#time-slots p')]
      .filter((node) => node.className.includes('bg-primary'))
      .map((node) => node.textContent.trim());

  it('preselects the notified slot when the server still lists it', async () => {
    const wanted = daysFromToday(1);
    renderAt(`?date=${wanted}&time=${encodeURIComponent('10:30 AM')}`);

    await waitFor(() => expect(selectedTimes()).toEqual(['10:30 AM']));
  });

  it('does not hold a slot the server no longer lists', async () => {
    axios.get.mockImplementation((url) => {
      if (String(url).includes('/api/appointments/available-slots')) {
        // 10:30 is gone; only these remain.
        return Promise.resolve({
          data: { success: true, availableSlots: ['11:00 AM', '11:30 AM'] },
        });
      }
      return Promise.resolve({ data: { success: true, doctor: DOCTOR } });
    });
    axios.post.mockResolvedValue({ data: { success: true } });

    const wanted = daysFromToday(1);
    renderAt(`?date=${wanted}&time=${encodeURIComponent('10:30 AM')}`);

    await waitFor(() =>
      expect(screen.getByText('11:00 AM')).toBeInTheDocument(),
    );
    expect(screen.queryByText('10:30 AM')).not.toBeInTheDocument();

    // The assertion that actually bites. Checking "no chip is highlighted"
    // CANNOT FAIL here — an unlisted slot renders no chip to highlight, so it
    // passes whether or not the selection was made. Mutation testing caught
    // that. What is observable is the booking attempt: if 10:30 were still
    // held internally, this click would POST it.
    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', { name: /book an appointment/i }),
    );

    expect(axios.post).not.toHaveBeenCalled();
  });

  it('books the notified slot when it IS still listed', async () => {
    axios.post.mockResolvedValue({ data: { success: true } });

    const wanted = daysFromToday(1);
    renderAt(`?date=${wanted}&time=${encodeURIComponent('10:30 AM')}`);

    await waitFor(() => expect(selectedTimes()).toEqual(['10:30 AM']));

    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', { name: /book an appointment/i }),
    );

    // The mirror of the test above: the selection is real, not cosmetic.
    await waitFor(() => expect(axios.post).toHaveBeenCalled());
    expect(axios.post.mock.calls[0][1]).toMatchObject({
      slotDate: wanted,
      slotTime: '10:30 AM',
    });
  });

  it('ignores a malformed time', async () => {
    const wanted = daysFromToday(1);
    renderAt(`?date=${wanted}&time=whenever`);

    await waitFor(() =>
      expect(screen.getByText('10:30 AM')).toBeInTheDocument(),
    );
    expect(selectedTimes()).toEqual([]);
  });

  it('does not apply the time to a DIFFERENT date', async () => {
    const wanted = daysFromToday(1);
    renderAt(`?date=${wanted}&time=${encodeURIComponent('10:30 AM')}`);

    await waitFor(() => expect(selectedTimes()).toEqual(['10:30 AM']));

    // Moving to another day clears it rather than carrying the notified slot
    // to a date it was never about.
    const user = userEvent.setup();
    const chips = [...document.querySelectorAll('.min-w-16')];
    await user.click(chips[3]);

    await waitFor(() => expect(selectedTimes()).toEqual([]));
  });
});

describe('Appointment for a doctor who is not accepting', () => {
  it('replaces the picker with a notice', async () => {
    mockApi({ ...DOCTOR, available: false });
    renderAt();

    await waitFor(() =>
      expect(
        screen.getByText(/is not accepting appointments at the moment/i),
      ).toBeInTheDocument(),
    );

    expect(screen.queryByText('Booking slots')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /book an appointment/i }),
    ).not.toBeInTheDocument();

    // Deliberately NOT asserting that the slots request is skipped. The doctor
    // and the slots are fetched in parallel on mount, so suppressing the
    // second would mean waiting for the first — trading a real serialisation
    // in the common case for a wasted request in the rare one. The response is
    // simply never rendered.
  });

  it('still shows the doctor, so the page is not a dead end', async () => {
    mockApi({ ...DOCTOR, available: false });
    renderAt();

    await waitFor(() =>
      expect(screen.getByText(DOCTOR.name)).toBeInTheDocument(),
    );
  });

  it('renders the picker when the doctor IS accepting', async () => {
    renderAt();

    await waitFor(() =>
      expect(screen.getByText('Booking slots')).toBeInTheDocument(),
    );
    expect(
      screen.getByRole('button', { name: /book an appointment/i }),
    ).toBeInTheDocument();
  });
});
