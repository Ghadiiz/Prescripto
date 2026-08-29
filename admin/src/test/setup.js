import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// Unmounts anything rendered between tests.
//
// Without it a component from one test is still in the document during the
// next, and a query like getByText finds the older one — a test that passes
// for the wrong reason, which is the failure mode this whole suite exists to
// avoid.
afterEach(() => {
  cleanup();
});
