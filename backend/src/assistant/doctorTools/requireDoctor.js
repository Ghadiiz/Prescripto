// The identity check every doctor tool runs first.
//
// Rule 3 says identity comes from ctx, never from args. That is only half the
// guarantee — the other half is that the ctx is the right KIND. A doctor tool
// handed a patient ctx must return nothing rather than treating `userId` as a
// doctor id, because the two are different id spaces and the numbers overlap:
// patient #7 and doctor #7 both exist.
//
// Mirrors the guard in tools/myAppointments.js, from the opposite side.
export const requireDoctor = (ctx) => {
  if (!ctx || !Number.isInteger(ctx.doctorId) || ctx.role !== 'doctor') {
    return {
      error: 'unavailable',
      message:
        'This tool is only available to a signed-in doctor acting on their ' +
        'own behalf.',
    };
  }

  return null;
};
