const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const partidoController = require('../controllers/partido.controller');

router.use(auth);

// Tickets 3.2/4.2
router.put('/:id/resultado', partidoController.cargarResultado);
router.delete('/:id/resultado', partidoController.borrarResultado);

// Update match time
router.put('/:id/fecha-hora', partidoController.updateFechaHora);
router.put('/:id/asignar-horario-manual', partidoController.asignarHorarioManual);

// Edición de brackets eliminatorios bracket
router.patch('/:id/bracket', partidoController.updateBracketMatch);

module.exports = router;
