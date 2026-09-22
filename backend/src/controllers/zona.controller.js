const zonaService = require('../services/zona.service');
const { ordenarZonaParejas } = require('../services/faseEliminatoria.service');

function getOrgId(req) {
  return req.organizadorId || req.organizador?.id;
}

async function getZonasByCategoria(req, res, next) {
  try {
    const organizadorId = getOrgId(req);
    const categoriaId = req.params.categoriaId || req.params.id;
    const zonas = await zonaService.getZonasByCategoria(organizadorId, categoriaId);

    for (const zona of zonas) {
      if (zona.formato === 'ROUND_ROBIN' || zona.formato === 'MINI_BRACKET') {
        zona.zonaParejas = ordenarZonaParejas(zona.zonaParejas, zona.formato);
      }
    }

    res.json(zonas);
  } catch (error) {
    next(error);
  }
}

async function limpiarResultadosZonas(req, res, next) {
  try {
    const organizadorId = getOrgId(req);
    const categoriaId = req.params.categoriaId || req.params.id;
    const result = await zonaService.limpiarResultadosZonas(organizadorId, categoriaId);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getZonasByCategoria,
  getZonasByTorneo: getZonasByCategoria,
  limpiarResultadosZonas,
};
