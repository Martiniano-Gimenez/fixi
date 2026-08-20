const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const torneoController = require('../controllers/torneo.controller');

// Todas las rutas de torneo requieren auth
router.use(auth);

router.post('/', torneoController.createTorneo);
router.get('/', torneoController.getTorneos);
router.get('/:id', torneoController.getTorneoById);
router.patch('/:id', torneoController.updateTorneo);
router.delete('/:id', torneoController.deleteTorneo);

// Rutas anidadas de parejas (crear y listar por torneo)
const parejaController = require('../controllers/pareja.controller');
router.post('/:id/parejas', parejaController.createPareja);
router.get('/:id/parejas', parejaController.getParejasByTorneo);

// Inicio y reinicio de torneo
router.post('/:id/iniciar', torneoController.iniciarTorneo);
router.post('/:id/iniciar-disponibilidad', torneoController.iniciarTorneoConDisponibilidad);
router.post('/:id/asignar-horarios', torneoController.asignarHorariosAutomatico);
router.post('/:id/reiniciar', torneoController.reiniciarTorneo);

// Rutas anidadas de partidos y zonas
const partidoController = require('../controllers/partido.controller');
const zonaController = require('../controllers/zona.controller');
const faseEliminatoriaController = require('../controllers/faseEliminatoria.controller');

router.get('/:id/partidos', partidoController.getPartidosByTorneo);

// Ticket 3 — Zonas
router.get('/:id/zonas', zonaController.getZonasByTorneo);
router.delete('/:id/zonas/resultados', zonaController.limpiarResultadosZonas);
router.put('/:id/zonas/reestructurar', zonaController.reestructurarZonas);

// Ticket 4.1 — Generar Eliminatoria
router.post('/:id/generar-eliminatoria', faseEliminatoriaController.generarEliminatoria);

// Ticket 4 — Obtener/Borrar Fases Eliminatorias
router.get('/:id/fases-eliminatorias', faseEliminatoriaController.getFasesEliminatorias);
router.delete('/:id/fases-eliminatorias', faseEliminatoriaController.deleteFasesEliminatorias);

module.exports = router;
