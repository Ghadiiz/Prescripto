import React from 'react';

// One doctor, rendered from the fields the server's allowlist sent — not from
// the assistant's prose. Everything here is a database value, so the panel
// shows the same details the /doctors page does, in the same shape, whoever
// asked for them.
//
// Tapping through to the booking page is 3.4; this card is read-only.

const Field = ({ label, value }) =>
  value ? (
    <p className="text-xs text-gray-600">
      <span className="text-gray-400">{label}: </span>
      {value}
    </p>
  ) : null;

const DoctorCard = ({ doctor }) => {
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

  return (
    <article className="rounded-lg border border-gray-200 bg-white p-3">
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

      {doctor.mapsUrl && (
        <a
          href={doctor.mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${doctor.name}'s clinic in Google Maps`}
          className="mt-2 flex items-center justify-center gap-1 rounded-md border border-gray-200 px-3 py-1.5 text-xs text-gray-700 hover:border-primary hover:text-primary"
        >
          📍 {address || 'View on map'}
        </a>
      )}
    </article>
  );
};

export default DoctorCard;
