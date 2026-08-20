const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const organizadorController = require('../controllers/organizador.controller');

router.use(auth);

// Perfil y configuración del club
router.get('/perfil', organizadorController.getOrganizador);
router.patch('/perfil', organizadorController.updateOrganizador);

// Simulación de impacto de cambio de jornada en todos los torneos del organizador
router.post('/simular-jornada', organizadorController.simularCambioJornada);

// Grilla de slots del club
router.get('/slots', organizadorController.getSlotsGrilla);

// Iniciar todos los torneos en borrador y programar horarios simultáneamente
router.post('/iniciar-todos', organizadorController.iniciarTodos);

module.exports = router;
