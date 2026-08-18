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
