import authRoutes from './auth/routes/authRoutes.js';
import doctorRoutes from './doctors/routes/doctorRoutes.js';
import appointmentRoutes from './appointments/routes/appointmentRoutes.js';
import adminRoutes from './admin/routes/adminRoutes.js';
import doctorPanelRoutes from './doctors/routes/doctorPanelRoutes.js';
import assistantRoutes from './assistant/assistantRoutes.js';
import notificationRoutes from './notifications/routes/notificationRoutes.js';

// The one list of what is mounted where.
//
// server.js mounts from this, and the 6.3 documentation-coverage test
// enumerates the SAME list. That is what makes "every endpoint is documented"
// an assertion about the real API rather than about a list the test keeps for
// itself: a router added to the app is necessarily a router the test walks.
//
// It exists as a table rather than being read back off the app because
// Express 5 does not expose a mounted layer's prefix — `app.router.stack` is
// there, but `layer.regexp` is `undefined` (measured on 5.2.1), so a full path
// cannot be reconstructed from the app object.
//
// `tag` is the OpenAPI grouping the endpoints under each prefix belong to, so
// the tag list in the spec and the mount table cannot drift apart either.
export const API_ROUTES = [
  { prefix: '/api/auth', router: authRoutes, tag: 'Auth' },
  { prefix: '/api/doctors', router: doctorRoutes, tag: 'Doctors' },
  { prefix: '/api/appointments', router: appointmentRoutes, tag: 'Appointments' },
  { prefix: '/api/admin', router: adminRoutes, tag: 'Admin' },
  { prefix: '/api/doctor', router: doctorPanelRoutes, tag: 'Doctor panel' },
  { prefix: '/api/assistant', router: assistantRoutes, tag: 'Assistant' },
  { prefix: '/api/notifications', router: notificationRoutes, tag: 'Notifications' },
];

// Express path params (`/:id`) to OpenAPI path templates (`/{id}`), and the
// trailing slash a router's own `'/'` route produces normalised away, so
// `/api/doctors/` and `/api/doctors` are the same path in the spec.
export const toOpenApiPath = (path) => {
  const templated = path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
  return templated.length > 1 ? templated.replace(/\/$/, '') : templated;
};

// Every endpoint the app actually serves, as `{ method, path }`.
//
// Walks each router's own stack, so it reflects what Express will route rather
// than what anyone wrote down.
export const listApiEndpoints = () => {
  const endpoints = [];

  for (const { prefix, router, tag } of API_ROUTES) {
    for (const layer of router.stack ?? []) {
      if (!layer.route) continue;

      for (const method of Object.keys(layer.route.methods)) {
        endpoints.push({
          method: method.toUpperCase(),
          path: toOpenApiPath(`${prefix}${layer.route.path}`),
          tag,
        });
      }
    }
  }

  return endpoints;
};
