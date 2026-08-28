import { createToolRunner } from './runTool.js';
import { doctorTools } from './doctorTools/index.js';

// The DOCTOR runner — the doctor-side equivalent of `runTool`.
//
// One line, and both halves of it matter:
//
//   - `doctorTools` is the registry, bound here rather than chosen per call.
//     Nothing a model sends can reach a patient tool through this runner.
//   - `(ctx) => ctx.doctorId` is the audit identity, because a doctor ctx has
//     no `userId`. `assistant_audit_log.user_id` is NOT NULL and 003's `role`
//     ENUM is what tells the two id spaces apart in that column.
//
// Getting the second one wrong would file a doctor's calls under a patient's
// id, so a test asserts the row's `role` and `user_id` for a real call.
export const runDoctorTool = createToolRunner(
  doctorTools,
  (ctx) => ctx?.doctorId,
);
