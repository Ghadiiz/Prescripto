import axios from 'axios';
import React, { useContext, useState } from 'react';
import { DoctorContext } from '../context/DoctorContext';
import { AdminContext } from '../context/AdminContext';
import { toast } from 'react-toastify';

const Login = () => {
  const [state, setState] = useState('Admin');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const backendUrl = import.meta.env.VITE_BACKEND_URL;

  const { setDToken } = useContext(DoctorContext);
  const { setAToken } = useContext(AdminContext);

  const onSubmitHandler = async (event) => {
    event.preventDefault();

    try {
      if (state === 'Admin') {
        const { data } = await axios.post(backendUrl + '/api/admin/login', {
          email,
          password,
        });
        if (data.success) {
          setAToken(data.data.token);
          sessionStorage.setItem('aToken', data.data.token);
          sessionStorage.removeItem('dToken');
          setDToken('');
          toast.success('Admin logged in successfully');
        } else {
          toast.error(data.message);
        }
      } else {
        const { data } = await axios.post(backendUrl + '/api/doctor/login', {
          email,
          password,
        });
        if (data.success) {
          setDToken(data.token);
          sessionStorage.setItem('dToken', data.token);
          sessionStorage.removeItem('aToken');
          setAToken('');
          toast.success('Doctor logged in successfully');
        } else {
          toast.error(data.message);
        }
      }
    } catch (error) {
      console.log('Error:', error);
      toast.error(error.response?.data?.message || 'Login failed');
    }
  };

  return (
    <form onSubmit={onSubmitHandler} className="min-h-[80vh] flex items-center">
      <div className="flex flex-col gap-3 m-auto items-start p-8 min-w-[340px] sm:min-w-96 border rounded-xl text-[#5E5E5E] text-sm shadow-lg">
        <p className="text-2xl font-semibold m-auto">
          <span className="text-primary">{state}</span> Login
        </p>
        <div className="w-full ">
          <p>Email</p>
          <input
            onChange={(e) => setEmail(e.target.value)}
            value={email}
            className="border border-[#DADADA] rounded w-full p-2 mt-1"
            type="email"
            required
          />
        </div>
        <div className="w-full ">
          <p>Password</p>
          <input
            onChange={(e) => setPassword(e.target.value)}
            value={password}
            className="border border-[#DADADA] rounded w-full p-2 mt-1"
            type="password"
            required
          />
        </div>
        <div className="w-full mb-2 p-3 rounded-md bg-blue-50 border border-blue-100 text-xs text-gray-600">
          <p className="font-medium text-gray-700 mb-1">Demo {state} login:</p>
          {state === 'Admin' ? (
            <>
              <p>Email: admin@prescripto.com</p>
              <p>Password: admin123</p>
            </>
          ) : (
            <>
              <p>Email: richard@example.com</p>
              <p>Password: doctor123</p>
            </>
          )}
        </div>

        <button className="bg-primary text-white w-full py-2 rounded-md text-base">
          Login
        </button>
        {state === 'Admin' ? (
          <p>
            Doctor Login?{' '}
            <span
              onClick={() => setState('Doctor')}
              className="text-primary underline cursor-pointer"
            >
              Click here
            </span>
          </p>
        ) : (
          <p>
            Admin Login?{' '}
            <span
              onClick={() => setState('Admin')}
              className="text-primary underline cursor-pointer"
            >
              Click here
            </span>
          </p>
        )}
      </div>
    </form>
  );
};

export default Login;
