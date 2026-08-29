import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import Doctors from './Doctors';
import { AppContext } from '../context/AppContext';

// CHARACTERISATION, ahead of 6.9. See RelatedDoctors.test.jsx for why these
// assert only what is on screen.
//
// The speciality names below are the ones the sidebar itself renders, so a
// doctor named after one would be indistinguishable from the filter link.
// These use invented surnames instead — otherwise a passing test could be
// matching the wrong element entirely.

const doctor = (id, name, speciality) => ({
  _id: id,
  name,
  speciality,
  available: true,
  image: `https://cdn.example.invalid/${id}.jpg`,
});

const DOCTORS = [
  doctor('d1', 'Dr. Alder', 'Dermatologist'),
  doctor('d2', 'Dr. Birch', 'Dermatologist'),
  doctor('d3', 'Dr. Cedar', 'Neurologist'),
];

// Rendered through a real route so useParams gives a real value.
const renderAt = (path, doctors = DOCTORS) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppContext.Provider value={{ doctors }}>
        <Routes>
          <Route path="/doctors" element={<Doctors />} />
          <Route path="/doctors/:speciality" element={<Doctors />} />
        </Routes>
      </AppContext.Provider>
    </MemoryRouter>,
  );

describe('Doctors', () => {
  it('lists every doctor when no speciality is in the URL', () => {
    renderAt('/doctors');

    expect(screen.getByText('Dr. Alder')).toBeInTheDocument();
    expect(screen.getByText('Dr. Birch')).toBeInTheDocument();
    expect(screen.getByText('Dr. Cedar')).toBeInTheDocument();
  });

  it('filters by the speciality in the URL', () => {
    renderAt('/doctors/Dermatologist');

    expect(screen.getByText('Dr. Alder')).toBeInTheDocument();
    expect(screen.getByText('Dr. Birch')).toBeInTheDocument();
    expect(screen.queryByText('Dr. Cedar')).not.toBeInTheDocument();
  });

  it('narrows the list as a name is typed', async () => {
    const user = userEvent.setup();
    renderAt('/doctors');

    await user.type(screen.getByPlaceholderText(/search doctors/i), 'birch');

    expect(screen.getByText('Dr. Birch')).toBeInTheDocument();
    expect(screen.queryByText('Dr. Alder')).not.toBeInTheDocument();
  });

  it('searches speciality as well as name', async () => {
    const user = userEvent.setup();
    renderAt('/doctors');

    await user.type(screen.getByPlaceholderText(/search doctors/i), 'neuro');

    expect(screen.getByText('Dr. Cedar')).toBeInTheDocument();
    expect(screen.queryByText('Dr. Alder')).not.toBeInTheDocument();
  });

  it('combines the URL speciality with the search box', async () => {
    const user = userEvent.setup();
    renderAt('/doctors/Dermatologist');

    await user.type(screen.getByPlaceholderText(/search doctors/i), 'alder');

    expect(screen.getByText('Dr. Alder')).toBeInTheDocument();
    expect(screen.queryByText('Dr. Birch')).not.toBeInTheDocument();
  });

  it('shows no doctor cards when nothing matches', async () => {
    const user = userEvent.setup();
    renderAt('/doctors');

    await user.type(screen.getByPlaceholderText(/search doctors/i), 'zzzz');

    for (const { name } of DOCTORS) {
      expect(screen.queryByText(name)).not.toBeInTheDocument();
    }
  });
});
