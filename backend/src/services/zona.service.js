const prisma = require('../lib/prisma');
const { getTorneoById } = require('./torneo.service');
const { calcularCompatibilidad, horaAMinutos, DURACION_PARTIDO_MIN } = require('./slots.service');

// Fisher-Yates shuffle
function shuffleArray(array) {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

/**
 * Función auxiliar para generar partidos de una zona
 */
async function generarPartidosZonaHelper(tx, torneoId, zonaId, formato, size, parejasEnEstaZona) {
  if (formato === 'ROUND_ROBIN') {
    if (size === 2) {
      await tx.partido.create({
        data: {
          torneoId,
          zonaId,
          pareja1Id: parejasEnEstaZona[0].id,
          pareja2Id: parejasEnEstaZona[1].id,
          posicionEnRonda: 1,
        },
      });
    } else if (size === 3) {
      const enfrentamientos = [[0, 1], [0, 2], [1, 2]];
      for (let k = 0; k < enfrentamientos.length; k++) {
        const [p1Idx, p2Idx] = enfrentamientos[k];
        await tx.partido.create({
          data: {
            torneoId,
            zonaId,
            pareja1Id: parejasEnEstaZona[p1Idx].id,
            pareja2Id: parejasEnEstaZona[p2Idx].id,
            posicionEnRonda: k + 1,
          },
        });
      }
    } else if (size === 4) {
      const enfrentamientos = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
      for (let k = 0; k < enfrentamientos.length; k++) {
        const [p1Idx, p2Idx] = enfrentamientos[k];
        await tx.partido.create({
          data: {
            torneoId,
            zonaId,
            pareja1Id: parejasEnEstaZona[p1Idx].id,
            pareja2Id: parejasEnEstaZona[p2Idx].id,
            posicionEnRonda: k + 1,
          },
        });
      }
    }
  } else if (formato === 'MINI_BRACKET') {
    await tx.partido.create({
      data: {
        torneoId,
        zonaId,
        pareja1Id: parejasEnEstaZona[0].id,
        pareja2Id: parejasEnEstaZona[1].id,
        posicionEnRonda: 1,
      },
    });
    await tx.partido.create({
      data: {
        torneoId,
        zonaId,
        pareja1Id: parejasEnEstaZona[2].id,
        pareja2Id: parejasEnEstaZona[3].id,
        posicionEnRonda: 2,
      },
    });
    await tx.partido.create({
      data: { torneoId, zonaId, posicionEnRonda: 3 },
    });
    await tx.partido.create({
      data: { torneoId, zonaId, posicionEnRonda: 4 },
    });
  }
}

/**
 * Lógica de inicio de torneo y generación de zonas (Sorteo aleatorio)
 */
async function iniciarTorneo(organizadorId, torneoId, externalTx = null) {
  const db = externalTx || prisma;
  const torneo = await getTorneoById(organizadorId, torneoId, db);

  if (torneo.estado !== 'BORRADOR') {
    const error = new Error('El torneo ya fue iniciado.');
    error.statusCode = 400;
    throw error;
  }

  const parejas = await db.pareja.findMany({ where: { torneoId } });
  const numParejas = parejas.length;

  if (numParejas < 2) {
    const error = new Error('Se necesitan al menos 2 parejas para iniciar el torneo.');
    error.statusCode = 400;
    throw error;
  }

  const parejasMezcladas = shuffleArray(parejas);
  const configuracionZonas = calcularConfigZonas(numParejas);

  const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  const runOperation = async (tx) => {
    let parejaIndex = 0;

    for (let i = 0; i < configuracionZonas.length; i++) {
      const size = configuracionZonas[i];
      const nombreZona = `Zona ${letras[i] || i}`;
      const formato = size === 4 ? 'MINI_BRACKET' : 'ROUND_ROBIN';
      const clasifican = size === 4 ? 3 : 2;

      const zona = await tx.zona.create({
        data: {
          torneoId,
          nombre: nombreZona,
          clasifican,
          formato,
        },
      });

      const parejasEnEstaZona = parejasMezcladas.slice(parejaIndex, parejaIndex + size);
      parejaIndex += size;

      for (const p of parejasEnEstaZona) {
        await tx.zonaPareja.create({
          data: {
            zonaId: zona.id,
            parejaId: p.id,
          },
        });
      }

      await generarPartidosZonaHelper(tx, torneoId, zona.id, formato, size, parejasEnEstaZona);
    }

    await tx.torneo.update({
      where: { id: torneoId },
      data: { estado: 'EN_CURSO' },
    });
  };

  if (externalTx) {
    await runOperation(externalTx);
  } else {
    await prisma.$transaction(runOperation);
  }

  return { message: 'Torneo iniciado y zonas generadas.' };
}

/**
 * Calcula distribución de zonas: ej. [3,3,4] o [3,3,2]
 */
function calcularConfigZonas(numParejas) {
  const zonas3 = Math.floor(numParejas / 3);
  const resto = numParejas % 3;

  let configuracionZonas = Array(zonas3).fill(3);
  if (resto === 1) {
    if (zonas3 > 0) {
      configuracionZonas[0] = 4;
    }
  } else if (resto === 2) {
    configuracionZonas.push(2);
  }
  return configuracionZonas;
}

/**
 * Arma grupos de parejas maximizando compatibilidad por slots discretos.
 * Greedy con backtracking acotado (máx 5000 iteraciones).
 */
function armarGruposPorCompatibilidad(parejas, configZonas, matriz) {
  const n = parejas.length;
  const asignado = new Array(n).fill(false);
  const grupos = [];

  const compatibilidad = parejas.map((_, i) => {
    let count = 0;
    for (let j = 0; j < n; j++) {
      if (i !== j && matriz[i][j] > 0) count++;
    }
    return count;
  });

  for (const size of configZonas) {
    const libres = [];
    for (let i = 0; i < n; i++) {
      if (!asignado[i]) libres.push(i);
    }

    const candidatos = [...libres].sort((a, b) => compatibilidad[a] - compatibilidad[b]);
    const grupo = intentarArmarGrupo(candidatos, size, asignado, matriz);

    if (grupo !== null) {
      grupo.forEach((idx) => (asignado[idx] = true));
      grupos.push(grupo);
    }
  }

  const sinGrupo = [];
  for (let i = 0; i < n; i++) {
    if (!asignado[i]) sinGrupo.push(i);
  }

  return { grupos, sinGrupo };
}

function intentarArmarGrupo(candidatos, size, asignado, matriz) {
  const MAX_ITER = 5000;
  let iteraciones = 0;

  function backtrack(inicio, grupoActual) {
    iteraciones++;
    if (iteraciones > MAX_ITER) return null;

    if (grupoActual.length === size) {
      return [...grupoActual];
    }

    for (let i = inicio; i < candidatos.length; i++) {
      const idx = candidatos[i];
      if (asignado[idx]) continue;

      let compatible = true;
      for (const prev of grupoActual) {
        if (matriz[idx][prev] === 0) {
          compatible = false;
          break;
        }
      }
      if (!compatible) continue;

      grupoActual.push(idx);
      const res = backtrack(i + 1, grupoActual);
      if (res !== null) return res;
      grupoActual.pop();

      if (iteraciones > MAX_ITER) return null;
    }

    return null;
  }

  const candidatosOrdenados = [...candidatos].sort((a, b) => {
    const scoreA = candidatos.reduce((acc, c) => acc + matriz[a][c], 0);
    const scoreB = candidatos.reduce((acc, c) => acc + matriz[b][c], 0);
    return scoreB - scoreA;
  });

  return backtrack(0, []);
}

/**
 * Iniciar torneo agrupando zonas por disponibilidad horaria
 */
async function iniciarTorneoConDisponibilidad(organizadorId, torneoId, externalTx = null) {
  const db = externalTx || prisma;
  const torneo = await getTorneoById(organizadorId, torneoId, db);

  if (torneo.estado !== 'BORRADOR') {
    const error = new Error('El torneo ya fue iniciado.');
    error.statusCode = 400;
    throw error;
  }

  const parejas = await db.pareja.findMany({
    where: { torneoId },
    include: { slotsSeleccionados: true },
  });

  const numParejas = parejas.length;
  if (numParejas < 2) {
    const error = new Error('Se necesitan al menos 2 parejas para iniciar el torneo.');
    error.statusCode = 400;
    throw error;
  }

  const conSlots = parejas.filter((p) => p.slotsSeleccionados.length > 0);
  if (conSlots.length === 0) {
    const error = new Error(
      'Ninguna pareja tiene disponibilidad horaria cargada. Usá el inicio por sorteo o cargá disponibilidad primero.'
    );
    error.statusCode = 400;
    throw error;
  }

  const n = numParejas;
  const matriz = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    const slotsA = parejas[i].slotsSeleccionados.map((s) => s.slotId);
    for (let j = i + 1; j < n; j++) {
      const slotsB = parejas[j].slotsSeleccionados.map((s) => s.slotId);
      const compat = calcularCompatibilidad(slotsA, slotsB);
      matriz[i][j] = compat;
      matriz[j][i] = compat;
    }
  }

  const configZonas = calcularConfigZonas(numParejas);
  const { grupos, sinGrupo } = armarGruposPorCompatibilidad(parejas, configZonas, matriz);

  const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const resumenZonasCreadas = [];
  const resumenZonasManual = [];

  const runOperation = async (tx) => {
    let letraIndex = 0;

    for (const grupo of grupos) {
      const size = grupo.length;
      const nombreZona = `Zona ${letras[letraIndex] || letraIndex}`;
      const formato = size === 4 ? 'MINI_BRACKET' : 'ROUND_ROBIN';
      const clasifican = size === 4 ? 3 : 2;

      const zona = await tx.zona.create({
        data: { torneoId, nombre: nombreZona, clasifican, formato },
      });

      const parejasEnZona = grupo.map((idx) => parejas[idx]);

      for (const p of parejasEnZona) {
        await tx.zonaPareja.create({ data: { zonaId: zona.id, parejaId: p.id } });
      }

      await generarPartidosZonaHelper(tx, torneoId, zona.id, formato, size, parejasEnZona);

      resumenZonasCreadas.push({
        nombre: nombreZona,
        parejas: parejasEnZona.map((p) => ({ id: p.id, jugador1: p.jugador1, jugador2: p.jugador2 })),
      });

      letraIndex++;
    }

    if (sinGrupo.length > 0) {
      const nombreZona = `Zona ${letras[letraIndex] || letraIndex}`;
      letraIndex++;

      await tx.zona.create({
        data: {
          torneoId,
          nombre: nombreZona,
          clasifican: 2,
          formato: 'ROUND_ROBIN',
          requiereArmadoManual: true,
        },
      });

      const parejasSinGrupo = sinGrupo.map((idx) => ({
        id: parejas[idx].id,
        jugador1: parejas[idx].jugador1,
        jugador2: parejas[idx].jugador2,
      }));

      resumenZonasManual.push({
        nombre: nombreZona,
        parejas: parejasSinGrupo,
      });
    }

    await tx.torneo.update({
      where: { id: torneoId },
      data: { estado: 'EN_CURSO' },
    });
  };

  if (externalTx) {
    await runOperation(externalTx);
  } else {
    await prisma.$transaction(runOperation);
  }

  return {
    message: 'Torneo iniciado por disponibilidad horaria.',
    zonasCreadas: resumenZonasCreadas,
    zonasManual: resumenZonasManual,
    parejasSinDisponibilidad: parejas
      .filter((p) => p.slotsSeleccionados.length === 0)
      .map((p) => ({ id: p.id, jugador1: p.jugador1, jugador2: p.jugador2 })),
  };
}

/**
 * Calcula la próxima fecha de un día ("Viernes" o "Sabado") a partir de una fecha base
 */
function proximaFechaPorDia(dia, fechaBase = new Date()) {
  const targetDia = dia === 'Viernes' ? 5 : 6;
  const hoy = new Date(fechaBase);
  const diaSemana = hoy.getDay();
  let diff = targetDia - diaSemana;
  if (diff < 0) diff += 7;
  const fecha = new Date(hoy);
  fecha.setDate(hoy.getDate() + diff);
  fecha.setHours(0, 0, 0, 0);
  return fecha;
}

/**
 * Convierte un slotId ("Viernes-18:00") a un intervalo { startMs, endMs, dia }
 */
function slotIdToInterval(slotId, baseFriday, baseSaturday, organizador) {
  const [dia, horaStr] = slotId.split('-');
  const [h, m] = horaStr.split(':').map(Number);
  const slotMin = h * 60 + m;
  const isFriday = dia === 'Viernes';
  const baseDate = isFriday ? baseFriday : baseSaturday;
  const horaInicioJornada = isFriday ? organizador.viernesInicio : organizador.sabadoInicio;
  const jornadaInicioMin = horaAMinutos(horaInicioJornada);

  let effectiveMin = slotMin;
  if (slotMin < jornadaInicioMin) {
    // Madrugada del día siguiente (+24hs)
    effectiveMin += 24 * 60;
  }

  const startMs = baseDate.getTime() + effectiveMin * 60 * 1000;
  const endMs = startMs + DURACION_PARTIDO_MIN * 60 * 1000;
  return { startMs, endMs, dia };
}

/**
 * Fusiona slots contiguos/solapados de una pareja en ventanas continuas
 */
function buildAvailabilityWindows(slotIds, baseFriday, baseSaturday, organizador) {
  if (!slotIds || slotIds.length === 0) return [];
  const intervals = slotIds.map((s) => slotIdToInterval(s, baseFriday, baseSaturday, organizador));
  intervals.sort((a, b) => a.startMs - b.startMs);

  const merged = [];
  for (const interval of intervals) {
    if (merged.length === 0) {
      merged.push({ startMs: interval.startMs, endMs: interval.endMs, dia: interval.dia });
    } else {
      const last = merged[merged.length - 1];
      if (interval.startMs <= last.endMs) {
        last.endMs = Math.max(last.endMs, interval.endMs);
      } else {
        merged.push({ startMs: interval.startMs, endMs: interval.endMs, dia: interval.dia });
      }
    }
  }
  return merged;
}

/**
 * Intersección de dos arrays de ventanas de disponibilidad ordenadas
 */
function intersectWindows(windowsA, windowsB) {
  const result = [];
  let i = 0;
  let j = 0;
  while (i < windowsA.length && j < windowsB.length) {
    const a = windowsA[i];
    const b = windowsB[j];
    const start = Math.max(a.startMs, b.startMs);
    const end = Math.min(a.endMs, b.endMs);
    if (start < end) {
      result.push({ startMs: start, endMs: end });
    }
    if (a.endMs < b.endMs) {
      i++;
    } else {
      j++;
    }
  }
  return result;
}

/**
 * Computa huecos libres de duración >= minDuracionMs en una cancha
 */
function computeFreeGaps(occupiedIntervals, dayStartMs, dayEndMs, minDuracionMs) {
  const gaps = [];
  let currentStart = dayStartMs;

  const relevant = (occupiedIntervals || [])
    .filter((inv) => inv.endMs > dayStartMs && inv.startMs < dayEndMs)
    .sort((a, b) => a.startMs - b.startMs);

  for (const inv of relevant) {
    const occStart = Math.max(inv.startMs, dayStartMs);
    const occEnd = Math.min(inv.endMs, dayEndMs);

    if (occStart > currentStart) {
      if (occStart - currentStart >= minDuracionMs) {
        gaps.push({ startMs: currentStart, endMs: occStart });
      }
    }
    currentStart = Math.max(currentStart, occEnd);
  }

  if (dayEndMs - currentStart >= minDuracionMs) {
    gaps.push({ startMs: currentStart, endMs: dayEndMs });
  }

  return gaps;
}

/**
 * Redondea timestampMs al próximo múltiplo de 15 min respecto a baseDateMs
 */
function ceilTo15Min(timestampMs, baseDateMs) {
  const offsetMin = (timestampMs - baseDateMs) / (60 * 1000);
  const ceiledMin = Math.ceil(offsetMin / 15) * 15;
  return baseDateMs + ceiledMin * 60 * 1000;
}

/**
 * Verifica si una pareja ya tiene un partido asignado en colisión con [startMs, endMs]
 */
function parejaTieneColision(parejaAssignments, parejaId, startMs, endMs) {
  if (!parejaId) return false;
  const assignments = parejaAssignments.get(parejaId);
  if (!assignments || assignments.length === 0) return false;
  return assignments.some((a) => a.startMs < endMs && a.endMs > startMs);
}

/**
 * Busca el horario de inicio más temprano (en grilla de 15 min) para una cancha
 */
function findEarliestSlotForCourt(
  freeGaps,
  sharedWindows,
  parejaAssignments,
  p1Id,
  p2Id,
  durMs,
  baseFriday,
  baseSaturday
) {
  let earliestT = null;
  const saturdayStartMs = baseSaturday.getTime();

  for (const gap of freeGaps) {
    for (const win of sharedWindows) {
      const overlapStart = Math.max(gap.startMs, win.startMs);
      const overlapEnd = Math.min(gap.endMs, win.endMs);
      if (overlapEnd - overlapStart < durMs) continue;

      const isFriday = overlapStart < saturdayStartMs;
      const baseDateMs = isFriday ? baseFriday.getTime() : baseSaturday.getTime();

      let T = ceilTo15Min(overlapStart, baseDateMs);
      while (T + durMs <= overlapEnd) {
        if (
          !parejaTieneColision(parejaAssignments, p1Id, T, T + durMs) &&
          !parejaTieneColision(parejaAssignments, p2Id, T, T + durMs)
        ) {
          if (earliestT === null || T < earliestT) {
            earliestT = T;
          }
          break; // Primer T válido para este par (gap, win)
        }
        T += 15 * 60 * 1000;
      }
    }
  }
  return earliestT;
}

/**
 * Asigna automáticamente horarios y canchas a los partidos de zonas con línea de tiempo continua e independiente por cancha,
 * respetando las canchas compartidas de TODO el club (cross-tournament y cruces con horario fijado en este torneo).
 */
async function asignarHorariosAutomatico(organizadorId, torneoId, externalTx = null) {
  const db = externalTx || prisma;
  const torneo = await getTorneoById(organizadorId, torneoId, db);

  if (torneo.estado === 'BORRADOR') {
    const error = new Error('El torneo está en borrador. Iniciá el torneo primero.');
    error.statusCode = 400;
    throw error;
  }

  const organizador = await db.organizador.findUnique({
    where: { id: organizadorId },
  });

  const cantidadCanchas = Math.max(1, organizador?.cantidadCanchas || 1);
  const DURACION_MS = DURACION_PARTIDO_MIN * 60 * 1000;

  // 1. Cargar todos los partidos ya agendados de TODO el club (otros torneos y cruces con horario fijado en este torneo)
  const partidosYaAgendados = await db.partido.findMany({
    where: {
      torneo: { organizadorId },
      canchaNumero: { not: null },
      fechaHora: { not: null },
      sinHorarioAsignado: false,
    },
    select: {
      id: true,
      torneoId: true,
      fechaHora: true,
      canchaNumero: true,
      pareja1Id: true,
      pareja2Id: true,
    },
  });

  const yaAgendadosIds = new Set(partidosYaAgendados.map((p) => p.id));

  // 2. Inicializar timelines de cada cancha y asignaciones de parejas
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

  // 3. Cargar partidos pendientes de zonas del torneo actual
  const partidos = await db.partido.findMany({
    where: {
      torneoId,
      zonaId: { not: null },
      estado: 'PENDIENTE',
      pareja1Id: { not: null },
      pareja2Id: { not: null },
    },
    include: {
      pareja1: { include: { slotsSeleccionados: true } },
      pareja2: { include: { slotsSeleccionados: true } },
    },
  });

  // Los partidos a procesar son aquellos que NO tienen horario firme asignado
  const partidosAAsignar = partidos.filter((p) => !yaAgendadosIds.has(p.id));

  const baseFriday = proximaFechaPorDia('Viernes', torneo.fecha || new Date());
  const baseSaturday = proximaFechaPorDia('Sabado', torneo.fecha || new Date());

  // Calcular límites de jornada de club para Viernes y Sábado
  const friInicioMin = horaAMinutos(organizador.viernesInicio);
  const friFinMin = horaAMinutos(organizador.viernesFin);
  let friEffectiveFinMin = friFinMin;
  if (friEffectiveFinMin <= friInicioMin && organizador.viernesFin) {
    friEffectiveFinMin += 24 * 60;
  }
  const friDayStartMs = baseFriday.getTime() + friInicioMin * 60 * 1000;
  const friDayEndMs = baseFriday.getTime() + friEffectiveFinMin * 60 * 1000;
  const hasFriday = Boolean(organizador.viernesInicio && organizador.viernesFin && friDayEndMs > friDayStartMs);

  const satInicioMin = horaAMinutos(organizador.sabadoInicio);
  const satFinMin = horaAMinutos(organizador.sabadoFin);
  let satEffectiveFinMin = satFinMin;
  if (satEffectiveFinMin <= satInicioMin && organizador.sabadoFin) {
    satEffectiveFinMin += 24 * 60;
  }
  const satDayStartMs = baseSaturday.getTime() + satInicioMin * 60 * 1000;
  const satDayEndMs = baseSaturday.getTime() + satEffectiveFinMin * 60 * 1000;
  const hasSaturday = Boolean(organizador.sabadoInicio && organizador.sabadoFin && satDayEndMs > satDayStartMs);

  // 4. Precomputar ventanas continuas compartidas por partido
  const partidosConVentanas = partidosAAsignar.map((p) => {
    const slotsP1 = p.pareja1.slotsSeleccionados.map((s) => s.slotId);
    const slotsP2 = p.pareja2.slotsSeleccionados.map((s) => s.slotId);

    const winP1 = buildAvailabilityWindows(slotsP1, baseFriday, baseSaturday, organizador);
    const winP2 = buildAvailabilityWindows(slotsP2, baseFriday, baseSaturday, organizador);
    const sharedWindows = intersectWindows(winP1, winP2);
    const totalAvailableMs = sharedWindows.reduce((acc, w) => acc + (w.endMs - w.startMs), 0);

    return { partido: p, sharedWindows, totalAvailableMs };
  });

  // Ordenar por heurística MCF: menor tiempo disponible compartido primero
  partidosConVentanas.sort((a, b) => a.totalAvailableMs - b.totalAvailableMs);

  const updates = [];

  // 5. Asignación de partidos en timeline continuo por cancha
  for (const { partido, sharedWindows, totalAvailableMs } of partidosConVentanas) {
    if (sharedWindows.length === 0 || totalAvailableMs < DURACION_MS) {
      updates.push({ id: partido.id, sinHorarioAsignado: true, fechaHora: null, canchaNumero: null });
      continue;
    }

    let bestCandidate = null;

    for (let c = 1; c <= cantidadCanchas; c++) {
      const courtIntervals = courtTimelines.get(c) || [];
      const friGaps = hasFriday ? computeFreeGaps(courtIntervals, friDayStartMs, friDayEndMs, DURACION_MS) : [];
      const satGaps = hasSaturday ? computeFreeGaps(courtIntervals, satDayStartMs, satDayEndMs, DURACION_MS) : [];
      const courtGaps = [...friGaps, ...satGaps];

      const earliestT = findEarliestSlotForCourt(
        courtGaps,
        sharedWindows,
        parejaAssignments,
        partido.pareja1Id,
        partido.pareja2Id,
        DURACION_MS,
        baseFriday,
        baseSaturday
      );

      if (earliestT !== null) {
        if (bestCandidate === null || earliestT < bestCandidate.T) {
          bestCandidate = { T: earliestT, cancha: c };
        }
      }
    }

    if (bestCandidate !== null) {
      const fechaHora = new Date(bestCandidate.T);
      const matchEndMs = bestCandidate.T + DURACION_MS;

      // Actualizar timeline de la cancha elegida
      courtTimelines.get(bestCandidate.cancha).push({ startMs: bestCandidate.T, endMs: matchEndMs });

      // Actualizar asignaciones de las dos parejas
      if (partido.pareja1Id) {
        if (!parejaAssignments.has(partido.pareja1Id)) parejaAssignments.set(partido.pareja1Id, []);
        parejaAssignments.get(partido.pareja1Id).push({ startMs: bestCandidate.T, endMs: matchEndMs });
      }
      if (partido.pareja2Id) {
        if (!parejaAssignments.has(partido.pareja2Id)) parejaAssignments.set(partido.pareja2Id, []);
        parejaAssignments.get(partido.pareja2Id).push({ startMs: bestCandidate.T, endMs: matchEndMs });
      }

      updates.push({
        id: partido.id,
        fechaHora,
        canchaNumero: bestCandidate.cancha,
        sinHorarioAsignado: false,
      });
    } else {
      updates.push({ id: partido.id, sinHorarioAsignado: true, fechaHora: null, canchaNumero: null });
    }
  }

  // 6. Persistir en base de datos
  if (updates.length > 0) {
    if (externalTx) {
      for (const u of updates) {
        await externalTx.partido.update({
          where: { id: u.id },
          data: {
            fechaHora: u.fechaHora,
            canchaNumero: u.canchaNumero,
            sinHorarioAsignado: u.sinHorarioAsignado,
          },
        });
      }
    } else {
      await prisma.$transaction(
        updates.map((u) =>
          prisma.partido.update({
            where: { id: u.id },
            data: {
              fechaHora: u.fechaHora,
              canchaNumero: u.canchaNumero,
              sinHorarioAsignado: u.sinHorarioAsignado,
            },
          })
        )
      );
    }
  }

  const asignados = updates.filter((u) => !u.sinHorarioAsignado).length;
  const sinHorario = updates.filter((u) => u.sinHorarioAsignado).length;

  return {
    message: 'Asignación de horarios completada.',
    asignados,
    sinHorario,
    total: updates.length,
  };
}

/**
 * Limpia todos los resultados de las zonas (sets, estados de partidos y estadísticas)
 */
async function limpiarResultadosZonas(organizadorId, torneoId) {
  const torneo = await getTorneoById(organizadorId, torneoId);

  await prisma.$transaction(async (tx) => {
    const partidosZonas = await tx.partido.findMany({
      where: { torneoId, zonaId: { not: null } },
    });
    const partidoIds = partidosZonas.map((p) => p.id);

    if (partidoIds.length > 0) {
      await tx.setPartido.deleteMany({
        where: { partidoId: { in: partidoIds } },
      });

      await tx.partido.updateMany({
        where: { id: { in: partidoIds } },
        data: { estado: 'PENDIENTE', ganadorId: null },
      });

      const zonasMiniBracket = await tx.zona.findMany({
        where: { torneoId, formato: 'MINI_BRACKET' },
      });
      if (zonasMiniBracket.length > 0) {
        await tx.partido.updateMany({
          where: {
            id: { in: partidoIds },
            zonaId: { in: zonasMiniBracket.map((z) => z.id) },
            posicionEnRonda: { in: [3, 4] },
          },
          data: { pareja1Id: null, pareja2Id: null, origenPareja1: null, origenPareja2: null },
        });
      }
    }

    const zonas = await tx.zona.findMany({ where: { torneoId } });
    if (zonas.length > 0) {
      await tx.zonaPareja.updateMany({
        where: { zonaId: { in: zonas.map((z) => z.id) } },
        data: {
          pj: 0,
          pg: 0,
          pp: 0,
          sf: 0,
          sc: 0,
          gf: 0,
          gc: 0,
          puntos: 0,
        },
      });
    }

    const faseViejas = await tx.faseEliminatoria.findMany({ where: { torneoId } });
    if (faseViejas.length > 0) {
      await tx.partido.deleteMany({
        where: { faseEliminatoriaId: { in: faseViejas.map((f) => f.id) } },
      });
      await tx.faseEliminatoria.deleteMany({ where: { torneoId } });
    }
  });

  return { message: 'Resultados de zonas reseteados.' };
}

/**
 * Reestructura manualmente las zonas del torneo
 */
async function reestructurarZonas(organizadorId, torneoId, zonasPayload) {
  const torneo = await getTorneoById(organizadorId, torneoId);

  if (torneo.estado === 'BORRADOR') {
    throw new Error('El torneo está en borrador. Iniciá el torneo primero.');
  }

  await prisma.$transaction(async (tx) => {
    const fases = await tx.faseEliminatoria.findMany({ where: { torneoId } });
    if (fases.length > 0) {
      await tx.partido.deleteMany({
        where: { faseEliminatoriaId: { in: fases.map((f) => f.id) } },
      });
      await tx.faseEliminatoria.deleteMany({ where: { torneoId } });
    }

    for (const zPayload of zonasPayload) {
      const zona = await tx.zona.findUnique({ where: { id: zPayload.id } });
      if (!zona) continue;

      const size = zPayload.parejas.length;
      if (size < 2) continue;

      const formato = size === 4 ? 'MINI_BRACKET' : 'ROUND_ROBIN';
      const clasifican = size >= 4 ? 3 : 2;

      await tx.zona.update({
        where: { id: zona.id },
        data: { formato, clasifican },
      });

      const partidosViejos = await tx.partido.findMany({ where: { zonaId: zona.id } });
      if (partidosViejos.length > 0) {
        await tx.setPartido.deleteMany({ where: { partidoId: { in: partidosViejos.map((p) => p.id) } } });
        await tx.partido.deleteMany({ where: { zonaId: zona.id } });
      }

      await tx.zonaPareja.deleteMany({ where: { zonaId: zona.id } });

      const parejasEnEstaZona = [];
      for (const pId of zPayload.parejas) {
        await tx.zonaPareja.create({
          data: { zonaId: zona.id, parejaId: pId },
        });
        parejasEnEstaZona.push({ id: pId });
      }

      await generarPartidosZonaHelper(tx, torneoId, zona.id, formato, size, parejasEnEstaZona);
    }
  });

  return { message: 'Zonas reestructuradas correctamente.' };
}

module.exports = {
  iniciarTorneo,
  limpiarResultadosZonas,
  reestructurarZonas,
  iniciarTorneoConDisponibilidad,
  asignarHorariosAutomatico,
};
