import { createContext } from 'react';

// The context object lives alone, with no component beside it, so that editing
// the provider does not cost a full reload under fast refresh. The provider is
// in `DoctorContextProvider.jsx`.
//
// The context KEEPS this filename deliberately: every consumer imports
// `{ DoctorContext }` from here, and moving the object instead of the component
// would have rewritten that import in every file that reads it.
export const DoctorContext = createContext();
