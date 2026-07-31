const parejaService = require('../services/pareja.service');

async function createPareja(req, res, next) {
  try {
    const pareja = await parejaService.createPareja(req.organizadorId, req.params.id, req.body);
    res.status(201).json(pareja);
  } catch (error) {
    next(error);
  }
}

async function getParejasByTorneo(req, res, next) {
  try {
    const parejas = await parejaService.getParejasByTorneo(req.organizadorId, req.params.id);
    res.json(parejas);
  } catch (error) {
    next(error);
  }
}

async function updatePareja(req, res, next) {
  try {
    const pareja = await parejaService.updatePareja(req.organizadorId, req.params.id, req.body);
    res.json(pareja);
  } catch (error) {
    next(error);
  }
}

async function deletePareja(req, res, next) {
  try {
    await parejaService.deletePareja(req.organizadorId, req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createPareja,
  getParejasByTorneo,
  updatePareja,
  deletePareja,
};
