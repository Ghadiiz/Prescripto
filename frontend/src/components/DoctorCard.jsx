import React from 'react';
import { useNavigate } from 'react-router-dom';

// One doctor, rendered from the fields the server's allowlist sent — not from
// the assistant's prose. Everything here is a database value, so the panel
// shows the same details the /doctors page does, in the same shape, whoever
// asked for them.
//
// The body is a button and the map link is its sibling, deliberately. Wrapping
// the whole card in a click handler would put an <a> inside a clickable
// region: tab order and screen-reader semantics get muddled, and a tap on the
// address would fire both actions unless suppressed with stopPropagation. Two
// separate controls need no tricks.

const Field = ({ label, value }) =>
  value ? (
    <p className="text-xs text-gray-600">
      <span className="text-gray-400">{label}: </span>
      {value}
    </p>
  ) : null;

const DoctorCard = ({ doctor, onNavigate }) => {
  const navigate = useNavigate();

  const address = [doctor.addressLine1, doctor.addressLine2]
    .filter(Boolean)
    .join(', ');

  // Stored as a bare comma-separated string ("English,Arabic"), which reads
  // badly once it is a label rather than a database value.
  const languages = doctor.languages
    ?.split(',')
    .map((language) => language.trim())
    .filter(Boolean)
    .join(', ');

  // search_doctors can only return doctors who are accepting; get_doctor
  // answers about whoever was asked for, so this can be false.
  const isAccepting = doctor.available !== false;

  const openDoctor = () => {
    onNavigate?.();
    navigate(`/appointment/${doctor.id}`);
  };

  return (
    <article className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <button
        type="button"
        onClick={openDoctor}
        aria-label={
          isAccepting
            ? `Book an appointment with ${doctor.name}`
            : `View ${doctor.name}'s profile`
        }
        className="block w-full p-3 text-left hover:bg-gray-50"
      >
        <div className="flex gap-3">
          {doctor.image && (
            <img
              src={doctor.image}
              alt=""
              className="h-14 w-14 flex-shrink-0 rounded-full bg-blue-50 object-cover"
            />
          )}

          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-gray-800">{doctor.name}</p>
            <p className="text-xs text-primary">{doctor.speciality}</p>

            <div className="mt-1 space-y-0.5">
              <Field
                label="Experience"
                value={
                  typeof doctor.experienceYears === 'number'
                    ? `${doctor.experienceYears} ${
                        doctor.experienceYears === 1 ? 'year' : 'years'
                      }${doctor.degree ? ` · ${doctor.degree}` : ''}`
                    : doctor.degree
                }
              />
              <Field label="Speaks" value={languages} />
              <Field
                label="Fee"
                value={
                  typeof doctor.fees === 'number' ? `${doctor.fees} JOD` : null
                }
              />
              <Field label="Area" value={doctor.area} />
            </div>
          </div>
        </div>

        {/* The tap still works when a doctor is not accepting — the patient
            asked about them and should be able to look. It just stops
            promising a booking the clinic will not take. */}
        {!isAccepting && (
          <p className="mt-2 text-xs text-gray-500">
            Not currently accepting appointments
          </p>
        )}

        <p className="mt-2 text-xs font-medium text-primary">
          {isAccepting ? 'Book an appointment →' : 'View profile →'}
        </p>
      </button>

      {doctor.mapsUrl && (
        <a
          href={doctor.mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${doctor.name}'s clinic in Google Maps`}
          className="flex items-center justify-center gap-1 border-t border-gray-100 px-3 py-1.5 text-xs text-gray-700 hover:text-primary"
        >
          📍 {address || 'View on map'}
        </a>
      )}
    </article>
  );
};

export default DoctorCard;
