import React, { useContext } from 'react';
import { Route, Routes, Navigate } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

import Login from './pages/Login';

import Dashboard from './pages/Admin/Dashboard';
import AllAppointments from './pages/Admin/AllAppointments';
import AddDoctor from './pages/Admin/AddDoctor';
import AddAdmin from './pages/Admin/AddAdmin';
import AdminProfile from './pages/Admin/AdminProfile';
import EditDoctor from './pages/Admin/EditDoctor';
import DoctorsList from './pages/Admin/DoctorsList';

import DoctorDashboard from './pages/Doctor/DoctorDashboard';
import DoctorAppointments from './pages/Doctor/DoctorAppointments';
import DoctorAppointmentDetail from './pages/Doctor/DoctorAppointmentDetail';
import DoctorProfile from './pages/Doctor/DoctorProfile';
import DoctorSetPassword from './pages/Doctor/DoctorSetPassword';

import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import { AdminContext } from './context/AdminContext';
import { DoctorContext } from './context/DoctorContext';

function App() {
  const { aToken } = useContext(AdminContext);
  const { dToken } = useContext(DoctorContext);

  return aToken || dToken ? (
    // AUTHENTICATED ROUTES (user is logged in)
    <div className="bg-[#F8F9FD]">
      <ToastContainer />
      <Navbar />
      <div className="flex items-start">
        <Sidebar />
        {aToken ? (
          <Routes>
            <Route path="/" element={<></>} />
            <Route path="/admin/dashboard" element={<Dashboard />} />
            <Route path="/admin/appointments" element={<AllAppointments />} />
            <Route path="/admin/add-doctor" element={<AddDoctor />} />
            <Route path="/admin/add-admin" element={<AddAdmin />} />
            <Route path="/admin/profile" element={<AdminProfile />} />
            <Route path="/admin/edit-doctor/:id" element={<EditDoctor />} />
            <Route path="/admin/doctors-list" element={<DoctorsList />} />
            <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
          </Routes>
        ) : (
          <Routes>
            <Route path="/" element={<></>} />
            <Route path="/doctor/dashboard" element={<DoctorDashboard />} />
            <Route path="/doctor/appointments" element={<DoctorAppointments />} />
            <Route
              path="/doctor-appointment-details/:id"
              element={<DoctorAppointmentDetail />}
            />
            <Route path="/doctor/profile" element={<DoctorProfile />} />
            <Route path="*" element={<Navigate to="/doctor/dashboard" replace />} />
          </Routes>
        )}
      </div>
    </div>
  ) : (
    // PUBLIC ROUTES (no authentication required)
    <>
      <ToastContainer />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/doctor/set-password" element={<DoctorSetPassword />} />
        <Route path="*" element={<Login />} />
      </Routes>
    </>
  );
}

export default App;
