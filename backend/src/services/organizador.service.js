const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { getSlotsValidosSet, generarGrillaOrganizador } = require('./slots.service');
const {
  iniciarTorneo,
  iniciarTorneoConDisponibilidad,
  asignarHorariosAutomatico,
} = require('./zona.service');

// Cache de planes validados en memoria para inicio determinista
// NOTE: single-process assumption — move to Redis/DB if scaling horizontally
const planesCache = new Map();
const PLAN_TTL_MS = 5 * 60 * 1000; // 5 minutos

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of planesCache) {
    if (v.expiresAt < now) planesCache.delete(k);
  }
}, 60_000);

function buildFingerprint(organizador, torneosConParejas) {
  const clubPart = [
    organizador.cantidadCanchas || 1,
    organizador.viernesInicio || '',
    organizador.viernesFin || '',
    organizador.sabadoInicio || '',
    organizador.sabadoFin || '',
  ].join(',');

  const torneosPart = (torneosConParejas || [])
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((t) => {
      const parejasPart = (t.parejas || [])
        .slice()
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((p) => {
          const slotsStr = (p.slotsSeleccionados || [])
            .map((s) => s.slotId)
            .sort()
            .join(',');
          return `${p.id}=${slotsStr}`;
        })
        .join('|');
      return `${t.id}:${parejasPart}`;
    });

  return JSON.stringify([clubPart, ...torneosPart]);
}

async function getOrganizador(organizadorId) {
  const organizador = await prisma.organizador.findUnique({
    where: { id: organizadorId },
    select: {
      id: true,
      email: true,
      nombre: true,
      cantidadCanchas: true,
      viernesInicio: true,
      viernesFin: true,
      sabadoInicio: true,
      sabadoFin: true,
      createdAt: true,
    },
  });

  if (!organizador) {
    const error = new Error('Organizador no encontrado.');
    error.statusCode = 404;
    throw error;
  }

  return organizador;
}

async function simularCambioJornadaOrganizador(organizadorId, nuevaJornada) {
  const organizador = await getOrganizador(organizadorId);

  const organizadorProyectado = {
    ...organizador,
    viernesInicio: nuevaJornada.viernesInicio !== undefined ? nuevaJornada.viernesInicio : organizador.viernesInicio,
    viernesFin: nuevaJornada.viernesFin !== undefined ? nuevaJornada.viernesFin : organizador.viernesFin,
    sabadoInicio: nuevaJornada.sabadoInicio !== undefined ? nuevaJornada.sabadoInicio : organizador.sabadoInicio,
    sabadoFin: nuevaJornada.sabadoFin !== undefined ? nuevaJornada.sabadoFin : organizador.sabadoFin,
  };

  const nuevosSlotsValidos = getSlotsValidosSet(organizadorProyectado);

  // Buscar todos los SlotPareja de todos los torneos de este organizador
  const slotsActuales = await prisma.slotPareja.findMany({
    where: {
      pareja: {
        torneo: { organizadorId },
      },
    },
    select: { id: true, parejaId: true, slotId: true },
  });

  const slotsInvalidos = slotsActuales.filter((s) => !nuevosSlotsValidos.has(s.slotId));
  const parejasAfectadasIds = new Set(slotsInvalidos.map((s) => s.parejaId));

  return {
    slotsAfectados: slotsInvalidos.length,
    parejasAfectadas: parejasAfectadasIds.size,
  };
}

async function updateOrganizador(organizadorId, data) {
  const organizador = await getOrganizador(organizadorId);

  const updateData = {};
  if (data.nombre !== undefined) updateData.nombre = data.nombre;
  if (data.cantidadCanchas !== undefined) updateData.cantidadCanchas = Math.max(1, Number(data.cantidadCanchas));
  if (data.viernesInicio !== undefined) updateData.viernesInicio = data.viernesInicio || null;
  if (data.viernesFin !== undefined) updateData.viernesFin = data.viernesFin || null;
  if (data.sabadoInicio !== undefined) updateData.sabadoInicio = data.sabadoInicio || null;
  if (data.sabadoFin !== undefined) updateData.sabadoFin = data.sabadoFin || null;

  return await prisma.$transaction(async (tx) => {
    const updated = await tx.organizador.update({
      where: { id: organizador.id },
      data: updateData,
      select: {
        id: true,
        email: true,
        nombre: true,
        cantidadCanchas: true,
        viernesInicio: true,
        viernesFin: true,
        sabadoInicio: true,
        sabadoFin: true,
      },
    });

    // Limpiar slots de parejas de todos los torneos que ya no caigan en la nueva grilla
    const nuevosSlotsValidos = getSlotsValidosSet(updated);
    const slotsActuales = await tx.slotPareja.findMany({
      where: {
        pareja: {
          torneo: { organizadorId },
        },
      },
      select: { id: true, slotId: true },
    });

    const idsABorrar = slotsActuales
      .filter((s) => !nuevosSlotsValidos.has(s.slotId))
      .map((s) => s.id);

    if (idsABorrar.length > 0) {
      await tx.slotPareja.deleteMany({
        where: { id: { in: idsABorrar } },
      });
    }

    return updated;
  });
}

async function getSlotsGrilla(organizadorId) {
  const organizador = await getOrganizador(organizadorId);
  return generarGrillaOrganizador(organizador);
}

/**
 * Valida si todos los torneos en borrador pueden iniciarse y programarse sin conflictos horarios,
 * ejecutando el pipeline completo en una transacción de prueba (dry-run con rollback).
 * Si no hay conflictos, guarda el snapshot lógico del plan en memoria para su aplicación determinista.
 */
async function preCheckInicioTodos(organizadorId) {
  const organizador = await getOrganizador(organizadorId);

  const torneosBorrador = await prisma.torneo.findMany({
    where: {
      organizadorId,
      estado: 'BORRADOR',
    },
    include: {
      parejas: {
        include: {
          slotsSeleccionados: true,
        },
      },
    },
  });

  if (torneosBorrador.length === 0) {
    const error = new Error('No hay torneos en estado Borrador para iniciar.');
    error.statusCode = 400;
    throw error;
  }

  const validos = [];
  const omitidos = [];

  for (const t of torneosBorrador) {
    if (t.parejas.length < 2) {
      omitidos.push({
        id: t.id,
        nombre: t.nombre,
        motivo: 'Tiene menos de 2 parejas inscriptas.',
      });
    } else {
      const totalSlots = t.parejas.reduce((acc, p) => acc + p.slotsSeleccionados.length, 0);
      const parejasConSlots = t.parejas.filter((p) => p.slotsSeleccionados.length > 0).length;
      const tieneDisponibilidad = parejasConSlots > 0;

      const scoreFlexibilidad = tieneDisponibilidad
        ? totalSlots / t.parejas.length
        : 999999;

      validos.push({
        torneo: t,
        tieneDisponibilidad,
        scoreFlexibilidad,
        avgSlots: tieneDisponibilidad ? Number((totalSlots / t.parejas.length).toFixed(1)) : 0,
      });
    }
  }

  if (validos.length === 0) {
    const error = new Error('Ninguno de los torneos en borrador cuenta con al menos 2 parejas.');
    error.statusCode = 400;
    throw error;
  }

  const fingerprint = buildFingerprint(organizador, torneosBorrador);

  const PLANNED_ROLLBACK = Symbol('PLANNED_ROLLBACK');
  let dryRunResult = null;

  try {
    await prisma.$transaction(async (tx) => {
      // 1. Iniciar zonas en cada torneo válido (usando tx)
      for (const item of validos) {
        if (item.tieneDisponibilidad) {
          await iniciarTorneoConDisponibilidad(organizadorId, item.torneo.id, tx);
        } else {
          await iniciarTorneo(organizadorId, item.torneo.id, tx);
        }
      }

      // 2. Ordenar torneos por restricción (menor score / promedio de slots primero)
      validos.sort((a, b) => a.scoreFlexibilidad - b.scoreFlexibilidad);

      // 3. Asignar horarios y canchas en tx
      for (const item of validos) {
        await asignarHorariosAutomatico(organizadorId, item.torneo.id, tx);
      }

      // 4. Buscar partidos sin horario asignado y zonas manuales por incompatibilidad
      const torneosIds = validos.map((v) => v.torneo.id);
      const partidosSinHorario = await tx.partido.findMany({
        where: {
          torneoId: { in: torneosIds },
          sinHorarioAsignado: true,
        },
        include: {
          torneo: { select: { id: true, nombre: true } },
          pareja1: { select: { id: true, jugador1: true, jugador2: true } },
          pareja2: { select: { id: true, jugador1: true, jugador2: true } },
          zona: { select: { id: true, nombre: true } },
        },
      });

      const zonasManuales = await tx.zona.findMany({
        where: {
          torneoId: { in: torneosIds },
          requiereArmadoManual: true,
        },
        include: {
          torneo: { select: { id: true, nombre: true } },
          zonaParejas: {
            include: {
              pareja: { select: { id: true, jugador1: true, jugador2: true } },
            },
          },
        },
      });

      if (partidosSinHorario.length > 0 || zonasManuales.length > 0) {
        const conflictosMap = new Map();

        for (const p of partidosSinHorario) {
          const tId = p.torneo.id;
          if (!conflictosMap.has(tId)) {
            conflictosMap.set(tId, {
              torneoId: tId,
              nombreTorneo: p.torneo.nombre,
              partidosSinHorario: [],
            });
          }
          conflictosMap.get(tId).partidosSinHorario.push({
            partidoId: p.id,
            zona: p.zona?.nombre || 'Zona',
            pareja1: p.pareja1 ? `${p.pareja1.jugador1} / ${p.pareja1.jugador2}` : 'Por definirse',
            pareja2: p.pareja2 ? `${p.pareja2.jugador1} / ${p.pareja2.jugador2}` : 'Por definirse',
          });
        }

        for (const zm of zonasManuales) {
          const tId = zm.torneo.id;
          if (!conflictosMap.has(tId)) {
            conflictosMap.set(tId, {
              torneoId: tId,
              nombreTorneo: zm.torneo.nombre,
              partidosSinHorario: [],
            });
          }
          const parejasNombres = zm.zonaParejas
            .map((zp) => (zp.pareja ? `${zp.pareja.jugador1} / ${zp.pareja.jugador2}` : 'Pareja'))
            .join(' | ');
          conflictosMap.get(tId).partidosSinHorario.push({
            partidoId: zm.id,
            zona: zm.nombre,
            pareja1: 'Incompatibilidad de grupo',
            pareja2: parejasNombres,
          });
        }

        dryRunResult = {
          bloqueado: true,
          motivo: 'Existen partidos o zonas sin horario compatible asignado.',
          conflictos: Array.from(conflictosMap.values()),
          omitidos,
        };
      } else {
        // Todo OK: armar el snapshot LÓGICO para persistirlo al confirmar
        const torneosPlan = [];
        for (const v of validos) {
          const zonasTx = await tx.zona.findMany({
            where: { torneoId: v.torneo.id },
            include: {
              zonaParejas: { select: { parejaId: true } },
              partidos: {
                select: {
                  posicionEnRonda: true,
                  pareja1Id: true,
                  pareja2Id: true,
                  fechaHora: true,
                  canchaNumero: true,
                  sinHorarioAsignado: true,
                },
              },
            },
          });

          torneosPlan.push({
            torneoId: v.torneo.id,
            nombre: v.torneo.nombre,
            avgSlots: v.avgSlots,
            zonas: zonasTx.map((z) => ({
              nombre: z.nombre,
              clasifican: z.clasifican,
              formato: z.formato,
              requiereArmadoManual: z.requiereArmadoManual || false,
              parejaIds: z.zonaParejas.map((zp) => zp.parejaId),
              partidos: z.partidos.map((p) => ({
                posicionEnRonda: p.posicionEnRonda,
                pareja1Id: p.pareja1Id,
                pareja2Id: p.pareja2Id,
                fechaHora: p.fechaHora,
                canchaNumero: p.canchaNumero,
                sinHorarioAsignado: p.sinHorarioAsignado || false,
              })),
            })),
          });
        }

        const planId = crypto.randomUUID();
        const expiresAt = Date.now() + PLAN_TTL_MS;

        planesCache.set(planId, {
          planId,
          organizadorId,
          expiresAt,
          fingerprint,
          torneosPlan,
          omitidos,
        });

        dryRunResult = {
          bloqueado: false,
          planId,
          torneosAIniciar: validos.map((v) => ({ id: v.torneo.id, nombre: v.torneo.nombre })),
          omitidos,
        };
      }

      // Forzar rollback para que nada se persista durante la verificación
      throw PLANNED_ROLLBACK;
    });
  } catch (err) {
    if (err !== PLANNED_ROLLBACK) {
      throw err;
    }
  }

  return dryRunResult;
}

/**
 * Inicia todos los torneos en estado BORRADOR y asigna sus horarios automáticamente.
 * Si recibe planId, aplica el snapshot precalculado en preCheckInicioTodos.
 */
async function iniciarTodosLosTorneos(organizadorId, planId = null) {
  if (planId) {
    const cached = planesCache.get(planId);
    if (!cached || cached.expiresAt < Date.now() || cached.organizadorId !== organizadorId) {
      const error = new Error('El plan de inicio expiró o no es válido. Por favor volvé a verificar.');
      error.statusCode = 400;
      throw error;
    }

    const organizador = await getOrganizador(organizadorId);
    const torneosBorrador = await prisma.torneo.findMany({
      where: { organizadorId, estado: 'BORRADOR' },
      include: { parejas: { include: { slotsSeleccionados: true } } },
    });

    const currentFingerprint = buildFingerprint(organizador, torneosBorrador);
    if (currentFingerprint !== cached.fingerprint) {
      planesCache.delete(planId);
      const error = new Error('Los datos del club o las parejas cambiaron desde la última verificación. Volvé a verificar antes de iniciar.');
      error.statusCode = 409;
      throw error;
    }

    // Aplicar el plan cacheado a la base de datos
    const resumen = [];
    await prisma.$transaction(async (tx) => {
      for (const tPlan of cached.torneosPlan) {
        const torneo = await tx.torneo.findUnique({ where: { id: tPlan.torneoId } });
        if (!torneo || torneo.estado !== 'BORRADOR') {
          throw new Error(`El torneo "${tPlan.nombre}" ya no está en estado Borrador.`);
        }

        let asignadosCount = 0;
        let sinHorarioCount = 0;

        for (const zData of tPlan.zonas) {
          const zona = await tx.zona.create({
            data: {
              torneoId: tPlan.torneoId,
              nombre: zData.nombre,
              clasifican: zData.clasifican,
              formato: zData.formato,
              requiereArmadoManual: zData.requiereArmadoManual || false,
            },
          });

          for (const parejaId of zData.parejaIds) {
            await tx.zonaPareja.create({
              data: {
                zonaId: zona.id,
                parejaId,
              },
            });
          }

          for (const pData of zData.partidos) {
            await tx.partido.create({
              data: {
                torneoId: tPlan.torneoId,
                zonaId: zona.id,
                posicionEnRonda: pData.posicionEnRonda,
                pareja1Id: pData.pareja1Id,
                pareja2Id: pData.pareja2Id,
                fechaHora: pData.fechaHora,
                canchaNumero: pData.canchaNumero,
                sinHorarioAsignado: pData.sinHorarioAsignado || false,
              },
            });

            if (pData.fechaHora && pData.canchaNumero) {
              asignadosCount++;
            } else if (pData.sinHorarioAsignado) {
              sinHorarioCount++;
            }
          }
        }

        await tx.torneo.update({
          where: { id: tPlan.torneoId },
          data: { estado: 'EN_CURSO' },
        });

        resumen.push({
          torneoId: tPlan.torneoId,
          nombre: tPlan.nombre,
          asignados: asignadosCount,
          sinHorario: sinHorarioCount,
          total: asignadosCount + sinHorarioCount,
          promedioSlots: tPlan.avgSlots,
        });
      }
    });

    planesCache.delete(planId);

    return {
      message: 'Torneos iniciados y programados con éxito.',
      iniciados: resumen,
      omitidos: cached.omitidos || [],
    };
  }

  // Fallback sin planId: ejecución legacy directa
  const torneosBorrador = await prisma.torneo.findMany({
    where: {
      organizadorId,
      estado: 'BORRADOR',
    },
    include: {
      parejas: {
        include: {
          slotsSeleccionados: true,
        },
      },
    },
  });

  if (torneosBorrador.length === 0) {
    const error = new Error('No hay torneos en estado Borrador para iniciar.');
    error.statusCode = 400;
    throw error;
  }

  const validos = [];
  const omitidos = [];

  for (const t of torneosBorrador) {
    if (t.parejas.length < 2) {
      omitidos.push({
        id: t.id,
        nombre: t.nombre,
        motivo: 'Tiene menos de 2 parejas inscriptas.',
      });
    } else {
      const totalSlots = t.parejas.reduce((acc, p) => acc + p.slotsSeleccionados.length, 0);
      const parejasConSlots = t.parejas.filter((p) => p.slotsSeleccionados.length > 0).length;
      const tieneDisponibilidad = parejasConSlots > 0;

      const scoreFlexibilidad = tieneDisponibilidad
        ? totalSlots / t.parejas.length
        : 999999;

      validos.push({
        torneo: t,
        tieneDisponibilidad,
        scoreFlexibilidad,
        avgSlots: tieneDisponibilidad ? Number((totalSlots / t.parejas.length).toFixed(1)) : 0,
      });
    }
  }

  if (validos.length === 0) {
    const error = new Error('Ninguno de los torneos en borrador cuenta con al menos 2 parejas.');
    error.statusCode = 400;
    throw error;
  }

  // 1. Iniciar zonas en cada torneo válido (por disponibilidad o sorteo aleatorio)
  for (const item of validos) {
    if (item.tieneDisponibilidad) {
      await iniciarTorneoConDisponibilidad(organizadorId, item.torneo.id);
    } else {
      await iniciarTorneo(organizadorId, item.torneo.id);
    }
  }

  // 2. Ordenar torneos por restricción (menor score / promedio de slots primero)
  validos.sort((a, b) => a.scoreFlexibilidad - b.scoreFlexibilidad);

  // 3. Asignar horarios y canchas en orden de prioridad cross-torneo
  const resumen = [];
  for (const item of validos) {
    const resultadoHorarios = await asignarHorariosAutomatico(organizadorId, item.torneo.id);
    resumen.push({
      torneoId: item.torneo.id,
      nombre: item.torneo.nombre,
      asignados: resultadoHorarios.asignados,
      sinHorario: resultadoHorarios.sinHorario,
      total: resultadoHorarios.total,
      promedioSlots: item.avgSlots,
    });
  }

  return {
    message: 'Torneos iniciados y programados con éxito.',
    iniciados: resumen,
    omitidos,
  };
}

module.exports = {
  getOrganizador,
  simularCambioJornadaOrganizador,
  updateOrganizador,
  getSlotsGrilla,
  preCheckInicioTodos,
  iniciarTodosLosTorneos,
};
