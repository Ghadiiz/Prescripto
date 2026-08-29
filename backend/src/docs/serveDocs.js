import swaggerUi from 'swagger-ui-express';

import { openApiSpec } from './openapi.js';

// Mounts the docs. Kept apart from openapi.js so building the spec (which the
// tests do) never pulls in the UI middleware.
//
// MUST be mounted ABOVE `app.use('/api', databaseReady)` — see the comment at
// the call site in server.js.

export const DOCS_PATH = '/api/docs';
export const DOCS_JSON_PATH = '/api/docs.json';

const uiOptions = {
  customSiteTitle: 'Prescripto API',
  swaggerOptions: {
    // "Try it out" is OFF, and this is a measured decision rather than
    // caution.
    //
    // The browser sends this page's own origin on an in-page request, and the
    // API's allowed-origins list holds the two frontends, not the API itself.
    // Measured: a POST carrying the API's own origin is rejected with 403
    // before reaching any handler, while the same POST from the patient app
    // reaches it and answers 401.
    //
    // So the button would be present and would always fail. The alternative —
    // adding the API's own origin to ALLOWED_ORIGINS — widens a production
    // CORS policy to make a documentation convenience work, which is a poor
    // trade. The page says so instead.
    supportedSubmitMethods: [],
    displayRequestDuration: false,
    docExpansion: 'list',
  },
};

export const mountApiDocs = (app) => {
  // The raw document, for generating clients or diffing the contract in CI.
  app.get(DOCS_JSON_PATH, (req, res) => {
    res.json(openApiSpec);
  });

  app.use(DOCS_PATH, swaggerUi.serve, swaggerUi.setup(openApiSpec, uiOptions));

  return app;
};
