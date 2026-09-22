const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');

const categoriaController = require('../controllers/categoria.controller');
const parejaController = require('../controllers/pareja.controller');
const zonaController = require('../controllers/zona.controller');
const faseEliminatoriaController = require('../controllers/faseEliminatoria.controller');
const partidoController = require('../controllers/partido.controller');

// Todas las rutas de categoría requieren auth
router.use(auth);

// CRUD de categoría
router.get('/:id', categoriaController.getCategoriaById);
router.patch('/:id', categoriaController.updateCategoria);
router.delete('/:id', categoriaController.deleteCategoria);
router.post('/:id/reiniciar', categoriaController.reiniciarCategoria);
router.post('/:id/sorteo', categoriaController.sortearZonas);

// Parejas de la categoría
router.post('/:id/parejas', parejaController.createPareja);
router.get('/:id/parejas', parejaController.getParejasByCategoria);

// Zonas de la categoría
router.get('/:id/zonas', zonaController.getZonasByCategoria);
router.delete('/:id/zonas/resultados', zonaController.limpiarResultadosZonas);

// Eliminatorias de la categoría
router.post('/:id/generar-eliminatoria', faseEliminatoriaController.generarEliminatoria);
router.get('/:id/fases-eliminatorias', faseEliminatoriaController.getFasesEliminatorias);
router.delete('/:id/fases-eliminatorias', faseEliminatoriaController.deleteFasesEliminatorias);

// Partidos de la categoría
router.get('/:id/partidos', partidoController.getPartidosByCategoria);

module.exports = router;
