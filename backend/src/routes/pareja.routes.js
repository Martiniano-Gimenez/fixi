const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const parejaController = require('../controllers/pareja.controller');
const disponibilidadController = require('../controllers/disponibilidad.controller');

router.use(auth);

router.patch('/:id', parejaController.updatePareja);
router.delete('/:id', parejaController.deletePareja);

router.get('/:id/disponibilidades', disponibilidadController.getDisponibilidadesHandler);
router.put('/:id/disponibilidades', disponibilidadController.setDisponibilidadesHandler);

module.exports = router;
