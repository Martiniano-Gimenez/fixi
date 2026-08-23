const partidoService = require('../services/partido.service');

function getOrgId(req) {
  return req.organizadorId || req.organizador?.id;
}

async function cargarResultado(req, res, next) {
  try {
    const result = await partidoService.cargarResultado(getOrgId(req), req.params.id, req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function borrarResultado(req, res, next) {
  try {
    const result = await partidoService.borrarResultado(getOrgId(req), req.params.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function updateFechaHora(req, res, next) {
  try {
    const { fechaHora } = req.body;
    const result = await partidoService.updateFechaHora(getOrgId(req), req.params.id, fechaHora);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function getPartidosByCategoria(req, res, next) {
  try {
    const categoriaId = req.params.categoriaId || req.params.id;
    const { zonaId, faseId } = req.query;

    const partidos = await partidoService.getPartidosByCategoria(getOrgId(req), categoriaId, {
      zonaId,
      faseId,
    });

    res.json(partidos);
  } catch (error) {
    next(error);
  }
}

async function updateBracketMatch(req, res, next) {
  try {
    const result = await partidoService.updateBracketMatch(getOrgId(req), req.params.id, req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function asignarHorarioManual(req, res, next) {
  try {
    const result = await partidoService.asignarHorarioManual(getOrgId(req), req.params.id, req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  cargarResultado,
  borrarResultado,
  updateFechaHora,
  getPartidosByCategoria,
  updateBracketMatch,
  asignarHorarioManual,
};
