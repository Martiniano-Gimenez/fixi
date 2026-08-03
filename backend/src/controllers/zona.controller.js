const prisma = require('../lib/prisma');

async function getZonasByTorneo(req, res, next) {
  try {
    const torneoId = req.params.id;
    const zonas = await prisma.zona.findMany({
      where: { torneoId },
      include: {
        zonaParejas: {
          include: { pareja: true },
          // Orden de posiciones predeterminado (Criterios de desempate)
          orderBy: [
            { puntos: 'desc' },
            { sf: 'desc' }, // Diferencia sets (simplificado, debería ser sf - sc)
            { gf: 'desc' }, // Diferencia games
          ]
        },
      },
      orderBy: { nombre: 'asc' }
    });

    // Como Prisma no soporta order by computados fácilmente (sf - sc), lo reordenamos en JS
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

          return 0; // Se podría agregar enfrentamiento directo
        });
      }
    }

    res.json(zonas);
  } catch (error) {
    next(error);
  }
}

const zonaService = require('../services/zona.service');

async function limpiarResultadosZonas(req, res, next) {
  try {
    const organizadorId = req.organizadorId;
    const torneoId = req.params.id;
    const result = await zonaService.limpiarResultadosZonas(organizadorId, torneoId);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

async function reestructurarZonas(req, res, next) {
  try {
    const organizadorId = req.organizadorId;
    const torneoId = req.params.id;
    const { zonas } = req.body;
    if (!zonas || !Array.isArray(zonas)) {
      return res.status(400).json({ message: 'El payload debe contener un array de zonas.' });
    }
    const result = await zonaService.reestructurarZonas(organizadorId, torneoId, zonas);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getZonasByTorneo,
  limpiarResultadosZonas,
  reestructurarZonas,
};
