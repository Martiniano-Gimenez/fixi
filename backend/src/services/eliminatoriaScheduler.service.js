const prisma = require('../lib/prisma');
const { horaAMinutos, DURACION_PARTIDO_MIN } = require('./slots.service');
const { proximaFechaPorDia } = require('./zona.service');
const { requireTorneoFecha } = require('../utils/dateUtils');

function getCanchasEfectivas(torneo, organizador) {
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
 * - Rondas 16 a 2 (Octavos, Cuartos, Semifinales y Finales) se programan en Domingo respetando ordenDomingo y descansos.
 * - Ronda 32 (Dieciseisavos) se programa el Sábado por la tardecita/noche.
 * - Funciona para todos los partidos desde el inicio del torneo (incluyendo slots vacíos con etiquetas de origen).
 * 
 * @param {string} organizadorId
 * @param {string} torneoId
 * @param {string|null} [categoriaId] - Opcional. Si se pasa, programa/reordena las eliminatorias de esa categoría.
 * @param {object|null} [externalTx] - Transacción Prisma externa opcional.
 */
async function programarHorariosEliminatorias(organizadorId, torneoId, categoriaId = null, externalTx = null) {
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

  // Ventana para Dieciseisavos (Sábado tardecita/noche)
  const sabInicioMin = horaAMinutos(organizador.sabadoInicio || '09:00');
  const sabFinMin = horaAMinutos(organizador.sabadoFin || '21:00');
  let sabEffectiveFinMin = sabFinMin <= sabInicioMin ? sabFinMin + 24 * 60 : sabFinMin;
  const sabNightStartMin = Math.max(sabInicioMin, Math.min(18 * 60, sabEffectiveFinMin - 150));
  const sabNightStartMs = baseSaturday.getTime() + sabNightStartMin * 60 * 1000;
  const sabNightEndMs = baseSaturday.getTime() + sabEffectiveFinMin * 60 * 1000;

  const cantidadCanchas = Math.max(1, getCanchasEfectivas(torneo, organizador));
  const DURACION_MS = DURACION_PARTIDO_MIN * 60 * 1000;
  const STEP_MS = 15 * 60 * 1000;
  const MIN_REST_MS = 30 * 60 * 1000;

  // 1. Filtrar y ordenar categorías prioritariamente por ordenDomingo
  const catsToSchedule = torneo.categorias
    .filter((cat) => (!categoriaId || cat.id === categoriaId) && cat.fasesEliminatorias && cat.fasesEliminatorias.length > 0)
    .sort((a, b) => {
      const ordA = a.ordenDomingo ?? 999;
      const ordB = b.ordenDomingo ?? 999;
      if (ordA !== ordB) return ordA - ordB;
      const nombreComp = (a.nombre || '').localeCompare(b.nombre || '');
      if (nombreComp !== 0) return nombreComp;
      return a.id.localeCompare(b.id);
    });

  if (catsToSchedule.length === 0) {
    return { partidosAgendados: 0, mensaje: 'No hay fases de eliminatoria para agendar.' };
  }

  // 2. Cargar partidos ya agendados que no forman parte de este lote de eliminatorias
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
  const matchScheduleMap = new Map(); // key: `${catId}:${ronda}:${posicionEnRonda}` -> { startMs, endMs, fechaHora, canchaNumero }

  // 4. Sábado: Programar Dieciseisavos (Ronda >= 32)
  for (const cat of catsToSchedule) {
    const fase32 = cat.fasesEliminatorias.find((f) => f.ronda >= 32);
    if (!fase32) continue;
    const maxRonda = Math.max(...cat.fasesEliminatorias.map((f) => f.ronda));

    for (const partido of fase32.partidos) {
      if (esPartidoBye(partido, fase32, maxRonda)) {
        updates.push({
          id: partido.id,
          fechaHora: null,
          canchaNumero: null,
          sinHorarioAsignado: false,
        });
        matchScheduleMap.set(`${cat.id}:${fase32.ronda}:${partido.posicionEnRonda}`, {
          startMs: 0,
          endMs: 0,
          fechaHora: null,
          canchaNumero: null,
          isBye: true,
        });
        continue;
      }

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

  // 5. Domingo: Programar Rondas < 32 (Octavos, Cuartos, Semis, Final) por niveles jerárquicos
  const maxLevels = Math.max(...catsToSchedule.map((c) => c.fasesEliminatorias.filter((f) => f.ronda < 32).length), 0);

  for (let level = 0; level < maxLevels; level++) {
    for (const cat of catsToSchedule) {
      const sundayFases = cat.fasesEliminatorias
        .filter((f) => f.ronda < 32)
        .sort((a, b) => b.ronda - a.ronda); // Rondas más tempranas primero (ej. 16, luego 8, luego 4, luego 2)

      const fase = sundayFases[level];
      if (!fase) continue;
      const maxRonda = Math.max(...cat.fasesEliminatorias.map((f) => f.ronda));

      for (const partido of fase.partidos) {
        if (esPartidoBye(partido, fase, maxRonda)) {
          updates.push({
            id: partido.id,
            fechaHora: null,
            canchaNumero: null,
            sinHorarioAsignado: false,
          });
          matchScheduleMap.set(`${cat.id}:${fase.ronda}:${partido.posicionEnRonda}`, {
            startMs: 0,
            endMs: 0,
            fechaHora: null,
            canchaNumero: null,
            isBye: true,
          });
          continue;
        }

        // Determinar hora mínima de inicio respetando la ronda anterior (padres) + descanso
        let minStart = domDayStartMs;

        if (level > 0) {
          const parentRonda = fase.ronda * 2;
          const posActual = partido.posicionEnRonda;
          const parentKey1 = `${cat.id}:${parentRonda}:${2 * posActual - 1}`;
          const parentKey2 = `${cat.id}:${parentRonda}:${2 * posActual}`;
          const parent1 = matchScheduleMap.get(parentKey1);
          const parent2 = matchScheduleMap.get(parentKey2);

          if (parent1 && parent1.endMs) {
            minStart = Math.max(minStart, parent1.endMs + MIN_REST_MS);
          }
          if (parent2 && parent2.endMs) {
            minStart = Math.max(minStart, parent2.endMs + MIN_REST_MS);
          }
        }

        let asignado = false;

        // Intento 1: Earliest-fit respetando descanso completo
        for (let T = minStart; T + DURACION_MS <= domDayEndMs; T += STEP_MS) {
          const tEnd = T + DURACION_MS;
          for (let c = 1; c <= cantidadCanchas; c++) {
            if (
              isCourtFree(sundayCourtTimelines, c, T, tEnd) &&
              isPairFree(partido.pareja1Id, T, tEnd) &&
              isPairFree(partido.pareja2Id, T, tEnd)
            ) {
              sundayCourtTimelines.get(c).push({ startMs: T, endMs: tEnd });
              matchScheduleMap.set(`${cat.id}:${fase.ronda}:${partido.posicionEnRonda}`, { startMs: T, endMs: tEnd });
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

        // Intento 2 (Fallback si el horario está apretado): Descanso mínimo directo al finalizar el padre
        if (!asignado && level > 0) {
          const parentRonda = fase.ronda * 2;
          const posActual = partido.posicionEnRonda;
          const parentKey1 = `${cat.id}:${parentRonda}:${2 * posActual - 1}`;
          const parentKey2 = `${cat.id}:${parentRonda}:${2 * posActual}`;
          const parent1 = matchScheduleMap.get(parentKey1);
          const parent2 = matchScheduleMap.get(parentKey2);
          let fallbackMinStart = domDayStartMs;
          if (parent1 && parent1.endMs) fallbackMinStart = Math.max(fallbackMinStart, parent1.endMs);
          if (parent2 && parent2.endMs) fallbackMinStart = Math.max(fallbackMinStart, parent2.endMs);

          for (let T = fallbackMinStart; T + DURACION_MS <= domDayEndMs; T += STEP_MS) {
            const tEnd = T + DURACION_MS;
            for (let c = 1; c <= cantidadCanchas; c++) {
              if (
                isCourtFree(sundayCourtTimelines, c, T, tEnd) &&
                isPairFree(partido.pareja1Id, T, tEnd) &&
                isPairFree(partido.pareja2Id, T, tEnd)
              ) {
                sundayCourtTimelines.get(c).push({ startMs: T, endMs: tEnd });
                matchScheduleMap.set(`${cat.id}:${fase.ronda}:${partido.posicionEnRonda}`, { startMs: T, endMs: tEnd });
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
    partidosAgendados: updates.filter((u) => !u.sinHorarioAsignado).length,
    partidosSinHorario: updates.filter((u) => u.sinHorarioAsignado).length,
    total: updates.length,
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
