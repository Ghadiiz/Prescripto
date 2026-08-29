import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import EditDoctor from './EditDoctor';
import { AdminContext } from '../../context/AdminContext';

// CHARACTERISATION, ahead of 6.9.
//
// This is the `react-hooks/immutability` target. Its effect loads a doctor out
// of context and fans it across a dozen useState setters; whatever 6.9 does to
// that, the observable contract is the same: open the page for a doctor id and
// the form comes up populated from context, without a network call.

vi.mock('axios');
vi.mock('react-toastify', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const DOCTOR = {
  id: 12,
  name: 'Dr. Placeholder Example',
  email: 'doctor@example.invalid',
  fees: 60,
  degree: 'MBBS',
  experience: '5 Years',
  about: 'Short profile text.',
  phone: '+962791234567',
  image: 'https://cdn.example.invalid/d.jpg',
  languages: 'English,Arabic',
  gender: 'Female',
  area: 'Khalda',
  speciality_id: 3,
  address: JSON.stringify({ line1: '1 Example Street', line2: 'Khalda, Amman' }),
};

const renderFor = (id, doctors) => {
  const getAllDoctors = vi.fn();

  render(
    <MemoryRouter initialEntries={[`/admin/edit-doctor/${id}`]}>
      <AdminContext.Provider
        value={{
          doctors,
          getAllDoctors,
          aToken: 'an-admin-token',
          backendUrl: 'http://api.example.invalid',
          // The component reads doctorOptions.specialities directly, with no
          // guard — so the shape matters, not just the presence of a value.
          doctorOptions: {
            specialities: [{ id: 3, name: 'Dermatologist' }],
            areas: ['Khalda'],
            languages: ['English', 'Arabic'],
            genders: ['Male', 'Female'],
          },
          getDoctorOptions: vi.fn(),
        }}
      >
        <Routes>
          <Route path="/admin/edit-doctor/:id" element={<EditDoctor />} />
        </Routes>
      </AdminContext.Provider>
    </MemoryRouter>,
  );

  return { getAllDoctors };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EditDoctor', () => {
  it('populates the form from the doctor already in context', async () => {
    renderFor(12, [DOCTOR]);

    await waitFor(() =>
      expect(screen.getByPlaceholderText('Name')).toHaveValue(
        'Dr. Placeholder Example',
      ),
    );

    expect(screen.getByPlaceholderText('Email')).toHaveValue(
      'doctor@example.invalid',
    );
    expect(screen.getByPlaceholderText('Fees')).toHaveValue(60);
    expect(screen.getByPlaceholderText('Education')).toHaveValue('MBBS');
    expect(screen.getByPlaceholderText('Phone')).toHaveValue('+962791234567');
  });

  it('splits the stored address into its two lines', async () => {
    renderFor(12, [DOCTOR]);

    await waitFor(() =>
      expect(screen.getByPlaceholderText('Address 1')).toHaveValue(
        '1 Example Street',
      ),
    );
    expect(screen.getByPlaceholderText('Address 2')).toHaveValue(
      'Khalda, Amman',
    );
  });

  it('matches the doctor by id, not by position', async () => {
    renderFor(12, [
      { ...DOCTOR, id: 11, name: 'Dr. Wrong One' },
      DOCTOR,
    ]);

    await waitFor(() =>
      expect(screen.getByPlaceholderText('Name')).toHaveValue(
        'Dr. Placeholder Example',
      ),
    );
  });

  it('asks the context to load doctors when it has none', async () => {
    const { getAllDoctors } = renderFor(12, []);

    await waitFor(() => expect(getAllDoctors).toHaveBeenCalled());
  });
});
