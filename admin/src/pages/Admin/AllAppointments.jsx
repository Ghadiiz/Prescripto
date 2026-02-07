import React, { useContext, useEffect } from 'react';
import { AdminContext } from '../../context/AdminContext';
import { assets } from '../../assets/assets';
import { AppContext } from '../../context/AppContext';

const AllAppointments = () => {
  const { aToken, appointments, getAllAppointments } = useContext(AdminContext);
  const { calculateAge, currency } = useContext(AppContext);

  useEffect(() => {
    if (aToken) {
      getAllAppointments();
    }
  }, [aToken]);

  const formatDate = (dateString) => {
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

      {!appointments || appointments.length === 0 ? (
        <p className="text-gray-500">No appointments found</p>
      ) : (
        <div className="bg-white border rounded text-sm max-h-[80vh] min-h-[60vh] overflow-y-scroll">
          <div className="hidden sm:grid grid-cols-[0.5fr_3fr_1fr_2fr_2fr_3fr_1fr_1fr] grid-flow-col py-3 px-6 border-b">
            <p>#</p>
            <p>Patient</p>
            <p>Age</p>
            <p>Date</p>
            <p>Time</p>
            <p>Doctor</p>
            <p>Fees</p>
            <p>Status</p>
          </div>

          {appointments.map((item, index) => (
            <div
              className="flex flex-wrap justify-between max-sm:gap-2 sm:grid sm:grid-cols-[0.5fr_3fr_1fr_2fr_2fr_3fr_1fr_1fr] items-center text-gray-500 py-3 px-6 border-b hover:bg-gray-50"
              key={index}
            >
              <p className="max-sm:hidden">{index + 1}</p>

              <div className="flex items-center gap-2">
                <img
                  className="w-8 rounded-full"
                  src={item.patient?.image || assets.profile_pic}
                  alt=""
                />
                <p>{item.patient?.name || 'Unknown Patient'}</p>
              </div>

              <p className="max-sm:hidden">
                {item.patient?.dob ? calculateAge(item.patient.dob) : '-'}
              </p>

              <p>{formatDate(item.appointmentDate)}</p>

              <p>{item.appointmentTime}</p>

              <div className="flex items-center gap-2">
                <img
                  className="w-8 rounded-full bg-gray-200"
                  src={item.doctor?.image || assets.doctor_icon}
                  alt=""
                />
                <p>{item.doctor?.name || 'Unknown Doctor'}</p>
              </div>

              <p>
                {currency}
                {item.doctor?.fees || item.fees || '50'}
              </p>

              {item.status === 'cancelled' ? (
                <p className="text-red-400 text-xs font-medium">Cancelled</p>
              ) : item.status === 'completed' ? (
                <p className="text-green-500 text-xs font-medium">Completed</p>
              ) : item.status === 'confirmed' ? (
                <p className="text-blue-500 text-xs font-medium">Confirmed</p>
              ) : item.status === 'pending' ? (
                <p className="text-gray-500 text-xs font-medium">Pending</p>
              ) : (
                <p className="text-gray-400 text-xs">{item.status}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AllAppointments;
