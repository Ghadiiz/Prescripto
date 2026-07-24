import React, { useContext, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { DoctorContext } from '../../context/DoctorContext';
import { assets } from '../../assets/assets';

const DoctorAppointments = () => {
  const navigate = useNavigate();
  const {
    dToken,
    appointments,
    getAppointments,
    cancelAppointment,
    completeAppointment,
  } = useContext(DoctorContext);

  useEffect(() => {
    if (dToken) {
      getAppointments();
    }
  }, [dToken]);

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    const day = date.getDate();
    const monthNames = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    const month = monthNames[date.getMonth()];
    const year = date.getFullYear();
    return `${day} ${month} ${year}`;
  };

  return (
    <div className="w-full max-w-6xl m-5">
      <p className="mb-3 text-lg font-medium">All Appointments</p>

      <div className="bg-white border rounded text-sm max-h-[80vh] overflow-y-scroll">
        <div className="max-sm:hidden grid grid-cols-[0.5fr_2fr_1fr_3fr_1fr_1.5fr] gap-1 py-3 px-6 border-b">
          <p>#</p>
          <p>Patient</p>
          <p>Payment</p>
          <p>Date & Time</p>
          <p>Fees</p>
          <p>Action</p>
        </div>
        {appointments && appointments.length > 0 ? (
          appointments.map((item, index) => (
            <div
              className="flex flex-wrap justify-between max-sm:gap-5 max-sm:text-base sm:grid grid-cols-[0.5fr_2fr_1fr_3fr_1fr_1.5fr] gap-1 items-center text-gray-500 py-3 px-6 border-b hover:bg-gray-50"
              key={index}
            >
              <p className="max-sm:hidden">{index + 1}</p>
              <div className="flex items-center gap-2">
                <img
                  src={item.patientImage || assets.profile_pic}
                  className="w-8 rounded-full"
                  alt=""
                />
                <p>{item.patientName || 'Unknown Patient'}</p>
              </div>
              <div>
                <p className="text-xs inline border border-primary px-2 rounded-full">
                  {item.payment ? 'Online' : 'CASH'}
                </p>
              </div>
              <p>
                {formatDate(item.appointmentDate || item.slotDate)},{' '}
                {item.appointmentTime || item.slotTime || '-'}
              </p>
              <p>${item.amount || 0}</p>

              <div className="flex gap-1 items-center">
                <button
                  onClick={() =>
                    navigate(`/doctor-appointment-details/${item._id}`)
                  }
                  className="text-xs px-3 py-1.5 border border-primary text-primary hover:bg-primary hover:text-white transition-all rounded"
                  title="View Details"
                >
                  View
                </button>

                {item.status?.toLowerCase() === 'cancelled' ? (
                  <p className="text-red-500 text-xs font-semibold bg-red-50 px-3 py-1.5 rounded">
                    Cancelled
                  </p>
                ) : item.status?.toLowerCase() === 'completed' ? (
                  <p className="text-green-600 text-xs font-semibold bg-green-50 px-3 py-1.5 rounded">
                    Completed
                  </p>
                ) : item.status?.toLowerCase() === 'pending' ? (
                  <>
                    <img
                      onClick={() => cancelAppointment(item._id)}
                      className="w-10 cursor-pointer hover:scale-110 transition-all"
                      src={assets.cancel_icon}
                      alt="Cancel"
                      title="Cancel Appointment"
                    />
                    {item.isPast && (
                      <img
                        onClick={() => completeAppointment(item._id)}
                        className="w-10 cursor-pointer hover:scale-110 transition-all"
                        src={assets.tick_icon}
                        alt="Complete"
                        title="Mark as Completed"
                      />
                    )}
                  </>
                ) : (
                  <p className="text-gray-400 text-xs font-medium">
                    {item.status || 'Pending'}
                  </p>
                )}
              </div>
            </div>
          ))
        ) : (
          <p className="px-6 py-3 text-gray-500">No appointments found</p>
        )}
      </div>
    </div>
  );
};

export default DoctorAppointments;
