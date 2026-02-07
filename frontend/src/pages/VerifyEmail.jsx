import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { toast } from 'react-toastify';

const VerifyEmail = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('verifying');
  const [message, setMessage] = useState('');

  const backendUrl = import.meta.env.VITE_BACKEND_URL;

  const verifyEmail = async () => {
    const token = searchParams.get('token');

    if (!token) {
      setStatus('error');
      setMessage('Invalid verification link. No token provided.');
      return;
    }

    try {
      const { data } = await axios.post(`${backendUrl}/api/auth/verify-email`, {
        token,
      });

      if (data.success) {
        setStatus('success');
        setMessage('Email verified successfully! Redirecting to login...');
        toast.success('Email verified! You can now login.');

        setTimeout(() => {
          navigate('/login');
        }, 3000);
      } else {
        setStatus('error');
        setMessage(data.message || 'Verification failed. Please try again.');
        toast.error(data.message);
      }
    } catch (error) {
      setStatus('error');
      setMessage(
        error.response?.data?.message ||
          'Verification failed. The link may be expired or invalid.',
      );
      toast.error('Verification failed');
    }
  };

  useEffect(() => {
    verifyEmail();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full text-center">
        {status === 'verifying' && (
          <>
            <div className="mb-6">
              <div className="inline-block animate-spin rounded-full h-16 w-16 border-b-4 border-primary"></div>
            </div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">
              Verifying Your Email
            </h2>
            <p className="text-gray-600">
              Please wait while we verify your email address...
            </p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="mb-6">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full">
                <svg
                  className="w-8 h-8 text-green-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
            </div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">
              Email Verified!
            </h2>
            <p className="text-gray-600 mb-6">{message}</p>
            <button
              onClick={() => navigate('/login')}
              className="bg-primary text-white px-8 py-3 rounded-full hover:bg-primary/90 transition-all"
            >
              Go to Login
            </button>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="mb-6">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-red-100 rounded-full">
                <svg
                  className="w-8 h-8 text-red-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </div>
            </div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">
              Verification Failed ❌
            </h2>
            <p className="text-gray-600 mb-6">{message}</p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => navigate('/login')}
                className="bg-primary text-white px-8 py-3 rounded-full hover:bg-primary/90 transition-all"
              >
                Back to Login
              </button>
              <button
                onClick={() => navigate('/resend-verification')}
                className="border border-primary text-primary px-8 py-3 rounded-full hover:bg-primary hover:text-white transition-all"
              >
                Resend Verification Email
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default VerifyEmail;
