import React, { useContext, useEffect } from 'react';
import { assets } from '../../assets/assets';
import { AdminContext } from '../../context/AdminContext';
import { AppContext } from '../../context/AppContext';

const Dashboard = () => {
  const { aToken, getDashData, dashData, appointments } =
    useContext(AdminContext);
  const { currency } = useContext(AppContext);

  useEffect(() => {
    if (aToken) {
      getDashData();
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

  if (!dashData) {
    return (
      <div className="m-5">
        <p className="text-gray-500">Loading dashboard...</p>
      </div>
    );
  }

  return (
    <div className="m-5">
      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2 bg-white p-4 min-w-52 rounded border-2 border-gray-100 cursor-pointer hover:scale-105 transition-all">
          <img className="w-14" src={assets.doctor_icon} alt="" />
          <div>
            <p className="text-xl font-semibold text-gray-600">
              {dashData.totalDoctors || 0}
            </p>
            <p className="text-gray-400">Doctors</p>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-white p-4 min-w-52 rounded border-2 border-gray-100 cursor-pointer hover:scale-105 transition-all">
          <img className="w-14" src={assets.doctor_icon} alt="" />
          <div>
            <p className="text-xl font-semibold text-green-600">
              {dashData.activeDoctors || 0}
            </p>
            <p className="text-gray-400">Active Doctors</p>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-white p-4 min-w-52 rounded border-2 border-gray-100 cursor-pointer hover:scale-105 transition-all">
          <img className="w-14" src={assets.appointments_icon} alt="" />
          <div>
            <p className="text-xl font-semibold text-gray-600">
              {dashData.totalAppointments || 0}
            </p>
            <p className="text-gray-400">Total Appointments</p>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-white p-4 min-w-52 rounded border-2 border-gray-100 cursor-pointer hover:scale-105 transition-all">
          <img className="w-14" src={assets.appointments_icon} alt="" />
          <div>
            <p className="text-xl font-semibold text-yellow-600">
              {dashData.pendingAppointments || 0}
            </p>
            <p className="text-gray-400">Pending</p>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-white p-4 min-w-52 rounded border-2 border-gray-100 cursor-pointer hover:scale-105 transition-all">
          <img className="w-14" src={assets.appointments_icon} alt="" />
          <div>
            <p className="text-xl font-semibold text-green-600">
              {dashData.completedAppointments || 0}
            </p>
            <p className="text-gray-400">Completed</p>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-white p-4 min-w-52 rounded border-2 border-gray-100 cursor-pointer hover:scale-105 transition-all">
          <img className="w-14" src={assets.appointments_icon} alt="" />
          <div>
            <p className="text-xl font-semibold text-red-600">
              {dashData.cancelledAppointments || 0}
            </p>
            <p className="text-gray-400">Cancelled</p>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-white p-4 min-w-52 rounded border-2 border-gray-100 cursor-pointer hover:scale-105 transition-all">
          <img className="w-14" src={assets.patients_icon} alt="" />
          <div>
            <p className="text-xl font-semibold text-gray-600">
              {dashData.totalUsers || 0}
            </p>
            <p className="text-gray-400">Patients</p>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-white p-4 min-w-52 rounded border-2 border-gray-100 cursor-pointer hover:scale-105 transition-all">
          <img className="w-14" src={assets.earning_icon} alt="" />
          <div>
            <p className="text-xl font-semibold text-gray-600">
              {currency}
              {dashData.totalRevenue || 0}
            </p>
            <p className="text-gray-400">Revenue</p>
          </div>
        </div>
      </div>

      <div className="bg-white">
        <div className="flex items-center gap-2.5 px-4 py-4 mt-10 rounded-t border">
          <img src={assets.list_icon} alt="" />
          <p className="font-semibold">Latest Bookings</p>
        </div>

        <div className="pt-4 border border-t-0">
          {!appointments || appointments.length === 0 ? (
            <p className="px-6 py-3 text-gray-500">No appointments yet</p>
          ) : (
            appointments.slice(0, 5).map((item, index) => (
              <div
                className="flex items-center px-6 py-3 gap-3 hover:bg-gray-100"
                key={index}
              >
                <img
                  className="rounded-full w-10"
                  src={item.doctor?.image || assets.doctor_icon}
                  alt=""
                />
                <div className="flex-1 text-sm">
                  <p className="text-gray-800 font-medium">
                    {item.doctor?.name || 'Unknown Doctor'}
                  </p>
                  <p className="text-gray-600">
                    Booking on {formatDate(item.appointmentDate)} at{' '}
                    {item.appointmentTime}
                  </p>
                </div>

                {item.status === 'cancelled' ? (
                  <p className="text-red-400 text-xs font-medium">Cancelled</p>
                ) : item.status === 'completed' ? (
                  <p className="text-green-500 text-xs font-medium">
                    Completed
                  </p>
                ) : item.status === 'confirmed' ? (
                  <p className="text-blue-500 text-xs font-medium">Confirmed</p>
                ) : (
                  <p className="text-gray-500 text-xs font-medium">Pending</p>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
