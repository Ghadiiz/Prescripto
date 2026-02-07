import React, { useContext, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppContext } from '../context/AppContext';
import axios from 'axios';
import { toast } from 'react-toastify';
import { assets } from '../assets/assets';

const AppointmentDetail = () => {
  const { id } = useParams();
  const { backendUrl, token, currencySymbol } = useContext(AppContext);
  const navigate = useNavigate();

  const [appointment, setAppointment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancellationReason, setCancellationReason] = useState('');

  const fetchAppointmentDetails = async () => {
    try {
      if (!token) {
        navigate('/login');
        return;
      }

      const { data } = await axios.get(`${backendUrl}/api/appointments/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (data.success) {
        setAppointment(data.appointment);
      } else {
        toast.error(data.message);
        navigate('/my-appointments');
      }
    } catch (error) {
      console.log(error);
      toast.error('Failed to load appointment details');
      navigate('/my-appointments');
    } finally {
      setLoading(false);
    }
  };

  const cancelAppointment = async () => {
    if (!cancellationReason.trim()) {
      toast.error('Please provide a cancellation reason');
      return;
    }

    try {
      const { data } = await axios.put(
        `${backendUrl}/api/appointments/${id}/cancel`,
        { cancellationReason: cancellationReason.trim() },
        { headers: { Authorization: `Bearer ${token}` } },
      );

      if (data.success) {
        toast.success('Appointment cancelled successfully');
        setShowCancelModal(false);
        fetchAppointmentDetails();
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(
        error.response?.data?.message || 'Failed to cancel appointment',
      );
    }
  };

  useEffect(() => {
    fetchAppointmentDetails();
  }, [id]);

  if (loading) {
    return (
      <div className="text-center py-20">
        <p>Loading appointment details...</p>
      </div>
    );
  }

  if (!appointment) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500">Appointment not found</p>
        <button
          onClick={() => navigate('/my-appointments')}
          className="mt-4 bg-primary text-white px-8 py-3 rounded-full"
        >
          Back to Appointments
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <button
        onClick={() => navigate('/my-appointments')}
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
        Back to My Appointments
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
          Appointment ID: #{appointment._id}
        </p>
      </div>

      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">
          Doctor Information
        </h2>
        <div className="flex gap-6">
          <img
            src={appointment.doctor.image}
            alt={appointment.doctor.name}
            className="w-32 h-32 rounded-lg object-cover bg-blue-50"
          />
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-2xl font-bold text-gray-800">
                {appointment.doctor.name}
              </h3>
              <img
                src={assets.verified_icon}
                alt="Verified"
                className="w-5 h-5"
              />
            </div>
            <p className="text-gray-600 mb-2">
              {appointment.doctor.degree} - {appointment.doctor.speciality}
            </p>
            <p className="text-sm text-gray-500 mb-1">
              Experience: {appointment.doctor.experience}
            </p>
            <p className="text-sm text-gray-600 mt-3">
              <span className="font-medium">Address:</span>
              <br />
              {appointment.doctor.address.line1}
              <br />
              {appointment.doctor.address.line2}
            </p>
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
              {appointment.slotDate}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500 mb-1">Time</p>
            <p className="text-lg font-medium text-gray-800">
              {appointment.slotTime}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500 mb-1">Appointment Fee</p>
            <p className="text-lg font-medium text-gray-800">
              {currencySymbol}
              {appointment.amount || appointment.doctor.fees}
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
          <button
            onClick={() => setShowCancelModal(true)}
            className="w-full md:w-auto px-8 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-all"
          >
            Cancel Appointment
          </button>
        </div>
      )}

      {showCancelModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-xl font-semibold text-gray-800 mb-4">
              Cancel Appointment
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Please provide a reason for cancellation:
            </p>

            <textarea
              className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              rows="4"
              placeholder="Enter cancellation reason (required)"
              value={cancellationReason}
              onChange={(e) => setCancellationReason(e.target.value)}
              maxLength={500}
            />

            <p className="text-xs text-gray-500 mt-1 mb-4">
              {cancellationReason.length}/500 characters
            </p>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowCancelModal(false)}
                className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-all"
              >
                Keep Appointment
              </button>
              <button
                onClick={cancelAppointment}
                className="px-6 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-all"
              >
                Cancel Appointment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AppointmentDetail;
