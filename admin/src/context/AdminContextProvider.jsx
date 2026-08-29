import axios from 'axios';
import { useState } from 'react';
import { toast } from 'react-toastify';

import { AdminContext } from './AdminContext';

const AdminContextProvider = (props) => {
  const backendUrl = import.meta.env.VITE_BACKEND_URL;

  const [aToken, setAToken] = useState(sessionStorage.getItem('aToken') || '');

  const [appointments, setAppointments] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [dashData, setDashData] = useState(false);
  // Dropdown options for the doctor forms, served by the backend so the lists
  // the forms offer and the lists the API validates against are the same.
  // Empty arrays keep .map() safe before the fetch lands.
  const [doctorOptions, setDoctorOptions] = useState({
    specialities: [],
    areas: [],
    genders: [],
    languages: [],
  });

  const getDoctorOptions = async () => {
    try {
      const { data } = await axios.get(backendUrl + '/api/admin/doctor-options', {
        headers: { Authorization: `Bearer ${aToken}` },
      });
      if (data.success) {
        setDoctorOptions(data.data);
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      console.error('Get doctor options error:', error);
      toast.error(error.response?.data?.message || error.message);
    }
  };

  const getAllDoctors = async () => {
    try {
      const { data } = await axios.get(backendUrl + '/api/admin/doctors', {
        headers: { Authorization: `Bearer ${aToken}` },
      });
      if (data.success) {
        setDoctors(data.data || data.doctors || []);
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      console.error('Get doctors error:', error);
      toast.error(error.response?.data?.message || error.message);
    }
  };

  const changeAvailability = async (docId) => {
    try {
      const { data } = await axios.put(
        backendUrl + `/api/admin/doctors/${docId}/toggle`,
        {},
        { headers: { Authorization: `Bearer ${aToken}` } },
      );
      if (data.success) {
        toast.success(data.message);
        getAllDoctors();
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(error.response?.data?.message || error.message);
    }
  };

  const deleteDoctor = async (docId) => {
    try {
      const { data } = await axios.delete(
        backendUrl + `/api/admin/doctors/${docId}`,
        { headers: { Authorization: `Bearer ${aToken}` } },
      );
      if (data.success) {
        toast.success(data.message);
        getAllDoctors();
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      console.error('Delete doctor error:', error);

      const errorMsg =
        error.response?.data?.message ||
        'Cannot delete doctor. They may have existing appointments.';
      toast.error(errorMsg);
    }
  };

  const updateDoctor = async (docId, formData) => {
    try {
      const { data } = await axios.put(
        backendUrl + `/api/admin/doctors/${docId}`,
        formData,
        { headers: { Authorization: `Bearer ${aToken}` } },
      );
      if (data.success) {
        toast.success(data.message);
        getAllDoctors();
        return true;
      } else {
        toast.error(data.message);
        return false;
      }
    } catch (error) {
      console.error('Update doctor error:', error);
      toast.error(error.response?.data?.message || error.message);
      return false;
    }
  };

  const getAllAppointments = async () => {
    try {
      const { data } = await axios.get(backendUrl + '/api/admin/appointments', {
        headers: { Authorization: `Bearer ${aToken}` },
      });
      if (data.success) {
        const appointmentsList = data.data || data.appointments || [];
        setAppointments(appointmentsList.reverse());
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      console.error('Get appointments error:', error);
      toast.error(error.response?.data?.message || error.message);
    }
  };

  const getDashData = async () => {
    try {
      const { data } = await axios.get(backendUrl + '/api/admin/dashboard', {
        headers: { Authorization: `Bearer ${aToken}` },
      });

      if (data.success) {
        setDashData(data.data || false);
        getAllAppointments();
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(error.response?.data?.message || error.message);
    }
  };

  const value = {
    aToken,
    setAToken,
    backendUrl,
    doctors,
    getAllDoctors,
    doctorOptions,
    getDoctorOptions,
    changeAvailability,
    deleteDoctor,
    updateDoctor,
    appointments,
    getAllAppointments,
    getDashData,
    dashData,
  };

  return (
    <AdminContext.Provider value={value}>
      {props.children}
    </AdminContext.Provider>
  );
};

export default AdminContextProvider;
