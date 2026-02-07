import React, { useContext, useEffect } from 'react';
import { DoctorContext } from '../../context/DoctorContext';
import { assets } from '../../assets/assets';

const DoctorDashboard = () => {
  const {
    dToken,
    dashData,
    getDashData,
    cancelAppointment,
    completeAppointment,
  } = useContext(DoctorContext);

  useEffect(() => {
    if (dToken) {
      getDashData();
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
    dashData && (
      <div className="m-5">
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 bg-white p-4 min-w-52 rounded border-2 border-gray-100 cursor-pointer hover:scale-105 transition-all">
            <img className="w-14" src={assets.earning_icon} alt="" />
            <div>
              <p className="text-xl font-semibold text-gray-600">
                ${dashData.earnings || 0}
              </p>
              <p className="text-gray-400">Earnings</p>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-white p-4 min-w-52 rounded border-2 border-gray-100 cursor-pointer hover:scale-105 transition-all">
            <img className="w-14" src={assets.appointments_icon} alt="" />
            <div>
              <p className="text-xl font-semibold text-gray-600">
                {dashData.appointments || 0}
              </p>
              <p className="text-gray-400">Appointments</p>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-white p-4 min-w-52 rounded border-2 border-gray-100 cursor-pointer hover:scale-105 transition-all">
            <img className="w-14" src={assets.patients_icon} alt="" />
            <div>
              <p className="text-xl font-semibold text-gray-600">
                {dashData.patients || 0}
              </p>
              <p className="text-gray-400">Patients</p>
            </div>
          </div>
        </div>

        <div className="bg-white">
          <div className="flex items-center gap-2.5 px-4 py-4 mt-10 rounded-t border">
            <img src={assets.list_icon} alt="" />
            <p className="font-semibold">Latest Bookings</p>
          </div>

          <div className="pt-4 border border-t-0">
            {dashData.latestAppointments &&
            dashData.latestAppointments.length > 0 ? (
              dashData.latestAppointments.slice(0, 5).map((item, index) => (
                <div
                  className="flex items-center px-6 py-3 gap-3 hover:bg-gray-100"
                  key={index}
                >
                  <img
                    className="rounded-full w-10"
                    src={item.patientImage || assets.profile_pic}
                    alt=""
                  />
                  <div className="flex-1 text-sm">
                    <p className="text-gray-800 font-medium">
                      {item.patientName || 'Unknown Patient'}
                    </p>
                    <p className="text-gray-600">
                      Booking on{' '}
                      {formatDate(item.appointmentDate || item.slotDate)} at{' '}
                      {item.appointmentTime || item.slotTime || '-'}
                    </p>
                  </div>

                  {item.status === 'cancelled' ? (
                    <p className="text-red-500 text-xs font-semibold bg-red-50 px-3 py-1 rounded-full">
                      Cancelled
                    </p>
                  ) : item.status === 'completed' ? (
                    <p className="text-green-600 text-xs font-semibold bg-green-50 px-3 py-1 rounded-full">
                      Completed
                    </p>
                  ) : item.status === 'pending' ? (
                    <div className="flex">
                      <img
                        onClick={() => cancelAppointment(item._id)}
                        className="w-10 cursor-pointer hover:scale-110 transition-all"
                        src={assets.cancel_icon}
                        alt=""
                        title="Cancel"
                      />
                      <img
                        onClick={() => completeAppointment(item._id)}
                        className="w-10 cursor-pointer hover:scale-110 transition-all"
                        src={assets.tick_icon}
                        alt=""
                        title="Complete"
                      />
                    </div>
                  ) : (
                    <p className="text-gray-400 text-xs">Pending</p>
                  )}
                </div>
              ))
            ) : (
              <p className="px-6 py-3 text-gray-500">No appointments yet</p>
            )}
          </div>
        </div>
      </div>
    )
  );
};

export default DoctorDashboard;
