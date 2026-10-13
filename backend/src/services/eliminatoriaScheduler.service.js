const prisma = require('../lib/prisma');
const { horaAMinutos, DURACION_PARTIDO_MIN } = require('./slots.service');
const { proximaFechaPorDia } = require('./zona.service');
const { requireTorneoFecha } = require('../utils/dateUtils');
const canchasOverridesService = require('./canchasOverrides.service');

function getCanchasEfectivas(torneo, organizador, overrideNum = null, diaKey = null) {
  if (overrideNum !== null && overrideNum !== undefined) {
    return Number(overrideNum);
  }
  if (diaKey && torneo?.id) {
    const diaOverride = canchasOverridesService.getCanchasDia(torneo.id, diaKey, organizador.cantidadCanchas || 1);
    if (diaOverride && diaOverride.canchas) {
      return Number(diaOverride.canchas);
    }
  }
  return torneo.canchasDisponiblesOverride ?? organizador.cantidadCanchas ?? 1;
}

function esRondaDieciseisavos(ronda) {
  return Number(ronda) >= 32;
}

function esPartidoBye(partido, fase, maxRondaCat) {
  if (!fase || fase.ronda !== maxRondaCat) return false;
  if (partido.estado === 'FINALIZADO' && ((partido.pareja1Id && !partido.pareja2Id && !partido.origenPareja2) || (!partido.pareja1Id && !partido.origenPareja1 && partido.pareja2Id))) {
    return true;
  }
  const hasSide1 = Boolean(partido.pareja1Id || partido.origenPareja1);
  const hasSide2 = Boolean(partido.pareja2Id || partido.origenPareja2);
  if ((hasSide1 && !hasSide2) || (!hasSide1 && hasSide2)) {
    return true;
  }
  return false;
}

/**
 * Auto-asigna horarios y canchas para TODOS los partidos de eliminatorias.
 * - Rondas 16 a 2 (Octavos, Cuartos, Semifinales y Finales) se programan en Domingo
 *   en bloques sincronizados por ronda, respetando prioridad por cantidad de clasificados y descansos saludables.
 * - Ronda 32 (Dieciseisavos) se programa el Sábado por la noche (20:45 o post-zonas).
 * - Maneja reducciones de canchas (Modo Lluvia en domingo) respetando partidos en curso/finalizados.
 * 
 * @param {string} organizadorId
 * @param {string} torneoId
 * @param {string|null} [categoriaId] - Opcional. Si se pasa, programa/reordena las eliminatorias de esa categoría.
 * @param {object|null} [externalTx] - Transacción Prisma externa opcional.
 * @param {number|null} [canchasOverride] - Cantidad de canchas reducidas explícita (ej. Modo Lluvia).
 */
async function programarHorariosEliminatorias(organizadorId, torneoId, categoriaId = null, externalTx = null, canchasOverride = null) {
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
          zonas: { select: { clasifican: true } },
          fasesEliminatorias: {
            orderBy: { ronda: 'desc' },
            include: {
              partidos: {
                orderBy: { posicionEnRonda: 'asc' },
              },
            },
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
  const baseSaturday = proximaFechaPorDia('Sabado', refFecha);

  const domInicioMin = horaAMinutos(organizador.domingoInicio);
  const domFinMin = horaAMinutos(organizador.domingoFin);
  let domEffectiveFinMin = domFinMin;
  if (domEffectiveFinMin <= domInicioMin) {
    domEffectiveFinMin += 24 * 60;
  }

  const domDayStartMs = baseSunday.getTime() + domInicioMin * 60 * 1000;
  const domDayEndMs = baseSunday.getTime() + domEffectiveFinMin * 60 * 1000;

  // Ventana para Dieciseisavos (Sábado noche: preferente 20:45 o cierre de zonas)
  const sabInicioMin = horaAMinutos(organizador.sabadoInicio || '08:00');
  const sabFinMin = horaAMinutos(organizador.sabadoFin || '23:00');
  let sabEffectiveFinMin = sabFinMin <= sabInicioMin ? sabFinMin + 24 * 60 : sabFinMin;
  const sabNightStartMin = Math.max(sabInicioMin, Math.min(20 * 60 + 45, sabEffectiveFinMin - 150));
  const sabNightStartMs = baseSaturday.getTime() + sabNightStartMin * 60 * 1000;
  const sabNightEndMs = baseSaturday.getTime() + sabEffectiveFinMin * 60 * 1000;

  const cantidadCanchas = Math.max(1, getCanchasEfectivas(torneo, organizador, canchasOverride));
  const DURACION_MS = DURACION_PARTIDO_MIN * 60 * 1000;
  const STEP_MS = 15 * 60 * 1000;

  // Descansos mínimos humanos entre fases
  const MIN_REST_OCTAVOS_CUARTOS_MS = 75 * 60 * 1000; // Al menos 1 turno completo libre de descanso (75 min)
  const DESIRED_REST_OCTAVOS_CUARTOS_MS = 75 * 60 * 1000;
  const MIN_REST_CUARTOS_SEMIS_MS = 75 * 60 * 1000;
  const DESIRED_REST_CUARTOS_SEMIS_MS = 75 * 60 * 1000;
  const MIN_REST_SEMIS_FINAL_MS = 30 * 60 * 1000; // Pre-final: 30 a 45 min
  const DESIRED_REST_SEMIS_FINAL_MS = 45 * 60 * 1000;

  // 1. Filtrar y ordenar categorías prioritariamente por cantidadParejasClasificadas (DESC)
  const catsToSchedule = torneo.categorias
    .filter((cat) => (!categoriaId || cat.id === categoriaId) && cat.fasesEliminatorias && cat.fasesEliminatorias.length > 0)
    .sort((a, b) => {
      const clasA = (a.zonas || []).reduce((s, z) => s + (z.clasifican || 0), 0);
      const clasB = (b.zonas || []).reduce((s, z) => s + (z.clasifican || 0), 0);
      if (clasB !== clasA) return clasB - clasA;
      const nombreComp = (a.nombre || '').localeCompare(b.nombre || '');
      if (nombreComp !== 0) return nombreComp;
      return a.id.localeCompare(b.id);
    });

  if (catsToSchedule.length === 0) {
    return { partidosAgendados: 0, mensaje: 'No hay fases de eliminatoria para agendar.' };
  }

  // 2. Cargar partidos externos (otros torneos u otros días)
  const allEliminatoriaMatchIds = new Set();
  for (const cat of catsToSchedule) {
    for (const fase of cat.fasesEliminatorias) {
      for (const p of fase.partidos) {
        allEliminatoriaMatchIds.add(p.id);
      }
    }
  }

  const partidosYaAgendados = await db.partido.findMany({
    where: {
      categoria: { torneo: { organizadorId } },
      canchaNumero: { not: null },
      fechaHora: { not: null },
      sinHorarioAsignado: false,
      id: { notIn: Array.from(allEliminatoriaMatchIds) },
    },
    select: {
      id: true,
      fechaHora: true,
      canchaNumero: true,
      pareja1Id: true,
      pareja2Id: true,
    },
  });

  // 3. Inicializar timelines por cancha y ocupación de parejas
  const sundayCourtTimelines = new Map();
  const saturdayCourtTimelines = new Map();
  for (let c = 1; c <= cantidadCanchas; c++) {
    sundayCourtTimelines.set(c, []);
    saturdayCourtTimelines.set(c, []);
  }

  const parejaAssignments = new Map();

  for (const p of partidosYaAgendados) {
    const pStart = new Date(p.fechaHora).getTime();
    const pEnd = pStart + DURACION_MS;
    const c = p.canchaNumero;

    if (c && c <= cantidadCanchas) {
      if (pStart >= domDayStartMs && pStart < domDayEndMs) {
        sundayCourtTimelines.get(c).push({ startMs: pStart, endMs: pEnd });
      } else {
        saturdayCourtTimelines.get(c).push({ startMs: pStart, endMs: pEnd });
      }
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

  function isCourtFree(timelineMap, c, s, e) {
    const intervals = timelineMap.get(c) || [];
    for (const it of intervals) {
      if (s < it.endMs && e > it.startMs) return false;
    }
    return true;
  }

  function isPairFree(parejaId, s, e) {
    if (!parejaId) return true;
    const intervals = parejaAssignments.get(parejaId) || [];
    for (const it of intervals) {
      if (s < it.endMs && e > it.startMs) return false;
    }
    return true;
  }

  const updates = [];
  const matchScheduleMap = new Map(); // key: `${catId}:${ronda}:${posicionEnRonda}` -> { startMs, endMs, fechaHora, canchaNumero, isBye }

  // Pre-cargar partidos ya FINALIZADOS o EN_CURSO (inmutables)
  for (const cat of catsToSchedule) {
    const maxRonda = Math.max(...cat.fasesEliminatorias.map((f) => f.ronda));
    for (const fase of cat.fasesEliminatorias) {
      for (const p of fase.partidos) {
        if (esPartidoBye(p, fase, maxRonda)) {
          matchScheduleMap.set(`${cat.id}:${fase.ronda}:${p.posicionEnRonda}`, {
            startMs: 0,
            endMs: 0,
            fechaHora: null,
            canchaNumero: null,
            isBye: true,
          });
          updates.push({
            id: p.id,
            fechaHora: null,
            canchaNumero: null,
            sinHorarioAsignado: false,
          });
        } else if ((p.estado === 'FINALIZADO' || p.estado === 'EN_CURSO') && p.fechaHora) {
          const pStart = new Date(p.fechaHora).getTime();
          const pEnd = pStart + DURACION_MS;
          matchScheduleMap.set(`${cat.id}:${fase.ronda}:${p.posicionEnRonda}`, {
            startMs: pStart,
            endMs: pEnd,
            fechaHora: p.fechaHora,
            canchaNumero: p.canchaNumero,
            isBye: false,
          });
          if (p.canchaNumero && p.canchaNumero <= cantidadCanchas) {
            if (pStart >= domDayStartMs && pStart < domDayEndMs) {
              sundayCourtTimelines.get(p.canchaNumero).push({ startMs: pStart, endMs: pEnd });
            } else {
              saturdayCourtTimelines.get(p.canchaNumero).push({ startMs: pStart, endMs: pEnd });
            }
          }
        }
      }
    }
  }

  // 4. Sábado: Programar Dieciseisavos (Ronda >= 32)
  for (const cat of catsToSchedule) {
    const fase32 = cat.fasesEliminatorias.find((f) => f.ronda >= 32);
    if (!fase32) continue;
    const maxRonda = Math.max(...cat.fasesEliminatorias.map((f) => f.ronda));

    const pendingMatches = fase32.partidos.filter(
      (p) => !esPartidoBye(p, fase32, maxRonda) && p.estado !== 'FINALIZADO' && p.estado !== 'EN_CURSO'
    );

    for (const partido of pendingMatches) {
      let asignado = false;
      for (let T = sabNightStartMs; T + DURACION_MS <= sabNightEndMs; T += STEP_MS) {
        const tEnd = T + DURACION_MS;
        for (let c = 1; c <= cantidadCanchas; c++) {
          if (
            isCourtFree(saturdayCourtTimelines, c, T, tEnd) &&
            isPairFree(partido.pareja1Id, T, tEnd) &&
            isPairFree(partido.pareja2Id, T, tEnd)
          ) {
            saturdayCourtTimelines.get(c).push({ startMs: T, endMs: tEnd });
            matchScheduleMap.set(`${cat.id}:${fase32.ronda}:${partido.posicionEnRonda}`, { startMs: T, endMs: tEnd });
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
  }

  // 5. Domingo: Programar Rondas < 32 (Octavos, Cuartos, Semis, Final)
  // Se programa por rondas sincronizadas decrecientes (ej. 16 -> 8 -> 4 -> 2)
  // para que todas las categorías jueguen primero sus Octavos, luego todos sus Cuartos,
  // luego todas sus Semifinales y finalmente todas sus Finales.
  const allSundayRondas = Array.from(
    new Set(
      catsToSchedule.flatMap((c) =>
        c.fasesEliminatorias.filter((f) => f.ronda < 32).map((f) => f.ronda)
      )
    )
  ).sort((a, b) => b - a);

  for (const rondaTarget of allSundayRondas) {
    // Ordenar categorías para esta ronda:
    // En Cuartos de final, dar prioridad a categorías que debutan en el día (sin ronda previa en domingo)
    // para que no esperen hasta última hora de la tarde y permitir mayor descanso a quienes jugaron Octavos a la mañana.
    const catsForRound = [...catsToSchedule].sort((a, b) => {
      if (rondaTarget === 8) {
        const aHasParent = a.fasesEliminatorias.some((f) => f.ronda === 16);
        const bHasParent = b.fasesEliminatorias.some((f) => f.ronda === 16);
        if (!aHasParent && bHasParent) return -1;
        if (aHasParent && !bHasParent) return 1;
      }
      const clasA = (a.zonas || []).reduce((s, z) => s + (z.clasifican || 0), 0);
      const clasB = (b.zonas || []).reduce((s, z) => s + (z.clasifican || 0), 0);
      if (clasB !== clasA) return clasB - clasA;
      const nombreComp = (a.nombre || '').localeCompare(b.nombre || '');
      if (nombreComp !== 0) return nombreComp;
      return a.id.localeCompare(b.id);
    });

    for (const cat of catsForRound) {
      const fase = cat.fasesEliminatorias.find((f) => f.ronda === rondaTarget);
      if (!fase) continue;
      const maxRonda = Math.max(...cat.fasesEliminatorias.map((f) => f.ronda));

      const pendingMatches = fase.partidos.filter(
        (p) => !esPartidoBye(p, fase, maxRonda) && p.estado !== 'FINALIZADO' && p.estado !== 'EN_CURSO'
      );

      if (pendingMatches.length === 0) continue;

      // Determinar si esta fase tiene una ronda precedente (padre) en esta categoría
      const parentRonda = fase.ronda * 2;
      const hasParentRonda = cat.fasesEliminatorias.some((f) => f.ronda === parentRonda);

      // Calcular restricciones temporales de los partidos precedentes (padres)
      let maxParentEndMs = 0;
      if (hasParentRonda) {
        for (const p of pendingMatches) {
          const parentKey1 = `${cat.id}:${parentRonda}:${2 * p.posicionEnRonda - 1}`;
          const parentKey2 = `${cat.id}:${parentRonda}:${2 * p.posicionEnRonda}`;
          const parent1 = matchScheduleMap.get(parentKey1);
          const parent2 = matchScheduleMap.get(parentKey2);
          if (parent1 && parent1.endMs && parent1.endMs > maxParentEndMs) {
            maxParentEndMs = parent1.endMs;
          }
          if (parent2 && parent2.endMs && parent2.endMs > maxParentEndMs) {
            maxParentEndMs = parent2.endMs;
          }
        }
      }

      // Definir descanso y franja objetivo según la ronda
      let minRestMs = 0;
      let desiredRestMs = 0;
      let targetEarliestMs = domDayStartMs;

      if (fase.ronda === 8) {
        // Cuartos de final
        if (hasParentRonda) {
          // Vino de Octavos
          minRestMs = MIN_REST_OCTAVOS_CUARTOS_MS;
          desiredRestMs = DESIRED_REST_OCTAVOS_CUARTOS_MS;
          targetEarliestMs = Math.max(domDayStartMs + 3 * DURACION_MS, maxParentEndMs + desiredRestMs);
        } else {
          // Categoría que arranca directamente en Cuartos (ej. 8 parejas)
          targetEarliestMs = domDayStartMs + 3 * DURACION_MS;
        }
      } else if (fase.ronda === 4) {
        // Semifinales: preferente tarde (16:45 en adelante)
        minRestMs = MIN_REST_CUARTOS_SEMIS_MS;
        desiredRestMs = DESIRED_REST_CUARTOS_SEMIS_MS;
        targetEarliestMs = Math.max(domDayStartMs + 6 * DURACION_MS, maxParentEndMs + desiredRestMs);
      } else if (fase.ronda === 2) {
        // Finales: preferente noche (19:15 en adelante)
        minRestMs = MIN_REST_SEMIS_FINAL_MS;
        desiredRestMs = DESIRED_REST_SEMIS_FINAL_MS;
        targetEarliestMs = Math.max(domDayStartMs + 8 * DURACION_MS, maxParentEndMs + desiredRestMs);
      } else {
        // Octavos de final: arranca en la mañana
        targetEarliestMs = domDayStartMs;
      }

      const absoluteEarliestMs = hasParentRonda && maxParentEndMs > 0
        ? Math.max(domDayStartMs, maxParentEndMs + minRestMs)
        : domDayStartMs;

      // Programar los partidos de esta ronda en bloque sincronizado (mismo horario o turnos más cercanos)
      let blockAssigned = false;

      function tryScheduleBatch(startSearchMs, minAllowedMs, requireFullBlock = false) {
        let remainingMatches = [...pendingMatches];
        const batchUpdates = [];
        const batchTimelinesToAdd = [];
        const batchMapToAdd = [];

        // Helper para chequear cancha libre considerando los partidos ya planificados en este mismo lote
        function isCourtFreeWithBatch(c, startMs, endMs) {
          if (!isCourtFree(sundayCourtTimelines, c, startMs, endMs)) return false;
          for (const b of batchTimelinesToAdd) {
            if (b.c === c && startMs < b.endMs && endMs > b.startMs) return false;
          }
          return true;
        }

        // Alinear el inicio de búsqueda a múltiplos exactos de turno de club (DURACION_MS = 75 min)
        let alignedStartMs = domDayStartMs;
        while (alignedStartMs < startSearchMs - 1000) {
          alignedStartMs += DURACION_MS;
        }

        // Permitir extensión para finales dominicales (+150 min sobre domDayEndMs para asegurar que el torneo cierre con campeón)
        const maxEndAllowedMs = fase.ronda === 2 ? domDayEndMs + 2 * DURACION_MS : domDayEndMs;

        for (let T = alignedStartMs; T + DURACION_MS <= maxEndAllowedMs && remainingMatches.length > 0; T += DURACION_MS) {
          const tEnd = T + DURACION_MS;
          const freeCourts = [];
          for (let c = 1; c <= cantidadCanchas; c++) {
            if (isCourtFreeWithBatch(c, T, tEnd)) {
              freeCourts.push(c);
            }
          }

          if (freeCourts.length === 0) continue;

          // Si se exige bloque completo, no fraccionar cruces si no entran todos (o un turno completo de canchas)
          const needed = Math.min(remainingMatches.length, cantidadCanchas);
          if (requireFullBlock && freeCourts.length < needed) {
            continue;
          }

          // Asignar los partidos que entren en las canchas libres de este turno T
          const toAssignThisSlot = remainingMatches.slice(0, freeCourts.length);
          let canAssignAll = true;

          for (let i = 0; i < toAssignThisSlot.length; i++) {
            const p = toAssignThisSlot[i];

            // Verificar si este partido específico respeta su padre directo
            if (hasParentRonda) {
              const parentKey1 = `${cat.id}:${parentRonda}:${2 * p.posicionEnRonda - 1}`;
              const parentKey2 = `${cat.id}:${parentRonda}:${2 * p.posicionEnRonda}`;
              const p1Sched = matchScheduleMap.get(parentKey1);
              const p2Sched = matchScheduleMap.get(parentKey2);
              if (p1Sched && p1Sched.endMs && T < p1Sched.endMs + minAllowedMs) canAssignAll = false;
              if (p2Sched && p2Sched.endMs && T < p2Sched.endMs + minAllowedMs) canAssignAll = false;
            }

            if (!isPairFree(p.pareja1Id, T, tEnd) || !isPairFree(p.pareja2Id, T, tEnd)) {
              canAssignAll = false;
            }

            if (!canAssignAll) break;
          }

          if (canAssignAll) {
            for (let i = 0; i < toAssignThisSlot.length; i++) {
              const p = toAssignThisSlot[i];
              const c = freeCourts[i];
              batchUpdates.push({
                id: p.id,
                fechaHora: new Date(T),
                canchaNumero: c,
                sinHorarioAsignado: false,
              });
              batchTimelinesToAdd.push({ c, startMs: T, endMs: tEnd });
              batchMapToAdd.push({ key: `${cat.id}:${fase.ronda}:${p.posicionEnRonda}`, sched: { startMs: T, endMs: tEnd, fechaHora: new Date(T), canchaNumero: c } });
            }
            remainingMatches = remainingMatches.slice(toAssignThisSlot.length);
          }
        }

        if (remainingMatches.length === 0) {
          // Aplicar todos los cambios del lote
          for (const item of batchTimelinesToAdd) {
            sundayCourtTimelines.get(item.c).push({ startMs: item.startMs, endMs: item.endMs });
          }
          for (const item of batchMapToAdd) {
            matchScheduleMap.set(item.key, item.sched);
          }
          for (const u of batchUpdates) {
            updates.push(u);
          }
          return true;
        }
        return false;
      }

      // Intento 1: Horario objetivo en bloque completo sincronizado con descanso deseado
      blockAssigned = tryScheduleBatch(targetEarliestMs, desiredRestMs, true);

      // Intento 2 (Fallback): Probar desde targetEarliestMs en bloque completo con descanso mínimo
      if (!blockAssigned && desiredRestMs > minRestMs) {
        blockAssigned = tryScheduleBatch(targetEarliestMs, minRestMs, true);
      }

      // Intento 3 (Fallback temprano en bloque completo): Probar desde absoluteEarliestMs
      if (!blockAssigned) {
        blockAssigned = tryScheduleBatch(absoluteEarliestMs, minRestMs, true);
      }

      // Intento 4 (Fallback admitiendo fraccionamiento parcial): Probar desde absoluteEarliestMs
      if (!blockAssigned) {
        blockAssigned = tryScheduleBatch(absoluteEarliestMs, minRestMs, false);
      }

      // Intento 5 (Fallback individual partido por partido en turnos disponibles)
      if (!blockAssigned) {
        let allIndividualAssigned = true;
        const maxEndAllowedMs = fase.ronda === 2 ? domDayEndMs + 2 * DURACION_MS : domDayEndMs;

        for (const p of pendingMatches) {
          let assigned = false;
          let pEarliestMs = absoluteEarliestMs;
          if (hasParentRonda) {
            const parentKey1 = `${cat.id}:${parentRonda}:${2 * p.posicionEnRonda - 1}`;
            const parentKey2 = `${cat.id}:${parentRonda}:${2 * p.posicionEnRonda}`;
            const p1Sched = matchScheduleMap.get(parentKey1);
            const p2Sched = matchScheduleMap.get(parentKey2);
            if (p1Sched && p1Sched.endMs) pEarliestMs = Math.max(pEarliestMs, p1Sched.endMs + minRestMs);
            if (p2Sched && p2Sched.endMs) pEarliestMs = Math.max(pEarliestMs, p2Sched.endMs + minRestMs);
          }

          let alignedPStart = domDayStartMs;
          while (alignedPStart < pEarliestMs - 1000) {
            alignedPStart += DURACION_MS;
          }

          for (let T = alignedPStart; T + DURACION_MS <= maxEndAllowedMs; T += DURACION_MS) {
            const tEnd = T + DURACION_MS;
            for (let c = 1; c <= cantidadCanchas; c++) {
              if (
                isCourtFree(sundayCourtTimelines, c, T, tEnd) &&
                isPairFree(p.pareja1Id, T, tEnd) &&
                isPairFree(p.pareja2Id, T, tEnd)
              ) {
                sundayCourtTimelines.get(c).push({ startMs: T, endMs: tEnd });
                matchScheduleMap.set(`${cat.id}:${fase.ronda}:${p.posicionEnRonda}`, { startMs: T, endMs: tEnd, fechaHora: new Date(T), canchaNumero: c });
                updates.push({
                  id: p.id,
                  fechaHora: new Date(T),
                  canchaNumero: c,
                  sinHorarioAsignado: false,
                });
                assigned = true;
                break;
              }
            }
            if (assigned) break;
          }

          if (!assigned) {
            allIndividualAssigned = false;
            updates.push({
              id: p.id,
              fechaHora: null,
              canchaNumero: null,
              sinHorarioAsignado: true,
            });
          }
        }
        blockAssigned = allIndividualAssigned;
      }
    }

    // Paso 5.b: Backfill inteligente dentro de la misma ronda (Misma ronda, sin romper bloques ni descansos)
    // Si quedaron canchas libres en turnos tempranos y hay partidos de esta misma ronda programados más tarde,
    // se adelantan de manera determinística verificando descanso individual de parejas y dependencias de cruces.
    let huboCambioBackfill = true;
    while (huboCambioBackfill) {
      huboCambioBackfill = false;

      // Partidos asignados en domingo para esta ronda
      const partidosRonda = [];
      for (const cat of catsToSchedule) {
        const fase = cat.fasesEliminatorias.find((f) => f.ronda === rondaTarget);
        if (!fase) continue;
        for (const p of fase.partidos) {
          const sched = matchScheduleMap.get(`${cat.id}:${rondaTarget}:${p.posicionEnRonda}`);
          if (sched && sched.fechaHora && sched.canchaNumero && sched.startMs >= domDayStartMs) {
            partidosRonda.push({
              partido: p,
              categoria: cat,
              fase,
              startMs: sched.startMs,
              endMs: sched.endMs,
              canchaNumero: sched.canchaNumero,
            });
          }
        }
      }

      if (partidosRonda.length === 0) break;

      // Recolectar todos los turnos del domingo donde juega esta misma ronda en el torneo (incluyendo otras categorías ya agendadas)
      const allSlotsSet = new Set(partidosRonda.map((p) => p.startMs));
      for (const cat of torneo.categorias) {
        const fase = cat.fasesEliminatorias?.find((f) => f.ronda === rondaTarget);
        if (!fase) continue;
        for (const p of fase.partidos) {
          const sched = matchScheduleMap.get(`${cat.id}:${rondaTarget}:${p.posicionEnRonda}`);
          if (sched?.fechaHora && sched.startMs >= domDayStartMs) {
            allSlotsSet.add(sched.startMs);
          } else if (p.fechaHora) {
            const pTime = new Date(p.fechaHora).getTime();
            if (pTime >= domDayStartMs && pTime < domDayEndMs) {
              allSlotsSet.add(pTime);
            }
          }
        }
      }
      const slotsRonda = Array.from(allSlotsSet).sort((a, b) => a - b);

      for (const slotTime of slotsRonda) {
        const partidosEnSlot = partidosRonda.filter((p) => p.startMs === slotTime);

        for (let c = 1; c <= cantidadCanchas; c++) {
          if (!isCourtFree(sundayCourtTimelines, c, slotTime, slotTime + DURACION_MS)) continue;

          // Cancha c libre en slotTime.
          // Buscar candidatos de esta misma ronda programados en turnos posteriores (cand.startMs > slotTime)
          const candidatos = partidosRonda.filter((cand) => {
            if (cand.startMs <= slotTime) return false;

            // Para rondas menores a 16 (Cuartos, Semis, Finales), proteger bloques unificados:
            // Solo permitir adelantar si la categoría ya juega fraccionada en múltiples turnos en esta ronda
            if (rondaTarget < 16) {
              const turnosCat = new Set(
                partidosRonda
                  .filter((m) => m.categoria.id === cand.categoria.id)
                  .map((m) => m.startMs)
              );
              if (turnosCat.size <= 1) return false;
            }

            return true;
          });

          // Criterio de ordenamiento determinístico:
          // 1. Cantidad de clasificados de la categoría DESC
          // 2. Nombre de la categoría ASC
          // 3. posicionEnRonda ASC
          // 4. ID del partido ASC
          candidatos.sort((a, b) => {
            const clasA = (a.categoria.zonas || []).reduce((s, z) => s + (z.clasifican || 0), 0);
            const clasB = (b.categoria.zonas || []).reduce((s, z) => s + (z.clasifican || 0), 0);
            if (clasB !== clasA) return clasB - clasA;

            const nomComp = (a.categoria.nombre || '').localeCompare(b.categoria.nombre || '');
            if (nomComp !== 0) return nomComp;

            if (a.partido.posicionEnRonda !== b.partido.posicionEnRonda) {
              return a.partido.posicionEnRonda - b.partido.posicionEnRonda;
            }
            return a.partido.id.localeCompare(b.partido.id);
          });

          for (const cand of candidatos) {
            const p = cand.partido;
            const cat = cand.categoria;
            const fase = cand.fase;

            // 1. Validar descanso individual con ronda previa (si tiene padre, ej. Dieciseisavos sábado)
            const parentRonda = fase.ronda * 2;
            const hasParent = cat.fasesEliminatorias.some((f) => f.ronda === parentRonda);
            let parentRestOk = true;

            if (hasParent) {
              const parentKey1 = `${cat.id}:${parentRonda}:${2 * p.posicionEnRonda - 1}`;
              const parentKey2 = `${cat.id}:${parentRonda}:${2 * p.posicionEnRonda}`;
              const p1Sched = matchScheduleMap.get(parentKey1);
              const p2Sched = matchScheduleMap.get(parentKey2);
              const MIN_ALLOWED_REST = 75 * 60 * 1000;
              if (p1Sched && p1Sched.endMs && slotTime < p1Sched.endMs + MIN_ALLOWED_REST) {
                parentRestOk = false;
              }
              if (p2Sched && p2Sched.endMs && slotTime < p2Sched.endMs + MIN_ALLOWED_REST) {
                parentRestOk = false;
              }
            }

            if (!parentRestOk) continue;

            // 2. Validar colisión de parejas en el turno slotTime
            const colisionEnSlot = partidosEnSlot.some((m) => {
              const mp = m.partido;
              return (
                (mp.pareja1Id && (mp.pareja1Id === p.pareja1Id || mp.pareja1Id === p.pareja2Id)) ||
                (mp.pareja2Id && (mp.pareja2Id === p.pareja1Id || mp.pareja2Id === p.pareja2Id))
              );
            });

            if (colisionEnSlot) continue;

            // 3. Validar descanso individual de las parejas con cualquier otro partido agendado
            let conflictoDescansoPareja = false;
            for (const otherCat of catsToSchedule) {
              for (const otherFase of otherCat.fasesEliminatorias) {
                for (const otherP of otherFase.partidos) {
                  if (otherP.id === p.id) continue;
                  const otherSched = matchScheduleMap.get(`${otherCat.id}:${otherFase.ronda}:${otherP.posicionEnRonda}`);
                  if (!otherSched || !otherSched.fechaHora) continue;

                  const mismaPareja = (
                    (p.pareja1Id && (otherP.pareja1Id === p.pareja1Id || otherP.pareja2Id === p.pareja1Id)) ||
                    (p.pareja2Id && (otherP.pareja1Id === p.pareja2Id || otherP.pareja2Id === p.pareja2Id))
                  );

                  if (mismaPareja) {
                    const diff = Math.abs(slotTime - otherSched.startMs);
                    if (diff < DURACION_MS + 75 * 60 * 1000) {
                      conflictoDescansoPareja = true;
                      break;
                    }
                  }
                }
                if (conflictoDescansoPareja) break;
              }
              if (conflictoDescansoPareja) break;
            }

            if (conflictoDescansoPareja) continue;

            // 4. Aplicar adelanto (Pull Forward)
            const oldStartMs = cand.startMs;
            const oldCancha = cand.canchaNumero;
            const tEnd = slotTime + DURACION_MS;

            // Actualizar sundayCourtTimelines: quitar viejo y agregar nuevo
            const oldTimeline = sundayCourtTimelines.get(oldCancha) || [];
            const idxTimeline = oldTimeline.findIndex((t) => t.startMs === oldStartMs);
            if (idxTimeline !== -1) {
              oldTimeline.splice(idxTimeline, 1);
            }
            sundayCourtTimelines.get(c).push({ startMs: slotTime, endMs: tEnd });

            // Actualizar matchScheduleMap
            const schedKey = `${cat.id}:${rondaTarget}:${p.posicionEnRonda}`;
            matchScheduleMap.set(schedKey, {
              startMs: slotTime,
              endMs: tEnd,
              fechaHora: new Date(slotTime),
              canchaNumero: c,
              isBye: false,
            });

            // Actualizar updates
            const updateItem = updates.find((u) => u.id === p.id);
            if (updateItem) {
              updateItem.fechaHora = new Date(slotTime);
              updateItem.canchaNumero = c;
              updateItem.sinHorarioAsignado = false;
            }

            huboCambioBackfill = true;
            break; // Avanza a la siguiente cancha o slot
          }
        }
      }
    }
  }

  // 6. Persistir en la base de datos
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
    partidosAgendados: updates.filter((u) => Boolean(u.fechaHora && !u.sinHorarioAsignado)).length,
    partidosSinHorario: updates.filter((u) => u.sinHorarioAsignado).length,
    total: updates.length,
    canchasUtilizadas: cantidadCanchas,
  };
}

// Alias retrocompatible
const asignarHorariosRondaUno = programarHorariosEliminatorias;

module.exports = {
  programarHorariosEliminatorias,
  asignarHorariosRondaUno,
  getCanchasEfectivas,
  esRondaDieciseisavos,
};
