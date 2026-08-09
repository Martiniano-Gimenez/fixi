const { setDisponibilidades, getDisponibilidades } = require('../services/disponibilidad.service');

async function getDisponibilidadesHandler(req, res, next) {
  try {
    const { id } = req.params; // parejaId
    const franjas = await getDisponibilidades(id);
    res.json(franjas);
  } catch (err) {
    next(err);
  }
}

async function setDisponibilidadesHandler(req, res, next) {
  try {
    const { id } = req.params; // parejaId
    const { franjas } = req.body; // [{ dia, horaInicio, horaFin }]

    if (!Array.isArray(franjas)) {
      return res.status(400).json({ error: 'El campo "franjas" debe ser un array.' });
    }

    const resultado = await setDisponibilidades(id, franjas);
    res.json(resultado);
  } catch (err) {
    next(err);
  }
}

module.exports = { getDisponibilidadesHandler, setDisponibilidadesHandler };
