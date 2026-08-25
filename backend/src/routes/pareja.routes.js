const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const parejaController = require('../controllers/pareja.controller');
const disponibilidadController = require('../controllers/disponibilidad.controller');

router.use(auth);

router.patch('/:id', parejaController.updatePareja);
router.delete('/:id', parejaController.deletePareja);

// Disponibilidad por slots
router.put('/disponibilidad-doble', disponibilidadController.setDisponibilidadDoble);
router.post('/disponibilidad-doble/remover', disponibilidadController.removerDisponibilidadDoble);
router.get('/:id/disponibilidad', disponibilidadController.getDisponibilidad);
router.put('/:id/disponibilidad', disponibilidadController.setDisponibilidad);

module.exports = router;
