const express = require('express');
const router = express.Router();
const publicController = require('../controllers/public.controller');

// Ticket 5.1 — Vista pública sin auth
router.get('/:slug', publicController.getTorneoPublico);

module.exports = router;
