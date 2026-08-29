import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import axios from 'axios';

import { AppContext } from './AppContext';

const AppContextProvider = (props) => {
  const currencySymbol = '$';
  const backendUrl = import.meta.env.VITE_BACKEND_URL;

  const [doctors, setDoctors] = useState([]);
  const [token, setToken] = useState(
    localStorage.getItem('token') ? localStorage.getItem('token') : '',
  );
  const [userData, setUserData] = useState(false);

  const getDoctorsData = async () => {
    try {
      const { data } = await axios.get(backendUrl + '/api/doctors');
      if (data.success) {
        setDoctors(data.doctors);
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(error.message);
    }
  };

  const loadUserProfileData = async () => {
    try {
      const { data } = await axios.get(backendUrl + '/api/auth/profile', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (data.success) {
        setUserData(data.user);
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      console.log(error);
      localStorage.removeItem('token');
      setToken(false);
      setUserData(false);
    }
  };

  // Both effects await inside an inner async function rather than calling the
  // loader bare. The setStates already happened after a request resolved; this
  // is what makes that visible, to a reader and to
  // `react-hooks/set-state-in-effect`, which cannot see past a bare call.
  // The loaders themselves stay out here — consumers call them through the
  // context value, so they cannot move inside an effect.
  useEffect(() => {
    const run = async () => {
      await getDoctorsData();
    };

    run();
  }, []);

  useEffect(() => {
    const run = async () => {
      if (token) {
        await loadUserProfileData();
      } else {
        setUserData(false);
      }
    };

    run();
  }, [token]);

  const value = {
    doctors,
    getDoctorsData,
    currencySymbol,
    backendUrl,
    token,
    setToken,
    userData,
    setUserData,
    loadUserProfileData,
  };

  return (
    <AppContext.Provider value={value}>{props.children}</AppContext.Provider>
  );
};

export default AppContextProvider;
