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

async function moverPareja(req, res, next) {
  try {
    const organizadorId = getOrgId(req);
    const categoriaId = req.params.categoriaId || req.params.id;
    const { parejaId, zonaOrigenId, zonaDestinoId } = req.body;
    const result = await zonaService.moverParejaDeZona(organizadorId, categoriaId, {
      parejaId,
      zonaOrigenId,
      zonaDestinoId,
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function agregarPareja(req, res, next) {
  try {
    const organizadorId = getOrgId(req);
    const categoriaId = req.params.categoriaId || req.params.id;
    const { zonaDestinoId, jugador1, jugador2, slotIds } = req.body;
    const result = await zonaService.agregarParejaAZona(organizadorId, categoriaId, {
      zonaDestinoId,
      jugador1,
      jugador2,
      slotIds,
    });
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getZonasByCategoria,
  getZonasByTorneo: getZonasByCategoria,
  limpiarResultadosZonas,
  moverPareja,
  agregarPareja,
};

