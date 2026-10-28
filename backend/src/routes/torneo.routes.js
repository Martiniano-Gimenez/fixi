const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const torneoController = require('../controllers/torneo.controller');
const categoriaController = require('../controllers/categoria.controller');

// Todas las rutas de torneo requieren auth
router.use(auth);

// CRUD de Torneo (Evento)
router.post('/', torneoController.createTorneo);
router.get('/', torneoController.getTorneos);
router.get('/:id', torneoController.getTorneoById);
router.put('/:id', torneoController.updateTorneo);
router.patch('/:id', torneoController.updateTorneo);
router.delete('/:id', torneoController.deleteTorneo);

// Categorías dentro del Torneo
router.post('/:torneoId/categorias', categoriaController.createCategoria);
router.get('/:torneoId/categorias', categoriaController.getCategorias);

// Acciones a nivel Torneo (Multi-categoría)
router.post('/:id/pre-check-inicio', torneoController.preCheckInicioTorneo);
router.post('/:id/iniciar', torneoController.iniciarTorneo);
router.post('/:id/reiniciar', torneoController.reiniciarTorneo);
router.patch('/:id/inscripcion', torneoController.setInscripcion);
router.get('/:id/partidos-sin-horario', torneoController.getPartidosSinHorarioTorneo);
router.get('/:id/canchas-disponibles', torneoController.getCanchasDisponiblesTorneo);

// Modo Día de Torneo
router.get('/:id/en-vivo', torneoController.getEnVivo);
router.post('/:id/canchas-override', torneoController.setCanchasOverride);

module.exports = router;
