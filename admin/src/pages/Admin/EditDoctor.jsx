import React, { useContext, useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { assets } from '../../assets/assets';
import { AdminContext } from '../../context/AdminContext';
import { toast } from 'react-toastify';
import axios from 'axios';

const EditDoctor = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const [docImg, setDocImg] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [experience, setExperience] = useState('1 Year');
  const [fees, setFees] = useState('');
  const [about, setAbout] = useState('');
  const [speciality, setSpeciality] = useState('7');
  const [degree, setDegree] = useState('');
  const [address1, setAddress1] = useState('');
  const [address2, setAddress2] = useState('');
  const [currentImage, setCurrentImage] = useState('');
  const [loading, setLoading] = useState(true);

  const { backendUrl, aToken, doctors, getAllDoctors } =
    useContext(AdminContext);

  useEffect(() => {
    const loadDoctorData = async () => {
      if (!doctors || doctors.length === 0) {
        await getAllDoctors();
      }

      const doctor = doctors.find((doc) => doc.id === parseInt(id));

      if (doctor) {
        setName(doctor.name || '');
        setEmail(doctor.email || '');
        setExperience(doctor.experience || '1 Year');
        setFees(doctor.fees || '');
        setAbout(doctor.about || '');
        setSpeciality(doctor.speciality_id?.toString() || '7');
        setDegree(doctor.degree || '');
        setCurrentImage(doctor.image || '');

        if (doctor.address) {
          try {
            let addr;
            if (typeof doctor.address === 'string') {
              addr = JSON.parse(doctor.address);
            } else if (typeof doctor.address === 'object') {
              addr = doctor.address;
            }

            if (addr) {
              const line1 =
                addr.line1 !== null && addr.line1 !== undefined
                  ? addr.line1
                  : '';
              const line2 =
                addr.line2 !== null && addr.line2 !== undefined
                  ? addr.line2
                  : '';
              setAddress1(line1);
              setAddress2(line2);
            }
          } catch (e) {
            console.error('Error parsing address:', e);
          }
        }

        setLoading(false);
      } else {
        fetchDoctorFromAPI();
      }
    };

    loadDoctorData();
  }, [id, doctors]);

  const fetchDoctorFromAPI = async () => {
    try {
      const { data } = await axios.get(backendUrl + `/api/admin/doctors`, {
        headers: { Authorization: `Bearer ${aToken}` },
      });

      if (data.success) {
        const doctor = data.data.find((doc) => doc.id === parseInt(id));

        if (doctor) {
          setName(doctor.name || '');
          setEmail(doctor.email || '');
          setExperience(doctor.experience || '1 Year');
          setFees(doctor.fees || '');
          setAbout(doctor.about || '');
          setSpeciality(doctor.speciality_id?.toString() || '7');
          setDegree(doctor.degree || '');
          setCurrentImage(doctor.image || '');

          if (doctor.address) {
            try {
              let addr;
              if (typeof doctor.address === 'string') {
                addr = JSON.parse(doctor.address);
              } else if (typeof doctor.address === 'object') {
                addr = doctor.address;
              }

              if (addr) {
                const line1 =
                  addr.line1 !== null && addr.line1 !== undefined
                    ? addr.line1
                    : '';
                const line2 =
                  addr.line2 !== null && addr.line2 !== undefined
                    ? addr.line2
                    : '';
                setAddress1(line1);
                setAddress2(line2);
              }
            } catch (e) {
              console.error('Error parsing address:', e);
            }
          }
        } else {
          toast.error('Doctor not found');
          navigate('/admin/doctors-list');
        }
      }

      setLoading(false);
    } catch (error) {
      console.error('Error fetching doctor:', error);
      toast.error('Failed to load doctor data');
      setLoading(false);
    }
  };

  const onSubmitHandler = async (event) => {
    event.preventDefault();

    try {
      const formData = new FormData();

      if (docImg) {
        formData.append('image', docImg);
      }

      formData.append('name', name);
      formData.append('email', email);
      formData.append('experience', experience);
      formData.append('fees', Number(fees));
      formData.append('about', about);
      formData.append('speciality_id', Number(speciality));
      formData.append('degree', degree);

      formData.append('address_line1', address1);
      formData.append('address_line2', address2);

      const { data } = await axios.put(
        backendUrl + `/api/admin/doctors/${id}`,
        formData,
        {
          headers: {
            Authorization: `Bearer ${aToken}`,
          },
        },
      );

      if (data.success) {
        toast.success(data.message);
        navigate('/admin/doctors-list');
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      console.error('Update doctor error:', error);
      toast.error(error.response?.data?.message || error.message);
    }
  };

  if (loading) {
    return (
      <div className="m-5">
        <p>Loading doctor data...</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmitHandler} className="m-5 w-full">
      <p className="mb-3 text-lg font-medium">Edit Doctor</p>

      <div className="bg-white px-8 py-8 border rounded w-full max-w-4xl max-h-[80vh] overflow-y-scroll">
        <div className="flex items-center gap-4 mb-8 text-gray-500">
          <label htmlFor="doc-img">
            <img
              className="w-16 h-16 object-cover bg-gray-100 rounded-full cursor-pointer"
              src={
                docImg
                  ? URL.createObjectURL(docImg)
                  : currentImage || assets.upload_area
              }
              alt=""
            />
          </label>
          <input
            onChange={(e) => setDocImg(e.target.files[0])}
            type="file"
            id="doc-img"
            hidden
          />
          <p>
            Upload new picture <br /> (optional)
          </p>
        </div>

        <div className="flex flex-col lg:flex-row items-start gap-10 text-gray-600">
          <div className="w-full lg:flex-1 flex flex-col gap-4">
            <div className="flex-1 flex flex-col gap-1">
              <p>Doctor name</p>
              <input
                onChange={(e) => setName(e.target.value)}
                value={name}
                className="border rounded px-3 py-2"
                type="text"
                placeholder="Name"
                required
              />
            </div>

            <div className="flex-1 flex flex-col gap-1">
              <p>Doctor Email</p>
              <input
                onChange={(e) => setEmail(e.target.value)}
                value={email}
                className="border rounded px-3 py-2"
                type="email"
                placeholder="Email"
                required
              />
            </div>

            <div className="flex-1 flex flex-col gap-1">
              <p>Experience</p>
              <select
                onChange={(e) => setExperience(e.target.value)}
                value={experience}
                className="border rounded px-3 py-2"
              >
                <option value="1 Year">1 Year</option>
                <option value="2 Years">2 Years</option>
                <option value="3 Years">3 Years</option>
                <option value="4 Years">4 Years</option>
                <option value="5 Years">5 Years</option>
                <option value="6 Years">6 Years</option>
                <option value="7 Years">7 Years</option>
                <option value="8 Years">8 Years</option>
                <option value="9 Years">9 Years</option>
                <option value="10 Years">10 Years</option>
              </select>
            </div>

            <div className="flex-1 flex flex-col gap-1">
              <p>Fees</p>
              <input
                onChange={(e) => setFees(e.target.value)}
                value={fees}
                className="border rounded px-3 py-2"
                type="number"
                placeholder="Fees"
                required
              />
            </div>
          </div>

          <div className="w-full lg:flex-1 flex flex-col gap-4">
            <div className="flex-1 flex flex-col gap-1">
              <p>Speciality</p>
              <select
                onChange={(e) => setSpeciality(e.target.value)}
                value={speciality}
                className="border rounded px-3 py-2"
              >
                <option value="7">General physician</option>
                <option value="8">Gynecologist</option>
                <option value="9">Dermatologist</option>
                <option value="10">Pediatricians</option>
                <option value="11">Neurologist</option>
                <option value="12">Gastroenterologist</option>
              </select>
            </div>

            <div className="flex-1 flex flex-col gap-1">
              <p>Education</p>
              <input
                onChange={(e) => setDegree(e.target.value)}
                value={degree}
                className="border rounded px-3 py-2"
                type="text"
                placeholder="Education"
                required
              />
            </div>

            <div className="flex-1 flex flex-col gap-1">
              <p>Address</p>
              <input
                onChange={(e) => setAddress1(e.target.value)}
                value={address1}
                className="border rounded px-3 py-2"
                type="text"
                placeholder="Address 1"
                required
              />
              <input
                onChange={(e) => setAddress2(e.target.value)}
                value={address2}
                className="border rounded px-3 py-2"
                type="text"
                placeholder="Address 2"
                required
              />
            </div>
          </div>
        </div>

        <div>
          <p className="mt-4 mb-2">About Doctor</p>
          <textarea
            onChange={(e) => setAbout(e.target.value)}
            value={about}
            className="w-full px-4 pt-2 border rounded"
            placeholder="Write about doctor"
            rows={5}
            required
          />
        </div>

        <div className="flex gap-3 mt-4">
          <button
            type="submit"
            className="bg-primary px-10 py-3 text-white rounded-full"
          >
            Update doctor
          </button>
          <button
            type="button"
            onClick={() => navigate('/admin/doctors-list')}
            className="bg-gray-300 px-10 py-3 text-gray-700 rounded-full"
          >
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
};

export default EditDoctor;
