import React, { useContext, useEffect, useState } from 'react';
import { AppContext } from '../context/AppContext';
import axios from 'axios';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';

const Login = () => {
  const [state, setState] = useState('Login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const navigate = useNavigate();
  const { backendUrl, token, setToken } = useContext(AppContext);

  const onSubmitHandler = async (event) => {
    event.preventDefault();

    try {
      if (state === 'Sign Up') {
        const { data } = await axios.post(backendUrl + '/api/auth/register', {
          name,
          email,
          password,
        });
        if (data.success) {
          toast.success(
            'Account created! Please check your email to verify your account.',
          );

          setState('Login');
          setName('');
          setEmail('');
          setPassword('');
        } else {
          toast.error(data.message);
        }
      } else {
        const { data } = await axios.post(backendUrl + '/api/auth/login', {
          email,
          password,
        });
        if (data.success) {
          localStorage.setItem('token', data.token);
          setToken(data.token);
          toast.success('Login successful!');
        } else {
          toast.error(data.message);
        }
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Something went wrong');
    }
  };

  useEffect(() => {
    if (token) {
      navigate('/');
    }
  }, [token]);

  return (
    <form onSubmit={onSubmitHandler} className="min-h-[80vh] flex items-center">
      <div className="flex flex-col gap-3 m-auto items-start p-8 min-w-[340px] sm:min-w-96 border rounded-xl text-zinc-600 text-sm shadow-lg">
        <p className="text-2xl font-semibold">
          {state === 'Sign Up' ? 'Create Account' : 'Login'}
        </p>
        <p>
          Please {state === 'Sign Up' ? 'sign up' : 'log in'} to book
          appointment
        </p>
        {state === 'Sign Up' && (
          <div className="w-full">
            <p>Full Name</p>
            <input
              className="border border-zinc-300 rounded w-full p-2 mt-1"
              type="text"
              onChange={(e) => setName(e.target.value)}
              value={name}
              required
            />
          </div>
        )}
        <div className="w-full">
          <p>Email</p>
          <input
            className="border border-zinc-300 rounded w-full p-2 mt-1"
            type="email"
            onChange={(e) => setEmail(e.target.value)}
            value={email}
            required
          />
        </div>
        <div className="w-full">
          <p>Password</p>
          <input
            className="border border-zinc-300 rounded w-full p-2 mt-1"
            type="password"
            onChange={(e) => setPassword(e.target.value)}
            value={password}
            required
          />
        </div>

        {state === 'Login' && (
          <button
            type="button"
            onClick={() => navigate('/forgot-password')}
            className="text-primary text-xs hover:underline self-end -mt-2"
          >
            Forgot Password?
          </button>
        )}

        {state === 'Login' && (
          <div className="w-full mt-1 mb-1 p-3 rounded-md bg-blue-50 border border-blue-100 text-xs text-gray-600">
            <p className="font-medium text-gray-700 mb-1">Demo account (for reviewers):</p>
            <p>Email: demo@prescripto.com</p>
            <p>Password: demo1234</p>
          </div>
        )}

        {state === 'Sign Up' && (
          <p className="w-full text-xs text-center text-gray-500 -mt-1 mb-1">
            Reviewer? Switch to <span className="font-medium">Login</span> to use the demo account.
          </p>
        )}

        <button
          type="submit"
          className="bg-primary text-white w-full py-2 rounded-md text-base"
        >
          {state === 'Sign Up' ? 'Create account' : 'Login'}
        </button>

        {state === 'Sign Up' ? (
          <p>
            Already have an account?{' '}
            <span
              onClick={() => setState('Login')}
              className="text-primary underline cursor-pointer"
            >
              Login here
            </span>
          </p>
        ) : (
          <>
            <p>
              Create a new account?{' '}
              <span
                onClick={() => setState('Sign Up')}
                className="text-primary underline cursor-pointer"
              >
                click here
              </span>
            </p>

            <p className="text-xs text-gray-500">
              Didn't receive verification email?{' '}
              <span
                onClick={() => navigate('/resend-verification')}
                className="text-primary underline cursor-pointer"
              >
                Resend verification
              </span>
            </p>
          </>
        )}
      </div>
    </form>
  );
};

export default Login;
