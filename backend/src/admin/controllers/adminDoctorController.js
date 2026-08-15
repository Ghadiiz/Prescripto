import * as adminDoctorService from '../services/adminDoctorService.js';
import {
  isValidEmail,
  isValidName,
  isValidPhone,
  isPositiveNumber,
  isValidGender,
  isValidArea,
  isValidLanguages,
} from '../../utils/validators.js';

export const getDoctorOptions = async (req, res, next) => {
  try {
    const options = await adminDoctorService.getDoctorOptions();

    res.status(200).json({
      success: true,
      data: options,
    });
  } catch (error) {
    next(error);
  }
};

export const getAllDoctors = async (req, res, next) => {
  try {
    const doctors = await adminDoctorService.getAllDoctors();

    res.status(200).json({
      success: true,
      count: doctors.length,
      data: doctors,
    });
  } catch (error) {
    next(error);
  }
};

export const addDoctor = async (req, res, next) => {
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

    if (!isValidName(name)) {
      return res.status(400).json({
        success: false,
        message: 'Doctor name must be between 2 and 100 characters',
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address',
      });
    }

    if (!isPositiveNumber(fees)) {
      return res.status(400).json({
        success: false,
        message: 'Fees must be a positive number',
      });
    }

    if (!isValidPhone(doctorData.phone)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid phone number',
      });
    }

    if (!isValidGender(doctorData.gender)) {
      return res.status(400).json({
        success: false,
        message: 'Gender must be Male or Female',
      });
    }

    if (!isValidArea(doctorData.area)) {
      return res.status(400).json({
        success: false,
        message: 'Please select a valid area',
      });
    }

    if (!isValidLanguages(doctorData.languages)) {
      return res.status(400).json({
        success: false,
        message:
          'Languages must be a comma-separated list without spaces, e.g. English,Arabic',
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
    next(error);
  }
};

export const updateDoctor = async (req, res, next) => {
  try {
    const { id } = req.params;
    const doctorData = req.body;
    const imageFile = req.file;
    const { name, email, fees } = doctorData;

    if (name !== undefined && !isValidName(name)) {
      return res.status(400).json({
        success: false,
        message: 'Doctor name must be between 2 and 100 characters',
      });
    }

    if (email !== undefined && !isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address',
      });
    }

    if (fees !== undefined && !isPositiveNumber(fees)) {
      return res.status(400).json({
        success: false,
        message: 'Fees must be a positive number',
      });
    }

    if (!isValidPhone(doctorData.phone)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid phone number',
      });
    }

    if (!isValidGender(doctorData.gender)) {
      return res.status(400).json({
        success: false,
        message: 'Gender must be Male or Female',
      });
    }

    if (!isValidArea(doctorData.area)) {
      return res.status(400).json({
        success: false,
        message: 'Please select a valid area',
      });
    }

    if (!isValidLanguages(doctorData.languages)) {
      return res.status(400).json({
        success: false,
        message:
          'Languages must be a comma-separated list without spaces, e.g. English,Arabic',
      });
    }

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
    next(error);
  }
};

export const deleteDoctor = async (req, res, next) => {
  try {
    const { id } = req.params;

    await adminDoctorService.deleteDoctor(id);

    res.status(200).json({
      success: true,
      message: 'Doctor deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

export const toggleAvailability = async (req, res, next) => {
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
    next(error);
  }
};
