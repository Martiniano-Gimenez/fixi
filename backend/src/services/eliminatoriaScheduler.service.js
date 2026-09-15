const prisma = require('../lib/prisma');
const { horaAMinutos, DURACION_PARTIDO_MIN } = require('./slots.service');
const { proximaFechaPorDia } = require('./zona.service');
const { requireTorneoFecha } = require('../utils/dateUtils');

function getCanchasEfectivas(torneo, organizador) {
  return torneo.canchasDisponiblesOverride ?? organizador.cantidadCanchas ?? 1;
}

/**
 * Auto-asigna horarios y canchas para la primera ronda de eliminatoria que se juega el domingo.
 * Utiliza earliest-fit puro respetando ordenDomingo de cada categoría.
 * 
 * @param {string} organizadorId
 * @param {string} torneoId
 * @param {string|null} [categoriaId] - Opcional. Si se pasa, programa/reordena las categorías de ronda 1 listas.
 * @param {object|null} [externalTx] - Transacción Prisma externa opcional.
 */
async function asignarHorariosRondaUno(organizadorId, torneoId, categoriaId = null, externalTx = null) {
  const db = externalTx || prisma;

  const organizador = await db.organizador.findUnique({
    where: { id: organizadorId },
  });

  if (!organizador) {
    const error = new Error('Organizador no encontrado.');
    error.statusCode = 404;
    throw error;
  }

  if (!organizador.domingoInicio || !organizador.domingoFin) {
    const error = new Error('El club no tiene configurado el horario de inicio y fin para el domingo. Por favor configuralo en Configuración del Club.');
    error.statusCode = 400;
    throw error;
  }

  const torneo = await db.torneo.findUnique({
    where: { id: torneoId },
    include: {
      categorias: {
        include: {
          fasesEliminatorias: {
            orderBy: { ronda: 'desc' },
          },
        },
      },
    },
  });

  if (!torneo) {
    const error = new Error('Torneo no encontrado.');
    error.statusCode = 404;
    throw error;
  }

  if (torneo.organizadorId !== organizadorId) {
    const error = new Error('No tenés permisos sobre este torneo.');
    error.statusCode = 403;
    throw error;
  }

  const refFecha = requireTorneoFecha(torneo);
  const baseSunday = proximaFechaPorDia('Domingo', refFecha);

  const domInicioMin = horaAMinutos(organizador.domingoInicio);
  const domFinMin = horaAMinutos(organizador.domingoFin);
  let domEffectiveFinMin = domFinMin;
  if (domEffectiveFinMin <= domInicioMin) {
    domEffectiveFinMin += 24 * 60;
  }

  const domDayStartMs = baseSunday.getTime() + domInicioMin * 60 * 1000;
  const domDayEndMs = baseSunday.getTime() + domEffectiveFinMin * 60 * 1000;

  const cantidadCanchas = Math.max(1, getCanchasEfectivas(torneo, organizador));
  const DURACION_MS = DURACION_PARTIDO_MIN * 60 * 1000;

  // 1. Identificar fases iniciales de eliminatoria de domingo (< 32)
  const faseIdsRondaUno = [];
  const categoriaMap = new Map();

  for (const cat of torneo.categorias) {
    if (categoriaId && cat.id !== categoriaId) continue;
    if (cat.fasesEliminatorias && cat.fasesEliminatorias.length > 0) {
      // La primera ronda de eliminatoria es la de mayor número de ronda (ej. 16, 8, 4, 2)
      const primeraFase = cat.fasesEliminatorias[0];
      if (primeraFase.ronda < 32) {
        faseIdsRondaUno.push(primeraFase.id);
        categoriaMap.set(cat.id, cat);
      }
    }
  }

  if (faseIdsRondaUno.length === 0) {
    return { partidosAgendados: 0, mensaje: 'No hay fases de eliminatoria de domingo para agendar.' };
  }

  // 2. Obtener los partidos de ronda 1 pendientes con parejas asignadas
  const partidosRondaUno = await db.partido.findMany({
    where: {
      faseEliminatoriaId: { in: faseIdsRondaUno },
      estado: 'PENDIENTE',
      pareja1Id: { not: null },
      pareja2Id: { not: null },
    },
    include: {
      categoria: true,
      faseEliminatoria: true,
    },
  });

  if (partidosRondaUno.length === 0) {
    return { partidosAgendados: 0, mensaje: 'No hay partidos de ronda 1 pendientes.' };
  }

  const partidosRondaUnoIds = new Set(partidosRondaUno.map((p) => p.id));

  // 3. Cargar partidos ya agendados de TODO el club (excluyendo los que estamos programando ahora)
  const partidosYaAgendados = await db.partido.findMany({
    where: {
      categoria: {
        torneo: { organizadorId },
      },
      canchaNumero: { not: null },
      fechaHora: { not: null },
      sinHorarioAsignado: false,
      id: { notIn: Array.from(partidosRondaUnoIds) },
    },
    select: {
      id: true,
      fechaHora: true,
      canchaNumero: true,
      pareja1Id: true,
      pareja2Id: true,
    },
  });

  // 4. Inicializar timelines por cancha y ocupación de parejas
  const courtTimelines = new Map();
  for (let c = 1; c <= cantidadCanchas; c++) {
    courtTimelines.set(c, []);
  }

  const parejaAssignments = new Map();

  for (const p of partidosYaAgendados) {
    const pStart = new Date(p.fechaHora).getTime();
    const pEnd = pStart + DURACION_MS;
    const cancha = p.canchaNumero;

    if (cancha && courtTimelines.has(cancha)) {
      courtTimelines.get(cancha).push({ startMs: pStart, endMs: pEnd });
    }

    if (p.pareja1Id) {
      if (!parejaAssignments.has(p.pareja1Id)) parejaAssignments.set(p.pareja1Id, []);
      parejaAssignments.get(p.pareja1Id).push({ startMs: pStart, endMs: pEnd });
    }
    if (p.pareja2Id) {
      if (!parejaAssignments.has(p.pareja2Id)) parejaAssignments.set(p.pareja2Id, []);
      parejaAssignments.get(p.pareja2Id).push({ startMs: pStart, endMs: pEnd });
    }
  }

  function isCourtFree(cancha, startMs, endMs) {
    const timeline = courtTimelines.get(cancha) || [];
    for (const interval of timeline) {
      if (startMs < interval.endMs && endMs > interval.startMs) {
        return false;
      }
    }
    return true;
  }

  function isPairFree(parejaId, startMs, endMs) {
    if (!parejaId) return true;
    const intervals = parejaAssignments.get(parejaId) || [];
    for (const interval of intervals) {
      if (startMs < interval.endMs && endMs > interval.startMs) {
        return false;
      }
    }
    return true;
  }

  // 5. Ordenar partidos prioritariamente por ordenDomingo de la categoría
  const partidosOrdenados = [...partidosRondaUno].sort((a, b) => {
    const ordenA = a.categoria?.ordenDomingo ?? 999;
    const ordenB = b.categoria?.ordenDomingo ?? 999;
    if (ordenA !== ordenB) return ordenA - ordenB;

    const nombreCatComp = (a.categoria?.nombre || '').localeCompare(b.categoria?.nombre || '');
    if (nombreCatComp !== 0) return nombreCatComp;

    return a.posicionEnRonda - b.posicionEnRonda;
  });

  // 6. Asignar slots earliest-fit
  const STEP_MS = 15 * 60 * 1000;
  const updates = [];

  for (const partido of partidosOrdenados) {
    let asignado = false;

    for (let T = domDayStartMs; T + DURACION_MS <= domDayEndMs; T += STEP_MS) {
      const tEnd = T + DURACION_MS;

      // Buscar primer cancha libre en T
      for (let c = 1; c <= cantidadCanchas; c++) {
        if (
          isCourtFree(c, T, tEnd) &&
          isPairFree(partido.pareja1Id, T, tEnd) &&
          isPairFree(partido.pareja2Id, T, tEnd)
        ) {
          courtTimelines.get(c).push({ startMs: T, endMs: tEnd });

          if (partido.pareja1Id) {
            if (!parejaAssignments.has(partido.pareja1Id)) parejaAssignments.set(partido.pareja1Id, []);
            parejaAssignments.get(partido.pareja1Id).push({ startMs: T, endMs: tEnd });
          }
          if (partido.pareja2Id) {
            if (!parejaAssignments.has(partido.pareja2Id)) parejaAssignments.set(partido.pareja2Id, []);
            parejaAssignments.get(partido.pareja2Id).push({ startMs: T, endMs: tEnd });
          }

          updates.push({
            id: partido.id,
            fechaHora: new Date(T),
            canchaNumero: c,
            sinHorarioAsignado: false,
          });

          asignado = true;
          break;
        }
      }

      if (asignado) break;
    }

    if (!asignado) {
      updates.push({
        id: partido.id,
        fechaHora: null,
        canchaNumero: null,
        sinHorarioAsignado: true,
      });
    }
  }

  // 7. Persistir asignaciones en base de datos
  for (const update of updates) {
    await db.partido.update({
      where: { id: update.id },
      data: {
        fechaHora: update.fechaHora,
        canchaNumero: update.canchaNumero,
        sinHorarioAsignado: update.sinHorarioAsignado,
      },
    });
  }

  return {
    partidosAgendados: updates.filter((u) => !u.sinHorarioAsignado).length,
    partidosSinHorario: updates.filter((u) => u.sinHorarioAsignado).length,
    total: updates.length,
  };
}

module.exports = {
  asignarHorariosRondaUno,
  getCanchasEfectivas,
};
