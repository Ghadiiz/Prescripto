import * as doctorModel from '../models/doctorModel.js';

export const getAllDoctors = async (req, res, next) => {
  try {
    const { speciality } = req.query;
    const doctors = await doctorModel.getAllDoctors(speciality);

    const transformedDoctors = doctors.map((doc) => ({
      _id: doc.id.toString(),
      name: doc.name,
      email: doc.email,
      image: doc.image,
      speciality: doc.speciality,
      degree: doc.degree,
      experience: doc.experience,
      about: doc.about,
      fees: doc.fees,
      address: {
        line1: doc.address_line1,
        line2: doc.address_line2,
      },
      available: Boolean(doc.available),
    }));

    res.status(200).json({
      success: true,
      count: transformedDoctors.length,
      doctors: transformedDoctors,
    });
  } catch (error) {
    next(error);
  }
};

export const getDoctorById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const doc = await doctorModel.getDoctorById(id);

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: 'Doctor not found',
      });
    }

    const transformedDoctor = {
      _id: doc.id.toString(),
      name: doc.name,
      email: doc.email,
      image: doc.image,
      speciality: doc.speciality,
      degree: doc.degree,
      experience: doc.experience,
      about: doc.about,
      fees: doc.fees,
      address: {
        line1: doc.address_line1,
        line2: doc.address_line2,
      },
      available: Boolean(doc.available),
    };

    res.status(200).json({
      success: true,
      doctor: transformedDoctor,
    });
  } catch (error) {
    next(error);
  }
};

export const getAllSpecialities = async (req, res, next) => {
  try {
    const specialities = await doctorModel.getAllSpecialities();

    const transformedData = specialities.map((item) => ({
      speciality: item.name,
      image: item.image,
    }));

    res.status(200).json({
      success: true,
      count: transformedData.length,
      specialities: transformedData,
    });
  } catch (error) {
    next(error);
  }
};

export const searchDoctors = async (req, res, next) => {
  try {
    const { query } = req.query;

    if (!query || query.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Search query is required',
      });
    }

    const doctors = await doctorModel.searchDoctors(query);

    const transformedDoctors = doctors.map((doc) => ({
      _id: doc.id.toString(),
      name: doc.name,
      email: doc.email,
      image: doc.image,
      speciality: doc.speciality,
      degree: doc.degree,
      experience: doc.experience,
      about: doc.about,
      fees: doc.fees,
      address: {
        line1: doc.address_line1,
        line2: doc.address_line2,
      },
      available: Boolean(doc.available),
    }));

    res.status(200).json({
      success: true,
      count: transformedDoctors.length,
      doctors: transformedDoctors,
    });
  } catch (error) {
    next(error);
  }
};
