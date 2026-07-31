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

// Ticket 4.3 — editar bracket
router.patch('/:id/bracket', (req, res) => {
  res.status(501).json({ error: 'No implementado todavía.' });
});

module.exports = router;
