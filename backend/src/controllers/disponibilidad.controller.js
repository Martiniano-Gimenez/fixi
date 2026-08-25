const disponibilidadService = require('../services/disponibilidad.service');

async function getDisponibilidad(req, res, next) {
  try {
    const slots = await disponibilidadService.getDisponibilidad(req.params.id);
    res.json(slots);
  } catch (error) {
    next(error);
  }
}

async function setDisponibilidad(req, res, next) {
  try {
    const { slots } = req.body;
    const resultado = await disponibilidadService.setDisponibilidad(req.params.id, slots);
    res.json(resultado);
  } catch (error) {
    next(error);
  }
}

async function setDisponibilidadDoble(req, res, next) {
  try {
    const { parejaId1, slotsToAdd1, parejaId2, slotsToAdd2 } = req.body;
    const resultado = await disponibilidadService.setDisponibilidadDoble(
      parejaId1,
      slotsToAdd1,
      parejaId2,
      slotsToAdd2
    );
    res.json(resultado);
  } catch (error) {
    next(error);
  }
}

async function removerDisponibilidadDoble(req, res, next) {
  try {
    const { parejaId1, slotsToRemove1, parejaId2, slotsToRemove2 } = req.body;
    const resultado = await disponibilidadService.removerDisponibilidadDoble(
      parejaId1,
      slotsToRemove1,
      parejaId2,
      slotsToRemove2
    );
    res.json(resultado);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getDisponibilidad,
  setDisponibilidad,
  setDisponibilidadDoble,
  removerDisponibilidadDoble,
};
