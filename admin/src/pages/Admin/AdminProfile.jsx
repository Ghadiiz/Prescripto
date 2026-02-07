import React, { useContext, useState, useEffect } from 'react';
import { AdminContext } from '../../context/AdminContext';
import { toast } from 'react-toastify';
import axios from 'axios';

const AdminProfile = () => {
  const { aToken, backendUrl } = useContext(AdminContext);

  const [isEdit, setIsEdit] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);

  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);

  const getAdminProfile = async () => {
    try {
      const { data } = await axios.get(`${backendUrl}/api/admin/profile`, {
        headers: { Authorization: `Bearer ${aToken}` },
      });

      if (data.success) {
        setName(data.admin.name);
        setEmail(data.admin.email);
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      console.error(error);
      toast.error('Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    getAdminProfile();
  }, []);

  const updateProfile = async () => {
    try {
      const { data } = await axios.put(
        `${backendUrl}/api/admin/profile`,
        { name, email },
        { headers: { Authorization: `Bearer ${aToken}` } },
      );

      if (data.success) {
        toast.success('Profile updated successfully!');
        setIsEdit(false);
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || 'Failed to update profile');
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();

    if (!oldPassword || !newPassword || !confirmPassword) {
      toast.error('Please fill in all password fields');
      return;
    }

    if (newPassword.length < 8) {
      toast.error('New password must be at least 8 characters');
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }

    setPasswordLoading(true);

    try {
      const { data } = await axios.put(
        `${backendUrl}/api/admin/change-password`,
        { oldPassword, newPassword },
        { headers: { Authorization: `Bearer ${aToken}` } },
      );

      if (data.success) {
        toast.success('Password changed successfully!');
        setShowPasswordChange(false);
        setOldPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || 'Failed to change password');
    } finally {
      setPasswordLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="m-5 w-full max-w-4xl">
        <p>Loading profile...</p>
      </div>
    );
  }

  return (
    <div className="m-5 w-full max-w-4xl">
      <p className="mb-3 text-lg font-medium">Admin Profile</p>

      <div className="bg-white px-8 py-8 border rounded w-full">
        <div className="mb-8">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-20 h-20 bg-primary text-white rounded-full flex items-center justify-center text-3xl font-bold">
              {name?.charAt(0)?.toUpperCase() || 'A'}
            </div>
            <div>
              <h2 className="text-2xl font-semibold text-gray-800">
                {name || 'Admin'}
              </h2>
              <p className="text-gray-500">{email}</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Name
              </label>
              {isEdit ? (
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              ) : (
                <p className="px-3 py-2 bg-gray-50 rounded-lg">{name}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              {isEdit ? (
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              ) : (
                <p className="px-3 py-2 bg-gray-50 rounded-lg">{email}</p>
              )}
            </div>
          </div>

          <div className="mt-4 flex gap-3">
            {isEdit ? (
              <>
                <button
                  onClick={updateProfile}
                  className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary/90"
                >
                  Save Changes
                </button>
                <button
                  onClick={() => {
                    setIsEdit(false);
                    getAdminProfile();
                  }}
                  className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setIsEdit(true)}
                className="px-6 py-2 border border-primary text-primary rounded-lg hover:bg-primary hover:text-white transition-all"
              >
                Edit Profile
              </button>
            )}
          </div>
        </div>

        <hr className="my-8" />

        <div>
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Security</h3>

          {!showPasswordChange ? (
            <button
              onClick={() => setShowPasswordChange(true)}
              className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
            >
              Change Password
            </button>
          ) : (
            <form onSubmit={changePassword} className="space-y-4 max-w-md">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Current Password
                </label>
                <input
                  type="password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  New Password
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  required
                  minLength={8}
                  placeholder="Minimum 8 characters"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Confirm New Password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  required
                  minLength={8}
                />
              </div>

              {newPassword &&
                confirmPassword &&
                newPassword !== confirmPassword && (
                  <p className="text-red-500 text-sm">Passwords do not match</p>
                )}

              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={passwordLoading || newPassword !== confirmPassword}
                  className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {passwordLoading ? 'Changing...' : 'Change Password'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowPasswordChange(false);
                    setOldPassword('');
                    setNewPassword('');
                    setConfirmPassword('');
                  }}
                  className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminProfile;
