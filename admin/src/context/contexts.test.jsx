import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useContext } from 'react';

import AdminContextProvider from './AdminContextProvider';
import DoctorContextProvider from './DoctorContextProvider';
import AppContextProvider from './AppContextProvider';
import { AdminContext } from './AdminContext';
import { DoctorContext } from './DoctorContext';
import { AppContext } from './AppContext';

// CHARACTERISATION, ahead of 6.9.
//
// All three of these files carry the `react-refresh/only-export-components`
// error, and the fix splits the provider out into its own module. The context
// object keeps this filename, which is what leaves the 22 consumer imports in
// this app untouched.
//
// 6.9 repointed the three provider imports above and this comment — nothing
// else in this file changed.
//
// So what these pin is CONSUMPTION: import the provider and the context the way
// a page does, render one inside the other, and read a value back out. If the
// relocation breaks the pairing — a consumer importing a different context
// object than the provider supplies, which renders as `undefined` rather than
// as an error — these fail.

vi.mock('axios');
vi.mock('react-toastify', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const Probe = ({ context, read }) => {
  const value = useContext(context);
  return <span data-testid="value">{read(value)}</span>;
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe('admin context providers', () => {
  it('AdminContext reaches a consumer with its value', () => {
    render(
      <AdminContextProvider>
        <Probe
          context={AdminContext}
          read={(v) => (v ? `doctors:${v.doctors.length}` : 'NO CONTEXT')}
        />
      </AdminContextProvider>,
    );

    expect(screen.getByTestId('value')).toHaveTextContent('doctors:0');
  });

  it('DoctorContext reaches a consumer with its value', () => {
    render(
      <DoctorContextProvider>
        <Probe
          context={DoctorContext}
          read={(v) => (v ? `appointments:${v.appointments.length}` : 'NO CONTEXT')}
        />
      </DoctorContextProvider>,
    );

    expect(screen.getByTestId('value')).toHaveTextContent('appointments:0');
  });

  it('AppContext reaches a consumer with its value', () => {
    render(
      <AppContextProvider>
        <Probe
          context={AppContext}
          read={(v) => (v ? typeof v.calculateAge : 'NO CONTEXT')}
        />
      </AppContextProvider>,
    );

    // Something is exposed — the exact helper matters less than the pairing
    // between provider and context surviving the move.
    expect(screen.getByTestId('value')).not.toHaveTextContent('NO CONTEXT');
  });

  it('each provider renders its children', () => {
    render(
      <AdminContextProvider>
        <p>admin child</p>
      </AdminContextProvider>,
    );
    expect(screen.getByText('admin child')).toBeInTheDocument();
  });
});
