import React, { useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AppContext } from '../context/AppContext';
import { assets } from '../assets/assets';
import RelatedDoctors from '../components/RelatedDoctors';
import { isCalendarDate, toLocalDateString } from '../utils/dates';
import axios from 'axios';
import { toast } from 'react-toastify';

// How many days ahead the strip offers. A notification can name a date beyond
// this — a waitlist window may start any day from today and span up to 30 —
// so the out-of-window case below is reachable, not defensive.
const BOOKABLE_DAYS = 7;

const Appointment = () => {
  const { docId } = useParams();
  const [searchParams] = useSearchParams();
  const { currencySymbol, backendUrl, token } = useContext(AppContext);
  const navigate = useNavigate();

  const daysOfWeek = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

  // Where a notification click lands: /appointment/:docId?date=YYYY-MM-DD.
  // Anything that is not a calendar date is ignored rather than trusted.
  const requestedDate = searchParams.get('date');
  const wantedDate = isCalendarDate(requestedDate) ? requestedDate : null;

  const [docInfo, setDocInfo] = useState(null);
  const [availableTimes, setAvailableTimes] = useState([]);
  const [selectedTime, setSelectedTime] = useState('');
  const [loading, setLoading] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState('cash');

  // Derived from today, not stored: an effect that immediately overwrote a
  // useState was the shape 6.9 removed everywhere else.
  const availableDates = useMemo(() => {
    const dates = [];
    const today = new Date();

    for (let i = 0; i < BOOKABLE_DAYS; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      dates.push({ dateObj: date, dateString: toLocalDateString(date) });
    }

    return dates;
  }, []);

  const wantedDateIsBookable = availableDates.some(
    (item) => item.dateString === wantedDate,
  );

  // The requested date when the strip can show it, otherwise the first day —
  // which is what the page has always opened on.
  const [selectedDate, setSelectedDate] = useState(() =>
    wantedDateIsBookable ? wantedDate : (availableDates[0]?.dateString ?? ''),
  );

  // A notification told the patient about a date this page cannot offer. Say
  // so, rather than silently showing them a different day and letting them
  // wonder where their slot went.
  const showOutOfWindowNotice = Boolean(wantedDate) && !wantedDateIsBookable;

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

      {!docInfo.available ? (
        // The 3.4 deferred item, decided with 7.1: the page used to render a
        // full picker for a doctor who had stopped accepting, and a
        // notification click-through is a stronger invitation to book than the
        // assistant card 3.4 already softened. `join_waitlist` has always
        // refused these doctors; only the page had not.
        <div className="sm:ml-72 sm:pl-4 mt-8">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm font-medium text-amber-900">
              {docInfo.name} is not accepting appointments at the moment.
            </p>
            <p className="mt-1 text-sm text-amber-800">
              There is nothing to book here for now. Other doctors in the same
              speciality are listed below.
            </p>
          </div>
        </div>
      ) : (
      <div className="sm:ml-72 sm:pl-4 mt-8 font-medium text-[#565656]">
        <p>Booking slots</p>

        {showOutOfWindowNotice && (
          <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
            <p className="text-sm text-blue-900">
              The slot you were told about is on{' '}
              <span className="font-medium">
                {new Date(`${wantedDate}T00:00:00`).toLocaleDateString(
                  undefined,
                  { weekday: 'short', day: 'numeric', month: 'short' },
                )}
              </span>
              , which is further ahead than the {BOOKABLE_DAYS} days this page
              can book. Come back nearer the date.
            </p>
          </div>
        )}

        <div className="flex gap-3 items-center w-full overflow-x-scroll mt-4">
          {availableDates.map((item, index) => (
            <div
              onClick={() => {
                setSelectedDate(item.dateString);
                setSelectedTime('');
              }}
              key={index}
              // The highlight is the only thing that says which day is
              // selected. Naming it makes that legible to a screen reader, and
              // assertable without reaching for a Tailwind class.
              aria-current={selectedDate === item.dateString ? 'date' : undefined}
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
      )}

      <RelatedDoctors speciality={docInfo.speciality} docId={docId} />
    </div>
  );
};

export default Appointment;
