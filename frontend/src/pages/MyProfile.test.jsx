import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import MyProfile from './MyProfile';
import { AppContext } from '../context/AppContext';

// CHARACTERISATION, ahead of 6.9.
//
// The `set-state-in-effect` here re-derives `phoneData` whenever
// `userData.phone` changes, on top of a lazy useState initialiser that already
// derives it once. 6.9 will likely collapse the two.
//
// The split is only VISIBLE in edit mode — the read view shows the raw stored
// string — so these open the editor and read the country-code select and the
// number input, which is what a user actually sees.

vi.mock('axios');
vi.mock('react-toastify', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const renderWith = (userData) =>
  render(
    <AppContext.Provider
      value={{
        userData,
        setUserData: vi.fn(),
        token: 'a-token',
        backendUrl: 'http://api.example.invalid',
        loadUserProfileData: vi.fn(),
      }}
    >
      <MyProfile />
    </AppContext.Provider>,
  );

const openEditor = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /edit/i }));
  return user;
};

// Edit mode renders TWO selects — the country code and the gender — so
// getByRole('combobox') is ambiguous. Picked by the shape of its value rather
// than by DOM order, which would silently follow a layout change.
const countryCodeSelect = () =>
  screen
    .getAllByRole('combobox')
    .find((select) => select.value.startsWith('+'));

const base = {
  name: 'Example Patient',
  email: 'patient@example.invalid',
  image: '',
  address_line1: '',
  address_line2: '',
  gender: 'Female',
  dob: '1990-01-01',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MyProfile phone handling', () => {
  it('splits a stored number into country code and local digits', async () => {
    renderWith({ ...base, phone: '+962791234567' });
    await openEditor();

    expect(countryCodeSelect()).toHaveValue('+962');
    expect(screen.getByPlaceholderText(/digits/i)).toHaveValue('791234567');
  });

  it('recognises a different country code', async () => {
    renderWith({ ...base, phone: '+9611234567' });
    await openEditor();

    expect(countryCodeSelect()).toHaveValue('+961');
    expect(screen.getByPlaceholderText(/digits/i)).toHaveValue('1234567');
  });

  it('defaults to +962 when the number carries no known code', async () => {
    renderWith({ ...base, phone: '0791234567' });
    await openEditor();

    expect(countryCodeSelect()).toHaveValue('+962');
    expect(screen.getByPlaceholderText(/digits/i)).toHaveValue('0791234567');
  });

  it('starts empty when no phone is stored', async () => {
    renderWith({ ...base, phone: '' });
    await openEditor();

    expect(countryCodeSelect()).toHaveValue('+962');
    expect(screen.getByPlaceholderText(/digits/i)).toHaveValue('');
  });

  it('re-splits when the stored phone changes', async () => {
    const { rerender } = renderWith({ ...base, phone: '+962791234567' });
    await openEditor();

    expect(screen.getByPlaceholderText(/digits/i)).toHaveValue('791234567');

    // The effect under refactor: a new userData.phone must be reflected.
    rerender(
      <AppContext.Provider
        value={{
          userData: { ...base, phone: '+20123456789' },
          setUserData: vi.fn(),
          token: 'a-token',
          backendUrl: 'http://api.example.invalid',
          loadUserProfileData: vi.fn(),
        }}
      >
        <MyProfile />
      </AppContext.Provider>,
    );

    expect(countryCodeSelect()).toHaveValue('+20');
    expect(screen.getByPlaceholderText(/digits/i)).toHaveValue('123456789');
  });
});
