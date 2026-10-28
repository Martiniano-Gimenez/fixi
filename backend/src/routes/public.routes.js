const express = require('express');
const router = express.Router();
const publicController = require('../controllers/public.controller');
const { limiteInscripcion } = require('../middleware/limitePorIp');

// Ticket 5.1 — Vista pública sin auth
router.get('/:slug', publicController.getTorneoPublico);

// Inscripción de parejas por link (sin auth). El límite por IP va solo en el POST.
router.get('/:slug/inscripcion', publicController.getInscripcion);
router.post('/:slug/inscripcion', limiteInscripcion, publicController.postInscripcion);

module.exports = router;
