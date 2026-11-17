const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');

const categoriaController = require('../controllers/categoria.controller');
const parejaController = require('../controllers/pareja.controller');
const zonaController = require('../controllers/zona.controller');
const faseEliminatoriaController = require('../controllers/faseEliminatoria.controller');
const partidoController = require('../controllers/partido.controller');
const { exigirCategoriaConTorneoAbierto } = require('../services/categoria.service');

async function torneoAbierto(req, res, next) {
  try {
    await exigirCategoriaConTorneoAbierto(req.organizadorId, req.params.id);
    next();
  } catch (error) { next(error); }
}

// Todas las rutas de categoría requieren auth
router.use(auth);

// CRUD de categoría
router.get('/:id', categoriaController.getCategoriaById);
router.patch('/:id', categoriaController.updateCategoria);
router.delete('/:id', categoriaController.deleteCategoria);
router.post('/:id/reiniciar', torneoAbierto, categoriaController.reiniciarCategoria);
router.post('/:id/sorteo', torneoAbierto, categoriaController.sortearZonas);

// Parejas de la categoría
router.post('/:id/parejas', torneoAbierto, parejaController.createPareja);
router.get('/:id/parejas', parejaController.getParejasByCategoria);

// Zonas de la categoría
router.get('/:id/zonas', zonaController.getZonasByCategoria);
router.put('/:id/zonas/:zonaId/desempate', torneoAbierto, zonaController.resolverDesempateZona);
router.delete('/:id/zonas/resultados', torneoAbierto, zonaController.limpiarResultadosZonas);
router.post('/:id/zonas/mover-pareja', torneoAbierto, zonaController.moverPareja);
router.post('/:id/zonas/agregar-pareja', torneoAbierto, zonaController.agregarPareja);

// Eliminatorias de la categoría
router.post('/:id/generar-eliminatoria', torneoAbierto, faseEliminatoriaController.generarEliminatoria);
router.get('/:id/fases-eliminatorias', faseEliminatoriaController.getFasesEliminatorias);
router.delete('/:id/fases-eliminatorias', torneoAbierto, faseEliminatoriaController.deleteFasesEliminatorias);
router.get('/:id/cuadro-estado', faseEliminatoriaController.getEstadoCuadro);
router.post('/:id/sincronizar-cuadro', torneoAbierto, faseEliminatoriaController.sincronizarCuadro);
router.get('/:id/sincronizar-cuadro', torneoAbierto, (req, res, next) => {
  req.query.simular = 'true';
  return faseEliminatoriaController.sincronizarCuadro(req, res, next);
});

// Partidos de la categoría
router.get('/:id/partidos', partidoController.getPartidosByCategoria);

module.exports = router;
