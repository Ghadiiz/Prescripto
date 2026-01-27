const express = require('express');
const router = express.Router();
const { getAllSpecialities } = require('../controllers/specialityController');

router.get('/', getAllSpecialities);

module.exports = router;
