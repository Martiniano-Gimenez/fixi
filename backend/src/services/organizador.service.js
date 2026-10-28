const crypto = require('crypto');
const prisma = require('../lib/prisma');
const {
  getSlotsValidosSet,
  generarGrillaOrganizador,
  calcularOpcionesResolucion,
  horaAMinutos,
  DURACION_PARTIDO_MIN,
  ordenarSlotsCronologicamente,
} = require('./slots.service');
const { getDiaCalendarioConTrasnoche, requireTorneoFecha, parseFechaLocal, clavesJornadasTorneo } = require('../utils/dateUtils');
const { minutosDespuesDelCierre } = require('../utils/horarioClub');
const {
  iniciarCategoria,
  iniciarCategoriaConDisponibilidad,
  asignarHorariosAutomatico,
  fusionarSlotsEnVentanas,
  interseccionVentanas,
  parseSlotToDate,
  proximaFechaPorDia,
  slotIdToMsWindow,
  asignarHorariosModoLluviaMCF,
} = require('./zona.service');
const canchasOverridesService = require('./canchasOverrides.service');
const { programarHorariosEliminatorias } = require('./eliminatoriaScheduler.service');

// Cache de planes validados en memoria para inicio determinista
const planesCache = new Map();

// Cache de sesiones de pre-check en memoria para resolución incremental estable
const preCheckSessions = new Map();
const PRECHECK_TTL_MS = 60 * 60 * 1000; // 1 hora con sliding TTL

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of planesCache) {
    if (v.expiresAt < now) planesCache.delete(k);
  }
  for (const [k, v] of preCheckSessions) {
    if (v.expiresAt < now) preCheckSessions.delete(k);
  }
}, 60_000);

function buildFingerprint(organizador, categoriasConParejas) {
  const clubPart = [
    organizador.cantidadCanchas || 1,
    organizador.viernesInicio || '',
    organizador.viernesFin || '',
    organizador.sabadoInicio || '',
    organizador.sabadoFin || '',
  ].join(',');

  const categoriasPart = (categoriasConParejas || [])
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((c) => {
      const parejasPart = (c.parejas || [])
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
      return `${c.id}:${parejasPart}`;
    });

  return JSON.stringify([clubPart, ...categoriasPart]);
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
      domingoInicio: true,
      domingoFin: true,
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

  const slotsActuales = await prisma.slotPareja.findMany({
    where: {
      pareja: {
        categoria: {
          torneo: { organizadorId },
        },
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
  if (data.domingoInicio !== undefined) updateData.domingoInicio = data.domingoInicio || null;
  if (data.domingoFin !== undefined) updateData.domingoFin = data.domingoFin || null;

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
        domingoInicio: true,
        domingoFin: true,
      },
    });

    const nuevosSlotsValidos = getSlotsValidosSet(updated);
    const slotsActuales = await tx.slotPareja.findMany({
      where: {
        pareja: {
          categoria: {
            torneo: { organizadorId },
          },
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
 * Reconstruye limpiamente los timelines de canchas y asignaciones de parejas a partir
 * de los partidos actualmente agendados en categoriasPlan.
 * Garantiza total sincronía entre el dry-run y cada re-check incremental.
 */
function buildTimelinesFromPlan({ categoriasPlan, cantCanchas, DURACION_MS }) {
  const courtTimelines = new Map();
  for (let c = 1; c <= cantCanchas; c++) courtTimelines.set(c, []);
  const parejaAssignments = new Map();

  for (const cPlan of categoriasPlan) {
    for (const z of cPlan.zonas) {
      for (const p of z.partidos) {
        if (!p.sinHorarioAsignado && p.fechaHora && p.canchaNumero) {
          const s = new Date(p.fechaHora).getTime();
          const e = s + DURACION_MS;
          if (courtTimelines.has(p.canchaNumero)) {
            courtTimelines.get(p.canchaNumero).push({ startMs: s, endMs: e });
          }
          if (p.pareja1Id) {
            if (!parejaAssignments.has(p.pareja1Id)) parejaAssignments.set(p.pareja1Id, []);
            parejaAssignments.get(p.pareja1Id).push({ startMs: s, endMs: e });
          }
          if (p.pareja2Id) {
            if (!parejaAssignments.has(p.pareja2Id)) parejaAssignments.set(p.pareja2Id, []);
            parejaAssignments.get(p.pareja2Id).push({ startMs: s, endMs: e });
          }
        }
      }
    }
  }

  return { courtTimelines, parejaAssignments };
}

/**
 * Evalúa incrementalmente los partidos sin horario de un snapshot sobre los huecos libres del timeline
 * garantizando que ningún partido previamente asignado sea modificado.
 * Operación 100% síncrona en memoria (cero riesgo de race conditions).
 */
function evaluarAsignacionesIncrementales({
  categoriasPlan,
  courtTimelines: inputCourtTimelines,
  parejaAssignments: inputParejaAssignments,
  parejasMap,
  cantidadCanchas,
  refFecha,
  organizador,
  DURACION_MS,
}) {
  // Reconstrucción limpia de timelines a partir del estado actual de los partidos del plan
  const freshTimelines = buildTimelinesFromPlan({ categoriasPlan, cantCanchas: cantidadCanchas, DURACION_MS });
  const courtTimelines = freshTimelines.courtTimelines;
  const parejaAssignments = freshTimelines.parejaAssignments;
  const friInicioMin = horaAMinutos(organizador.viernesInicio);
  const friFinMin = horaAMinutos(organizador.viernesFin);
  let friEffectiveFinMin = friFinMin;
  if (friEffectiveFinMin <= friInicioMin && organizador.viernesFin) {
    friEffectiveFinMin += 24 * 60;
  }
  const baseFriday = proximaFechaPorDia('Viernes', refFecha);
  const baseSaturday = proximaFechaPorDia('Sabado', refFecha);
  const friDayStartMs = baseFriday.getTime() + friInicioMin * 60 * 1000;
  const friDayEndMs = baseFriday.getTime() + friEffectiveFinMin * 60 * 1000;

  const satInicioMin = horaAMinutos(organizador.sabadoInicio);
  const satFinMin = horaAMinutos(organizador.sabadoFin);
  let satEffectiveFinMin = satFinMin;
  if (satEffectiveFinMin <= satInicioMin && organizador.sabadoFin) {
    satEffectiveFinMin += 24 * 60;
  }
  const satDayStartMs = baseSaturday.getTime() + satInicioMin * 60 * 1000;
  const satDayEndMs = baseSaturday.getTime() + satEffectiveFinMin * 60 * 1000;

  function isCourtFree(cancha, startMs, endMs) {
    const timeline = courtTimelines.get(cancha) || [];
    for (const interval of timeline) {
      if (startMs < interval.endMs && endMs > interval.startMs) return false;
    }
    return true;
  }

  function isPairFree(parejaId, startMs, endMs) {
    if (!parejaId) return true;
    const intervals = parejaAssignments.get(parejaId) || [];
    for (const interval of intervals) {
      if (startMs < interval.endMs && endMs > interval.startMs) return false;
    }
    return true;
  }

  // 1. Intentar asignar partidos que estaban sin horario
  for (const cPlan of categoriasPlan) {
    for (const zona of cPlan.zonas) {
      for (const partido of zona.partidos) {
        if (!partido.sinHorarioAsignado) continue;

        const par1 = parejasMap.get(partido.pareja1Id);
        const par2 = parejasMap.get(partido.pareja2Id);
        const slotsP1 = ordenarSlotsCronologicamente((par1?.slotsSeleccionados || []).map((s) => s.slotId));
        const slotsP2 = ordenarSlotsCronologicamente((par2?.slotsSeleccionados || []).map((s) => s.slotId));

        const conSlotsP1 = slotsP1.length > 0;
        const conSlotsP2 = slotsP2.length > 0;

        let sharedWindows = [];
        let slotsComunes = [];
        if (conSlotsP1 && conSlotsP2) {
          const set2 = new Set(slotsP2);
          slotsComunes = slotsP1.filter((s) => set2.has(s));
          const win1 = fusionarSlotsEnVentanas(slotsP1, refFecha);
          const win2 = fusionarSlotsEnVentanas(slotsP2, refFecha);
          sharedWindows = interseccionVentanas(win1, win2);
        } else if (conSlotsP1 || conSlotsP2) {
          slotsComunes = conSlotsP1 ? slotsP1 : slotsP2;
          sharedWindows = fusionarSlotsEnVentanas(slotsComunes, refFecha);
        }

        slotsComunes = ordenarSlotsCronologicamente(slotsComunes);

        if (sharedWindows.length === 0) continue;

        let asignado = false;
        // Probar primero slots comunes exactos
        for (const sId of slotsComunes) {
          const sWin = slotIdToMsWindow(sId, refFecha);
          if (!sWin) continue;
          const sStart = sWin.startMs;
          const sEnd = sWin.endMs;
          if (!isPairFree(partido.pareja1Id, sStart, sEnd) || !isPairFree(partido.pareja2Id, sStart, sEnd)) {
            continue;
          }
          for (let c = 1; c <= cantidadCanchas; c++) {
            if (isCourtFree(c, sStart, sEnd)) {
              if (!courtTimelines.has(c)) courtTimelines.set(c, []);
              courtTimelines.get(c).push({ startMs: sStart, endMs: sEnd });
              if (!parejaAssignments.has(partido.pareja1Id)) parejaAssignments.set(partido.pareja1Id, []);
              parejaAssignments.get(partido.pareja1Id).push({ startMs: sStart, endMs: sEnd });
              if (!parejaAssignments.has(partido.pareja2Id)) parejaAssignments.set(partido.pareja2Id, []);
              parejaAssignments.get(partido.pareja2Id).push({ startMs: sStart, endMs: sEnd });

              partido.fechaHora = new Date(sStart);
              partido.canchaNumero = c;
              partido.sinHorarioAsignado = false;
              asignado = true;
              break;
            }
          }
          if (asignado) break;
        }

        // Si no se asignó en slot común, probar en ventanas continuas
        if (!asignado) {
          for (const win of sharedWindows) {
            const isFri = win.dia === 'Viernes';
            const dayStartMs = isFri ? friDayStartMs : satDayStartMs;
            const dayEndMs = isFri ? friDayEndMs : satDayEndMs;
            const wStart = Math.max(win.startMs, dayStartMs);
            const wEnd = Math.min(win.endMs, dayEndMs);

            let bestCand = null;
            for (let c = 1; c <= cantidadCanchas; c++) {
              let T = wStart;
              while (T + DURACION_MS <= wEnd) {
                const tEnd = T + DURACION_MS;
                if (isCourtFree(c, T, tEnd) && isPairFree(partido.pareja1Id, T, tEnd) && isPairFree(partido.pareja2Id, T, tEnd)) {
                  if (bestCand === null || T < bestCand.T) {
                    bestCand = { T, cancha: c };
                  }
                  break;
                }
                T += 15 * 60 * 1000;
              }
            }

            if (bestCand !== null) {
              if (!courtTimelines.has(bestCand.cancha)) courtTimelines.set(bestCand.cancha, []);
              courtTimelines.get(bestCand.cancha).push({ startMs: bestCand.T, endMs: bestCand.T + DURACION_MS });
              if (!parejaAssignments.has(partido.pareja1Id)) parejaAssignments.set(partido.pareja1Id, []);
              parejaAssignments.get(partido.pareja1Id).push({ startMs: bestCand.T, endMs: bestCand.T + DURACION_MS });
              if (!parejaAssignments.has(partido.pareja2Id)) parejaAssignments.set(partido.pareja2Id, []);
              parejaAssignments.get(partido.pareja2Id).push({ startMs: bestCand.T, endMs: bestCand.T + DURACION_MS });

              partido.fechaHora = new Date(bestCand.T);
              partido.canchaNumero = bestCand.cancha;
              partido.sinHorarioAsignado = false;
              asignado = true;
              break;
            }
          }
        }
      }
    }
  }

  // 1b. Intentar asignar partidos MINI_BRACKET de ronda 2 (P3 y P4) que estaban sin horario
  for (const cPlan of categoriasPlan) {
    for (const zona of cPlan.zonas) {
      if (zona.formato !== 'MINI_BRACKET') continue;

      const p1 = zona.partidos.find((p) => p.posicionEnRonda === 1);
      const p2 = zona.partidos.find((p) => p.posicionEnRonda === 2);
      const p3 = zona.partidos.find((p) => p.posicionEnRonda === 3);
      const p4 = zona.partidos.find((p) => p.posicionEnRonda === 4);

      if (!p1?.fechaHora || !p2?.fechaHora || p1.sinHorarioAsignado || p2.sinHorarioAsignado) continue;

      const minStartMs = Math.max(new Date(p1.fechaHora).getTime(), new Date(p2.fechaHora).getTime()) + DURACION_MS;

      const rawZonaParejas = (zona.parejaIds || []).map((pId) => parejasMap.get(pId)).filter(Boolean);
      const slotsLists = rawZonaParejas.map((p) => ordenarSlotsCronologicamente((p.slotsSeleccionados || []).map((s) => s.slotId)));

      let shared4 = [];
      const conSlotsLists = slotsLists.filter((l) => l.length > 0);
      if (conSlotsLists.length === 0) {
        if (organizador.viernesInicio && organizador.viernesFin) {
          shared4.push({ dia: 'Viernes', startMs: friDayStartMs, endMs: friDayEndMs });
        }
        if (organizador.sabadoInicio && organizador.sabadoFin) {
          shared4.push({ dia: 'Sabado', startMs: satDayStartMs, endMs: satDayEndMs });
        }
      } else {
        const windowsList = conSlotsLists.map((l) => fusionarSlotsEnVentanas(l, refFecha));
        shared4 = windowsList[0];
        for (let i = 1; i < windowsList.length; i++) {
          shared4 = interseccionVentanas(shared4, windowsList[i]);
        }
      }

      let commonSlots4 = [];
      if (conSlotsLists.length > 0) {
        commonSlots4 = conSlotsLists[0];
        for (let i = 1; i < conSlotsLists.length; i++) {
          commonSlots4 = commonSlots4.filter((s) => conSlotsLists[i].includes(s));
        }
        commonSlots4 = ordenarSlotsCronologicamente(commonSlots4);
      }

      const matchesToAssign = [p3, p4].filter((p) => p && p.sinHorarioAsignado);
      for (const m of matchesToAssign) {
        let asignado = false;

        for (const sId of commonSlots4) {
          const sWin = slotIdToMsWindow(sId, refFecha);
          if (!sWin || sWin.startMs < minStartMs) continue;

          let withinShared = false;
          for (const w of shared4) {
            if (w.dia === sWin.dia && sWin.startMs >= w.startMs && sWin.endMs <= w.endMs) {
              withinShared = true;
              break;
            }
          }
          if (!withinShared) continue;

          for (let c = 1; c <= cantidadCanchas; c++) {
            if (isCourtFree(c, sWin.startMs, sWin.endMs)) {
              if (!courtTimelines.has(c)) courtTimelines.set(c, []);
              courtTimelines.get(c).push({ startMs: sWin.startMs, endMs: sWin.endMs });

              m.fechaHora = new Date(sWin.startMs);
              m.canchaNumero = c;
              m.sinHorarioAsignado = false;
              asignado = true;
              break;
            }
          }
          if (asignado) break;
        }

        if (!asignado) {
          for (const window of shared4) {
            const isFri = window.dia === 'Viernes';
            const dayStartMs = isFri ? friDayStartMs : satDayStartMs;
            const dayEndMs = isFri ? friDayEndMs : satDayEndMs;
            const wStart = Math.max(window.startMs, dayStartMs, minStartMs);
            const wEnd = Math.min(window.endMs, dayEndMs);

            let bestCand = null;
            for (let c = 1; c <= cantidadCanchas; c++) {
              let T = wStart;
              while (T + DURACION_MS <= wEnd) {
                const tEnd = T + DURACION_MS;
                if (isCourtFree(c, T, tEnd)) {
                  if (bestCand === null || T < bestCand.T) {
                    bestCand = { T, cancha: c };
                  }
                  break;
                }
                T += 15 * 60 * 1000;
              }
            }

            if (bestCand !== null) {
              if (!courtTimelines.has(bestCand.cancha)) courtTimelines.set(bestCand.cancha, []);
              courtTimelines.get(bestCand.cancha).push({ startMs: bestCand.T, endMs: bestCand.T + DURACION_MS });

              m.fechaHora = new Date(bestCand.T);
              m.canchaNumero = bestCand.cancha;
              m.sinHorarioAsignado = false;
              asignado = true;
              break;
            }
          }
        }
      }
    }
  }

  // 2. Construir slotsEvaluadosMap a partir de los timelines actuales
  const grilla = generarGrillaOrganizador(organizador);
  const allSlotIds = [...grilla.viernes, ...grilla.sabado];
  const slotsEvaluadosMap = new Map();

  for (const sId of allSlotIds) {
    const sDate = parseSlotToDate(sId, refFecha);
    if (!sDate) continue;
    const sStartMs = sDate.getTime();
    const sEndMs = sStartMs + DURACION_MS;

    const canchasOcupadas = new Set();
    const parejasOcupadas = new Set();

    for (let c = 1; c <= cantidadCanchas; c++) {
      for (const item of courtTimelines.get(c) || []) {
        if (Math.max(sStartMs, item.startMs) < Math.min(sEndMs, item.endMs)) {
          canchasOcupadas.add(c);
        }
      }
    }

    for (const [parejaId, intervals] of parejaAssignments.entries()) {
      for (const item of intervals) {
        if (Math.max(sStartMs, item.startMs) < Math.min(sEndMs, item.endMs)) {
          parejasOcupadas.add(parejaId);
        }
      }
    }

    const canchasLibres = cantidadCanchas - canchasOcupadas.size;
    slotsEvaluadosMap.set(sId, {
      canchasLibres,
      parejasOcupadas: Array.from(parejasOcupadas),
    });
  }

  // 3. Recalcular mapa de conflictos para los partidos y zonas que sigan sin horario
  const conflictosMap = new Map();
  const parejaFreqMap = new Map();

  for (const cPlan of categoriasPlan) {
    for (const z of cPlan.zonas) {
      for (const p of z.partidos) {
        if (p.sinHorarioAsignado) {
          if (p.pareja1Id) parejaFreqMap.set(p.pareja1Id, (parejaFreqMap.get(p.pareja1Id) || 0) + 1);
          if (p.pareja2Id) parejaFreqMap.set(p.pareja2Id, (parejaFreqMap.get(p.pareja2Id) || 0) + 1);
        }
      }
    }
  }

  let totalPartidosSinHorario = 0;
  let totalZonasManuales = 0;

  for (const cPlan of categoriasPlan) {
    const cId = cPlan.categoriaId;

    for (const z of cPlan.zonas) {
      if (z.requiereArmadoManual || z.esZonaManualOriginal) {
        // Re-evaluar compatibilidad pairwise con disponibilidad actualizada de parejasMap
        const rawZonaParejas = z.parejaIds.map((pId) => {
          const p = parejasMap.get(pId);
          return {
            id: pId,
            nombre: p ? `${p.jugador1} / ${p.jugador2}` : 'Pareja',
            slotIds: (p?.slotsSeleccionados || []).map((s) => s.slotId),
          };
        });

        // Verificar si todas las parejas comparten al menos un slot entre cada par
        let todaviaIncompatible = false;
        if (rawZonaParejas.length <= 1 || rawZonaParejas.length >= 5) {
          todaviaIncompatible = true;
        } else {
          for (let i = 0; i < rawZonaParejas.length; i++) {
            for (let j = i + 1; j < rawZonaParejas.length; j++) {
              const s1 = rawZonaParejas[i].slotIds;
              const s2 = rawZonaParejas[j].slotIds;
              const shared = s1.filter((slot) => s2.includes(slot));
              if (shared.length === 0) {
                todaviaIncompatible = true;
                break;
              }
            }
            if (todaviaIncompatible) break;
          }
        }

        // Si ya son compatibles, marcar zona como resuelta y procesar sus partidos normalmente
        if (!todaviaIncompatible) {
          z.requiereArmadoManual = false;
          // Procesar partidos sin horario de esta zona en el loop normal
          for (const partido of z.partidos) {
            if (!partido.sinHorarioAsignado) continue;

            const par1 = parejasMap.get(partido.pareja1Id);
            const par2 = parejasMap.get(partido.pareja2Id);
            const slotsP1 = ordenarSlotsCronologicamente((par1?.slotsSeleccionados || []).map((s) => s.slotId));
            const slotsP2 = ordenarSlotsCronologicamente((par2?.slotsSeleccionados || []).map((s) => s.slotId));

            const conSlotsP1 = slotsP1.length > 0;
            const conSlotsP2 = slotsP2.length > 0;

            let sharedWindows = [];
            let slotsComunes = [];
            if (conSlotsP1 && conSlotsP2) {
              const set2 = new Set(slotsP2);
              slotsComunes = slotsP1.filter((s) => set2.has(s));
              const win1 = fusionarSlotsEnVentanas(slotsP1, refFecha);
              const win2 = fusionarSlotsEnVentanas(slotsP2, refFecha);
              sharedWindows = interseccionVentanas(win1, win2);
            } else if (conSlotsP1 || conSlotsP2) {
              slotsComunes = conSlotsP1 ? slotsP1 : slotsP2;
              sharedWindows = fusionarSlotsEnVentanas(slotsComunes, refFecha);
            }

            slotsComunes = ordenarSlotsCronologicamente(slotsComunes);

            if (sharedWindows.length === 0) continue;

            let asignado = false;
            for (const sId of slotsComunes) {
              const sWin = slotIdToMsWindow(sId, refFecha);
              if (!sWin) continue;
              const sStart = sWin.startMs;
              const sEnd = sWin.endMs;
              if (!isPairFree(partido.pareja1Id, sStart, sEnd) || !isPairFree(partido.pareja2Id, sStart, sEnd)) {
                continue;
              }
              for (let c = 1; c <= cantidadCanchas; c++) {
                if (isCourtFree(c, sStart, sEnd)) {
                  if (!courtTimelines.has(c)) courtTimelines.set(c, []);
                  courtTimelines.get(c).push({ startMs: sStart, endMs: sEnd });
                  if (!parejaAssignments.has(partido.pareja1Id)) parejaAssignments.set(partido.pareja1Id, []);
                  parejaAssignments.get(partido.pareja1Id).push({ startMs: sStart, endMs: sEnd });
                  if (!parejaAssignments.has(partido.pareja2Id)) parejaAssignments.set(partido.pareja2Id, []);
                  parejaAssignments.get(partido.pareja2Id).push({ startMs: sStart, endMs: sEnd });

                  partido.fechaHora = new Date(sStart);
                  partido.canchaNumero = c;
                  partido.sinHorarioAsignado = false;
                  asignado = true;
                  break;
                }
              }
              if (asignado) break;
            }

            if (!asignado) {
              for (const win of sharedWindows) {
                const isFri = win.dia === 'Viernes';
                const dayStartMs = isFri ? friDayStartMs : satDayStartMs;
                const dayEndMs = isFri ? friDayEndMs : satDayEndMs;
                const wStart = Math.max(win.startMs, dayStartMs);
                const wEnd = Math.min(win.endMs, dayEndMs);

                let bestCand = null;
                for (let c = 1; c <= cantidadCanchas; c++) {
                  let T = wStart;
                  while (T + DURACION_MS <= wEnd) {
                    const tEnd = T + DURACION_MS;
                    if (isCourtFree(c, T, tEnd) && isPairFree(partido.pareja1Id, T, tEnd) && isPairFree(partido.pareja2Id, T, tEnd)) {
                      if (bestCand === null || T < bestCand.T) {
                        bestCand = { T, cancha: c };
                      }
                      break;
                    }
                    T += 15 * 60 * 1000;
                  }
                }

                if (bestCand !== null) {
                  if (!courtTimelines.has(bestCand.cancha)) courtTimelines.set(bestCand.cancha, []);
                  courtTimelines.get(bestCand.cancha).push({ startMs: bestCand.T, endMs: bestCand.T + DURACION_MS });
                  if (!parejaAssignments.has(partido.pareja1Id)) parejaAssignments.set(partido.pareja1Id, []);
                  parejaAssignments.get(partido.pareja1Id).push({ startMs: bestCand.T, endMs: bestCand.T + DURACION_MS });
                  if (!parejaAssignments.has(partido.pareja2Id)) parejaAssignments.set(partido.pareja2Id, []);
                  parejaAssignments.get(partido.pareja2Id).push({ startMs: bestCand.T, endMs: bestCand.T + DURACION_MS });

                  partido.fechaHora = new Date(bestCand.T);
                  partido.canchaNumero = bestCand.cancha;
                  partido.sinHorarioAsignado = false;
                  asignado = true;
                  break;
                }
              }
            }
          }
        } else {
          // La zona es incompatible — marcar como manual y limpiar horarios de TODOS sus partidos
          z.requiereArmadoManual = true;
          for (const p of z.partidos) {
            p.fechaHora = null;
            p.canchaNumero = null;
            p.sinHorarioAsignado = true;
          }

          totalZonasManuales++;
          if (!conflictosMap.has(cId)) {
            conflictosMap.set(cId, {
              categoriaId: cId,
              nombreCategoria: cPlan.nombre,
              partidosSinHorario: [],
            });
          }

          const parejasNombres = rawZonaParejas.map((p) => p.nombre).join(' | ');

          const parejasManuales = rawZonaParejas.map((p) => {
            const mySlots = p.slotIds;
            const slotsViables = allSlotIds.filter((sId) => {
              const info = slotsEvaluadosMap.get(sId);
              if (!info || info.canchasLibres <= 0) return false;
              if (p.id && info.parejasOcupadas.includes(p.id)) return false;
              return true;
            });

            const slotsQueDestraban = (rawZonaParejas.length <= 1 || rawZonaParejas.length >= 5)
              ? []
              : slotsViables.filter((sId) => {
                  const simulated = rawZonaParejas.map((item) => {
                    if (item.id === p.id) {
                      return Array.from(new Set([...item.slotIds, sId]));
                    }
                    return item.slotIds;
                  });
                  for (let i = 0; i < simulated.length; i++) {
                    for (let j = i + 1; j < simulated.length; j++) {
                      const s1 = simulated[i];
                      const s2 = simulated[j];
                      const shared = s1.filter((slot) => s2.includes(slot));
                      if (shared.length === 0) return false;
                    }
                  }
                  return true;
                });

            return {
              id: p.id,
              nombre: p.nombre,
              slotsCount: mySlots.length,
              slotIds: mySlots,
              slotsViables,
              slotsQueDestraban,
            };
          });

          const crucesIncompatibles = [];
          for (let i = 0; i < rawZonaParejas.length; i++) {
            for (let j = i + 1; j < rawZonaParejas.length; j++) {
              const p1 = rawZonaParejas[i];
              const p2 = rawZonaParejas[j];
              const shared = p1.slotIds.filter((slot) => p2.slotIds.includes(slot));
              if (shared.length === 0) {
                crucesIncompatibles.push({
                  p1: p1.nombre,
                  p2: p2.nombre,
                  p1Id: p1.id,
                  p2Id: p2.id,
                });
              }
            }
          }

          conflictosMap.get(cId).partidosSinHorario.push({
            partidoId: z.id || z.nombre,
            zonaId: z.id || z.nombre,
            zona: z.nombre,
            categoriaId: cId,
            motivo: 'ZONA_MANUAL_INCOMPLETA',
            pareja1: rawZonaParejas.length <= 1
              ? 'Zona con 1 sola pareja (incompleta)'
              : (rawZonaParejas.length >= 5
                ? `Zona con ${rawZonaParejas.length} parejas (máximo 4)`
                : 'Incompatibilidad de grupo'),
            pareja2: parejasNombres,
            parejasManuales,
            crucesIncompatibles,
            aparicionesMaximas: 999,
            tamanoZona: rawZonaParejas.length,
            parejaIds: rawZonaParejas.map((p) => p.id),
          });
          continue;
        }
      }

      for (const p of z.partidos) {
        if (!p.sinHorarioAsignado) continue;
        totalPartidosSinHorario++;

        if (!conflictosMap.has(cId)) {
          conflictosMap.set(cId, {
            categoriaId: cId,
            nombreCategoria: cPlan.nombre,
            partidosSinHorario: [],
          });
        }

        if (z.formato === 'MINI_BRACKET' && p.posicionEnRonda >= 3) {
          const rawZonaParejas = (z.parejaIds || []).map((pId) => {
            const par = parejasMap.get(pId);
            return {
              id: pId,
              nombre: par ? `${par.jugador1} / ${par.jugador2}` : 'Pareja',
              slotIds: (par?.slotsSeleccionados || []).map((s) => s.slotId),
            };
          });

          const parejasManuales = rawZonaParejas.map((par) => {
            const mySlots = par.slotIds;
            const slotsViables = allSlotIds.filter((sId) => {
              const info = slotsEvaluadosMap.get(sId);
              if (!info || info.canchasLibres <= 0) return false;
              if (par.id && info.parejasOcupadas.includes(par.id)) return false;
              return true;
            });

            const slotsQueDestraban = slotsViables.filter((sId) => {
              const simulated = rawZonaParejas.map((item) => {
                if (item.id === par.id) {
                  return Array.from(new Set([...item.slotIds, sId]));
                }
                return item.slotIds;
              });
              for (let i = 0; i < simulated.length; i++) {
                for (let j = i + 1; j < simulated.length; j++) {
                  const s1 = simulated[i];
                  const s2 = simulated[j];
                  const shared = s1.filter((slot) => s2.includes(slot));
                  if (shared.length === 0) return false;
                }
              }
              return true;
            });

            return {
              id: par.id,
              nombre: par.nombre,
              slotsCount: mySlots.length,
              slotIds: mySlots,
              slotsViables,
              slotsQueDestraban,
            };
          });

          const crucesIncompatibles = [];
          for (let i = 0; i < rawZonaParejas.length; i++) {
            for (let j = i + 1; j < rawZonaParejas.length; j++) {
              const p1 = rawZonaParejas[i];
              const p2 = rawZonaParejas[j];
              const shared = p1.slotIds.filter((slot) => p2.slotIds.includes(slot));
              if (shared.length === 0) {
                crucesIncompatibles.push({
                  p1: p1.nombre,
                  p2: p2.nombre,
                  p1Id: p1.id,
                  p2Id: p2.id,
                });
              }
            }
          }

          const desc = p.posicionEnRonda === 3 ? 'Ganador P1 vs Ganador P2' : 'Perdedor P1 vs Perdedor P2';
          conflictosMap.get(cId).partidosSinHorario.push({
            partidoId: p.id,
            zonaId: z.id,
            zona: z.nombre,
            categoriaId: cId,
            motivo: 'PARTIDO_SIN_HORARIO',
            pareja1: desc,
            pareja2: rawZonaParejas.map((par) => par.nombre).join(' | '),
            parejasManuales,
            crucesIncompatibles,
            aparicionesMaximas: 999,
          });
          continue;
        }

        const par1 = parejasMap.get(p.pareja1Id);
        const par2 = parejasMap.get(p.pareja2Id);
        const slotsP1 = ordenarSlotsCronologicamente((par1?.slotsSeleccionados || []).map((s) => s.slotId));
        const slotsP2 = ordenarSlotsCronologicamente((par2?.slotsSeleccionados || []).map((s) => s.slotId));

        const win1 = fusionarSlotsEnVentanas(slotsP1, refFecha);
        const win2 = fusionarSlotsEnVentanas(slotsP2, refFecha);
        const shared = interseccionVentanas(win1, win2);

        const tieneFranjaComun = shared.length > 0;
        const motivo = tieneFranjaComun ? 'SIN_CANCHA_DISPONIBLE' : 'SIN_FRANJA_COMUN';

        let p1Score = win1.length * 1000 + slotsP1.length;
        let p2Score = win2.length * 1000 + slotsP2.length;
        const p1IsMoreConstrained = p1Score <= p2Score;

        const parejaMasRestringida = p1IsMoreConstrained ? par1 : par2;
        const parejaMasRestringidaSlots = p1IsMoreConstrained ? slotsP1.length : slotsP2.length;
        const parejaMasRestringidaOpciones = p1IsMoreConstrained ? win1.length : win2.length;
        const parejaMasRestringidaSlotIds = p1IsMoreConstrained ? slotsP1 : slotsP2;

        const slotsViables = allSlotIds.filter((sId) => {
          const info = slotsEvaluadosMap.get(sId);
          if (!info || info.canchasLibres <= 0) return false;
          if (p.pareja1Id && info.parejasOcupadas.includes(p.pareja1Id)) return false;
          if (p.pareja2Id && info.parejasOcupadas.includes(p.pareja2Id)) return false;
          return true;
        });

        const opcionesResolucion = calcularOpcionesResolucion(slotsP1, slotsP2, slotsViables, 6);

        const maxApariciones = Math.max(
          parejaFreqMap.get(p.pareja1Id) || 0,
          parejaFreqMap.get(p.pareja2Id) || 0
        );

        conflictosMap.get(cId).partidosSinHorario.push({
          partidoId: p.id,
          zonaId: z.id,
          zona: z.nombre,
          categoriaId: cId,
          pareja1Id: p.pareja1Id,
          pareja1: par1 ? `${par1.jugador1} / ${par1.jugador2}` : 'Por definirse',
          pareja1SlotsCount: slotsP1.length,
          pareja1OpcionesCount: win1.length,
          pareja1SlotIds: slotsP1,
          pareja2Id: p.pareja2Id,
          pareja2: par2 ? `${par2.jugador1} / ${par2.jugador2}` : 'Por definirse',
          pareja2SlotsCount: slotsP2.length,
          pareja2OpcionesCount: win2.length,
          pareja2SlotIds: slotsP2,
          motivo,
          parejaMasRestringidaId: parejaMasRestringida?.id || null,
          parejaMasRestringidaNombre: parejaMasRestringida
            ? `${parejaMasRestringida.jugador1} / ${parejaMasRestringida.jugador2}`
            : '',
          parejaMasRestringidaSlots: parejaMasRestringidaSlots,
          parejaMasRestringidaOpciones: parejaMasRestringidaOpciones,
          parejaMasRestringidaSlotIds: parejaMasRestringidaSlotIds,
          slotsViables,
          opcionesResolucion,
          aparicionesMaximas: maxApariciones,
        });
      }
    }
  }

  for (const catConflicto of conflictosMap.values()) {
    catConflicto.partidosSinHorario.sort((a, b) => b.aparicionesMaximas - a.aparicionesMaximas);
  }

  return {
    conflictos: Array.from(conflictosMap.values()),
    totalConflictos: totalPartidosSinHorario + totalZonasManuales,
    totalZonasManuales,
    grillaOrganizador: grilla,
  };
}

/**
 * Valida si todas las categorías en borrador de un Torneo pueden iniciarse y programarse sin conflictos horarios.
 * Utiliza un Snapshot Estable en memoria para garantizar que durante la sesión de resolución de cruces
 * las zonas se mantengan congeladas y los partidos asignados permanezcan inmutables.
 */
async function preCheckInicioTorneo(organizadorId, torneoId, { forceReset = false, isReCheck = false } = {}) {
  const organizador = await getOrganizador(organizadorId);

  const torneo = await prisma.torneo.findUnique({
    where: { id: torneoId },
    include: {
      categorias: {
        where: { estado: 'BORRADOR' },
        // Orden explícito (sesión 81): define en qué orden se inician las categorías y, como validos.sort
        // es estable, el desempate entre categorías con el mismo scoreFlexibilidad.
        orderBy: [{ nombre: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        include: {
          parejas: {
            include: {
              slotsSeleccionados: true,
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

  const categoriasBorrador = torneo.categorias;

  if (categoriasBorrador.length === 0) {
    const error = new Error('No hay categorías en estado Borrador en este torneo para iniciar.');
    error.statusCode = 400;
    throw error;
  }

  const validos = [];
  const omitidos = [];

  for (const c of categoriasBorrador) {
    if (c.parejas.length < 2) {
      omitidos.push({
        id: c.id,
        nombre: c.nombre,
        motivo: 'Tiene menos de 2 parejas inscriptas.',
      });
    } else {
      const totalSlots = c.parejas.reduce((acc, p) => acc + p.slotsSeleccionados.length, 0);
      const parejasConSlots = c.parejas.filter((p) => p.slotsSeleccionados.length > 0).length;
      const tieneDisponibilidad = parejasConSlots > 0;

      const scoreFlexibilidad = tieneDisponibilidad
        ? totalSlots / c.parejas.length
        : 999999;

      validos.push({
        categoria: c,
        tieneDisponibilidad,
        scoreFlexibilidad,
        avgSlots: tieneDisponibilidad ? Number((totalSlots / c.parejas.length).toFixed(1)) : 0,
      });
    }
  }

  if (validos.length === 0) {
    const error = new Error('Ninguna de las categorías en borrador cuenta con al menos 2 parejas.');
    error.statusCode = 400;
    throw error;
  }

  const refFecha = requireTorneoFecha(torneo);
  const cantCanchas = Math.max(1, organizador.cantidadCanchas || 1);
  const DURACION_MS = DURACION_PARTIDO_MIN * 60 * 1000;

  // Mapa global de parejas con disponibilidad actualizada
  const parejasMap = new Map();
  for (const c of categoriasBorrador) {
    for (const p of c.parejas) {
      parejasMap.set(p.id, p);
    }
  }

  // Hash de IDs de parejas para invalidar automáticamente el snapshot si se agregan o eliminan parejas
  const currentParejaIds = Array.from(parejasMap.keys()).sort().join(',');

  // =========================================================================
  // CAMINO 1: RE-EVALUACIÓN SOBRE SNAPSHOT CONGELADO EXISTENTE (Incremental)
  // =========================================================================
  const existingSession = preCheckSessions.get(torneoId);
  const isSessionValid = existingSession &&
    existingSession.organizadorId === organizadorId &&
    existingSession.expiresAt > Date.now() &&
    existingSession.parejaIdsHash === currentParejaIds;

  if (isSessionValid && !forceReset) {
    // Sliding TTL: renueva la expiración en cada interacción
    existingSession.expiresAt = Date.now() + PRECHECK_TTL_MS;

    // Evaluación 100% síncrona en memoria sobre el snapshot congelado
    const evalRes = evaluarAsignacionesIncrementales({
      categoriasPlan: existingSession.categoriasPlan,
      courtTimelines: existingSession.courtTimelines,
      parejaAssignments: existingSession.parejaAssignments,
      parejasMap,
      cantidadCanchas: cantCanchas,
      refFecha,
      organizador,
      DURACION_MS,
    });

    if (evalRes.totalConflictos > 0) {
      // Si el re-check vuelve a tener conflictos, invalidar cualquier plan previo no-emergencia
      for (const [pId, pObj] of planesCache.entries()) {
        if (pObj.torneoId === torneoId && !pObj.esEmergencia) {
          planesCache.delete(pId);
        }
      }

      const planEmergenciaId = crypto.randomUUID();
      const fingerprint = buildFingerprint(organizador, categoriasBorrador);

      planesCache.set(planEmergenciaId, {
        planId: planEmergenciaId,
        organizadorId,
        torneoId,
        expiresAt: existingSession.expiresAt,
        fingerprint,
        categoriasPlan: structuredClone(existingSession.categoriasPlan),
        omitidos,
        esEmergencia: true,
      });

      return {
        bloqueado: true,
        motivo: 'Existen partidos o zonas sin horario compatible asignado.',
        conflictos: evalRes.conflictos,
        grillaOrganizador: evalRes.grillaOrganizador,
        permiteInicioEmergencia: evalRes.totalZonasManuales === 0,
        planEmergenciaId,
        omitidos,
        sesionReiniciada: false,
      };
    } else {
      const planId = crypto.randomUUID();
      const fingerprint = buildFingerprint(organizador, categoriasBorrador);

      planesCache.set(planId, {
        planId,
        organizadorId,
        torneoId,
        expiresAt: existingSession.expiresAt,
        fingerprint,
        categoriasPlan: structuredClone(existingSession.categoriasPlan),
        omitidos,
      });

      return {
        bloqueado: false,
        planId,
        torneoId,
        categoriasAIniciar: validos.map((v) => ({ id: v.categoria.id, nombre: v.categoria.nombre })),
        omitidos,
        sesionReiniciada: false,
      };
    }
  }

  // =========================================================================
  // CAMINO 2: PRIMER PRE-CHECK O REINICIO EXPLÍCITO (Generar Nuevo Snapshot)
  // =========================================================================
  const sesionReiniciada = Boolean(isReCheck && !forceReset && (!existingSession || existingSession.expiresAt <= Date.now()));

  const fingerprint = buildFingerprint(organizador, categoriasBorrador);
  const PLANNED_ROLLBACK = Symbol('PLANNED_ROLLBACK');
  let dryRunResult = null;

  try {
    await prisma.$transaction(async (tx) => {
      // 1. Iniciar zonas en cada categoría válida (usando tx)
      for (const item of validos) {
        if (item.tieneDisponibilidad) {
          await iniciarCategoriaConDisponibilidad(organizadorId, item.categoria.id, tx);
        } else {
          await iniciarCategoria(organizadorId, item.categoria.id, tx);
        }
      }

      // 2. Ordenar categorías por restricción (menor score / promedio de slots primero)
      validos.sort((a, b) => a.scoreFlexibilidad - b.scoreFlexibilidad);

      // 3. Asignar horarios y canchas en tx con pool global multi-categoría (MCF Global)
      const categoriasIdsValidos = validos.map((v) => v.categoria.id);
      await asignarHorariosAutomatico(organizadorId, categoriasIdsValidos, tx, { isPreCheck: true });

      // 4. Construir categoriasPlan y capturar timelines del snapshot mediante buildTimelinesFromPlan
      const categoriasPlan = [];

      for (const v of validos) {
        // Orden explícito (sesión 81). zonaParejas por pareja.orden: sin orderBy SQLite las devolvía por el
        // índice (zonaId, parejaId), en orden de UUID, distinto en cada corrida. Zonas por nombre y partidos
        // por posición: hoy coinciden con el orden de creación (sin efecto observable), quedan explícitos.
        const zonasTx = await tx.zona.findMany({
          where: { categoriaId: v.categoria.id },
          orderBy: { nombre: 'asc' },
          include: {
            zonaParejas: {
              select: { parejaId: true },
              orderBy: [{ pareja: { orden: 'asc' } }, { parejaId: 'asc' }],
            },
            partidos: {
              orderBy: { posicionEnRonda: 'asc' },
              select: {
                id: true,
                posicionEnRonda: true,
                pareja1Id: true,
                pareja2Id: true,
                origenPareja1: true,
                origenPareja2: true,
                fechaHora: true,
                canchaNumero: true,
                sinHorarioAsignado: true,
              },
            },
          },
        });

        categoriasPlan.push({
          categoriaId: v.categoria.id,
          nombre: v.categoria.nombre,
          avgSlots: v.avgSlots,
          zonas: zonasTx.map((z) => ({
            id: z.id,
            nombre: z.nombre,
            clasifican: z.clasifican,
            formato: z.formato,
            requiereArmadoManual: z.requiereArmadoManual || false,
            esZonaManualOriginal: Boolean(z.requiereArmadoManual),
            parejaIds: z.zonaParejas.map((zp) => zp.parejaId),
            partidos: z.partidos.map((p) => ({
              id: p.id,
              posicionEnRonda: p.posicionEnRonda,
              pareja1Id: p.pareja1Id,
              pareja2Id: p.pareja2Id,
              origenPareja1: p.origenPareja1 || null,
              origenPareja2: p.origenPareja2 || null,
              fechaHora: p.fechaHora,
              canchaNumero: p.canchaNumero,
              sinHorarioAsignado: p.sinHorarioAsignado || false,
            })),
          })),
        });
      }

      const { courtTimelines, parejaAssignments } = buildTimelinesFromPlan({
        categoriasPlan,
        cantCanchas,
        DURACION_MS,
      });

      // Guardar sesión en memoria para re-checks incrementales estables
      preCheckSessions.set(torneoId, {
        torneoId,
        organizadorId,
        createdAt: Date.now(),
        expiresAt: Date.now() + PRECHECK_TTL_MS,
        parejaIdsHash: currentParejaIds,
        validos,
        omitidos,
        categoriasPlan,
        courtTimelines,
        parejaAssignments,
        refFecha,
      });

      // 5. Evaluar conflictos iniciales
      const evalRes = evaluarAsignacionesIncrementales({
        categoriasPlan,
        courtTimelines,
        parejaAssignments,
        parejasMap,
        cantidadCanchas: cantCanchas,
        refFecha,
        organizador,
        DURACION_MS,
      });

      if (evalRes.totalConflictos > 0) {
        let planEmergenciaId = null;
        if (evalRes.totalZonasManuales === 0) {
          planEmergenciaId = crypto.randomUUID();
          planesCache.set(planEmergenciaId, {
            planId: planEmergenciaId,
            organizadorId,
            torneoId,
            expiresAt: Date.now() + PRECHECK_TTL_MS,
            fingerprint,
            categoriasPlan: structuredClone(categoriasPlan),
            omitidos,
            esEmergencia: true,
          });
        }

        dryRunResult = {
          bloqueado: true,
          motivo: 'Existen partidos o zonas sin horario compatible asignado.',
          conflictos: evalRes.conflictos,
          grillaOrganizador: evalRes.grillaOrganizador,
          permiteInicioEmergencia: evalRes.totalZonasManuales === 0,
          planEmergenciaId,
          omitidos,
          sesionReiniciada,
        };
      } else {
        const planId = crypto.randomUUID();
        planesCache.set(planId, {
          planId,
          organizadorId,
          torneoId,
          expiresAt: Date.now() + PRECHECK_TTL_MS,
          fingerprint,
          categoriasPlan: structuredClone(categoriasPlan),
          omitidos,
        });

        dryRunResult = {
          bloqueado: false,
          planId,
          torneoId,
          categoriasAIniciar: validos.map((v) => ({ id: v.categoria.id, nombre: v.categoria.nombre })),
          omitidos,
          sesionReiniciada,
        };
      }

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
 * Inicia las categorías del Torneo y aplica el plan precalculado.
 */
async function iniciarTorneoMultiCategoria(organizadorId, torneoId, planId = null) {
  if (planId) {
    const cached = planesCache.get(planId);
    if (!cached || cached.expiresAt < Date.now() || cached.organizadorId !== organizadorId || cached.torneoId !== torneoId) {
      const error = new Error('El plan de inicio expiró o no es válido. Por favor volvé a verificar.');
      error.statusCode = 400;
      throw error;
    }

    const organizador = await getOrganizador(organizadorId);
    const torneo = await prisma.torneo.findUnique({
      where: { id: torneoId },
      include: {
        categorias: {
          where: { estado: 'BORRADOR' },
          include: { parejas: { include: { slotsSeleccionados: true } } },
        },
      },
    });

    const currentFingerprint = buildFingerprint(organizador, torneo?.categorias || []);
    if (currentFingerprint !== cached.fingerprint) {
      planesCache.delete(planId);
      const error = new Error('Los datos del club o las parejas cambiaron desde la última verificación. Volvé a verificar antes de iniciar.');
      error.statusCode = 409;
      throw error;
    }

    // Aplicar el plan cacheado a la base de datos
    const resumen = [];
    await prisma.$transaction(async (tx) => {
      // Primera escritura: cierra la inscripción por link y toma el bloqueo del torneo, el mismo
      // que toma cada inscripción. Después se repite la verificación de parejas y club dentro de
      // la transacción: una inscripción (o un alta) confirmada entre la verificación de arriba y
      // este punto quedaría sin zona en una categoría ya iniciada.
      await tx.torneo.update({
        where: { id: torneoId },
        data: { inscripcionAbierta: false },
      });
      const organizadorTx = await tx.organizador.findUnique({ where: { id: organizadorId } });
      const categoriasTx = await tx.categoria.findMany({
        where: { torneoId, estado: 'BORRADOR' },
        include: { parejas: { include: { slotsSeleccionados: true } } },
      });
      if (buildFingerprint(organizadorTx, categoriasTx) !== cached.fingerprint) {
        planesCache.delete(planId);
        const error = new Error('Los datos del club o las parejas cambiaron desde la última verificación. Volvé a verificar antes de iniciar.');
        error.statusCode = 409;
        throw error;
      }

      const categoriasConSinHorario = [];
      for (const cPlan of cached.categoriasPlan) {
        const categoria = await tx.categoria.findUnique({ where: { id: cPlan.categoriaId } });
        if (!categoria || categoria.estado !== 'BORRADOR') {
          throw new Error(`La categoría "${cPlan.nombre}" ya no está en estado Borrador.`);
        }

        let asignadosCount = 0;
        let sinHorarioCount = 0;

        for (const zData of cPlan.zonas) {
          const zona = await tx.zona.create({
            data: {
              categoriaId: cPlan.categoriaId,
              nombre: zData.nombre,
              clasifican: zData.clasifican,
              formato: zData.formato,
              requiereArmadoManual: zData.requiereArmadoManual || false,
            },
          });

          for (const pId of zData.parejaIds) {
            await tx.zonaPareja.create({
              data: { zonaId: zona.id, parejaId: pId },
            });
          }

          for (const pData of zData.partidos) {
            await tx.partido.create({
              data: {
                categoriaId: cPlan.categoriaId,
                zonaId: zona.id,
                posicionEnRonda: pData.posicionEnRonda,
                pareja1Id: pData.pareja1Id,
                pareja2Id: pData.pareja2Id,
                origenPareja1: pData.origenPareja1 || null,
                origenPareja2: pData.origenPareja2 || null,
                fechaHora: pData.fechaHora ? new Date(pData.fechaHora) : null,
                canchaNumero: pData.canchaNumero,
                sinHorarioAsignado: pData.sinHorarioAsignado,
                estado: 'PENDIENTE',
              },
            });

            if (pData.sinHorarioAsignado) sinHorarioCount++;
            else if (pData.fechaHora) asignadosCount++;
          }
        }

        await tx.categoria.update({
          where: { id: cPlan.categoriaId },
          data: { estado: 'EN_CURSO' },
        });

        if (sinHorarioCount > 0) {
          categoriasConSinHorario.push(cPlan.categoriaId);
        }

        resumen.push({
          categoriaId: cPlan.categoriaId,
          nombre: cPlan.nombre,
          zonas: cPlan.zonas.length,
          asignados: asignadosCount,
          sinHorario: sinHorarioCount,
        });
      }

      // Asignar horarios automáticos con pool global a todas las categorías que tengan partidos sin horario
      // una vez que TODOS los partidos aprobados de todas las categorías ya fueron persistidos en la base de datos
      if (categoriasConSinHorario.length > 0) {
        await asignarHorariosAutomatico(organizadorId, categoriasConSinHorario, tx);
      }

      await tx.torneo.update({
        where: { id: torneoId },
        data: { estado: 'EN_CURSO' },
      });
    }, {
      maxWait: 10000,
      timeout: 30000,
    });

    planesCache.delete(planId);
    preCheckSessions.delete(torneoId);

    // Generar brackets eliminatorios vacíos (estructura con orígenes "1° Zona A", etc.)
    // para cada categoría iniciada. Los clasificados se asignarán cuando finalicen las zonas.
    const { generarEliminatoria } = require('./faseEliminatoria.service');
    for (const cat of resumen) {
      try {
        await generarEliminatoria(organizadorId, cat.categoriaId);
      } catch (err) {
        // No bloquear el inicio del torneo si algún bracket no se genera
        // (ej: categoría con una sola zona de 2 parejas sin bracket eliminatorio)
        console.warn(`[iniciarTorneo] No se pudo generar bracket para "${cat.nombre}": ${err.message}`);
      }
    }

    // Programar automáticamente los horarios y canchas de todos los cruces eliminatorios
    // (Dieciseisavos el sábado por la tardecita/noche, Octavos a Final el domingo)
    const { programarHorariosEliminatorias } = require('./eliminatoriaScheduler.service');
    try {
      await programarHorariosEliminatorias(organizadorId, torneoId);
    } catch (err) {
      console.warn(`[iniciarTorneo] No se pudieron programar horarios de eliminatorias: ${err.message}`);
    }

    return {
      message: 'Torneo iniciado y horarios asignados exitosamente.',
      categoriasIniciadas: resumen,
      omitidos: cached.omitidos || [],
    };
  }

  // Si no se proveyó planId, ejecutar preCheck y luego aplicar
  const preCheck = await preCheckInicioTorneo(organizadorId, torneoId);
  if (preCheck.bloqueado) {
    const error = new Error(preCheck.motivo);
    error.statusCode = 400;
    error.conflictos = preCheck.conflictos;
    throw error;
  }
  return await iniciarTorneoMultiCategoria(organizadorId, torneoId, preCheck.planId);
}

/**
 * Obtiene los partidos sin horario asignado de un torneo
 */
async function getPartidosSinHorarioTorneo(organizadorId, torneoId) {
  const torneo = await prisma.torneo.findUnique({
    where: { id: torneoId },
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

  const partidos = await prisma.partido.findMany({
    where: {
      categoria: { torneoId },
      sinHorarioAsignado: true,
      estado: { not: 'FINALIZADO' },
    },
    include: {
      categoria: { select: { id: true, nombre: true } },
      zona: { select: { id: true, nombre: true } },
      faseEliminatoria: { select: { id: true, nombre: true, ronda: true } },
      pareja1: {
        select: {
          id: true,
          jugador1: true,
          jugador2: true,
          slotsSeleccionados: { select: { slotId: true } },
        },
      },
      pareja2: {
        select: {
          id: true,
          jugador1: true,
          jugador2: true,
          slotsSeleccionados: { select: { slotId: true } },
        },
      },
    },
    orderBy: [
      { categoria: { nombre: 'asc' } },
      { zona: { nombre: 'asc' } },
      { posicionEnRonda: 'asc' },
    ],
  });

  const organizador = await getOrganizador(organizadorId);
  const grilla = generarGrillaOrganizador(organizador);
  const canchasClub = organizador.cantidadCanchas || 1;
  const refFecha = requireTorneoFecha(torneo);

  // Buscar todos los partidos con fechaHora y canchaNumero asignados en este torneo
  const partidosAsignados = await prisma.partido.findMany({
    where: {
      categoria: { torneoId },
      fechaHora: { not: null },
      canchaNumero: { not: null },
    },
    select: {
      id: true,
      fechaHora: true,
      canchaNumero: true,
      pareja1Id: true,
      pareja2Id: true,
    },
  });

  const partidosIntervalos = partidosAsignados.map((p) => {
    const startMs = new Date(p.fechaHora).getTime();
    const endMs = startMs + 75 * 60 * 1000;
    return {
      partidoId: p.id,
      canchaNumero: p.canchaNumero,
      startMs,
      endMs,
      pareja1Id: p.pareja1Id,
      pareja2Id: p.pareja2Id,
    };
  });

  const allSlotIds = [...grilla.viernes, ...grilla.sabado];
  const slotsEvaluados = [];

  for (const slotId of allSlotIds) {
    const slotDate = parseSlotToDate(slotId, refFecha);
    if (!slotDate) continue;

    const slotStartMs = slotDate.getTime();
    const slotEndMs = slotStartMs + 75 * 60 * 1000;

    // Canchas de la jornada lógica del turno: las del override por lluvia si existe, si no todas las del club
    const diaKeySlot = getDiaCalendarioConTrasnoche(slotDate, organizador)?.key;
    const cantCanchas = Math.min(
      canchasOverridesService.getCanchasDia(torneoId, diaKeySlot, canchasClub).canchas,
      canchasClub
    );

    let canchasOcupadasCount = 0;
    const parejasJugandoEnSlot = new Set();

    for (const p of partidosIntervalos) {
      if (Math.max(slotStartMs, p.startMs) < Math.min(slotEndMs, p.endMs)) {
        if (p.canchaNumero) canchasOcupadasCount++;
        if (p.pareja1Id) parejasJugandoEnSlot.add(p.pareja1Id);
        if (p.pareja2Id) parejasJugandoEnSlot.add(p.pareja2Id);
      }
    }

    const canchasLibres = cantCanchas - canchasOcupadasCount;
    slotsEvaluados.push({
      slotId,
      canchasLibres,
      parejasJugando: Array.from(parejasJugandoEnSlot),
    });
  }

  // Excluir partidos BYE de eliminatorias (no requieren horario ni rival)
  const partidosSinBye = partidos.filter((p) => !p.esBye);

  // Para cada partido sin horario calculamos slotsViables y nivel de urgencia
  const partidosConUrgencia = partidosSinBye.map((p) => {
    const p1Slots = ordenarSlotsCronologicamente((p.pareja1?.slotsSeleccionados || []).map((s) => s.slotId));
    const p2Slots = ordenarSlotsCronologicamente((p.pareja2?.slotsSeleccionados || []).map((s) => s.slotId));
    const slotsEnComunOriginales = ordenarSlotsCronologicamente(p1Slots.filter((s) => p2Slots.includes(s)));

    const slotsViables = ordenarSlotsCronologicamente(
      slotsEvaluados
        .filter((s) => {
          if (s.canchasLibres <= 0) return false;
          if (p.pareja1Id && s.parejasJugando.includes(p.pareja1Id)) return false;
          if (p.pareja2Id && s.parejasJugando.includes(p.pareja2Id)) return false;
          return true;
        })
        .map((s) => s.slotId)
    );

    const slotsViablesCount = slotsViables.length;
    const slotsValidosConEstrella = ordenarSlotsCronologicamente(slotsViables.filter((sId) => slotsEnComunOriginales.includes(sId)));
    const slotsValidosConEstrellaCount = slotsValidosConEstrella.length;

    let urgencia = 'BAJA';
    if (slotsViablesCount <= 1) {
      urgencia = 'ALTA';
    } else if (slotsViablesCount <= 3) {
      urgencia = 'MEDIA';
    }

    return {
      ...p,
      slotsViables,
      slotsViablesCount,
      slotsEnComunOriginales,
      slotsEnComunCount: slotsEnComunOriginales.length,
      slotsValidosConEstrella,
      slotsValidosConEstrellaCount,
      urgencia,
    };
  });

  // Ordenar Most Constrained First (los más restringidos primero)
  partidosConUrgencia.sort((a, b) => {
    if (a.slotsViablesCount !== b.slotsViablesCount) {
      return a.slotsViablesCount - b.slotsViablesCount;
    }
    const catA = a.categoria?.nombre || '';
    const catB = b.categoria?.nombre || '';
    if (catA !== catB) return catA.localeCompare(catB);
    const zonaA = a.zona?.nombre || '';
    const zonaB = b.zona?.nombre || '';
    if (zonaA !== zonaB) return zonaA.localeCompare(zonaB);
    return (a.posicionEnRonda || 0) - (b.posicionEnRonda || 0);
  });

  return partidosConUrgencia;
}

/**
 * Obtiene el estado de ocupación de canchas y slots libres en tiempo real para un torneo
 */
async function getCanchasDisponiblesTorneo(organizadorId, torneoId, ignorePartidoId = null) {
  const organizador = await getOrganizador(organizadorId);
  const torneo = await prisma.torneo.findUnique({ where: { id: torneoId } });
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

  const grilla = generarGrillaOrganizador(organizador);
  const canchasClub = organizador.cantidadCanchas || 1;
  const refFecha = requireTorneoFecha(torneo);

  // Buscar todos los partidos con fechaHora y canchaNumero asignados en este torneo
  const partidosAsignados = await prisma.partido.findMany({
    where: {
      categoria: { torneoId },
      fechaHora: { not: null },
      canchaNumero: { not: null },
      ...(ignorePartidoId ? { id: { not: ignorePartidoId } } : {}),
    },
    select: {
      id: true,
      fechaHora: true,
      canchaNumero: true,
      pareja1Id: true,
      pareja2Id: true,
      categoria: { select: { nombre: true } },
      pareja1: { select: { jugador1: true, jugador2: true } },
      pareja2: { select: { jugador1: true, jugador2: true } },
    },
  });

  const partidosIntervalos = partidosAsignados.map((p) => {
    const startMs = new Date(p.fechaHora).getTime();
    const endMs = startMs + 75 * 60 * 1000;
    return {
      partidoId: p.id,
      canchaNumero: p.canchaNumero,
      startMs,
      endMs,
      pareja1Id: p.pareja1Id,
      pareja2Id: p.pareja2Id,
    };
  });

  const slotsEvaluados = [];
  const allSlotIds = [...grilla.viernes, ...grilla.sabado, ...(grilla.domingo || [])];

  for (const slotId of allSlotIds) {
    const [dia, hora] = slotId.split('-');
    const slotDate = parseSlotToDate(slotId, refFecha);
    if (!slotDate) continue;

    const slotStartMs = slotDate.getTime();
    const slotEndMs = slotStartMs + 75 * 60 * 1000;

    // Canchas de la jornada lógica del turno: las del override por lluvia si existe, si no todas las del club
    const diaKeySlot = getDiaCalendarioConTrasnoche(slotDate, organizador)?.key;
    const cantCanchas = Math.min(
      canchasOverridesService.getCanchasDia(torneoId, diaKeySlot, canchasClub).canchas,
      canchasClub
    );

    const canchasOcupadas = [];
    const parejasJugandoEnSlot = new Set();

    for (const p of partidosIntervalos) {
      if (Math.max(slotStartMs, p.startMs) < Math.min(slotEndMs, p.endMs)) {
        if (p.canchaNumero) canchasOcupadas.push(p.canchaNumero);
        if (p.pareja1Id) parejasJugandoEnSlot.add(p.pareja1Id);
        if (p.pareja2Id) parejasJugandoEnSlot.add(p.pareja2Id);
      }
    }

    const canchasLibres = [];
    for (let c = 1; c <= cantCanchas; c++) {
      if (!canchasOcupadas.includes(c)) {
        canchasLibres.push(c);
      }
    }

    slotsEvaluados.push({
      slotId,
      dia,
      hora,
      fechaIso: slotDate.toISOString(),
      canchasLibres,
      canchasOcupadas,
      totalCanchas: cantCanchas,
      parejasOcupadasIds: Array.from(parejasJugandoEnSlot),
    });
  }

  return {
    // Canchas del club; las activas de cada turno van en slots[].totalCanchas
    cantidadCanchas: canchasClub,
    grilla,
    slots: slotsEvaluados,
    totalPartidosAsignados: partidosAsignados.length,
  };
}

/**
 * Obtiene el estado consolidado en vivo de un torneo en curso para el dashboard Día de Torneo
 */
async function getEstadoEnVivo(organizadorId, torneoId) {
  const torneo = await prisma.torneo.findUnique({
    where: { id: torneoId },
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

  if (torneo.estado !== 'EN_CURSO') {
    const error = new Error('El modo Día de Torneo solo está disponible para torneos en curso.');
    error.statusCode = 400;
    throw error;
  }

  const organizador = await getOrganizador(organizadorId);
  const canchasClub = organizador.cantidadCanchas || 1;

  const partidos = await prisma.partido.findMany({
    where: {
      categoria: { torneoId },
    },
    include: {
      categoria: { select: { id: true, nombre: true } },
      zona: { select: { id: true, nombre: true } },
      faseEliminatoria: { select: { id: true, nombre: true, ronda: true } },
      pareja1: { select: { id: true, jugador1: true, jugador2: true } },
      pareja2: { select: { id: true, jugador1: true, jugador2: true } },
      ganador: { select: { id: true, jugador1: true, jugador2: true } },
      sets: { orderBy: { numero: 'asc' } },
    },
    orderBy: [
      { fechaHora: 'asc' },
      { canchaNumero: 'asc' },
    ],
  });

  function formatPareja(p, origen) {
    if (p) return `${p.jugador1} / ${p.jugador2}`;
    if (origen) return origen;
    return 'Por definirse';
  }

  const DURACION_MS = (organizador.duracionPartidoMin || 75) * 60 * 1000;

  // Horarios del club para calcular el día lógico de cada partido (canchas fantasma y canchasPorDia)
  const horariosClubObj = {
    viernesInicio: organizador.viernesInicio,
    viernesFin: organizador.viernesFin,
    sabadoInicio: organizador.sabadoInicio,
    sabadoFin: organizador.sabadoFin,
    domingoInicio: organizador.domingoInicio,
    domingoFin: organizador.domingoFin,
  };

  // Categorías con métricas de zonas y fases eliminatorias
  const categoriasTorneo = await prisma.categoria.findMany({
    where: { torneoId },
    orderBy: { nombre: 'asc' },
    select: {
      id: true,
      nombre: true,
      zonas: {
        select: {
          id: true,
          nombre: true,
          partidos: { select: { id: true, estado: true } },
        },
      },
      fasesEliminatorias: {
        orderBy: { ronda: 'desc' },
        select: {
          id: true,
          nombre: true,
          ronda: true,
          partidos: {
            select: {
              id: true,
              estado: true,
              pareja1Id: true,
              pareja2Id: true,
              ganadorId: true,
            },
          },
        },
      },
    },
  });

  const categoriasListasParaEliminatoria = [];
  const categoriasInfo = [];

  for (const cat of categoriasTorneo) {
    let totalPartidosZona = 0;
    let partidosZonaFinalizados = 0;

    for (const z of (cat.zonas || [])) {
      totalPartidosZona += z.partidos.length;
      partidosZonaFinalizados += z.partidos.filter((p) => p.estado === 'FINALIZADO').length;
    }

    const partidosZonaPendientes = totalPartidosZona - partidosZonaFinalizados;
    const zonasFinalizadas = totalPartidosZona > 0 && partidosZonaPendientes === 0;

    const tieneEliminatoria = Boolean(cat.fasesEliminatorias && cat.fasesEliminatorias.length > 0);
    let clasificadosAsignados = false;
    let totalPartidosEliminatoria = 0;
    let partidosEliminatoriaFinalizados = 0;
    let finalFinalizada = false;

    if (tieneEliminatoria) {
      const primeraFase = cat.fasesEliminatorias[0];
      clasificadosAsignados = primeraFase.partidos.some((p) => p.pareja1Id || p.pareja2Id);

      for (const f of cat.fasesEliminatorias) {
        totalPartidosEliminatoria += f.partidos.length;
        partidosEliminatoriaFinalizados += f.partidos.filter((p) => p.estado === 'FINALIZADO').length;
        if (f.ronda === 2) {
          const finalMatch = f.partidos[0];
          if (finalMatch && finalMatch.estado === 'FINALIZADO' && finalMatch.ganadorId) {
            finalFinalizada = true;
          }
        }
      }
    }

    // Compatibilidad: categorías que tienen zonas terminadas y bracket listo para asignar
    if (zonasFinalizadas && tieneEliminatoria && !clasificadosAsignados) {
      categoriasListasParaEliminatoria.push({
        id: cat.id,
        nombre: cat.nombre,
      });
    }

    let estadoEliminatoria = 'SIN_ELIMINATORIA';
    if (tieneEliminatoria) {
      if (finalFinalizada) {
        estadoEliminatoria = 'FINALIZADA';
      } else if (clasificadosAsignados) {
        estadoEliminatoria = 'EN_CURSO';
      } else if (zonasFinalizadas) {
        estadoEliminatoria = 'LISTA_PARA_ASIGNAR';
      } else {
        estadoEliminatoria = 'ESPERANDO_ZONAS';
      }
    }

    categoriasInfo.push({
      id: cat.id,
      nombre: cat.nombre,
      totalZonas: cat.zonas?.length || 0,
      totalPartidosZona,
      partidosZonaFinalizados,
      zonasFinalizadas,
      tieneEliminatoria,
      primeraRondaNombre: tieneEliminatoria ? cat.fasesEliminatorias[0]?.nombre : null,
      clasificadosAsignados,
      totalPartidosEliminatoria,
      partidosEliminatoriaFinalizados,
      estadoEliminatoria,
    });
  }

  function esPartidoByeEnVivo(p) {
    return Boolean(p.esBye);
  }

  // Clasificar partidos
  const partidosEnCursoList = [];
  const partidosEnCanchaFantasmaList = [];
  const proximosPartidosList = [];
  const partidosFinalizadosList = [];

  let finalizadosCount = 0;
  let enCursoCount = 0;
  let pendientesConHorarioCount = 0;
  let pendientesSinHorarioCount = 0;

  for (const p of partidos) {
    if (esPartidoByeEnVivo(p)) {
      continue;
    }

    const p1Nombre = formatPareja(p.pareja1, p.origenPareja1);
    const p2Nombre = formatPareja(p.pareja2, p.origenPareja2);
    const formatted = {
      id: p.id,
      categoriaId: p.categoriaId,
      categoria: p.categoria?.nombre || '',
      zonaId: p.zonaId,
      zona: p.zona?.nombre || null,
      faseEliminatoriaId: p.faseEliminatoriaId,
      fase: p.faseEliminatoria?.nombre || null,
      pareja1Id: p.pareja1Id,
      pareja1: p1Nombre,
      // Objeto raw para ResultadoModal (espera { jugador1, jugador2 })
      pareja1Obj: p.pareja1 || null,
      pareja2Id: p.pareja2Id,
      pareja2: p2Nombre,
      pareja2Obj: p.pareja2 || null,
      fechaHora: p.fechaHora,
      canchaNumero: p.canchaNumero,
      sinHorarioAsignado: p.sinHorarioAsignado,
      estado: p.estado,
      sets: p.sets || [],
      // Minutos que el partido termina después del cierre del club (Modo Lluvia). Solo admin, nunca en la vista pública.
      minutosDespuesDelCierre: p.fechaHora ? minutosDespuesDelCierre(p.fechaHora, organizador) : 0,
    };

    if (p.estado === 'FINALIZADO') {
      finalizadosCount++;
      partidosFinalizadosList.push({
        ...formatted,
        ganadorId: p.ganadorId,
        ganador: p.ganador ? `${p.ganador.jugador1} / ${p.ganador.jugador2}` : null,
      });
    } else if (p.estado === 'EN_CURSO') {
      enCursoCount++;
      const horaInicio = p.fechaHora || new Date();
      const horaEstimadaFin = new Date(new Date(horaInicio).getTime() + DURACION_MS);
      const enCursoObj = {
        ...formatted,
        horaInicio,
        horaEstimadaFin,
      };
      partidosEnCursoList.push(enCursoObj);
    } else if (p.estado === 'PENDIENTE') {
      if (p.sinHorarioAsignado || (!p.faseEliminatoriaId && !p.fechaHora)) {
        pendientesSinHorarioCount++;
      } else if (p.fechaHora) {
        pendientesConHorarioCount++;
        // Verificar si quedó en cancha fantasma (cancha > canchasActivas del día respectivo)
        const partidoDiaKey = p.fechaHora
          ? getDiaCalendarioConTrasnoche(p.fechaHora, horariosClubObj)?.key
          : null;
        const diaPartidoOverride = partidoDiaKey ? canchasOverridesService.getCanchasDia(torneoId, partidoDiaKey, canchasClub) : null;
        const canchasMaxDia = diaPartidoOverride ? diaPartidoOverride.canchas : canchasClub;
        const esDelDiaLluvia = diaPartidoOverride ? diaPartidoOverride.isLluvia : false;

        if (p.canchaNumero && p.canchaNumero > canchasMaxDia && esDelDiaLluvia) {
          let motivo = 'Cancha inhabilitada por modo lluvia';
          if (
            p.estado === 'PENDIENTE' &&
            p.canchaNumero > canchasMaxDia &&
            diaPartidoOverride?.partidosSinSlot &&
            diaPartidoOverride.partidosSinSlot[p.id]
          ) {
            motivo = diaPartidoOverride.partidosSinSlot[p.id];
          } else if (
            p.fechaHora &&
            diaPartidoOverride?.activoDesde &&
            new Date(p.fechaHora).getTime() < new Date(diaPartidoOverride.activoDesde).getTime()
          ) {
            // Se compara con la activación de la lluvia de la jornada del partido, no con la última aplicada
            motivo = 'Horario anterior a la activación del modo lluvia';
          } else if (!p.pareja1Id || !p.pareja2Id) {
            motivo = 'Parejas aún no definidas (clasificados de zona)';
          }

          partidosEnCanchaFantasmaList.push({
            ...formatted,
            motivo,
          });
        } else {
          proximosPartidosList.push(formatted);
        }
      }
    }
  }

  // Construir mapa de canchas independientes por jornada (canchasPorDia)
  const overridesTorneo = canchasOverridesService.getOverridesTorneo(torneoId);
  const canchasPorDia = {};

  // 1. Cargar días canónicos a partir de torneo.fecha (Viernes, Sábado, Domingo)
  if (torneo.fecha) {
    const refFecha = new Date(torneo.fecha);
    if (!isNaN(refFecha.getTime())) {
      for (let i = 0; i < 3; i++) {
        const d = new Date(refFecha.getTime() + i * 24 * 3600 * 1000);
        const info = getDiaCalendarioConTrasnoche(d, horariosClubObj);
        if (info && !canchasPorDia[info.key]) {
          const ov = overridesTorneo[info.key];
          canchasPorDia[info.key] = {
            canchas: ov && ov.canchas ? Number(ov.canchas) : canchasClub,
            isLluvia: Boolean(ov && ov.isLluvia),
            activoDesde: ov ? ov.activoDesde : null,
          };
        }
      }
    }
  }

  // 2. Incluir cualquier día que tenga override explícito en JSON
  for (const [diaK, ov] of Object.entries(overridesTorneo)) {
    if (!canchasPorDia[diaK]) {
      canchasPorDia[diaK] = {
        canchas: ov && ov.canchas ? Number(ov.canchas) : canchasClub,
        isLluvia: Boolean(ov && ov.isLluvia),
        activoDesde: ov ? ov.activoDesde : null,
      };
    }
  }

  // 3. Incluir días con partidos existentes
  for (const p of partidos) {
    if (p.fechaHora) {
      const info = getDiaCalendarioConTrasnoche(p.fechaHora, horariosClubObj);
      if (info && !canchasPorDia[info.key]) {
        const ov = overridesTorneo[info.key];
        canchasPorDia[info.key] = {
          canchas: ov && ov.canchas ? Number(ov.canchas) : canchasClub,
          isLluvia: Boolean(ov && ov.isLluvia),
          activoDesde: ov ? ov.activoDesde : null,
        };
      }
    }
  }

  return {
    torneo: {
      id: torneo.id,
      nombre: torneo.nombre,
      fecha: torneo.fecha,
      estado: torneo.estado,
      slug: torneo.slug,
      canchasClub,
      horariosClub: {
        viernesInicio: organizador.viernesInicio,
        viernesFin: organizador.viernesFin,
        sabadoInicio: organizador.sabadoInicio,
        sabadoFin: organizador.sabadoFin,
        domingoInicio: organizador.domingoInicio,
        domingoFin: organizador.domingoFin,
      },
    },
    canchasClub,
    // Canchas de cada jornada (OverrideCanchasDia): la única fuente de las canchas activas por día
    canchasPorDia,
    partidosEnCurso: partidosEnCursoList,
    partidosEnCanchaFantasma: partidosEnCanchaFantasmaList,
    proximosPartidos: proximosPartidosList,
    categoriasListasParaEliminatoria,
    categorias: categoriasInfo,
    // Ordenados más reciente primero para que el último resultado cargado aparezca arriba
    partidosFinalizados: [...partidosFinalizadosList].sort((a, b) => {
      const tA = a.fechaHora ? new Date(a.fechaHora).getTime() : 0;
      const tB = b.fechaHora ? new Date(b.fechaHora).getTime() : 0;
      return tB - tA;
    }),
    resumenEstado: {
      totalPartidos: partidos.filter((p) => !esPartidoByeEnVivo(p)).length,
      finalizados: finalizadosCount,
      enCurso: enCursoCount,
      pendientesConHorario: pendientesConHorarioCount,
      pendientesSinHorario: pendientesSinHorarioCount,
      enCanchaFantasma: partidosEnCanchaFantasmaList.length,
    },
  };
}

/**
 * Reprograma automáticamente los partidos pendientes ante una reducción de canchas activas (Modo Lluvia).
 */
async function reprogramarPorReduccionCanchas(organizadorId, torneoId, nuevoCanchasOverride, mockTimestamp = null, diaKey = null) {
  const torneo = await prisma.torneo.findUnique({
    where: { id: torneoId },
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

  if (torneo.estado !== 'EN_CURSO') {
    const error = new Error('El modo Día de Torneo solo está disponible para torneos en curso.');
    error.statusCode = 400;
    throw error;
  }

  const organizador = await getOrganizador(organizadorId);
  const canchasClub = organizador.cantidadCanchas || 1;

  const overrideNum = (nuevoCanchasOverride === null || nuevoCanchasOverride === undefined)
    ? canchasClub
    : Number(nuevoCanchasOverride);

  if (isNaN(overrideNum) || overrideNum < 1) {
    const error = new Error('La cantidad de canchas activas debe ser un número mayor o igual a 1.');
    error.statusCode = 400;
    throw error;
  }

  if (overrideNum > canchasClub) {
    const error = new Error(`La cantidad de canchas activas (${overrideNum}) no puede superar el total del club (${canchasClub}).`);
    error.statusCode = 400;
    throw error;
  }

  const esRestauracion = overrideNum === canchasClub;

  const horariosClubObj = {
    viernesInicio: organizador.viernesInicio,
    viernesFin: organizador.viernesFin,
    sabadoInicio: organizador.sabadoInicio,
    sabadoFin: organizador.sabadoFin,
    domingoInicio: organizador.domingoInicio,
    domingoFin: organizador.domingoFin,
  };

  // Jornada de la operación: diaKey si viene; si no, la jornada lógica de mockTimestamp (solo tests).
  // Tiene que ser una de las tres jornadas del torneo. Sin ninguna de las dos, una reducción se rechaza y
  // una restauración restaura todas las jornadas. Todo se valida antes de cualquier escritura en la base
  // o en la caché.
  let diaKeyJornada = null;
  if (diaKey !== null && diaKey !== undefined) {
    diaKeyJornada = diaKey;
  } else if (mockTimestamp) {
    diaKeyJornada = getDiaCalendarioConTrasnoche(mockTimestamp, horariosClubObj)?.key || '';
  }
  if (diaKeyJornada !== null) {
    const clavesTorneo = clavesJornadasTorneo(requireTorneoFecha(torneo));
    if (typeof diaKeyJornada !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(diaKeyJornada) || !clavesTorneo.includes(diaKeyJornada)) {
      const error = new Error('Jornada inválida.');
      error.statusCode = 400;
      throw error;
    }
  } else if (!esRestauracion) {
    const error = new Error('Indicá la jornada.');
    error.statusCode = 400;
    throw error;
  }

  // Momento de activación que se guarda en el override: mockTimestamp en tests; si no, el mediodía de la jornada.
  let timestampOverride;
  if (mockTimestamp) {
    timestampOverride = new Date(mockTimestamp);
  } else if (diaKeyJornada) {
    timestampOverride = parseFechaLocal(diaKeyJornada);
  } else if (torneo.fecha) {
    timestampOverride = parseFechaLocal(torneo.fecha);
  } else {
    timestampOverride = new Date();
  }

  // Día lógico de la operación. Restaurar todo (sin jornada) no tiene un día propio: recorre cada override.
  const diaOverrideTs = diaKey ? parseFechaLocal(diaKey) : (diaKeyJornada ? timestampOverride : null);

  const overrideDiaInfo = getDiaCalendarioConTrasnoche(diaOverrideTs, horariosClubObj);
  const overrideDiaKey = overrideDiaInfo?.key || null;

  const DIAS_MAP = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const diaNombre = overrideDiaInfo?.logicalDate
    ? DIAS_MAP[overrideDiaInfo.logicalDate.getDay()]
    : null;

  const canchasActualesDia = overrideDiaKey
    ? canchasOverridesService.getCanchasDia(torneoId, overrideDiaKey, canchasClub).canchas
    : canchasClub;

  const allOverridesMap = canchasOverridesService.getOverridesTorneo(torneoId);
  const hasActiveOverrides = allOverridesMap && Object.keys(allOverridesMap).length > 0;

  // 2. Si no hay cambio en la cantidad de canchas activas para esta jornada específica, no hacer nada.
  // En restauración sin jornada, solo retornar temprano si ya NO quedan overrides activos en el torneo.
  if (esRestauracion && !diaKeyJornada) {
    if (!hasActiveOverrides && overrideNum === canchasClub) {
      return {
        message: `El torneo ya cuenta con todas las canchas (${canchasClub}) activas.`,
        canchasActivas: canchasClub,
        overrideActivoDesde: null,
        reprogramacion: { ejecutada: false },
      };
    }
  } else if (overrideNum === canchasActualesDia) {
    // La jornada ya tiene esa cantidad de canchas: no se reprograma (sin mirar cuál fue la última lluvia)
    return {
      message: `La cantidad de canchas activas para ${diaNombre || 'la jornada'} ya es ${overrideNum}.`,
      canchasActivas: overrideNum,
      overrideActivoDesde: overrideDiaKey ? canchasOverridesService.getCanchasDia(torneoId, overrideDiaKey, canchasClub).activoDesde : null,
      reprogramacion: { ejecutada: false },
    };
  }

  // 3. Caso: Reducción de canchas -> Validar que no haya partidos EN_CURSO en canchas a inhabilitar en la jornada afectada
  if (overrideNum < canchasClub) {
    const partidosEnCursoAfectadosRaw = await prisma.partido.findMany({
      where: {
        categoria: { torneoId },
        estado: 'EN_CURSO',
        canchaNumero: { gt: overrideNum },
      },
      include: {
        pareja1: { select: { jugador1: true, jugador2: true } },
        pareja2: { select: { jugador1: true, jugador2: true } },
      },
    });

    const partidosEnCursoAfectados = partidosEnCursoAfectadosRaw.filter((p) => {
      if (!overrideDiaKey || !p.fechaHora) return true;
      const pDiaKey = getDiaCalendarioConTrasnoche(p.fechaHora, horariosClubObj)?.key;
      return pDiaKey === overrideDiaKey;
    });

    if (partidosEnCursoAfectados.length > 0) {
      const p = partidosEnCursoAfectados[0];
      const p1 = p.pareja1 ? `${p.pareja1.jugador1}/${p.pareja1.jugador2}` : 'P1';
      const p2 = p.pareja2 ? `${p.pareja2.jugador1}/${p.pareja2.jugador2}` : 'P2';
      const error = new Error(
        `No podés reducir a ${overrideNum} canchas porque hay un partido en curso en la Cancha ${p.canchaNumero} (${p1} vs ${p2}). Esperá a que termine o finalizalo antes de reducir.`
      );
      error.statusCode = 400;
      throw error;
    }
  }

  // 4. Determinar si la jornada afectada es Domingo (eliminatorias/playoffs) o Viernes/Sábado (fase de zonas)
  const esDomingo = overrideDiaInfo?.logicalDate
    ? overrideDiaInfo.logicalDate.getDay() === 0
    : false;

  // Ejecutar scheduler y actualización de torneo en una ÚNICA transacción atómica.
  // Si cualquiera de las dos operaciones falla, todo hace rollback sin dejar estados inconsistentes.
  const { res: mcfRes, pendingMutations } = await prisma.$transaction(async (tx) => {
    let res;

    if (esRestauracion && !diaKeyJornada) {
      // Restauración global multi-día sin jornada:
      // Consultar todos los overrides activos del torneo en DB ordenados cronológicamente
      const activeOverrides = await tx.overrideCanchasDia.findMany({
        where: { torneoId },
        orderBy: { diaKey: 'asc' },
      });

      if (activeOverrides.length > 0) {
        let totalReprogramados = 0;
        let totalSinCambio = 0;
        let totalSinHorarioNuevo = 0;
        const allCambios = [];
        const allPartidosSinSlot = {};

        for (const ov of activeOverrides) {
          const diaTs = parseFechaLocal(ov.diaKey);
          const ovDiaInfo = getDiaCalendarioConTrasnoche(diaTs, horariosClubObj);
          const ovEsDomingo = ovDiaInfo?.logicalDate
            ? ovDiaInfo.logicalDate.getDay() === 0
            : false;

          let dayRes;
          if (ovEsDomingo) {
            const schedRes = await programarHorariosEliminatorias(
              organizadorId,
              torneoId,
              null,
              tx,
              canchasClub,
              { soloDomingo: true }
            );
            dayRes = {
              partidosReprogramados: schedRes.cambios ? schedRes.cambios.length : schedRes.partidosAgendados,
              partidosSinCambio: schedRes.total - (schedRes.cambios ? schedRes.cambios.length : 0),
              partidosSinHorarioNuevo: schedRes.partidosSinHorario,
              cambios: schedRes.cambios || [],
            };
          } else {
            dayRes = await asignarHorariosModoLluviaMCF(
              organizadorId,
              torneoId,
              canchasClub,
              tx,
              diaTs
            );
          }

          totalReprogramados += dayRes?.partidosReprogramados || 0;
          totalSinCambio += dayRes?.partidosSinCambio || 0;
          totalSinHorarioNuevo += dayRes?.partidosSinHorarioNuevo || 0;
          if (dayRes?.cambios) allCambios.push(...dayRes.cambios);
          if (dayRes?.partidosSinSlot) Object.assign(allPartidosSinSlot, dayRes.partidosSinSlot);
        }

        res = {
          partidosReprogramados: totalReprogramados,
          partidosSinCambio: totalSinCambio,
          partidosSinHorarioNuevo: totalSinHorarioNuevo,
          cambios: allCambios,
          partidosSinSlot: allPartidosSinSlot,
        };
      } else {
        res = await asignarHorariosModoLluviaMCF(
          organizadorId,
          torneoId,
          overrideNum,
          tx,
          diaOverrideTs
        );
      }
    } else if (esDomingo) {
      // En Domingo todas las fases son eliminatorias/playoffs.
      // Delegamos en programarHorariosEliminatorias con las canchas reducidas y descansos reales.
      const schedRes = await programarHorariosEliminatorias(
        organizadorId,
        torneoId,
        null,
        tx,
        overrideNum,
        { soloDomingo: true }
      );
      res = {
        partidosReprogramados: schedRes.cambios ? schedRes.cambios.length : schedRes.partidosAgendados,
        partidosSinCambio: schedRes.total - (schedRes.cambios ? schedRes.cambios.length : 0),
        partidosSinHorarioNuevo: schedRes.partidosSinHorario,
        cambios: schedRes.cambios || [],
        // Padres sin turno antes de un hijo finalizado o en juego (techo de la cadena)
        partidosSinSlot: schedRes.partidosSinSlot || {},
      };
    } else {
      // Viernes o Sábado (zonas): ejecutar el Scheduler Continuo MCF dentro de tx (scopeado al día lógico)
      res = await asignarHorariosModoLluviaMCF(
        organizadorId,
        torneoId,
        overrideNum,
        tx,             // externalTx: operaciones sobre db.partido dentro de tx
        diaOverrideTs   // overrideTimestamp para scopear al día lógico correspondiente
      );
    }

    // Actualizar override independiente por día en DB dentro de tx
    // NOTA: La caché en memoria NO se muta dentro de la transacción.
    const mutations = [];
    if (esRestauracion) {
      if (diaKeyJornada) {
        const m1 = await canchasOverridesService.removeOverrideDia(torneoId, overrideDiaKey || diaKeyJornada, tx);
        if (m1) mutations.push(m1);
        if (overrideDiaKey && overrideDiaKey !== diaKeyJornada) {
          const m2 = await canchasOverridesService.removeOverrideDia(torneoId, overrideDiaKey, tx);
          if (m2) mutations.push(m2);
        }
      } else {
        const m = await canchasOverridesService.clearOverridesTorneo(torneoId, tx);
        if (m) mutations.push(m);
      }
    } else if (overrideDiaKey) {
      const m = await canchasOverridesService.setOverrideDia(
        torneoId,
        overrideDiaKey,
        overrideNum,
        timestampOverride,
        res?.partidosSinSlot || {},
        tx
      );
      if (m) mutations.push(m);
    }

    // Sincronizar estado en Torneo dentro de la misma tx (retrocompatibilidad)
    if (esRestauracion) {
      const remainingOverrides = await tx.overrideCanchasDia.findMany({
        where: { torneoId, isLluvia: true },
        orderBy: { activoDesde: 'asc' },
      });
      const latestRemaining = remainingOverrides.length > 0 ? remainingOverrides[remainingOverrides.length - 1] : null;
      await tx.torneo.update({
        where: { id: torneoId },
        data: {
          canchasDisponiblesOverride: latestRemaining ? latestRemaining.canchas : null,
          overrideActivoDesde: latestRemaining ? new Date(latestRemaining.activoDesde) : null,
        },
      });
    } else {
      await tx.torneo.update({
        where: { id: torneoId },
        data: {
          canchasDisponiblesOverride: overrideNum,
          overrideActivoDesde: timestampOverride,
        },
      });
    }

    return { res, pendingMutations: mutations };
  }, { timeout: 20000, maxWait: 5000 });

  // POST-COMMIT: Aplicar mutaciones pendientes a la memoria caché de forma centralizada
  for (const m of pendingMutations || []) {
    canchasOverridesService.applyCacheMutation(m.action, m.payload);
  }

  const message = esRestauracion
    ? `Todas las canchas (${canchasClub}) fueron restauradas para ${diaNombre || (diaKeyJornada ? 'la jornada' : 'todas las jornadas')}. Se reprogramaron ${mcfRes.partidosReprogramados} partidos.`
    : `Canchas reducidas a ${overrideNum} para ${diaNombre || 'la jornada'}. Se reprogramaron ${mcfRes.partidosReprogramados} partidos.`;

  return {
    message,
    canchasActivas: overrideNum,
    overrideActivoDesde: esRestauracion ? null : timestampOverride.toISOString(),
    reprogramacion: {
      ejecutada: true,
      overrideDiaKey,
      diaNombre,
      partidosReprogramados: mcfRes.partidosReprogramados,
      partidosSinCambio: mcfRes.partidosSinCambio,
      partidosSinHorarioNuevo: mcfRes.partidosSinHorarioNuevo,
      cambios: mcfRes.cambios || [],
    },
  };
}

module.exports = {
  getOrganizador,
  updateOrganizador,
  simularCambioJornadaOrganizador,
  getSlotsGrilla,
  preCheckInicioTorneo,
  iniciarTorneoMultiCategoria,
  getPartidosSinHorarioTorneo,
  getCanchasDisponiblesTorneo,
  getEstadoEnVivo,
  reprogramarPorReduccionCanchas,
  preCheckSessions,
  planesCache,
};
