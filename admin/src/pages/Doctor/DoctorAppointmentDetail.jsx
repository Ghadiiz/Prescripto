import React, { useContext, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DoctorContext } from '../../context/DoctorContext';
import { AppContext } from '../../context/AppContext';
import axios from 'axios';
import { toast } from 'react-toastify';
import { assets } from '../../assets/assets';

const DoctorAppointmentDetail = () => {
  const { id } = useParams();
  const { backendUrl, dToken, cancelAppointment, completeAppointment } =
    useContext(DoctorContext);
  const { calculateAge } = useContext(AppContext);
  const navigate = useNavigate();

  const [appointment, setAppointment] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchAppointmentDetails = async () => {
    try {
      if (!dToken) {
        navigate('/login');
        return;
      }

      const { data } = await axios.get(
        `${backendUrl}/api/doctor/appointments/${id}`,
        { headers: { Authorization: `Bearer ${dToken}` } },
      );

      if (data.success) {
        setAppointment(data.appointment);
      } else {
        toast.error(data.message);
        navigate('/doctor-appointments');
      }
    } catch (error) {
      console.log(error);
      toast.error('Failed to load appointment details');
      navigate('/doctor-appointments');
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = async () => {
    const success = await completeAppointment(id);
    if (success) {
      fetchAppointmentDetails();
    }
  };

  const handleCancel = async () => {
    const success = await cancelAppointment(id);
    if (success) {
      fetchAppointmentDetails();
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    const day = date.getDate();
    const monthNames = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];
    const month = monthNames[date.getMonth()];
    const year = date.getFullYear();
    return `${day} ${month} ${year}`;
  };

  useEffect(() => {
    fetchAppointmentDetails();
  }, [id]);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <p>Loading appointment details...</p>
      </div>
    );
  }

  if (!appointment) {
    return (
      <div className="flex flex-col justify-center items-center h-screen">
        <p className="text-gray-500 mb-4">Appointment not found</p>
        <button
          onClick={() => navigate('/doctor/appointments')}
          className="bg-primary text-white px-8 py-3 rounded-full"
        >
          Back to Appointments
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl m-5">
      <button
        onClick={() => navigate('/doctor/appointments')}
        className="flex items-center gap-2 text-gray-600 hover:text-gray-800 mb-6"
      >
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 19l-7-7 7-7"
          />
        </svg>
        Back to Appointments
      </button>

      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-gray-800">
            Appointment Details
          </h1>
          <div>
            {appointment.status?.toLowerCase() === 'cancelled' ? (
              <span className="inline-block bg-red-100 text-red-700 text-sm font-semibold px-4 py-2 rounded-full">
                ● Cancelled
              </span>
            ) : appointment.status?.toLowerCase() === 'completed' ? (
              <span className="inline-block bg-green-100 text-green-700 text-sm font-semibold px-4 py-2 rounded-full">
                ● Completed
              </span>
            ) : (
              <span className="inline-block bg-blue-100 text-blue-700 text-sm font-semibold px-4 py-2 rounded-full">
                ● Pending
              </span>
            )}
          </div>
        </div>
        <p className="text-gray-500 text-sm">
          Appointment ID: #{appointment.id}
        </p>
      </div>

      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">
          Patient Information
        </h2>
        <div className="flex gap-6">
          <img
            src={appointment.patientImage || assets.profile_pic}
            alt={appointment.patientName}
            className="w-24 h-24 rounded-full object-cover"
          />
          <div className="flex-1">
            <h3 className="text-2xl font-bold text-gray-800 mb-2">
              {appointment.patientName || 'Unknown Patient'}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-gray-500">Email</p>
                <p className="text-gray-800 font-medium">
                  {appointment.patientEmail || 'N/A'}
                </p>
              </div>
              <div>
                <p className="text-gray-500">Phone</p>
                <p className="text-gray-800 font-medium">
                  {appointment.patientPhone || 'N/A'}
                </p>
              </div>
              <div>
                <p className="text-gray-500">Gender</p>
                <p className="text-gray-800 font-medium">
                  {appointment.patientGender || 'N/A'}
                </p>
              </div>
              <div>
                <p className="text-gray-500">Age</p>
                <p className="text-gray-800 font-medium">
                  {appointment.patientDob
                    ? calculateAge(appointment.patientDob)
                    : 'N/A'}
                </p>
              </div>
            </div>
            {appointment.patientAddress && (
              <div className="mt-3">
                <p className="text-gray-500 text-sm">Address</p>
                <p className="text-gray-800 text-sm">
                  {appointment.patientAddress.line1}
                  {appointment.patientAddress.line2 && (
                    <>
                      <br />
                      {appointment.patientAddress.line2}
                    </>
                  )}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">
          Appointment Information
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-gray-500 mb-1">Date</p>
            <p className="text-lg font-medium text-gray-800">
              {formatDate(appointment.appointmentDate || appointment.slotDate)}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500 mb-1">Time</p>
            <p className="text-lg font-medium text-gray-800">
              {appointment.appointmentTime || appointment.slotTime}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500 mb-1">Appointment Fee</p>
            <p className="text-lg font-medium text-gray-800">
              ${appointment.amount || 0}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500 mb-1">Payment Method</p>
            <p className="text-lg font-medium">
              {appointment.payment ? (
                <span className="inline-flex items-center gap-1 text-sm font-semibold text-green-600 bg-green-50 px-3 py-1 rounded-full">
                  💳 Online Payment
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 bg-blue-50 px-3 py-1 rounded-full">
                  💵 Cash on Arrival
                </span>
              )}
            </p>
          </div>
        </div>

        {appointment.status?.toLowerCase() === 'cancelled' &&
          appointment.cancellationReason && (
            <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm font-medium text-red-800 mb-1">
                Cancellation Reason:
              </p>
              <p className="text-sm text-red-700">
                {appointment.cancellationReason}
              </p>
            </div>
          )}
      </div>

      {appointment.status?.toLowerCase() === 'pending' && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">Actions</h2>
          <div className="flex gap-3">
            <button
              onClick={handleComplete}
              className="flex items-center gap-2 px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-all"
            >
              <img
                src={assets.tick_icon}
                alt="Complete"
                className="w-5 h-5 invert"
              />
              Mark as Completed
            </button>
            <button
              onClick={handleCancel}
              className="flex items-center gap-2 px-6 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-all"
            >
              <img
                src={assets.cancel_icon}
                alt="Cancel"
                className="w-5 h-5 invert"
              />
              Cancel Appointment
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DoctorAppointmentDetail;
