const parejaService = require('../services/pareja.service');

function getOrgId(req) {
  return req.organizadorId || req.organizador?.id;
}

async function createPareja(req, res, next) {
  try {
    const organizadorId = getOrgId(req);
    const categoriaId = req.params.categoriaId || req.params.id;
    const pareja = await parejaService.createPareja(organizadorId, categoriaId, req.body);
    res.status(201).json(pareja);
  } catch (error) {
    next(error);
  }
}

async function getParejasByCategoria(req, res, next) {
  try {
    const organizadorId = getOrgId(req);
    const categoriaId = req.params.categoriaId || req.params.id;
    const parejas = await parejaService.getParejasByCategoria(organizadorId, categoriaId);
    res.json(parejas);
  } catch (error) {
    next(error);
  }
}

async function updatePareja(req, res, next) {
  try {
    const organizadorId = getOrgId(req);
    const pareja = await parejaService.updatePareja(organizadorId, req.params.id, req.body);
    res.json(pareja);
  } catch (error) {
    next(error);
  }
}

async function deletePareja(req, res, next) {
  try {
    const organizadorId = getOrgId(req);
    await parejaService.deletePareja(organizadorId, req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createPareja,
  getParejasByCategoria,
  updatePareja,
  deletePareja,
};
