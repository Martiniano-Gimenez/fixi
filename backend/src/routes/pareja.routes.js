const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const parejaController = require('../controllers/pareja.controller');
const disponibilidadController = require('../controllers/disponibilidad.controller');

router.use(auth);

router.patch('/:id', parejaController.updatePareja);
router.delete('/:id', parejaController.deletePareja);

// Disponibilidad por slots
router.get('/:id/disponibilidad', disponibilidadController.getDisponibilidad);
router.put('/:id/disponibilidad', disponibilidadController.setDisponibilidad);

module.exports = router;
