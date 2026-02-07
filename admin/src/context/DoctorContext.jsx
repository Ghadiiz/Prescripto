import { createContext, useState } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';

export const DoctorContext = createContext();

const DoctorContextProvider = (props) => {
  const backendUrl = import.meta.env.VITE_BACKEND_URL;

  const [dToken, setDToken] = useState(
    localStorage.getItem('dToken') ? localStorage.getItem('dToken') : '',
  );
  const [appointments, setAppointments] = useState([]);
  const [dashData, setDashData] = useState(false);
  const [profileData, setProfileData] = useState(false);

  const getAppointments = async () => {
    try {
      const { data } = await axios.get(
        backendUrl + '/api/doctor/appointments',
        {
          headers: { Authorization: `Bearer ${dToken}` },
        },
      );

      if (data.success) {
        const appointmentsList = data.appointments || [];
        setAppointments(appointmentsList.reverse());
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(error.response?.data?.message || error.message);
    }
  };

  const getProfileData = async () => {
    try {
      const { data } = await axios.get(backendUrl + '/api/doctor/profile', {
        headers: { Authorization: `Bearer ${dToken}` },
      });

      const profile = data.doctor;
      console.log('Profile data:', profile);
      setProfileData(profile);
    } catch (error) {
      console.log(error);
      toast.error(error.response?.data?.message || error.message);
    }
  };

  const cancelAppointment = async (appointmentId) => {
    try {
      const { data } = await axios.put(
        backendUrl + `/api/doctor/appointments/${appointmentId}/cancel`,
        { cancellationReason: 'Cancelled by doctor' },
        { headers: { Authorization: `Bearer ${dToken}` } },
      );

      if (data.success) {
        toast.success(data.message);
        getAppointments();
        getDashData();
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || error.message);
      console.log(error);
    }
  };

  const completeAppointment = async (appointmentId) => {
    try {
      const { data } = await axios.put(
        backendUrl + `/api/doctor/appointments/${appointmentId}/complete`,
        {},
        { headers: { Authorization: `Bearer ${dToken}` } },
      );

      if (data.success) {
        toast.success(data.message);
        getAppointments();
        getDashData();
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || error.message);
      console.log(error);
    }
  };

  const getDashData = async () => {
    try {
      const { data } = await axios.get(backendUrl + '/api/doctor/dashboard', {
        headers: { Authorization: `Bearer ${dToken}` },
      });

      if (data.success) {
        setDashData(data.data);
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(error.response?.data?.message || error.message);
    }
  };

  const value = {
    dToken,
    setDToken,
    backendUrl,
    appointments,
    getAppointments,
    cancelAppointment,
    completeAppointment,
    dashData,
    getDashData,
    profileData,
    setProfileData,
    getProfileData,
  };

  return (
    <DoctorContext.Provider value={value}>
      {props.children}
    </DoctorContext.Provider>
  );
};

export default DoctorContextProvider;
