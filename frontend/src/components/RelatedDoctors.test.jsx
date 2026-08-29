import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import RelatedDoctors from './RelatedDoctors';
import { AppContext } from '../context/AppContext';

// CHARACTERISATION tests, written before 6.9 refactors this component.
//
// RelatedDoctors currently derives its list in a useEffect and stores it in
// state, which is the `set-state-in-effect` error 6.9 will fix — most likely by
// computing during render and deleting the state entirely.
//
// So every assertion here is about what a USER SEES. Nothing names the state,
// counts renders, or reaches inside. A test that had to be edited during the
// refactor would stop being evidence that behaviour was preserved, which is the
// only reason these exist.

const doctor = (id, name, speciality, available = true) => ({
  _id: id,
  name,
  speciality,
  available,
  image: `https://cdn.example.invalid/${id}.jpg`,
});

const DOCTORS = [
  doctor('d1', 'Dr. Alder', 'Dermatologist'),
  doctor('d2', 'Dr. Birch', 'Dermatologist'),
  doctor('d3', 'Dr. Cedar', 'Dermatologist'),
  doctor('d4', 'Dr. Elm', 'Neurologist'),
  doctor('d5', 'Dr. Fir', 'Neurologist'),
];

const renderWith = (doctors, props) =>
  render(
    <MemoryRouter>
      <AppContext.Provider value={{ doctors }}>
        <RelatedDoctors {...props} />
      </AppContext.Provider>
    </MemoryRouter>,
  );

describe('RelatedDoctors', () => {
  it('shows other doctors of the same speciality', () => {
    renderWith(DOCTORS, { speciality: 'Dermatologist', docId: 'd1' });

    expect(screen.getByText('Dr. Birch')).toBeInTheDocument();
    expect(screen.getByText('Dr. Cedar')).toBeInTheDocument();
  });

  it('excludes the doctor currently being viewed', () => {
    renderWith(DOCTORS, { speciality: 'Dermatologist', docId: 'd1' });

    expect(screen.queryByText('Dr. Alder')).not.toBeInTheDocument();
  });

  it('excludes other specialities', () => {
    renderWith(DOCTORS, { speciality: 'Dermatologist', docId: 'd1' });

    expect(screen.queryByText('Dr. Elm')).not.toBeInTheDocument();
    expect(screen.queryByText('Dr. Fir')).not.toBeInTheDocument();
  });

  it('renders nothing when no other doctor matches', () => {
    const { container } = renderWith(
      [doctor('d1', 'Dr. Alder', 'Dermatologist')],
      { speciality: 'Dermatologist', docId: 'd1' },
    );

    // The component returns null rather than an empty section.
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing before the doctor list has loaded', () => {
    const { container } = renderWith([], {
      speciality: 'Dermatologist',
      docId: 'd1',
    });

    expect(container).toBeEmptyDOMElement();
  });

  it('shows at most five', () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      doctor(`x${i}`, `Dr. Number${i}`, 'Dermatologist'),
    );

    renderWith(many, { speciality: 'Dermatologist', docId: 'nobody' });

    const shown = many.filter(({ name }) => screen.queryByText(name));
    expect(shown).toHaveLength(5);
  });

  it('marks availability', () => {
    renderWith(
      [
        doctor('d1', 'Dr. Alder', 'Dermatologist'),
        doctor('d2', 'Dr. Birch', 'Dermatologist', false),
      ],
      { speciality: 'Dermatologist', docId: 'd1' },
    );

    expect(screen.getByText('Not Available')).toBeInTheDocument();
  });
});
