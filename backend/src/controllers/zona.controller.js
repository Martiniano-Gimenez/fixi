const zonaService = require('../services/zona.service');

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
        zona.zonaParejas.sort((a, b) => {
          if (zona.formato === 'MINI_BRACKET') {
            const posA = a.posicion || 99;
            const posB = b.posicion || 99;
            if (posA !== posB) return posA - posB;
          }

          if (b.puntos !== a.puntos) return b.puntos - a.puntos;
          
          const diffSetsA = a.sf - a.sc;
          const diffSetsB = b.sf - b.sc;
          if (diffSetsB !== diffSetsA) return diffSetsB - diffSetsA;
          
          const diffGamesA = a.gf - a.gc;
          const diffGamesB = b.gf - b.gc;
          if (diffGamesB !== diffGamesA) return diffGamesB - diffGamesA;

          return 0;
        });
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

async function reestructurarZonas(req, res, next) {
  try {
    const organizadorId = getOrgId(req);
    const categoriaId = req.params.categoriaId || req.params.id;
    const { zonas } = req.body;
    if (!zonas || !Array.isArray(zonas)) {
      return res.status(400).json({ message: 'El payload debe contener un array de zonas.' });
    }
    const result = await zonaService.reestructurarZonas(organizadorId, categoriaId, zonas);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getZonasByCategoria,
  getZonasByTorneo: getZonasByCategoria,
  limpiarResultadosZonas,
  reestructurarZonas,
};
