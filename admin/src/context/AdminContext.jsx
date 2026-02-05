import axios from 'axios';
import { createContext, useState } from 'react';
import { toast } from 'react-toastify';

export const AdminContext = createContext();

const AdminContextProvider = (props) => {
  const backendUrl = import.meta.env.VITE_BACKEND_URL;

  const [aToken, setAToken] = useState(
    localStorage.getItem('aToken') ? localStorage.getItem('aToken') : '',
  );

  const [appointments, setAppointments] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [dashData, setDashData] = useState(false);

  // Getting all Doctors data from Database using API
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

  // Function to change doctor availability using API
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

  // ✅ NEW: Delete doctor function
  // Delete doctor function
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
      // Better error message
      const errorMsg =
        error.response?.data?.message ||
        'Cannot delete doctor. They may have existing appointments.';
      toast.error(errorMsg);
    }
  };

  // ✅ NEW: Update doctor function
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

  // Getting all appointment data from Database using API
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

  // Getting Admin Dashboard data from Database using API
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
    changeAvailability,
    deleteDoctor, // NEW
    updateDoctor, // NEW
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
