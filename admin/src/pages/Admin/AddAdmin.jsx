import React, { useContext, useState } from 'react';
import { AdminContext } from '../../context/AdminContext';
import { toast } from 'react-toastify';
import axios from 'axios';

const AddAdmin = () => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const { aToken, backendUrl } = useContext(AdminContext);

  const onSubmitHandler = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data } = await axios.post(
        `${backendUrl}/api/admin/create-admin`,
        { name, email, password },
        { headers: { Authorization: `Bearer ${aToken}` } },
      );

      if (data.success) {
        toast.success(data.message);

        setName('');
        setEmail('');
        setPassword('');
      } else {
        toast.error(data.message);
      }
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || 'Failed to create admin');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={onSubmitHandler} className="m-5 w-full max-w-4xl">
      <p className="mb-3 text-lg font-medium">Add New Admin</p>

      <div className="bg-white px-8 py-8 border rounded w-full max-w-4xl">
        <div className="flex flex-col lg:flex-row items-start gap-10 text-gray-600">
          <div className="w-full lg:flex-1 flex flex-col gap-4">
            <div className="flex-1 flex flex-col gap-1">
              <p>Admin Name</p>
              <input
                onChange={(e) => setName(e.target.value)}
                value={name}
                className="border rounded px-3 py-2"
                type="text"
                placeholder="Admin name"
                required
              />
            </div>

            <div className="flex-1 flex flex-col gap-1">
              <p>Admin Email</p>
              <input
                onChange={(e) => setEmail(e.target.value)}
                value={email}
                className="border rounded px-3 py-2"
                type="email"
                placeholder="admin@example.com"
                required
              />
            </div>

            <div className="flex-1 flex flex-col gap-1">
              <p>Temporary Password</p>
              <input
                onChange={(e) => setPassword(e.target.value)}
                value={password}
                className="border rounded px-3 py-2"
                type="password"
                placeholder="Minimum 8 characters"
                required
                minLength={8}
              />
              <p className="text-xs text-gray-500">
                The admin will receive this password via email and should change
                it after first login.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded">
          <p className="text-sm text-blue-800">
            <strong>📧 Email Notification:</strong> The new admin will receive
            an email with their login credentials and a link to the admin panel.
          </p>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="bg-primary px-10 py-3 mt-4 text-white rounded-full disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Creating Admin...' : 'Add Admin'}
        </button>
      </div>
    </form>
  );
};

export default AddAdmin;
