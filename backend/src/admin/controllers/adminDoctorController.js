import * as adminDoctorService from '../services/adminDoctorService.js';

export const getAllDoctors = async (req, res) => {
  try {
    const doctors = await adminDoctorService.getAllDoctors();

    res.status(200).json({
      success: true,
      count: doctors.length,
      data: doctors,
    });
  } catch (error) {
    console.error('Error fetching doctors:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch doctors',
    });
  }
};

export const addDoctor = async (req, res) => {
  try {
    const doctorData = req.body;
    const imageFile = req.file;

    const { name, email, speciality_id, degree, experience, fees } = doctorData;

    if (!name || !email || !speciality_id || !degree || !experience || !fees) {
      return res.status(400).json({
        success: false,
        message: 'All required fields must be provided',
      });
    }

    const doctor = await adminDoctorService.addDoctor(doctorData, imageFile);

    res.status(201).json({
      success: true,
      message:
        'Doctor added successfully! Email sent to doctor to set password.',
      data: doctor,
    });
  } catch (error) {
    console.error('Error adding doctor:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to add doctor',
    });
  }
};

export const updateDoctor = async (req, res) => {
  try {
    const { id } = req.params;
    const doctorData = req.body;
    const imageFile = req.file;

    const doctor = await adminDoctorService.updateDoctor(
      id,
      doctorData,
      imageFile,
    );

    res.status(200).json({
      success: true,
      message: 'Doctor updated successfully',
      data: doctor,
    });
  } catch (error) {
    console.error('Error updating doctor:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update doctor',
    });
  }
};

export const deleteDoctor = async (req, res) => {
  try {
    const { id } = req.params;

    await adminDoctorService.deleteDoctor(id);

    res.status(200).json({
      success: true,
      message: 'Doctor deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting doctor:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to delete doctor',
    });
  }
};

export const toggleAvailability = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await adminDoctorService.toggleDoctorAvailability(id);

    res.status(200).json({
      success: true,
      message: 'Doctor availability updated successfully',
      data: {
        id: parseInt(id),
        available: result.available,
      },
    });
  } catch (error) {
    console.error('Error toggling availability:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to toggle availability',
    });
  }
};
