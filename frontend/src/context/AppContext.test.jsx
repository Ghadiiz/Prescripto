import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useContext } from 'react';
import axios from 'axios';

import AppContextProvider, { AppContext } from './AppContext';

// CHARACTERISATION, ahead of 6.9.
//
// Two things get pinned here, and 6.9 threatens both:
//
//   1. the two mount effects (`set-state-in-effect` at lines 50 and 55) — the
//      doctor fetch and the token-driven profile load;
//   2. how the context is CONSUMED. 6.9's `only-export-components` fix moves
//      `export const AppContext` into its own module, changing the import path
//      in 13 files. This test imports the context and the provider the way a
//      consumer does, so a move that breaks consumption fails here.

vi.mock('axios');
vi.mock('react-toastify', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// A consumer that renders the context, so assertions stay on rendered output
// rather than reaching into provider internals.
const Probe = () => {
  const { doctors, userData, currencySymbol } = useContext(AppContext);

  return (
    <div>
      <span data-testid="currency">{currencySymbol}</span>
      <span data-testid="doctor-count">{doctors.length}</span>
      <span data-testid="user">{userData ? userData.name : 'no-user'}</span>
    </div>
  );
};

const DOCTORS = [
  { _id: 'd1', name: 'Dr. Alder', speciality: 'Dermatologist' },
  { _id: 'd2', name: 'Dr. Birch', speciality: 'Neurologist' },
];

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('AppContextProvider', () => {
  it('fetches the doctor directory on mount and exposes it', async () => {
    axios.get.mockResolvedValue({ data: { success: true, doctors: DOCTORS } });

    render(
      <AppContextProvider>
        <Probe />
      </AppContextProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('doctor-count')).toHaveTextContent('2'),
    );
    expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/api/doctors'));
  });

  it('exposes the currency symbol', () => {
    axios.get.mockResolvedValue({ data: { success: true, doctors: [] } });

    render(
      <AppContextProvider>
        <Probe />
      </AppContextProvider>,
    );

    expect(screen.getByTestId('currency')).toHaveTextContent('$');
  });

  it('leaves userData false when there is no token', async () => {
    axios.get.mockResolvedValue({ data: { success: true, doctors: [] } });

    render(
      <AppContextProvider>
        <Probe />
      </AppContextProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('doctor-count')).toHaveTextContent('0'),
    );
    expect(screen.getByTestId('user')).toHaveTextContent('no-user');

    // The profile endpoint must not be called without a token.
    const profileCalls = axios.get.mock.calls.filter(([url]) =>
      String(url).includes('/api/auth/profile'),
    );
    expect(profileCalls).toHaveLength(0);
  });

  it('loads the profile when a token is already stored', async () => {
    localStorage.setItem('token', 'stored-token');

    axios.get.mockImplementation((url) => {
      if (String(url).includes('/api/auth/profile')) {
        return Promise.resolve({
          data: { success: true, user: { name: 'Example Patient' } },
        });
      }
      return Promise.resolve({ data: { success: true, doctors: DOCTORS } });
    });

    render(
      <AppContextProvider>
        <Probe />
      </AppContextProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('user')).toHaveTextContent('Example Patient'),
    );
  });

  it('survives a failed directory fetch', async () => {
    axios.get.mockRejectedValue(new Error('network down'));

    render(
      <AppContextProvider>
        <Probe />
      </AppContextProvider>,
    );

    // Renders rather than throwing; the list is simply empty.
    await waitFor(() =>
      expect(screen.getByTestId('doctor-count')).toHaveTextContent('0'),
    );
  });
});
