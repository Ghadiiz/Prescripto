const { getDB } = require('../config/mysql');

// Get all specialities
const getAllSpecialities = async (req, res) => {
  try {
    const db = getDB();
    const [specialities] = await db.query('SELECT * FROM specialities');

    // Match frontend structure
    const transformedData = specialities.map((item) => ({
      speciality: item.name,
      image: item.image,
    }));

    res.status(200).json({
      success: true,
      count: transformedData.length,
      data: transformedData,
    });
  } catch (error) {
    console.error('Error fetching specialities:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch specialities',
    });
  }
};

module.exports = {
  getAllSpecialities,
};
