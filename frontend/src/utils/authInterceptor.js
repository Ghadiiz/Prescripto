import axios from 'axios';
import { toast } from 'react-toastify';

axios.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const hadAuthHeader = Boolean(error.config?.headers?.Authorization);

    if (hadAuthHeader && (status === 401 || status === 403)) {
      localStorage.removeItem('token');
      if (window.location.pathname !== '/login') {
        toast.error('Your session has expired. Please log in again.');
        setTimeout(() => {
          window.location.href = '/login';
        }, 800);
      }
    }

    return Promise.reject(error);
  },
);
