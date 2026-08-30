import { getDB } from '../../config/mysql.js';
import { APPOINTMENT_STATUS } from '../../constants/appointmentStatus.js';

// SQL for the assistant's appointment tools.
//
// Unlike the doctor queries, these read ONE patient's own rows. `user_id = ?`
// is not a filter the caller may choose — it is always ctx.userId, bound
// first, and there is no code path that omits it. See tools/README.md rule 3.

// No doctor_phone: no tool result has carried a phone number, and an
// appointment doesn't need one.
const APPOINTMENT_COLUMNS = `
      a.id,
      a.appointment_date,
      a.appointment_time,
      a.status,
      a.amount,
      a.cancellation_reason,
      TIMESTAMP(a.appointment_date, a.appointment_time) <= NOW() AS is_past,
      d.id AS doctor_id,
      d.name AS doctor_name,
      s.name AS speciality,
      d.address_line1,
      d.address_line2,
      d.area,
      d.image`;

export const APPOINTMENT_RESULT_LIMIT = 20;

// 7.5. Does this patient already hold an appointment with THIS ONE DOCTOR on
// THIS ONE DAY?
//
// THE SCOPING IS THE POINT, and it is why this is a separate function rather
// than an option on the one below. Every predicate is literal in the SQL:
// there is no conditions array, no optional filter, and no code path that can
// omit the doctor or the date. Widening it is an edit, not an argument.
//
// That is the rule-6 discipline the doctor tools use, applied to a patient
// query because the failure mode is just as bad. This answer decides whether a
// patient is told to CANCEL SOMETHING. A query that widened across doctors
// would tell them to cancel an appointment with a doctor they never mentioned
// — nonsensical and alarming, and exactly the bug the increment exists to
// avoid rather than create.
//
// Three columns, because three are all that is needed: the caller already has
// the doctor. Nothing here reaches for a name, and rule 4 forbids the `*` that
// would drag one in.
export const findAppointmentWithDoctorOnDate = async (
  userId,
  doctorId,
  date,
) => {
  const db = getDB();

  const [appointments] = await db.query(
    `SELECT a.id, a.appointment_date, a.appointment_time
       FROM appointments a
      WHERE a.user_id = ?
        AND a.doctor_id = ?
        AND a.appointment_date = ?
        AND a.status <> ?
      ORDER BY a.appointment_time`,
    [userId, doctorId, date, APPOINTMENT_STATUS.CANCELLED],
  );

  return appointments;
};

export const findAppointmentsForUser = async (userId, { status } = {}) => {
  const db = getDB();

  // userId first and always. Anything the model influences comes after.
  const conditions = ['a.user_id = ?'];
  const params = [userId];

  if (status === 'upcoming') {
    conditions.push('a.status <> ?');
    params.push(APPOINTMENT_STATUS.CANCELLED);
    conditions.push('TIMESTAMP(a.appointment_date, a.appointment_time) > NOW()');
  } else if (status === 'past') {
    conditions.push('a.status <> ?');
    params.push(APPOINTMENT_STATUS.CANCELLED);
    conditions.push(
      'TIMESTAMP(a.appointment_date, a.appointment_time) <= NOW()',
    );
  } else if (status === 'cancelled') {
    conditions.push('a.status = ?');
    params.push(APPOINTMENT_STATUS.CANCELLED);
  }

  const [appointments] = await db.query(
    `SELECT
${APPOINTMENT_COLUMNS}
     FROM appointments a
     JOIN doctors d ON a.doctor_id = d.id
     JOIN specialities s ON d.speciality_id = s.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY a.appointment_date DESC, a.appointment_time DESC
     LIMIT ${APPOINTMENT_RESULT_LIMIT}`,
    params,
  );

  return appointments;
};
