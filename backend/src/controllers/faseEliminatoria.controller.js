const faseEliminatoriaService = require('../services/faseEliminatoria.service');

function getOrgId(req) {
  return req.organizadorId || req.organizador?.id;
}

async function generarEliminatoria(req, res, next) {
  try {
    const categoriaId = req.params.categoriaId || req.params.id;
    const organizadorId = getOrgId(req);

    const resultado = await faseEliminatoriaService.generarEliminatoria(
      organizadorId,
      categoriaId
    );

    res.status(201).json(resultado);
  } catch (error) {
    next(error);
  }
}

async function getFasesEliminatorias(req, res, next) {
  try {
    const categoriaId = req.params.categoriaId || req.params.id;
    const organizadorId = getOrgId(req);

    const fases = await faseEliminatoriaService.getFasesEliminatorias(
      organizadorId,
      categoriaId
    );

    res.status(200).json(fases);
  } catch (error) {
    next(error);
  }
}

async function deleteFasesEliminatorias(req, res, next) {
  try {
    const categoriaId = req.params.categoriaId || req.params.id;
    const organizadorId = getOrgId(req);

    const resultado = await faseEliminatoriaService.borrarEliminatoria(
      organizadorId,
      categoriaId
    );

    res.status(200).json(resultado);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  generarEliminatoria,
  getFasesEliminatorias,
  deleteFasesEliminatorias,
};
