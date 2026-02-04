import React, { useContext, useState } from 'react';
import { AppContext } from '../context/AppContext';
import axios from 'axios';
import { toast } from 'react-toastify';
import { assets } from '../assets/assets';

const MyProfile = () => {
  const [isEdit, setIsEdit] = useState(false);
  const [image, setImage] = useState(null);

  const { token, backendUrl, userData, setUserData, loadUserProfileData } =
    useContext(AppContext);

  // Country codes with flags
  const countryCodes = [
    { code: '+962', country: 'Jordan', flag: '🇯🇴', digits: 9 },
    { code: '+1', country: 'USA/Canada', flag: '🇺🇸', digits: 10 },
    { code: '+44', country: 'UK', flag: '🇬🇧', digits: 10 },
    { code: '+971', country: 'UAE', flag: '🇦🇪', digits: 9 },
    { code: '+966', country: 'Saudi Arabia', flag: '🇸🇦', digits: 9 },
    { code: '+20', country: 'Egypt', flag: '🇪🇬', digits: 10 },
    { code: '+961', country: 'Lebanon', flag: '🇱🇧', digits: 8 },
    { code: '+970', country: 'Palestine', flag: '🇵🇸', digits: 9 },
  ];

  // Parse existing phone number
  const parsePhoneNumber = (fullPhone) => {
    if (!fullPhone) return { countryCode: '+962', phoneNumber: '' };

    // Find matching country code
    const matchedCountry = countryCodes.find((c) =>
      fullPhone.startsWith(c.code),
    );
    if (matchedCountry) {
      return {
        countryCode: matchedCountry.code,
        phoneNumber: fullPhone.substring(matchedCountry.code.length).trim(),
      };
    }

    // Default to Jordan if no match
    return { countryCode: '+962', phoneNumber: fullPhone };
  };

  const [phoneData, setPhoneData] = useState(() =>
    parsePhoneNumber(userData?.phone),
  );

  // Format date from ISO to YYYY-MM-DD for input field
  const formatDateForInput = (dateString) => {
    if (!dateString) return '';

    // Handle ISO format (2005-08-13T21:00:00.000Z)
    if (dateString.includes('T')) {
      return dateString.split('T')[0];
    }

    // Handle Date object
    if (dateString instanceof Date) {
      const year = dateString.getFullYear();
      const month = String(dateString.getMonth() + 1).padStart(2, '0');
      const day = String(dateString.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    // Already in YYYY-MM-DD format
    return dateString;
  };

  // Format date for display
  const formatDateForDisplay = (dateString) => {
    if (!dateString) return 'Not provided';
    const date = new Date(dateString);
    const options = { year: 'numeric', month: 'long', day: 'numeric' };
    return date.toLocaleDateString('en-US', options);
  };

  // Validate phone number based on country
  const validatePhone = (countryCode, phoneNumber) => {
    if (!phoneNumber) return true; // Optional field

    // Remove spaces, dashes, parentheses
    const cleanNumber = phoneNumber.replace(/[\s\-()]/g, '');

    // Check if only digits
    if (!/^\d+$/.test(cleanNumber)) {
      return false;
    }

    // Find country rules
    const country = countryCodes.find((c) => c.code === countryCode);
    if (country) {
      return cleanNumber.length === country.digits;
    }

    return cleanNumber.length >= 8 && cleanNumber.length <= 15;
  };

  // Handle phone number input
  const handlePhoneNumberChange = (value) => {
    // Only allow digits
    const cleanValue = value.replace(/\D/g, '');
    setPhoneData((prev) => ({ ...prev, phoneNumber: cleanValue }));

    // Update userData with combined phone
    const fullPhone = phoneData.countryCode + cleanValue;
    setUserData((prev) => ({ ...prev, phone: fullPhone }));
  };

  // Handle country code change
  const handleCountryCodeChange = (newCode) => {
    setPhoneData((prev) => ({ ...prev, countryCode: newCode }));

    // Update userData with combined phone
    const fullPhone = newCode + phoneData.phoneNumber;
    setUserData((prev) => ({ ...prev, phone: fullPhone }));
  };

  // Update profile
  const updateUserProfileData = async () => {
    try {
      // Validate phone
      if (
        phoneData.phoneNumber &&
        !validatePhone(phoneData.countryCode, phoneData.phoneNumber)
      ) {
        const country = countryCodes.find(
          (c) => c.code === phoneData.countryCode,
        );
        toast.error(
          `Phone number must be ${country.digits} digits for ${country.country}`,
        );
        return;
      }

      // Format date to YYYY-MM-DD only (remove time component)
      let formattedDob = null;
      if (userData.dob) {
        formattedDob = formatDateForInput(userData.dob);
      }

      const updateData = {
        name: userData.name,
        phone: phoneData.phoneNumber
          ? phoneData.countryCode + phoneData.phoneNumber
          : null,
        address: userData.address,
        gender: userData.gender,
        dob: formattedDob,
      };

      const { data } = await axios.put(
        backendUrl + '/api/auth/profile',
        updateData,
        { headers: { Authorization: `Bearer ${token}` } },
      );

      if (data.success) {
        toast.success('Profile updated successfully!');
        await loadUserProfileData();
        setIsEdit(false);
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(error.response?.data?.message || 'Failed to update profile');
    }
  };

  // Upload profile image
  const uploadProfileImage = async () => {
    try {
      if (!image) {
        return;
      }

      const formData = new FormData();
      formData.append('image', image);

      const { data } = await axios.post(
        backendUrl + '/api/auth/profile/image',
        formData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'multipart/form-data',
          },
        },
      );

      if (data.success) {
        toast.success('Profile image updated!');
        await loadUserProfileData();
        setImage(null);
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      console.log(error);
      toast.error(error.response?.data?.message || 'Failed to upload image');
    }
  };

  // Save both profile data and image
  const handleSave = async () => {
    await updateUserProfileData();
    if (image) {
      await uploadProfileImage();
    }
  };

  return userData ? (
    <div className="max-w-lg flex flex-col gap-2 text-sm">
      {/* Profile Image */}
      {isEdit ? (
        <label htmlFor="image">
          <div className="inline-block relative cursor-pointer">
            <img
              className="w-36 rounded opacity-75"
              src={
                image
                  ? URL.createObjectURL(image)
                  : userData.image || assets.profile_pic
              }
              alt=""
            />
            <img
              className="w-10 absolute bottom-12 right-12"
              src={image ? '' : assets.upload_icon}
              alt=""
            />
          </div>
          <input
            onChange={(e) => setImage(e.target.files[0])}
            type="file"
            id="image"
            hidden
          />
        </label>
      ) : (
        <img
          className="w-36 rounded"
          src={userData.image || assets.profile_pic}
          alt=""
        />
      )}

      {/* Name */}
      {isEdit ? (
        <input
          className="bg-gray-50 text-3xl font-medium max-w-60 mt-4"
          type="text"
          value={userData.name || ''}
          onChange={(e) =>
            setUserData((prev) => ({ ...prev, name: e.target.value }))
          }
        />
      ) : (
        <p className="font-medium text-3xl text-neutral-800 mt-4">
          {userData.name || 'Not provided'}
        </p>
      )}

      <hr className="bg-zinc-400 h-[1px] border-none" />

      {/* CONTACT INFORMATION */}
      <div>
        <p className="text-neutral-500 underline mt-3">CONTACT INFORMATION</p>
        <div className="grid grid-cols-[1fr_3fr] gap-y-2.5 mt-3 text-neutral-700">
          <p className="font-medium">Email id:</p>
          <p className="text-blue-500">{userData.email || 'Not provided'}</p>

          <p className="font-medium">Phone:</p>
          {isEdit ? (
            <div className="flex gap-2">
              <select
                className="bg-gray-100 px-2 py-1 rounded text-sm"
                value={phoneData.countryCode}
                onChange={(e) => handleCountryCodeChange(e.target.value)}
              >
                {countryCodes.map((country, index) => (
                  <option key={index} value={country.code}>
                    {country.flag} {country.code}
                  </option>
                ))}
              </select>
              <input
                className="bg-gray-100 px-3 py-1 rounded flex-1"
                type="text"
                value={phoneData.phoneNumber}
                onChange={(e) => handlePhoneNumberChange(e.target.value)}
                placeholder={`${countryCodes.find((c) => c.code === phoneData.countryCode)?.digits} digits`}
                maxLength={15}
              />
            </div>
          ) : (
            <p className="text-blue-400">{userData.phone || 'Not provided'}</p>
          )}

          <p className="font-medium">Address:</p>
          {isEdit ? (
            <p>
              <input
                className="bg-gray-50 w-full mb-2 px-2 py-1 rounded"
                value={userData.address?.line1 || ''}
                onChange={(e) =>
                  setUserData((prev) => ({
                    ...prev,
                    address: { ...prev.address, line1: e.target.value },
                  }))
                }
                type="text"
                placeholder="Address Line 1"
              />
              <input
                className="bg-gray-50 w-full px-2 py-1 rounded"
                value={userData.address?.line2 || ''}
                onChange={(e) =>
                  setUserData((prev) => ({
                    ...prev,
                    address: { ...prev.address, line2: e.target.value },
                  }))
                }
                type="text"
                placeholder="Address Line 2"
              />
            </p>
          ) : (
            <p className="text-gray-500">
              {userData.address?.line1 || 'Not provided'}
              <br />
              {userData.address?.line2}
            </p>
          )}
        </div>
      </div>

      {/* BASIC INFORMATION */}
      <div>
        <p className="text-neutral-500 underline mt-3">BASIC INFORMATION</p>
        <div className="grid grid-cols-[1fr_3fr] gap-y-2.5 mt-3 text-neutral-700">
          <p className="font-medium">Gender:</p>
          {isEdit ? (
            <select
              className="max-w-28 bg-gray-100 px-2 py-1 rounded"
              value={userData.gender || ''}
              onChange={(e) =>
                setUserData((prev) => ({ ...prev, gender: e.target.value }))
              }
            >
              <option value="">Select</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </select>
          ) : (
            <p className="text-gray-400">{userData.gender || 'Not provided'}</p>
          )}

          <p className="font-medium">Birthday:</p>
          {isEdit ? (
            <input
              className="max-w-36 bg-gray-100 px-2 py-1 rounded"
              type="date"
              value={formatDateForInput(userData.dob)}
              onChange={(e) =>
                setUserData((prev) => ({ ...prev, dob: e.target.value }))
              }
            />
          ) : (
            <p className="text-gray-400">
              {formatDateForDisplay(userData.dob)}
            </p>
          )}
        </div>
      </div>

      {/* Edit/Save Button */}
      <div className="mt-10">
        {isEdit ? (
          <button
            className="border border-primary px-8 py-2 rounded-full hover:bg-primary hover:text-white transition-all"
            onClick={handleSave}
          >
            Save information
          </button>
        ) : (
          <button
            className="border border-primary px-8 py-2 rounded-full hover:bg-primary hover:text-white transition-all"
            onClick={() => setIsEdit(true)}
          >
            Edit
          </button>
        )}
      </div>
    </div>
  ) : (
    <div className="text-center py-20">
      <p>Loading profile...</p>
    </div>
  );
};

export default MyProfile;
