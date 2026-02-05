import React, { useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppContext } from '../context/AppContext';
import axios from 'axios';
import { toast } from 'react-toastify';

const MyAppointments = () => {
  const { backendUrl, token } = useContext(AppContext);
  const navigate = useNavigate();

  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hiddenAppointments, setHiddenAppointments] = useState([]);

  // Modal state
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState(null);
  const [cancellationReason, setCancellationReason] = useState('');

  // Load hidden appointments from localStorage on mount
  useEffect(() => {
    const hidden = JSON.parse(
      localStorage.getItem('hiddenAppointments') || '[]',
    );
    setHiddenAppointments(hidden);
  }, []);

  // Fetch user's appointments
  const fetchAppointments = async () => {
    try {
      if (!token) {
        navigate('/login');
        return;
      }

      const { data } = await axios.get(
        `${backendUrl}/api/appointments/my-appointments`,
        { headers: { Authorization: `Bearer ${token}` } },
      );

      if (data.success) {
        // Filter out hidden appointments
        const hidden = JSON.parse(
          localStorage.getItem('hiddenAppointments') || '[]',
        );
        const visibleAppointments = data.appointments.filter(
          (app) => !hidden.includes(app._id),
        );
        setAppointments(visibleAppointments);
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error('Failed to load appointments');
    } finally {
      setLoading(false);
    }
  };

  // Open cancel modal
  const openCancelModal = (appointmentId) => {
    setSelectedAppointmentId(appointmentId);
    setCancellationReason('');
    setShowCancelModal(true);
  };

  // Close cancel modal
  const closeCancelModal = () => {
    setShowCancelModal(false);
    setSelectedAppointmentId(null);
    setCancellationReason('');
  };

  // Cancel appointment with reason
  const cancelAppointment = async () => {
    if (!cancellationReason.trim()) {
      toast.error('Please provide a cancellation reason');
      return;
    }

    try {
      const { data } = await axios.put(
        `${backendUrl}/api/appointments/${selectedAppointmentId}/cancel`,
        { cancellationReason: cancellationReason.trim() },
        { headers: { Authorization: `Bearer ${token}` } },
      );

      if (data.success) {
        toast.success('Appointment cancelled successfully');
        closeCancelModal();
        fetchAppointments(); // Refresh the list
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

  // Remove appointment from view (persist in localStorage)
  const removeAppointment = (appointmentId) => {
    // Get current hidden list
    const hidden = JSON.parse(
      localStorage.getItem('hiddenAppointments') || '[]',
    );

    // Add this appointment ID to hidden list
    const updatedHidden = [...hidden, appointmentId];

    // Save to localStorage
    localStorage.setItem('hiddenAppointments', JSON.stringify(updatedHidden));

    // Update state
    setHiddenAppointments(updatedHidden);
    setAppointments((prev) => prev.filter((app) => app._id !== appointmentId));

    toast.success('Appointment removed from view');
  };

  useEffect(() => {
    fetchAppointments();
  }, [token]);

  if (loading) {
    return (
      <div className="text-center py-20">
        <p>Loading appointments...</p>
      </div>
    );
  }

  return (
    <div>
      <p className="pb-3 mt-12 text-lg font-medium text-gray-600 border-b">
        My appointments
      </p>

      {appointments.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-gray-500">No appointments found</p>
          <button
            onClick={() => navigate('/doctors')}
            className="mt-4 bg-primary text-white px-8 py-3 rounded-full"
          >
            Book an appointment
          </button>
        </div>
      ) : (
        <div>
          {appointments.map((item, index) => (
            <div
              key={index}
              className="grid grid-cols-[1fr_2fr] gap-4 sm:flex sm:gap-6 py-4 border-b"
            >
              <div>
                <img
                  className="w-36 bg-[#EAEFFF]"
                  src={item.doctor.image}
                  alt=""
                />
              </div>
              <div className="flex-1 text-sm text-[#5E5E5E]">
                <p className="text-[#262626] text-base font-semibold">
                  {item.doctor.name}
                </p>
                <p>{item.doctor.speciality}</p>
                <p className="text-[#464646] font-medium mt-1">Address:</p>
                <p>{item.doctor.address.line1}</p>
                <p>{item.doctor.address.line2}</p>
                <p className="mt-1">
                  <span className="text-sm text-[#3C3C3C] font-medium">
                    Date & Time:
                  </span>{' '}
                  {item.slotDate} | {item.slotTime}
                </p>

                {/* ✅ ADD THIS - Payment Method Display */}
                <p className="mt-1">
                  <span className="text-sm text-[#3C3C3C] font-medium">
                    Payment:
                  </span>{' '}
                  {item.payment ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                      💳 Online Payment
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                      💵 Cash on Arrival
                    </span>
                  )}
                </p>

                <div className="mt-2">
                  {item.status?.toLowerCase() === 'cancelled' ? (
                    <span className="inline-block bg-red-100 text-red-700 text-xs font-semibold px-3 py-1 rounded-full">
                      ● Cancelled
                    </span>
                  ) : item.status?.toLowerCase() === 'completed' ? (
                    <span className="inline-block bg-green-100 text-green-700 text-xs font-semibold px-3 py-1 rounded-full">
                      ● Completed
                    </span>
                  ) : (
                    <span className="inline-block bg-blue-100 text-blue-700 text-xs font-semibold px-3 py-1 rounded-full">
                      ● Pending
                    </span>
                  )}
                </div>

                {item.status?.toLowerCase() === 'cancelled' &&
                  item.cancellationReason && (
                    <p className="mt-2 text-xs text-red-600">
                      <span className="font-medium">Cancellation Reason:</span>{' '}
                      {item.cancellationReason}
                    </p>
                  )}
              </div>

              <div className="flex flex-col gap-2 justify-end text-sm text-center">
                {item.status?.toLowerCase() === 'cancelled' ? (
                  <>
                    <button className="sm:min-w-48 py-2 px-4 border border-red-500 text-red-500 bg-red-50 rounded cursor-not-allowed">
                      Cancelled
                    </button>
                    <button
                      onClick={() => removeAppointment(item._id)}
                      className="sm:min-w-48 py-2 px-4 border border-gray-400 text-gray-700 hover:bg-gray-100 transition-all duration-300 rounded"
                    >
                      Remove from view
                    </button>
                  </>
                ) : item.status?.toLowerCase() === 'completed' ? (
                  <button className="sm:min-w-48 py-2 px-4 border border-green-500 text-green-500 bg-green-50 rounded cursor-not-allowed">
                    Completed
                  </button>
                ) : (
                  <button
                    onClick={() => openCancelModal(item._id)}
                    className="sm:min-w-48 py-2 px-4 border border-red-500 text-red-500 hover:bg-red-500 hover:text-white transition-all duration-300 rounded"
                  >
                    Cancel appointment
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Cancel Appointment Modal */}
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
                onClick={closeCancelModal}
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

export default MyAppointments;
