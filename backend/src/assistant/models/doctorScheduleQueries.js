import { getDB } from '../../config/mysql.js';
import { APPOINTMENT_STATUS } from '../../constants/appointmentStatus.js';

// SQL for the assistant's DOCTOR tools.
//
// Every query here reads one doctor's own rows. `a.doctor_id = ?` is not a
// filter the caller may choose — it is always ctx.doctorId, bound first, and
// there is no code path that omits it. See doctorTools/README.md rule 3.
//
// `doctorAppointmentService.getDoctorAppointments` is deliberately NOT reused:
// it is `SELECT a.*` and returns `patientEmail`, and rule 4 forbids both in a
// tool result. The doctor panel may show a doctor their patient's email; a
// tool result that a model reads, and 5.6 ships to an MCP host, may not.

// No email, no user_id. 5.2's rule holds on this side too: a column that never
// ships cannot leak.
const SCHEDULE_COLUMNS = `
      a.id,
      a.appointment_date,
      a.appointment_time,
      a.status,
      a.amount,
      a.cancellation_reason,
      TIMESTAMP(a.appointment_date, a.appointment_time) <= NOW() AS is_past,
      u.name AS patient_name`;

export const SCHEDULE_RESULT_LIMIT = 100;
export const FOLLOWUP_RESULT_LIMIT = 50;

// Appointments for a doctor across an inclusive date range.
//
// Cancelled rows are excluded by default: a cancelled appointment is not on
// the schedule, and including it silently would make a doctor's day look
// fuller than it is.
export const findAppointmentsForDoctorRange = async (
  doctorId,
  dateFrom,
  dateTo,
  { includeCancelled = false } = {},
) => {
  const db = getDB();

  // doctorId first and always. Anything the model influences comes after.
  const conditions = ['a.doctor_id = ?', 'a.appointment_date BETWEEN ? AND ?'];
  const params = [doctorId, dateFrom, dateTo];

  if (!includeCancelled) {
    conditions.push('a.status <> ?');
    params.push(APPOINTMENT_STATUS.CANCELLED);
  }

  const [rows] = await db.query(
    `SELECT
${SCHEDULE_COLUMNS}
     FROM appointments a
     JOIN users u ON a.user_id = u.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY a.appointment_date, a.appointment_time
     LIMIT ${SCHEDULE_RESULT_LIMIT}`,
    params,
  );

  return rows;
};

// The booked half-hour times for one doctor on one date, as 'HH:MM:SS'.
//
// Only what schedule_gaps needs to subtract from the grid — no patient, no
// amount, nothing about who. A cancelled appointment frees its slot (that is
// what 5.4 notifies about), so it is not booked.
export const findBookedTimesForDoctor = async (doctorId, date) => {
  const db = getDB();

  const [rows] = await db.query(
    `SELECT a.appointment_time
       FROM appointments a
      WHERE a.doctor_id = ?
        AND a.appointment_date = ?
        AND a.status <> ?`,
    [doctorId, date, APPOINTMENT_STATUS.CANCELLED],
  );

  return rows.map((row) => String(row.appointment_time));
};

// Patients whose last COMPLETED visit with this doctor is old, and who have
// nothing booked ahead.
//
// The NOT EXISTS is the whole point of the tool: a patient who already has an
// appointment next Tuesday does not need chasing, however long ago they were
// last seen. Without it this is just "old visits", which any doctor could get
// by scrolling their own panel.
export const findPatientsNeedingFollowup = async (
  doctorId,
  sinceDays,
  limit,
) => {
  const db = getDB();

  const safeLimit = Math.min(
    Math.max(Number.parseInt(limit, 10) || 1, 1),
    FOLLOWUP_RESULT_LIMIT,
  );

  const [rows] = await db.query(
    `SELECT
        u.name AS patient_name,
        MAX(a.appointment_date) AS last_visit_date,
        DATEDIFF(CURDATE(), MAX(a.appointment_date)) AS days_since,
        COUNT(*) AS completed_visits
       FROM appointments a
       JOIN users u ON a.user_id = u.id
      WHERE a.doctor_id = ?
        AND a.status = ?
        AND NOT EXISTS (
          SELECT 1
            FROM appointments future
           WHERE future.doctor_id = a.doctor_id
             AND future.user_id = a.user_id
             AND future.status <> ?
             AND TIMESTAMP(future.appointment_date, future.appointment_time) > NOW()
        )
      GROUP BY a.user_id, u.name
     HAVING days_since >= ?
      ORDER BY days_since DESC
      LIMIT ?`,
    // `safeLimit` is a parameter rather than interpolated text. The clamp above
    // still runs — it is what keeps the value sane — but the limit is no longer
    // part of the statement, so its safety no longer depends on the clamp being
    // correct. This works because every call site in the repo uses `query()`:
    // mysql2 escapes a NUMERIC limit correctly there, while a string parameter
    // is a parse error and `execute()` rejects a LIMIT placeholder outright.
    [
      doctorId,
      APPOINTMENT_STATUS.COMPLETED,
      APPOINTMENT_STATUS.CANCELLED,
      sinceDays,
      safeLimit,
    ],
  );

  return rows;
};

// Counts and earnings for one doctor over an inclusive date range.
//
// Earnings sum `a.amount` — the fee actually charged at booking — rather than
// joining `doctors.fees` the way getDoctorDashboard does. Today's fee applied
// to last year's appointments reports a number that was never collected.
export const findStatsForDoctor = async (doctorId, dateFrom, dateTo) => {
  const db = getDB();

  const [[row]] = await db.query(
    `SELECT
        COUNT(*) AS appointments_total,
        COALESCE(SUM(a.status = ?), 0) AS completed,
        COALESCE(SUM(a.status = ?), 0) AS cancelled,
        COALESCE(SUM(
          a.status <> ?
          AND TIMESTAMP(a.appointment_date, a.appointment_time) > NOW()
        ), 0) AS upcoming,
        COUNT(DISTINCT a.user_id) AS distinct_patients,
        COALESCE(SUM(CASE WHEN a.status = ? THEN a.amount ELSE 0 END), 0) AS earnings
       FROM appointments a
      WHERE a.doctor_id = ?
        AND a.appointment_date BETWEEN ? AND ?`,
    [
      APPOINTMENT_STATUS.COMPLETED,
      APPOINTMENT_STATUS.CANCELLED,
      APPOINTMENT_STATUS.CANCELLED,
      APPOINTMENT_STATUS.COMPLETED,
      doctorId,
      dateFrom,
      dateTo,
    ],
  );

  return row;
};
