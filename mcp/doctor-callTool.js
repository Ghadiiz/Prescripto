import { runDoctorTool } from '../backend/src/assistant/runDoctorTool.js';
import { createCallTool } from './callTool.js';
import { createDoctorContext } from './doctor-context.js';

// The DOCTOR binding of the audited bridge.
//
// Three lines, and each names one half of rule 6's separation:
//
//   - createDoctorContext reads PRESCRIPTO_DOCTOR_TOKEN_FILE and verifies a
//     DOCTOR token, producing `{ doctorId, role }`.
//   - runDoctorTool is bound to the doctor registry and logs `doctors.id` as
//     the audit identity.
//
// Neither is reachable from patient-server.js, and neither is selected by
// anything a model sends.
const doctor = createCallTool({
  createContext: createDoctorContext,
  runTool: runDoctorTool,
});

export const callDoctorTool = doctor.callTool;
export const sessionId = doctor.sessionId;
