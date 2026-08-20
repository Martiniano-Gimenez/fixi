const organizadorService = require('../services/organizador.service');

async function getOrganizador(req, res, next) {
  try {
    const organizador = await organizadorService.getOrganizador(req.organizadorId);
    res.json(organizador);
  } catch (error) {
    next(error);
  }
}

async function updateOrganizador(req, res, next) {
  try {
    const organizador = await organizadorService.updateOrganizador(req.organizadorId, req.body);
    res.json(organizador);
  } catch (error) {
    next(error);
  }
}

async function simularCambioJornada(req, res, next) {
  try {
    const resultado = await organizadorService.simularCambioJornadaOrganizador(req.organizadorId, req.body);
    res.json(resultado);
  } catch (error) {
    next(error);
  }
}

async function getSlotsGrilla(req, res, next) {
  try {
    const grilla = await organizadorService.getSlotsGrilla(req.organizadorId);
    res.json(grilla);
  } catch (error) {
    next(error);
  }
}

async function iniciarTodos(req, res, next) {
  try {
    const resultado = await organizadorService.iniciarTodosLosTorneos(req.organizadorId);
    res.json(resultado);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getOrganizador,
  updateOrganizador,
  simularCambioJornada,
  getSlotsGrilla,
  iniciarTodos,
};
