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

module.exports = {
  getDisponibilidad,
  setDisponibilidad,
};
