const prisma = require('../lib/prisma');

/**
 * GET /api/public/:slug
 * Devuelve toda la data del torneo para la vista pública (sin auth).
 */
async function getTorneoPublico(req, res, next) {
  try {
    const { slug } = req.params;

    const torneo = await prisma.torneo.findUnique({
      where: { slug },
      include: {
        organizador: {
          select: { nombre: true },
        },
        parejas: {
          orderBy: { orden: 'asc' },
        },
      },
    });

    if (!torneo) {
      return res.status(404).json({ error: 'Torneo no encontrado.' });
    }

    // Obtener zonas con tabla de posiciones
    const zonas = await prisma.zona.findMany({
      where: { torneoId: torneo.id },
      orderBy: { nombre: 'asc' },
      include: {
        zonaParejas: {
          orderBy: [
            { puntos: 'desc' },
            { pg: 'desc' },
          ],
          include: { pareja: true },
        },
      },
    });

    // Obtener partidos de zona
    const partidosZona = await prisma.partido.findMany({
      where: {
        torneoId: torneo.id,
        zonaId: { not: null },
      },
      orderBy: { posicionEnRonda: 'asc' },
      include: {
        pareja1: true,
        pareja2: true,
        ganador: true,
        sets: { orderBy: { numero: 'asc' } },
      },
    });

    // Obtener fases eliminatorias
    const fasesEliminatorias = await prisma.faseEliminatoria.findMany({
      where: { torneoId: torneo.id },
      orderBy: { ronda: 'desc' },
      include: {
        partidos: {
          orderBy: { posicionEnRonda: 'asc' },
          include: {
            pareja1: true,
            pareja2: true,
            ganador: true,
            sets: { orderBy: { numero: 'asc' } },
          },
        },
      },
    });

    res.json({
      torneo: {
        id: torneo.id,
        nombre: torneo.nombre,
        slug: torneo.slug,
        estado: torneo.estado,
        fecha: torneo.fecha,
        organizador: torneo.organizador.nombre,
        totalParejas: torneo.parejas.length,
      },
      zonas: zonas.map((z) => ({
        id: z.id,
        nombre: z.nombre,
        formato: z.formato,
        clasifican: z.clasifican,
        tabla: z.zonaParejas.map((zp) => ({
          pareja: `${zp.pareja.jugador1} / ${zp.pareja.jugador2}`,
          puntos: zp.puntos,
          pj: zp.pj,
          pg: zp.pg,
          pp: zp.pp,
          sf: zp.sf,
          sc: zp.sc,
          gf: zp.gf,
          gc: zp.gc,
        })),
        partidos: partidosZona
          .filter((p) => p.zonaId === z.id)
          .map((p) => ({
            id: p.id,
            estado: p.estado,
            fechaHora: p.fechaHora,
            pareja1: p.pareja1 ? `${p.pareja1.jugador1} / ${p.pareja1.jugador2}` : null,
            pareja2: p.pareja2 ? `${p.pareja2.jugador1} / ${p.pareja2.jugador2}` : null,
            ganador: p.ganador ? `${p.ganador.jugador1} / ${p.ganador.jugador2}` : null,
            sets: p.sets.map((s) => ({
              gamesPareja1: s.gamesPareja1,
              gamesPareja2: s.gamesPareja2,
            })),
          })),
      })),
      eliminatoria: fasesEliminatorias.map((fase) => ({
        id: fase.id,
        nombre: fase.nombre,
        ronda: fase.ronda,
        partidos: fase.partidos.map((p) => ({
          id: p.id,
          posicion: p.posicionEnRonda,
          estado: p.estado,
          fechaHora: p.fechaHora,
          origenPareja1: p.origenPareja1,
          origenPareja2: p.origenPareja2,
          pareja1: p.pareja1 ? `${p.pareja1.jugador1} / ${p.pareja1.jugador2}` : null,
          pareja2: p.pareja2 ? `${p.pareja2.jugador1} / ${p.pareja2.jugador2}` : null,
          ganador: p.ganador ? `${p.ganador.jugador1} / ${p.ganador.jugador2}` : null,
          sets: p.sets.map((s) => ({
            gamesPareja1: s.gamesPareja1,
            gamesPareja2: s.gamesPareja2,
          })),
        })),
      })),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getTorneoPublico };
