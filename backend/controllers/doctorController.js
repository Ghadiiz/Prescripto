const { getDB } = require('../config/mysql');

// Get all doctors
const getAllDoctors = async (req, res) => {
  try {
    const db = getDB();
    const { speciality } = req.query;

    let query = `
      SELECT 
        d.id,
        d.name,
        d.email,
        d.image,
        s.name AS speciality,
        d.degree,
        d.experience,
        d.about,
        d.fees,
        d.address_line1,
        d.address_line2,
        d.available
      FROM doctors d
      JOIN specialities s ON d.speciality_id = s.id
      WHERE d.available = true
    `;

    const params = [];

    // Check if speciality filter is provided
    if (speciality) {
      query += ' AND s.name = ?';
      params.push(speciality);
    }

    const [doctors] = await db.query(query, params);

    // Match frontend structure
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
      data: transformedDoctors,
    });
  } catch (error) {
    console.error('Error fetching doctors:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch doctors',
    });
  }
};

// Get doctor by ID
const getDoctorById = async (req, res) => {
  try {
    const db = getDB();
    const { id } = req.params;

    const query = `
      SELECT 
        d.id,
        d.name,
        d.email,
        d.image,
        s.name AS speciality,
        d.degree,
        d.experience,
        d.about,
        d.fees,
        d.address_line1,
        d.address_line2,
        d.available
      FROM doctors d
      JOIN specialities s ON d.speciality_id = s.id
      WHERE d.id = ?
    `;

    const [doctors] = await db.query(query, [id]);

    if (doctors.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Doctor not found',
      });
    }

    const doc = doctors[0];

    // Match frontend structure
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
      data: transformedDoctor,
    });
  } catch (error) {
    console.error('Error fetching doctor:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch doctor',
    });
  }
};

module.exports = {
  getAllDoctors,
  getDoctorById,
};
