import React, { useContext, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppContext } from '../context/AppContext';
import { assets } from '../assets/assets';
import RelatedDoctors from '../components/RelatedDoctors';
import axios from 'axios';
import { toast } from 'react-toastify';

const Appointment = () => {
  const { docId } = useParams();
  const { currencySymbol, backendUrl, token } = useContext(AppContext);
  const navigate = useNavigate();

  const daysOfWeek = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

  const [docInfo, setDocInfo] = useState(null);
  const [availableDates, setAvailableDates] = useState([]);
  const [availableTimes, setAvailableTimes] = useState([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [loading, setLoading] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState('cash');

  const fetchDocInfo = async () => {
    try {
      const { data } = await axios.get(`${backendUrl}/api/doctors/${docId}`);
      if (data.success) {
        setDocInfo(data.doctor);
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error('Failed to load doctor information');
    } finally {
      setLoading(false);
    }
  };

  const generateAvailableDates = () => {
    const dates = [];
    const today = new Date();

    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      dates.push({
        dateObj: date,
        dateString: date.toISOString().split('T')[0],
      });
    }

    setAvailableDates(dates);
    if (dates.length > 0) {
      setSelectedDate(dates[0].dateString);
    }
  };

  const fetchAvailableTimes = async (date) => {
    try {
      const { data } = await axios.get(
        `${backendUrl}/api/appointments/available-slots`,
        {
          params: {
            doctorId: docId,
            date: date,
          },
        },
      );
      if (data.success) {
        setAvailableTimes(data.availableSlots || []);
      } else {
        setAvailableTimes([]);
        toast.error(data.message);
      }
    } catch (error) {
      console.log(error);
      setAvailableTimes([]);
    }
  };

  const bookAppointment = async () => {
    if (!token) {
      toast.warning('Please login to book appointment');
      return navigate('/login');
    }

    if (!selectedDate || !selectedTime) {
      toast.error('Please select a date and time');
      return;
    }

    try {
      const { data } = await axios.post(
        `${backendUrl}/api/appointments`,
        {
          doctorId: docId,
          slotDate: selectedDate,
          slotTime: selectedTime,
          payment: paymentMethod === 'online',
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );

      if (data.success) {
        toast.success('Appointment booked successfully!');
        navigate('/my-appointments');
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(
        error.response?.data?.message || 'Failed to book appointment',
      );
    }
  };

  useEffect(() => {
    fetchDocInfo();
    generateAvailableDates();
  }, [docId]);

  useEffect(() => {
    if (selectedDate) {
      fetchAvailableTimes(selectedDate);
    }
  }, [selectedDate]);

  if (loading) {
    return (
      <div className="text-center py-20">
        <p>Loading doctor information...</p>
      </div>
    );
  }

  if (!docInfo) {
    return (
      <div className="text-center py-20">
        <p>Doctor not found</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-4">
        <div>
          <img
            className="bg-primary w-full sm:max-w-72 rounded-lg"
            src={docInfo.image}
            alt=""
          />
        </div>

        <div className="flex-1 border border-[#ADADAD] rounded-lg p-8 py-7 bg-white mx-2 sm:mx-0 mt-[-80px] sm:mt-0">
          <p className="flex items-center gap-2 text-3xl font-medium text-gray-700">
            {docInfo.name}
            <img className="w-5" src={assets.verified_icon} alt="" />
          </p>
          <div className="flex items-center gap-2 mt-1 text-gray-600">
            <p>
              {docInfo.degree} - {docInfo.speciality}
            </p>
            <button className="py-0.5 px-2 border text-xs rounded-full">
              {docInfo.experience}
            </button>
          </div>

          <div>
            <p className="flex items-center gap-1 text-sm font-medium text-[#262626] mt-3">
              About <img className="w-3" src={assets.info_icon} alt="" />
            </p>
            <p className="text-sm text-gray-600 max-w-[700px] mt-1">
              {docInfo.about}
            </p>
          </div>

          <p className="text-gray-600 font-medium mt-4">
            Appointment fee:{' '}
            <span className="text-gray-800">
              {currencySymbol}
              {docInfo.fees}
            </span>
          </p>
        </div>
      </div>

      <div className="sm:ml-72 sm:pl-4 mt-8 font-medium text-[#565656]">
        <p>Booking slots</p>

        <div className="flex gap-3 items-center w-full overflow-x-scroll mt-4">
          {availableDates.map((item, index) => (
            <div
              onClick={() => {
                setSelectedDate(item.dateString);
                setSelectedTime('');
              }}
              key={index}
              className={`text-center py-6 min-w-16 rounded-full cursor-pointer ${
                selectedDate === item.dateString
                  ? 'bg-primary text-white'
                  : 'border border-[#DDDDDD]'
              }`}
            >
              <p>{daysOfWeek[item.dateObj.getDay()]}</p>
              <p>{item.dateObj.getDate()}</p>
            </div>
          ))}
        </div>

        <div className="relative flex items-center gap-2 mt-4">
          {availableTimes.length > 0 && (
            <button
              onClick={() => {
                document
                  .getElementById('time-slots')
                  .scrollBy({ left: -200, behavior: 'smooth' });
              }}
              className="hidden md:flex items-center justify-center flex-shrink-0 bg-white border border-gray-300 rounded-full p-2 shadow-md hover:bg-gray-50"
            >
              <svg
                className="w-4 h-4"
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
            </button>
          )}

          <div
            id="time-slots"
            className="flex items-center gap-3 w-full overflow-x-scroll scroll-smooth"
          >
            {availableTimes.length > 0 ? (
              availableTimes.map((time, index) => (
                <p
                  onClick={() => setSelectedTime(time)}
                  key={index}
                  className={`text-sm font-light flex-shrink-0 px-5 py-2 rounded-full cursor-pointer ${
                    selectedTime === time
                      ? 'bg-primary text-white'
                      : 'text-[#949494] border border-[#B4B4B4]'
                  }`}
                >
                  {time}
                </p>
              ))
            ) : (
              <p className="text-sm text-gray-500">
                No available times for this date
              </p>
            )}
          </div>

          {availableTimes.length > 0 && (
            <button
              onClick={() => {
                document
                  .getElementById('time-slots')
                  .scrollBy({ left: 200, behavior: 'smooth' });
              }}
              className="hidden md:flex items-center justify-center flex-shrink-0 bg-white border border-gray-300 rounded-full p-2 shadow-md hover:bg-gray-50"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </button>
          )}
        </div>

        <div className="mt-6 mb-4">
          <p className="text-gray-700 font-medium mb-3">Payment Method</p>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer bg-white border-2 border-gray-300 rounded-lg px-4 py-3 hover:border-primary transition-all">
              <input
                type="radio"
                name="paymentMethod"
                value="cash"
                checked={paymentMethod === 'cash'}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="w-4 h-4 text-primary"
              />
              <span className="text-sm font-medium">💵 Cash on Arrival</span>
            </label>

            <label className="flex items-center gap-2 cursor-not-allowed bg-gray-50 border-2 border-gray-300 rounded-lg px-4 py-3 opacity-50">
              <input
                type="radio"
                name="paymentMethod"
                value="online"
                disabled
                className="w-4 h-4"
              />
              <span className="text-sm font-medium">💳 Online Payment</span>
              <span className="text-xs text-gray-500">(Coming Soon)</span>
            </label>
          </div>
        </div>

        <button
          onClick={bookAppointment}
          className="bg-primary text-white text-sm font-light px-20 py-3 rounded-full my-6 hover:bg-primary/90 transition-all"
        >
          Book an appointment
        </button>
      </div>

      <RelatedDoctors speciality={docInfo.speciality} docId={docId} />
    </div>
  );
};

export default Appointment;
