const prisma = require('../lib/prisma');
const { ordenarZonaParejas } = require('../services/faseEliminatoria.service');

/**
 * GET /api/public/:slug
 * Devuelve toda la data del torneo y todas sus categorías para la vista pública (sin auth).
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
        categorias: {
          orderBy: { createdAt: 'asc' },
          include: {
            parejas: {
              orderBy: { orden: 'asc' },
            },
            zonas: {
              orderBy: { nombre: 'asc' },
              include: {
                zonaParejas: {
                  orderBy: [
                    { posicion: 'asc' },
                    { puntos: 'desc' },
                    { pg: 'desc' },
                  ],
                  include: { pareja: true },
                },
              },
            },
            partidos: {
              where: { zonaId: { not: null } },
              orderBy: { posicionEnRonda: 'asc' },
              include: {
                pareja1: true,
                pareja2: true,
                ganador: true,
                sets: { orderBy: { numero: 'asc' } },
              },
            },
            fasesEliminatorias: {
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
            },
          },
        },
      },
    });

    if (!torneo) {
      return res.status(404).json({ error: 'Torneo no encontrado.' });
    }

    const categoriasFormateadas = torneo.categorias.map((c) => ({
      id: c.id,
      nombre: c.nombre,
      estado: c.estado,
      totalParejas: c.parejas.length,
      parejas: c.parejas.map((p) => ({
        id: p.id,
        jugador1: p.jugador1,
        jugador2: p.jugador2,
        orden: p.orden,
      })),
      zonas: c.zonas.map((z) => ({
        id: z.id,
        nombre: z.nombre,
        formato: z.formato,
        clasifican: z.clasifican,
        tabla: ordenarZonaParejas(z.zonaParejas, z.formato).map((zp) => ({
          pareja: `${zp.pareja.jugador1} / ${zp.pareja.jugador2}`,
          posicion: zp.posicion,
          puntos: zp.puntos,
          pj: zp.pj,
          pg: zp.pg,
          pp: zp.pp,
          sf: zp.sf,
          sc: zp.sc,
          gf: zp.gf,
          gc: zp.gc,
        })),
        partidos: c.partidos
          .filter((p) => p.zonaId === z.id)
          .map((p) => ({
            id: p.id,
            posicionEnRonda: p.posicionEnRonda,
            estado: p.estado,
            fechaHora: p.fechaHora,
            canchaNumero: p.canchaNumero,
            sinHorarioAsignado: p.sinHorarioAsignado,
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
      eliminatoria: c.fasesEliminatorias.map((fase) => ({
        id: fase.id,
        nombre: fase.nombre,
        ronda: fase.ronda,
        partidos: fase.partidos.map((p) => ({
          id: p.id,
          posicion: p.posicionEnRonda,
          estado: p.estado,
          fechaHora: p.fechaHora,
          canchaNumero: p.canchaNumero,
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
    }));

    res.json({
      torneo: {
        id: torneo.id,
        nombre: torneo.nombre,
        slug: torneo.slug,
        estado: torneo.estado,
        fecha: torneo.fecha,
        organizador: torneo.organizador.nombre,
        totalCategorias: torneo.categorias.length,
      },
      categorias: categoriasFormateadas,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getTorneoPublico };
