const faseEliminatoriaService = require('../services/faseEliminatoria.service');

/**
 * POST /api/torneos/:id/generar-eliminatoria
 */
async function generarEliminatoria(req, res) {
  try {
    const { id: torneoId } = req.params;
    const organizadorId = req.organizadorId;

    const resultado = await faseEliminatoriaService.generarEliminatoria(
      organizadorId,
      torneoId
    );

    res.status(201).json(resultado);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ error: error.message });
  }
}

/**
 * GET /api/torneos/:id/fases-eliminatorias
 */
async function getFasesEliminatorias(req, res) {
  try {
    const { id: torneoId } = req.params;
    const organizadorId = req.organizadorId;

    const fases = await faseEliminatoriaService.getFasesEliminatorias(
      organizadorId,
      torneoId
    );

    res.status(200).json(fases);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ error: error.message });
  }
}

/**
 * DELETE /api/torneos/:id/fases-eliminatorias
 */
async function deleteFasesEliminatorias(req, res) {
  try {
    const { id: torneoId } = req.params;
    const organizadorId = req.organizadorId;

    const resultado = await faseEliminatoriaService.borrarEliminatoria(
      organizadorId,
      torneoId
    );

    res.status(200).json(resultado);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ error: error.message });
  }
}

module.exports = {
  generarEliminatoria,
  getFasesEliminatorias,
  deleteFasesEliminatorias,
};
