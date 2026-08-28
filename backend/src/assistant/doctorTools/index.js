// The DOCTOR tool registry.
//
// Doctor-scoped only, and a SEPARATE list from tools/index.js by design, not
// by accident of organisation. Rule 6: patient tools and doctor tools are
// separate servers, separate processes, separate auth — never one registry
// with a `role` parameter deciding which half you get.
//
// What that buys, concretely: the blast radius of a mistake in this directory
// is doctors, and the blast radius of a mistake in tools/ is patients. Neither
// is ever the union of both.
//
// 5.6 registers this over mcp/doctor-server.js. Nothing here is reachable from
// the patient chat endpoint or from mcp/patient-server.js, which refuses to
// start if any of these names appears in its registry.

import mySchedule from './mySchedule.js';
import scheduleGaps from './scheduleGaps.js';
import patientsNeedingFollowup from './patientsNeedingFollowup.js';
import myStats from './myStats.js';

export const doctorTools = [
  mySchedule,
  scheduleGaps,
  patientsNeedingFollowup,
  myStats,
];

// Rule 2 has one exception and it is join_waitlist, a PATIENT tool. There is
// no doctor write tool and none is planned: a doctor cancelling or completing
// an appointment does it in the panel, where a human is looking at the row.
export const readOnlyDoctorTools = doctorTools.filter((tool) => !tool.mutates);

export const getDoctorTool = (name) =>
  doctorTools.find((tool) => tool.name === name);
