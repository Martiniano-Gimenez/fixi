const partidoService = require('../services/partido.service');
const prisma = require('../lib/prisma');

async function cargarResultado(req, res, next) {
  try {
    const result = await partidoService.cargarResultado(req.organizadorId, req.params.id, req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function borrarResultado(req, res, next) {
  try {
    const result = await partidoService.borrarResultado(req.organizadorId, req.params.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function updateFechaHora(req, res, next) {
  try {
    const { fechaHora } = req.body;
    const result = await partidoService.updateFechaHora(req.organizadorId, req.params.id, fechaHora);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

// Endpoint adicional para listar partidos (necesario para el frontend)
async function getPartidosByTorneo(req, res, next) {
  try {
    // Se asume que esta ruta se monta en /torneos/:id/partidos
    const torneoId = req.params.id;
    const { zonaId, faseId } = req.query;

    const where = { torneoId };
    if (zonaId) where.zonaId = zonaId;
    if (faseId) where.faseEliminatoriaId = faseId;

    const partidos = await prisma.partido.findMany({
      where,
      include: {
        pareja1: true,
        pareja2: true,
        ganador: true,
        sets: { orderBy: { numero: 'asc' } },
      },
      orderBy: [
        { zonaId: 'asc' },
        { faseEliminatoriaId: 'asc' },
        { posicionEnRonda: 'asc' }
      ]
    });

    res.json(partidos);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  cargarResultado,
  borrarResultado,
  updateFechaHora,
  getPartidosByTorneo,
};
