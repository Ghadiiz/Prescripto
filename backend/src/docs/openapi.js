import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import swaggerJSDoc from 'swagger-jsdoc';

import { API_ROUTES } from '../routes.js';

// The OpenAPI document, built from the JSDoc beside each route.
//
// WHAT THESE DOCS ARE FOR, and what they are deliberately not:
//
// They describe the CONTRACT — method, path, auth requirement, request shape,
// response shapes, status codes. They are public in production, so they must
// not double as a map of the defences.
//
// Deliberately absent, and it must stay that way:
//
//   - how the assistant's guardrails decide anything;
//   - which claims the auth middleware checks, or in what order;
//   - the mechanics of join_waitlist's confirmation, beyond that one is
//     required;
//   - the 401 TAXONOMY. A client needs to know a 401 is possible. It does not
//     need to be able to tell an expired token from a forged one from the
//     wrong role — that distinction is a probing aid, and the codes that carry
//     it stay internal.
//
// Every example here is SYNTHETIC. No real token, no real patient or doctor,
// no address from the seed. tests/openapi.test.js asserts this rather than
// trusting it: it scans the generated document for JWT-shaped strings and for
// email domains other than example.invalid.

const here = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(here, '..', '..');

// Windows paths to glob patterns.
//
// `resolve()` yields backslashes, and glob reads a backslash as an escape
// character — so `src/**/routes/*.js` matched NOTHING and the spec came out
// with a single path. Silently, because a glob matching no files is not an
// error. Worth a named helper rather than an inline replace, since the failure
// it prevents looks like "the annotations are wrong" rather than "the path is".
const toGlob = (path) => path.replaceAll('\\', '/');

// A placeholder that could never be mistaken for a credential. Not a truncated
// real token, not a plausible-looking fake — the test rejects anything
// beginning `eyJ`.
export const EXAMPLE_BEARER = '<paste-your-access-token-here>';

const definition = {
  openapi: '3.0.3',
  info: {
    title: 'Prescripto API',
    version: '1.0.0',
    description: [
      'Medical appointment booking API — patients browse doctors and book',
      'appointments, doctors manage their schedule, admins manage doctors.',
      '',
      '**Authentication.** Most endpoints need a bearer token obtained from the',
      'relevant login endpoint. Patient, doctor and admin tokens are distinct',
      'and are not interchangeable: an endpoint expecting one will refuse the',
      'others.',
      '',
      '**Try it out is disabled.** The browser sends this page’s own origin,',
      'which is not in the API’s allowed-origins list, so every in-page request',
      'would be rejected before reaching a handler. Rather than offer a button',
      'that always fails, it is turned off — use curl or the frontend apps.',
      '',
      'All examples on this page are synthetic.',
    ].join('\n'),
  },
  servers: [
    { url: '/', description: 'This server' },
  ],
  tags: API_ROUTES.map(({ tag }) => ({ name: tag })),
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'A token from the matching login endpoint. Patient, doctor and ' +
          'admin tokens are separate and cannot be substituted for one another.',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          message: {
            type: 'string',
            description: 'A human-readable summary. Not machine-parseable.',
            example: 'Request could not be completed.',
          },
        },
      },
      Speciality: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 3 },
          name: { type: 'string', example: 'Dermatologist' },
        },
      },
      Doctor: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 12 },
          name: { type: 'string', example: 'Dr. Placeholder Example' },
          speciality: { type: 'string', example: 'Dermatologist' },
          degree: { type: 'string', example: 'MBBS' },
          experience: { type: 'string', example: '5 Years' },
          about: { type: 'string', example: 'Short profile text.' },
          fees: { type: 'number', example: 50 },
          area: { type: 'string', example: 'Khalda' },
          address_line1: { type: 'string', example: '1 Example Street' },
          address_line2: { type: 'string', example: 'Khalda, Amman' },
          available: { type: 'boolean', example: true },
          image: { type: 'string', format: 'uri', example: 'https://cdn.example.invalid/d.jpg' },
        },
      },
      Appointment: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 481 },
          appointment_date: { type: 'string', format: 'date', example: '2031-03-04' },
          appointment_time: { type: 'string', example: '10:30:00' },
          status: {
            type: 'string',
            enum: ['pending', 'completed', 'cancelled'],
            example: 'pending',
          },
          amount: { type: 'number', example: 50 },
          cancellation_reason: { type: 'string', nullable: true, example: null },
        },
      },
      Notification: {
        type: 'object',
        properties: {
          id: { type: 'integer', example: 91 },
          type: { type: 'string', example: 'waitlist_slot_open' },
          payload: {
            type: 'object',
            description: 'Shape depends on `type`.',
            example: {
              doctor_id: 12,
              doctor_name: 'Dr. Placeholder Example',
              date: '2031-03-04',
              slot_time: '10:30 AM',
            },
          },
          read_at: { type: 'string', format: 'date-time', nullable: true, example: null },
          created_at: { type: 'string', format: 'date-time', example: '2031-03-01T09:00:00.000Z' },
        },
      },
    },
    responses: {
      // Generic on purpose. The client needs to know these are possible; the
      // conditions that distinguish them are not documented.
      Unauthorized: {
        description: 'Authentication required, or the token was not accepted.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      Forbidden: {
        description: 'Authenticated, but not permitted to perform this action.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      NotFound: {
        description: 'No such resource.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      BadRequest: {
        description: 'The request was rejected by validation.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      TooManyRequests: {
        description: 'Rate limited. Retry later.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      ServiceUnavailable: {
        description: 'The server is starting up. Retry shortly.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
    },
  },
};

// Absolute globs, derived from this file's own location rather than from the
// working directory — the same reason mcp/env.js resolves backend/.env that
// way. `npm start` and the test runner have different cwds.
export const buildOpenApiSpec = () =>
  swaggerJSDoc({
    definition,
    // Forward slashes, always. `resolve()` yields backslashes on Windows and
    // glob treats those as escape characters, so the recursive pattern matched
    // nothing and the spec came out with a single path — silently, because a
    // glob that matches no files is not an error.
    apis: [
      toGlob(resolve(backendRoot, 'src/**/routes/*.js')),
      toGlob(resolve(backendRoot, 'src/assistant/assistantRoutes.js')),
    ],
  });

export const openApiSpec = buildOpenApiSpec();
