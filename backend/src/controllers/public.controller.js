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
          parejaId: zp.parejaId,
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
            pareja1Id: p.pareja1Id,
            pareja2Id: p.pareja2Id,
            ganadorId: p.ganadorId,
            pareja1: p.pareja1 ? `${p.pareja1.jugador1} / ${p.pareja1.jugador2}` : null,
            pareja2: p.pareja2 ? `${p.pareja2.jugador1} / ${p.pareja2.jugador2}` : null,
            ganador: p.ganador ? `${p.ganador.jugador1} / ${p.ganador.jugador2}` : null,
            sets: p.sets.map((s) => ({
              gamesPareja1: s.gamesPareja1,
              gamesPareja2: s.gamesPareja2,
            })),
          })),
      })),
      eliminatoria: (() => {
        const fases = c.fasesEliminatorias || [];
        if (fases.length === 0) return [];

        function nombreCortoRonda(ronda, nombreOriginal) {
          if (ronda === 32) return 'Dieciseisavos';
          if (ronda === 16) return 'Octavos';
          if (ronda === 8) return 'Cuartos';
          if (ronda === 4) return 'Semifinal';
          if (ronda === 2) return 'Final';
          if (nombreOriginal) {
            return nombreOriginal.replace(/\s+de\s+Final$/i, '').trim();
          }
          return `Ronda de ${ronda}`;
        }

        const fasesOrdenadas = [...fases].sort((a, b) => b.ronda - a.ronda);
        const fasesProcesadas = [];

        for (let idx = 0; idx < fasesOrdenadas.length; idx++) {
          const fase = fasesOrdenadas[idx];
          const fasePrevia = idx > 0 ? fasesProcesadas[idx - 1] : null;
          const nombrePrevia = fasePrevia ? nombreCortoRonda(fasePrevia.ronda, fasePrevia.nombre) : '';
          const prevMap = fasePrevia ? new Map(fasePrevia.partidos.map((p) => [p.posicion, p])) : null;

          const partidosFase = fase.partidos.map((p) => {
            const esBye = Boolean(p.esBye);
            const p1Str = p.pareja1 ? `${p.pareja1.jugador1} / ${p.pareja1.jugador2}` : null;
            const p2Str = p.pareja2 ? `${p.pareja2.jugador1} / ${p.pareja2.jugador2}` : null;

            let displayOrigenPareja1 = null;
            let displayOrigenPareja2 = null;
            let displayPareja1 = null;
            let displayPareja2 = null;

            if (fasePrevia && prevMap) {
              const posPrev1 = 2 * p.posicionEnRonda - 1;
              const prev1 = prevMap.get(posPrev1);
              if (prev1 && prev1.esBye) {
                displayOrigenPareja1 = prev1.origenPareja1 || prev1.origenPareja2 || prev1.displayOrigenPareja1;
                displayPareja1 = prev1.pareja1 || prev1.pareja2 || prev1.displayPareja1;
              } else if (!p1Str) {
                displayOrigenPareja1 = `Ganador ${nombrePrevia} #${posPrev1}`;
              }

              const posPrev2 = 2 * p.posicionEnRonda;
              const prev2 = prevMap.get(posPrev2);
              if (prev2 && prev2.esBye) {
                displayOrigenPareja2 = prev2.origenPareja1 || prev2.origenPareja2 || prev2.displayOrigenPareja2;
                displayPareja2 = prev2.pareja1 || prev2.pareja2 || prev2.displayPareja2;
              } else if (!p2Str) {
                displayOrigenPareja2 = `Ganador ${nombrePrevia} #${posPrev2}`;
              }
            }

            return {
              id: p.id,
              posicion: p.posicionEnRonda,
              estado: p.estado,
              fechaHora: p.fechaHora,
              canchaNumero: p.canchaNumero,
              origenPareja1: p.origenPareja1,
              origenPareja2: p.origenPareja2,
              displayOrigenPareja1,
              displayOrigenPareja2,
              displayPareja1,
              displayPareja2,
              esBye,
              pareja1Id: p.pareja1Id,
              pareja2Id: p.pareja2Id,
              ganadorId: p.ganadorId,
              pareja1: p1Str,
              pareja2: p2Str,
              ganador: p.ganador ? `${p.ganador.jugador1} / ${p.ganador.jugador2}` : null,
              sets: p.sets.map((s) => ({
                gamesPareja1: s.gamesPareja1,
                gamesPareja2: s.gamesPareja2,
              })),
            };
          });

          fasesProcesadas.push({
            id: fase.id,
            nombre: fase.nombre,
            ronda: fase.ronda,
            partidos: partidosFase,
          });
        }

        return fasesProcesadas;
      })(),
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
