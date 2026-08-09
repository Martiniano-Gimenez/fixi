const torneoService = require('../services/torneo.service');
const zonaService = require('../services/zona.service');

async function createTorneo(req, res, next) {
  try {
    const torneo = await torneoService.createTorneo(req.organizadorId, req.body);
    res.status(201).json(torneo);
  } catch (error) {
    next(error);
  }
}

async function getTorneos(req, res, next) {
  try {
    const torneos = await torneoService.getTorneos(req.organizadorId);
    res.json(torneos);
  } catch (error) {
    next(error);
  }
}

async function getTorneoById(req, res, next) {
  try {
    const torneo = await torneoService.getTorneoById(req.organizadorId, req.params.id);
    res.json(torneo);
  } catch (error) {
    next(error);
  }
}

async function updateTorneo(req, res, next) {
  try {
    const torneo = await torneoService.updateTorneo(req.organizadorId, req.params.id, req.body);
    res.json(torneo);
  } catch (error) {
    next(error);
  }
}

async function iniciarTorneo(req, res, next) {
  try {
    const result = await zonaService.iniciarTorneo(req.organizadorId, req.params.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function reiniciarTorneo(req, res, next) {
  try {
    const result = await torneoService.reiniciarTorneo(req.organizadorId, req.params.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function iniciarTorneoConDisponibilidad(req, res, next) {
  try {
    const result = await zonaService.iniciarTorneoConDisponibilidad(req.organizadorId, req.params.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function asignarHorariosAutomatico(req, res, next) {
  try {
    const result = await zonaService.asignarHorariosAutomatico(req.organizadorId, req.params.id);
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
  iniciarTorneo,
  reiniciarTorneo,
  iniciarTorneoConDisponibilidad,
  asignarHorariosAutomatico,
};
