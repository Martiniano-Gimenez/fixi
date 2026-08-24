const torneoService = require('../services/torneo.service');
const organizadorService = require('../services/organizador.service');

function getOrgId(req) {
  return req.organizadorId || req.organizador?.id;
}

async function createTorneo(req, res, next) {
  try {
    const torneo = await torneoService.createTorneo(getOrgId(req), req.body);
    res.status(201).json(torneo);
  } catch (error) {
    next(error);
  }
}

async function getTorneos(req, res, next) {
  try {
    const torneos = await torneoService.getTorneos(getOrgId(req));
    res.json(torneos);
  } catch (error) {
    next(error);
  }
}

async function getTorneoById(req, res, next) {
  try {
    const torneo = await torneoService.getTorneoById(getOrgId(req), req.params.id);
    res.json(torneo);
  } catch (error) {
    next(error);
  }
}

async function updateTorneo(req, res, next) {
  try {
    const torneo = await torneoService.updateTorneo(getOrgId(req), req.params.id, req.body);
    res.json(torneo);
  } catch (error) {
    next(error);
  }
}

async function deleteTorneo(req, res, next) {
  try {
    const result = await torneoService.deleteTorneo(getOrgId(req), req.params.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function preCheckInicioTorneo(req, res, next) {
  try {
    const organizadorId = getOrgId(req);
    const torneoId = req.params.id;
    const result = await organizadorService.preCheckInicioTorneo(organizadorId, torneoId);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function iniciarTorneo(req, res, next) {
  try {
    const organizadorId = getOrgId(req);
    const torneoId = req.params.id;
    const { planId } = req.body || {};
    const result = await organizadorService.iniciarTorneoMultiCategoria(organizadorId, torneoId, planId);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function reiniciarTorneo(req, res, next) {
  try {
    const result = await torneoService.reiniciarTorneo(getOrgId(req), req.params.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function getPartidosSinHorarioTorneo(req, res, next) {
  try {
    const organizadorId = getOrgId(req);
    const torneoId = req.params.id;
    const result = await organizadorService.getPartidosSinHorarioTorneo(organizadorId, torneoId);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function getCanchasDisponiblesTorneo(req, res, next) {
  try {
    const organizadorId = getOrgId(req);
    const torneoId = req.params.id;
    const ignorePartidoId = req.query.ignorePartidoId;
    const result = await organizadorService.getCanchasDisponiblesTorneo(organizadorId, torneoId, ignorePartidoId);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createTorneo,
  getTorneos,
  getTorneoById,
  updateTorneo,
  deleteTorneo,
  preCheckInicioTorneo,
  iniciarTorneo,
  reiniciarTorneo,
  getPartidosSinHorarioTorneo,
  getCanchasDisponiblesTorneo,
};
