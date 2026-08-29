// What a tool result is allowed to become on its way to the browser.
//
// This is rule 4's discipline applied one boundary further out. Rule 4 forbids
// `SELECT *` because a column added later would silently reach a tool result;
// the same reasoning applies here, where a FIELD added to a tool result later
// would silently reach the patient's browser. So every field is named, and a
// tool absent from the allowlist produces nothing at all.
//
// Fail-closed is the point. A tool added in a future increment is invisible to
// the client until someone deliberately writes a projection for it — the
// opposite of a spread, which would expose it by default.
//
// One field is excluded on purpose: `about`. It is the long, admin-controlled
// free text an attacker plants payloads in (2.9's L3 case does exactly that),
// and a structured card has no use for it. Keeping it out means the injected
// bio never reaches the UI at all.

const DOCTOR_CARD_LIMIT = 10;

// `available` is passed in rather than read off the row, because the two tools
// know it in different ways and neither should be guessed at. `doctor.available
// ?? true` would look tidier and would silently start lying the day the search
// query drops its filter.
const toDoctorCard = (doctor, { available }) => ({
  available,
  id: doctor.id,
  name: doctor.name,
  speciality: doctor.speciality,
  degree: doctor.degree,
  experienceYears: doctor.experience_years,
  languages: doctor.languages,
  gender: doctor.gender,
  fees: doctor.fees,
  area: doctor.area,
  addressLine1: doctor.address_line1,
  addressLine2: doctor.address_line2,
  image: doctor.image,
  mapsUrl: doctor.maps_url,
});

const toAvailabilityCard = (result) => ({
  doctorId: result.doctor_id,
  doctorName: result.doctor_name,
  acceptingAppointments: result.accepting_appointments,
  // Rule 7: availability is a snapshot, never a hold. The timestamp travels
  // with the numbers so the UI cannot render a slot count without being able
  // to say when it was true.
  checkedAt: result.checked_at,
  dates: (result.dates ?? []).map((day) => ({
    date: day.date,
    available: day.available,
    freeSlotCount: day.free_slot_count,
    // 7.3. Times, never who holds the other slots — the query behind these
    // reads `appointment_time` and nothing else.
    freeTimes: day.free_times ?? [],
    reason: day.reason ?? null,
  })),
});

// Keyed by tool name. Anything not here returns null and never reaches a
// browser.
const PROJECTIONS = {
  // The search query pins `d.available = TRUE`, which is also why the column
  // is absent from its result — there is nothing to read, only a guarantee to
  // restate.
  search_doctors: (result) =>
    Array.isArray(result) && result.length
      ? {
          kind: 'doctors',
          doctors: result
            .slice(0, DOCTOR_CARD_LIMIT)
            .map((doctor) => toDoctorCard(doctor, { available: true })),
        }
      : null,

  // No such filter here: get_doctor answers about whichever doctor was asked
  // for, accepting appointments or not.
  get_doctor: (result) =>
    result
      ? {
          kind: 'doctors',
          doctors: [toDoctorCard(result, { available: Boolean(result.available) })],
        }
      : null,

  check_availability: (result) =>
    result ? { kind: 'availability', ...toAvailabilityCard(result) } : null,
};

export const CARD_TOOLS = Object.keys(PROJECTIONS);

export const toClientCard = (toolName, result) => {
  // A tool that returned an error object has nothing to render, and the error
  // text is the model's business, not the patient's.
  if (!result || result.error) return null;

  return PROJECTIONS[toolName]?.(result) ?? null;
};

export default toClientCard;
