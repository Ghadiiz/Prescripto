import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import AvailabilityCard from './AvailabilityCard';

// The card that rule 7 lives in, tested on the render side for the first time.
//
// The 6.8 Known Issue named this exactly: the checked-at caveat was "protected
// only by the backend test that forces checkedAt to ship, and by the line
// being rendered unconditionally so no data shape can drop it" — which is to
// say, by a human reading the diff. 6.8 built the runner; 7.3 edits the
// component, so this is the moment to pin it here too.

const card = (overrides = {}) => ({
  doctorId: 407,
  doctorName: 'Dr. Placeholder Example',
  acceptingAppointments: true,
  checkedAt: '2026-08-21T12:46:13.377Z',
  dates: [
    {
      date: '2026-08-25',
      available: true,
      freeSlotCount: 3,
      freeTimes: ['10:00 AM', '10:30 AM', '02:00 PM'],
      reason: null,
    },
  ],
  ...overrides,
});

const CAVEAT = /slots are not held until you book/i;

describe('AvailabilityCard free times', () => {
  it('shows the actual times, not just the count', () => {
    render(<AvailabilityCard availability={card()} />);

    expect(screen.getByText('10:00 AM')).toBeInTheDocument();
    expect(screen.getByText('10:30 AM')).toBeInTheDocument();
    expect(screen.getByText('02:00 PM')).toBeInTheDocument();
    expect(screen.getByText(/3 slots free/)).toBeInTheDocument();
  });

  it('caps a wide-open day rather than printing 22 chips', () => {
    const allDay = Array.from({ length: 22 }, (_, i) => {
      const hour = 10 + Math.floor(i / 2);
      const minute = i % 2 === 0 ? '00' : '30';
      const suffix = hour >= 12 ? 'PM' : 'AM';
      const shown = hour > 12 ? hour - 12 : hour;
      return `${String(shown).padStart(2, '0')}:${minute} ${suffix}`;
    });

    render(
      <AvailabilityCard
        availability={card({
          dates: [
            {
              date: '2026-08-25',
              available: true,
              freeSlotCount: 22,
              freeTimes: allDay,
              reason: null,
            },
          ],
        })}
      />,
    );

    expect(screen.getByText('+16 more')).toBeInTheDocument();
    expect(screen.getByText(allDay[5])).toBeInTheDocument();
    expect(screen.queryByText(allDay[6])).not.toBeInTheDocument();
    // The count still tells the truth about the whole day.
    expect(screen.getByText(/22 slots free/)).toBeInTheDocument();
  });

  it('renders a pre-7.3 card with no times at all', () => {
    render(
      <AvailabilityCard
        availability={card({
          dates: [
            {
              date: '2026-08-25',
              available: true,
              freeSlotCount: 3,
              reason: null,
            },
          ],
        })}
      />,
    );

    expect(screen.getByText(/3 slots free/)).toBeInTheDocument();
    expect(screen.getByText(CAVEAT)).toBeInTheDocument();
  });
});

describe('AvailabilityCard rule 7 caveat', () => {
  it('is shown alongside the times', () => {
    render(<AvailabilityCard availability={card()} />);

    expect(screen.getByText(CAVEAT)).toBeInTheDocument();
    expect(screen.getByText(/Checked at/i)).toBeInTheDocument();
  });

  it('is shown when a date has NO free times', () => {
    render(
      <AvailabilityCard
        availability={card({
          dates: [
            {
              date: '2026-08-24',
              available: false,
              freeSlotCount: 0,
              freeTimes: [],
              reason: 'date_in_past',
            },
          ],
        })}
      />,
    );

    expect(screen.getByText(/none free/)).toBeInTheDocument();
    expect(screen.getByText(/in the past/)).toBeInTheDocument();
    // Unconditional: there is no data shape that removes it.
    expect(screen.getByText(CAVEAT)).toBeInTheDocument();
  });

  it('is shown even when the doctor is not accepting at all', () => {
    render(
      <AvailabilityCard
        availability={card({ acceptingAppointments: false, dates: [] })}
      />,
    );

    expect(screen.getByText(/Not currently accepting/i)).toBeInTheDocument();
    expect(screen.getByText(CAVEAT)).toBeInTheDocument();
  });
});
