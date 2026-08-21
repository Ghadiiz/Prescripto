import axios from 'axios';
import { toast } from 'react-toastify';

// What "your session expired" means, in one place.
//
// Exported because the assistant panel streams over `fetch`, not axios, so it
// never reaches the interceptor below. Two copies of this logic would drift —
// one would forget to clear localStorage, or would redirect from /login back
// to /login.
export const handleAuthFailure = () => {
  localStorage.removeItem('token');

  if (window.location.pathname !== '/login') {
    toast.error('Your session has expired. Please log in again.');
    setTimeout(() => {
      window.location.href = '/login';
    }, 800);
  }
};

axios.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const hadAuthHeader = Boolean(error.config?.headers?.Authorization);

    if (hadAuthHeader && (status === 401 || status === 403)) {
      handleAuthFailure();
    }

    return Promise.reject(error);
  },
);
