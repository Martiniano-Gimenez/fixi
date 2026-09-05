const prisma = require('../lib/prisma');
const { getCategoriaById } = require('./categoria.service');
const { calcularCompatibilidad, horaAMinutos, DURACION_PARTIDO_MIN } = require('./slots.service');
const { parseFechaLocal, requireTorneoFecha, getDiaCalendarioConTrasnoche } = require('../utils/dateUtils');

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
async function generarPartidosZonaHelper(tx, categoriaId, zonaId, formato, size, parejasEnEstaZona) {
  if (formato === 'ROUND_ROBIN') {
    if (size === 2) {
      await tx.partido.create({
        data: {
          categoriaId,
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
            categoriaId,
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
            categoriaId,
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
        categoriaId,
        zonaId,
        pareja1Id: parejasEnEstaZona[0].id,
        pareja2Id: parejasEnEstaZona[1].id,
        posicionEnRonda: 1,
      },
    });
    await tx.partido.create({
      data: {
        categoriaId,
        zonaId,
        pareja1Id: parejasEnEstaZona[2].id,
        pareja2Id: parejasEnEstaZona[3].id,
        posicionEnRonda: 2,
      },
    });
    await tx.partido.create({
      data: {
        categoriaId,
        zonaId,
        posicionEnRonda: 3,
        origenPareja1: 'Ganador Partido 1',
        origenPareja2: 'Ganador Partido 2',
      },
    });
    await tx.partido.create({
      data: {
        categoriaId,
        zonaId,
        posicionEnRonda: 4,
        origenPareja1: 'Perdedor Partido 1',
        origenPareja2: 'Perdedor Partido 2',
      },
    });
  }
}

/**
 * Lógica de inicio de categoría y generación de zonas (Sorteo aleatorio)
 */
async function iniciarCategoria(organizadorId, categoriaId, externalTx = null) {
  const db = externalTx || prisma;
  const categoria = await getCategoriaById(organizadorId, categoriaId, db);

  if (categoria.estado !== 'BORRADOR') {
    const error = new Error('La categoría ya fue iniciada.');
    error.statusCode = 400;
    throw error;
  }

  const parejas = await db.pareja.findMany({ where: { categoriaId } });
  const numParejas = parejas.length;

  if (numParejas < 2) {
    const error = new Error('Se necesitan al menos 2 parejas para iniciar la categoría.');
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
          categoriaId,
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

      await generarPartidosZonaHelper(tx, categoriaId, zona.id, formato, size, parejasEnEstaZona);
    }

    await tx.categoria.update({
      where: { id: categoriaId },
      data: { estado: 'EN_CURSO' },
    });
  };

  if (externalTx) {
    await runOperation(externalTx);
  } else {
    await prisma.$transaction(runOperation);
  }

  return { message: 'Categoría iniciada y zonas generadas.' };
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

  return backtrack(0, []);
}

/**
 * Iniciar categoría agrupando zonas por disponibilidad horaria
 */
async function iniciarCategoriaConDisponibilidad(organizadorId, categoriaId, externalTx = null) {
  const db = externalTx || prisma;
  const categoria = await getCategoriaById(organizadorId, categoriaId, db);

  if (categoria.estado !== 'BORRADOR') {
    const error = new Error('La categoría ya fue iniciada.');
    error.statusCode = 400;
    throw error;
  }

  const parejas = await db.pareja.findMany({
    where: { categoriaId },
    include: { slotsSeleccionados: true },
  });

  const numParejas = parejas.length;
  if (numParejas < 2) {
    const error = new Error('Se necesitan al menos 2 parejas para iniciar la categoría.');
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
        data: { categoriaId, nombre: nombreZona, clasifican, formato },
      });

      const parejasEnZona = grupo.map((idx) => parejas[idx]);

      for (const p of parejasEnZona) {
        await tx.zonaPareja.create({ data: { zonaId: zona.id, parejaId: p.id } });
      }

      await generarPartidosZonaHelper(tx, categoriaId, zona.id, formato, size, parejasEnZona);

      resumenZonasCreadas.push({
        nombre: nombreZona,
        parejas: parejasEnZona.map((p) => ({ id: p.id, jugador1: p.jugador1, jugador2: p.jugador2 })),
      });

      letraIndex++;
    }

    if (sinGrupo.length > 0) {
      const nombreZona = `Zona ${letras[letraIndex] || letraIndex}`;
      letraIndex++;

      const zona = await tx.zona.create({
        data: {
          categoriaId,
          nombre: nombreZona,
          clasifican: 2,
          formato: 'ROUND_ROBIN',
          requiereArmadoManual: true,
        },
      });

      const parejasSinGrupo = sinGrupo.map((idx) => parejas[idx]);

      for (const p of parejasSinGrupo) {
        await tx.zonaPareja.create({
          data: {
            zonaId: zona.id,
            parejaId: p.id,
          },
        });
      }

      resumenZonasManual.push({
        nombre: nombreZona,
        parejas: parejasSinGrupo.map((p) => ({
          id: p.id,
          jugador1: p.jugador1,
          jugador2: p.jugador2,
        })),
      });
    }

    await tx.categoria.update({
      where: { id: categoriaId },
      data: { estado: 'EN_CURSO' },
    });
  };

  if (externalTx) {
    await runOperation(externalTx);
  } else {
    await prisma.$transaction(runOperation);
  }

  return {
    message: 'Categoría iniciada por disponibilidad horaria.',
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
function proximaFechaPorDia(dia, fechaBase) {
  const targetDia = dia === 'Viernes' ? 5 : 6;
  const hoy = parseFechaLocal(fechaBase);
  const diaActual = hoy.getDay();
  let diff = targetDia - diaActual;
  if (diff < 0) diff += 7;
  const targetDate = new Date(hoy);
  targetDate.setDate(hoy.getDate() + diff);
  targetDate.setHours(0, 0, 0, 0);
  return targetDate;
}

/**
 * Convierte un slotId ("Viernes-18:00" o "Viernes-00:00") a una fecha completa DateTime.
 * Los slots de madrugada (00:00 a 05:59) corresponden a la trasnoche del día y por lo tanto
 * se ubican en la madrugada del día calendario siguiente.
 */
function parseSlotToDate(slotId, fechaBase) {
  if (!slotId || !fechaBase) return null;
  const [dia, horaStr] = slotId.split('-');
  if (!dia || !horaStr) return null;
  const [hh, mm] = horaStr.split(':').map(Number);
  if (isNaN(hh) || isNaN(mm)) return null;

  const baseDate = proximaFechaPorDia(dia, fechaBase);
  // Si la hora es de trasnoche (00:00 a 05:59), pertenece a la madrugada del día siguiente
  if (hh < 6) {
    baseDate.setDate(baseDate.getDate() + 1);
  }
  baseDate.setHours(hh, mm, 0, 0);
  return baseDate;
}

/**
 * Convierte un slotId a su ventana continua en milisegundos [startMs, endMs]
 */
function slotIdToMsWindow(slotId, refFecha) {
  const startDate = parseSlotToDate(slotId, refFecha);
  if (!startDate) return null;
  const startMs = startDate.getTime();
  const endMs = startMs + DURACION_PARTIDO_MIN * 60 * 1000;
  return { startMs, endMs, dia: slotId.split('-')[0] };
}

/**
 * Fusiona slots adyacentes de una lista de slotIds en ventanas continuas
 */
function fusionarSlotsEnVentanas(slotIds, refFecha) {
  const rawWindows = slotIds
    .map((s) => slotIdToMsWindow(s, refFecha))
    .filter(Boolean)
    .sort((a, b) => a.startMs - b.startMs);

  if (rawWindows.length === 0) return [];

  const merged = [];
  let current = { ...rawWindows[0] };

  for (let i = 1; i < rawWindows.length; i++) {
    const next = rawWindows[i];
    if (next.dia === current.dia && next.startMs <= current.endMs) {
      current.endMs = Math.max(current.endMs, next.endMs);
    } else {
      merged.push(current);
      current = { ...next };
    }
  }
  merged.push(current);
  return merged;
}

/**
 * Calcula la intersección de ventanas continuas entre dos listas de ventanas
 */
function interseccionVentanas(ventanasA, ventanasB) {
  const result = [];
  for (const a of ventanasA) {
    for (const b of ventanasB) {
      if (a.dia !== b.dia) continue;
      const startMs = Math.max(a.startMs, b.startMs);
      const endMs = Math.min(a.endMs, b.endMs);
      if (endMs - startMs >= DURACION_PARTIDO_MIN * 60 * 1000) {
        result.push({ dia: a.dia, startMs, endMs });
      }
    }
  }
  return result;
}

/**
 * Asigna automáticamente horarios y canchas a los partidos de zonas en dos pasadas
 * con línea de tiempo continua e independiente por cancha, respetando canchas compartidas
 * de TODO el club (cross-category y cruces con horario fijado).
 * Soporta recibir un categoriaId individual o un array de categoriaIds para optimización global (MCF Global).
 */
async function asignarHorariosAutomatico(organizadorId, categoriaIdOrIds, externalTx = null) {
  const db = externalTx || prisma;
  const categoriaIds = Array.isArray(categoriaIdOrIds) ? categoriaIdOrIds : [categoriaIdOrIds];

  const categorias = await db.categoria.findMany({
    where: { id: { in: categoriaIds } },
    include: {
      torneo: true,
    },
  });

  if (categorias.length === 0) {
    const error = new Error('No se encontraron categorías.');
    error.statusCode = 404;
    throw error;
  }

  for (const c of categorias) {
    if (c.torneo.organizadorId !== organizadorId) {
      const error = new Error('No tenés permisos para gestionar una o más categorías seleccionadas.');
      error.statusCode = 403;
      throw error;
    }
  }

  const enBorrador = categorias.find((c) => c.estado === 'BORRADOR');
  if (enBorrador) {
    const error = new Error(`La categoría "${enBorrador.nombre}" está en borrador. Iniciá la categoría primero.`);
    error.statusCode = 400;
    throw error;
  }

  const organizador = await db.organizador.findUnique({
    where: { id: organizadorId },
  });

  const cantidadCanchas = Math.max(1, organizador?.cantidadCanchas || 1);
  const DURACION_MS = DURACION_PARTIDO_MIN * 60 * 1000;

  // 1. Cargar todos los partidos ya agendados de TODO el club
  const partidosYaAgendados = await db.partido.findMany({
    where: {
      categoria: {
        torneo: { organizadorId },
      },
      canchaNumero: { not: null },
      fechaHora: { not: null },
      sinHorarioAsignado: false,
    },
    select: {
      id: true,
      categoriaId: true,
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

  // 3. Cargar partidos pendientes de zonas de las categorías especificadas
  const partidos = await db.partido.findMany({
    where: {
      categoriaId: { in: categoriaIds },
      zonaId: { not: null },
      estado: 'PENDIENTE',
    },
    include: {
      categoria: { include: { torneo: true } },
      zona: {
        include: {
          zonaParejas: {
            include: {
              pareja: {
                include: { slotsSeleccionados: true },
              },
            },
          },
        },
      },
      pareja1: { include: { slotsSeleccionados: true } },
      pareja2: { include: { slotsSeleccionados: true } },
    },
  });

  const partidosFase1 = [];
  const partidosMiniBracketFase2 = [];

  for (const p of partidos) {
    if (yaAgendadosIds.has(p.id)) continue;
    if (p.zona?.formato === 'MINI_BRACKET' && p.posicionEnRonda >= 3) {
      partidosMiniBracketFase2.push(p);
    } else if (p.pareja1Id && p.pareja2Id) {
      partidosFase1.push(p);
    }
  }

  const refFecha = requireTorneoFecha(categorias[0]?.torneo);
  const baseFriday = proximaFechaPorDia('Viernes', refFecha);
  const baseSaturday = proximaFechaPorDia('Sabado', refFecha);

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

  // 4. Preprocesar y clasificar partidos Fase 1 en grupos de prioridad (MCF Global)
  const grupo0 = []; // Máxima prioridad (resolución manual)
  const grupo1 = [];
  const grupo2 = [];

  for (const partido of partidosFase1) {
    const slotsP1 = (partido.pareja1?.slotsSeleccionados || []).map((s) => s.slotId);
    const slotsP2 = (partido.pareja2?.slotsSeleccionados || []).map((s) => s.slotId);

    const conSlotsP1 = slotsP1.length > 0;
    const conSlotsP2 = slotsP2.length > 0;

    let slotsComunes = [];
    let sharedWindows = [];

    if (conSlotsP1 && conSlotsP2) {
      const set2 = new Set(slotsP2);
      slotsComunes = slotsP1.filter((s) => set2.has(s));

      const win1 = fusionarSlotsEnVentanas(slotsP1, refFecha);
      const win2 = fusionarSlotsEnVentanas(slotsP2, refFecha);
      sharedWindows = interseccionVentanas(win1, win2);
    } else if (conSlotsP1 || conSlotsP2) {
      slotsComunes = conSlotsP1 ? slotsP1 : slotsP2;
      sharedWindows = fusionarSlotsEnVentanas(slotsComunes, refFecha);
    } else {
      if (hasFriday) {
        sharedWindows.push({ dia: 'Viernes', startMs: friDayStartMs, endMs: friDayEndMs });
      }
      if (hasSaturday) {
        sharedWindows.push({ dia: 'Sabado', startMs: satDayStartMs, endMs: satDayEndMs });
      }
    }

    const item = { partido, slotsComunes, sharedWindows, numOptions: sharedWindows.length };

    if (partido.pareja1?.resolucionManual || partido.pareja2?.resolucionManual) {
      grupo0.push(item);
    } else if (slotsComunes.length === 1 || (slotsComunes.length === 0 && sharedWindows.length === 1)) {
      grupo1.push(item);
    } else {
      grupo2.push(item);
    }
  }

  // Ordenar grupo0 y grupo2 por menor cantidad de opciones (Most Constrained First)
  grupo0.sort((a, b) => a.numOptions - b.numOptions);
  grupo2.sort((a, b) => a.numOptions - b.numOptions);

  const updatesMap = new Map();

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

  function findFreeCourtAt(startMs, endMs) {
    for (let c = 1; c <= cantidadCanchas; c++) {
      if (isCourtFree(c, startMs, endMs)) {
        return c;
      }
    }
    return null;
  }

  function tryAssignSlotWithGap(partido, slotId, sharedWindows) {
    const slotWin = slotIdToMsWindow(slotId, refFecha);
    if (!slotWin) return false;

    const startMs = slotWin.startMs;
    const endMs = slotWin.endMs;

    let withinShared = false;
    for (const w of sharedWindows) {
      if (w.dia === slotWin.dia && startMs >= w.startMs && endMs <= w.endMs) {
        withinShared = true;
        break;
      }
    }
    if (!withinShared) return false;

    if (!isPairFree(partido.pareja1Id, startMs, endMs) || !isPairFree(partido.pareja2Id, startMs, endMs)) {
      return false;
    }

    const canchaLibre = findFreeCourtAt(startMs, endMs);
    if (canchaLibre !== null) {
      courtTimelines.get(canchaLibre).push({ startMs, endMs });
      if (!parejaAssignments.has(partido.pareja1Id)) parejaAssignments.set(partido.pareja1Id, []);
      parejaAssignments.get(partido.pareja1Id).push({ startMs, endMs });
      if (!parejaAssignments.has(partido.pareja2Id)) parejaAssignments.set(partido.pareja2Id, []);
      parejaAssignments.get(partido.pareja2Id).push({ startMs, endMs });

      updatesMap.set(partido.id, {
        id: partido.id,
        sinHorarioAsignado: false,
        fechaHora: new Date(startMs),
        canchaNumero: canchaLibre,
      });
      return true;
    }
    return false;
  }

  function tryAssignContinuousWindows(partido, sharedWindows) {
    for (const window of sharedWindows) {
      const isFri = window.dia === 'Viernes';
      const dayStartMs = isFri ? friDayStartMs : satDayStartMs;
      const dayEndMs = isFri ? friDayEndMs : satDayEndMs;

      const wStart = Math.max(window.startMs, dayStartMs);
      const wEnd = Math.min(window.endMs, dayEndMs);

      let bestCandidateForWindow = null;

      for (let c = 1; c <= cantidadCanchas; c++) {
        let T = wStart;
        while (T + DURACION_MS <= wEnd) {
          const tEnd = T + DURACION_MS;
          if (isCourtFree(c, T, tEnd) && isPairFree(partido.pareja1Id, T, tEnd) && isPairFree(partido.pareja2Id, T, tEnd)) {
            if (bestCandidateForWindow === null || T < bestCandidateForWindow.T) {
              bestCandidateForWindow = { T, cancha: c };
            }
            break;
          }
          T += 15 * 60 * 1000;
        }
      }

      if (bestCandidateForWindow !== null) {
        courtTimelines.get(bestCandidateForWindow.cancha).push({
          startMs: bestCandidateForWindow.T,
          endMs: bestCandidateForWindow.T + DURACION_MS,
        });
        if (!parejaAssignments.has(partido.pareja1Id)) parejaAssignments.set(partido.pareja1Id, []);
        parejaAssignments.get(partido.pareja1Id).push({
          startMs: bestCandidateForWindow.T,
          endMs: bestCandidateForWindow.T + DURACION_MS,
        });
        if (!parejaAssignments.has(partido.pareja2Id)) parejaAssignments.set(partido.pareja2Id, []);
        parejaAssignments.get(partido.pareja2Id).push({
          startMs: bestCandidateForWindow.T,
          endMs: bestCandidateForWindow.T + DURACION_MS,
        });

        updatesMap.set(partido.id, {
          id: partido.id,
          sinHorarioAsignado: false,
          fechaHora: new Date(bestCandidateForWindow.T),
          canchaNumero: bestCandidateForWindow.cancha,
        });
        return true;
      }
    }
    return false;
  }

  // ================= PASADA 0 (Alta Prioridad - Resolución Manual) =================
  for (const { partido, slotsComunes, sharedWindows } of grupo0) {
    let asignado = false;
    for (const slotId of slotsComunes) {
      if (tryAssignSlotWithGap(partido, slotId, sharedWindows)) {
        asignado = true;
        break;
      }
    }
    if (!asignado) {
      if (!tryAssignContinuousWindows(partido, sharedWindows)) {
        updatesMap.set(partido.id, { id: partido.id, sinHorarioAsignado: true, fechaHora: null, canchaNumero: null });
      }
    }
  }

  // ================= PASADA 1 =================
  for (const { partido, slotsComunes, sharedWindows } of grupo1) {
    const ok = tryAssignSlotWithGap(partido, slotsComunes[0], sharedWindows);
    if (!ok) {
      const okContinuous = tryAssignContinuousWindows(partido, sharedWindows);
      if (!okContinuous) {
        updatesMap.set(partido.id, { id: partido.id, sinHorarioAsignado: true, fechaHora: null, canchaNumero: null });
      }
    }
  }

  // ================= PASADA 2 =================
  for (const { partido, slotsComunes, sharedWindows } of grupo2) {
    let asignado = false;
    for (const slotId of slotsComunes) {
      if (tryAssignSlotWithGap(partido, slotId, sharedWindows)) {
        asignado = true;
        break;
      }
    }
    if (!asignado) {
      if (!tryAssignContinuousWindows(partido, sharedWindows)) {
        updatesMap.set(partido.id, { id: partido.id, sinHorarioAsignado: true, fechaHora: null, canchaNumero: null });
      }
    }
  }

  // ================= FASE 2: MINI_BRACKET RONDA 2 (P3: Ganadores y P4: Perdedores) =================
  // Solo se procesan después de que P1 y P2 de la zona ya tienen horario confirmado (max(fin(P1), fin(P2))).
  const mbZonasMap = new Map();
  for (const p of partidosMiniBracketFase2) {
    if (!mbZonasMap.has(p.zonaId)) mbZonasMap.set(p.zonaId, []);
    mbZonasMap.get(p.zonaId).push(p);
  }

  for (const [zId, matches] of mbZonasMap.entries()) {
    const zona = matches[0]?.zona;
    if (!zona) continue;

    // Buscar P1 y P2 de esta zona
    const allZonaPartidos = partidos.filter((p) => p.zonaId === zId);
    const p1 = allZonaPartidos.find((p) => p.posicionEnRonda === 1);
    const p2 = allZonaPartidos.find((p) => p.posicionEnRonda === 2);

    const t1 = updatesMap.get(p1?.id)?.fechaHora || (p1?.fechaHora && !p1?.sinHorarioAsignado ? p1.fechaHora : null);
    const t2 = updatesMap.get(p2?.id)?.fechaHora || (p2?.fechaHora && !p2?.sinHorarioAsignado ? p2.fechaHora : null);

    const p3 = matches.find((p) => p.posicionEnRonda === 3);
    const p4 = matches.find((p) => p.posicionEnRonda === 4);

    if (!t1 || !t2) {
      if (p3) updatesMap.set(p3.id, { id: p3.id, sinHorarioAsignado: true, fechaHora: null, canchaNumero: null });
      if (p4) updatesMap.set(p4.id, { id: p4.id, sinHorarioAsignado: true, fechaHora: null, canchaNumero: null });
      continue;
    }

    const minStartMs = Math.max(new Date(t1).getTime(), new Date(t2).getTime()) + DURACION_MS;

    // Obtener las 4 parejas de la zona
    const zonePairs = (zona.zonaParejas || []).map((zp) => zp.pareja).filter(Boolean);
    const slotsLists = zonePairs.map((p) => (p.slotsSeleccionados || []).map((s) => s.slotId));

    // Calcular intersección cuádruple de ventanas continuas
    let shared4 = [];
    const conSlotsLists = slotsLists.filter((l) => l.length > 0);
    if (conSlotsLists.length === 0) {
      if (hasFriday) shared4.push({ dia: 'Viernes', startMs: friDayStartMs, endMs: friDayEndMs });
      if (hasSaturday) shared4.push({ dia: 'Sabado', startMs: satDayStartMs, endMs: satDayEndMs });
    } else {
      const windowsList = conSlotsLists.map((l) => fusionarSlotsEnVentanas(l, refFecha));
      shared4 = windowsList[0];
      for (let i = 1; i < windowsList.length; i++) {
        shared4 = interseccionVentanas(shared4, windowsList[i]);
      }
    }

    // Calcular slots comunes exactos de las 4 parejas
    let commonSlots4 = [];
    if (conSlotsLists.length > 0) {
      commonSlots4 = conSlotsLists[0];
      for (let i = 1; i < conSlotsLists.length; i++) {
        commonSlots4 = commonSlots4.filter((s) => conSlotsLists[i].includes(s));
      }
    }

    // Programar P3 y P4
    const matchesToSchedule = [p3, p4].filter(Boolean);
    for (const m of matchesToSchedule) {
      let asignado = false;

      // 1. Probar slots comunes exactos posteriores a minStartMs
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

        const canchaLibre = findFreeCourtAt(sWin.startMs, sWin.endMs);
        if (canchaLibre !== null) {
          courtTimelines.get(canchaLibre).push({ startMs: sWin.startMs, endMs: sWin.endMs });
          updatesMap.set(m.id, {
            id: m.id,
            sinHorarioAsignado: false,
            fechaHora: new Date(sWin.startMs),
            canchaNumero: canchaLibre,
          });
          asignado = true;
          break;
        }
      }

      // 2. Probar ventanas continuas si no se asignó en slot común exacto
      if (!asignado) {
        for (const window of shared4) {
          const isFri = window.dia === 'Viernes';
          const dayStartMs = isFri ? friDayStartMs : satDayStartMs;
          const dayEndMs = isFri ? friDayEndMs : satDayEndMs;

          const wStart = Math.max(window.startMs, dayStartMs, minStartMs);
          const wEnd = Math.min(window.endMs, dayEndMs);

          let bestCandidate = null;
          for (let c = 1; c <= cantidadCanchas; c++) {
            let T = wStart;
            while (T + DURACION_MS <= wEnd) {
              const tEnd = T + DURACION_MS;
              if (isCourtFree(c, T, tEnd)) {
                if (bestCandidate === null || T < bestCandidate.T) {
                  bestCandidate = { T, cancha: c };
                }
                break;
              }
              T += 15 * 60 * 1000;
            }
          }

          if (bestCandidate !== null) {
            courtTimelines.get(bestCandidate.cancha).push({
              startMs: bestCandidate.T,
              endMs: bestCandidate.T + DURACION_MS,
            });
            updatesMap.set(m.id, {
              id: m.id,
              sinHorarioAsignado: false,
              fechaHora: new Date(bestCandidate.T),
              canchaNumero: bestCandidate.cancha,
            });
            asignado = true;
            break;
          }
        }
      }

      if (!asignado) {
        updatesMap.set(m.id, { id: m.id, sinHorarioAsignado: true, fechaHora: null, canchaNumero: null });
      }
    }
  }

  const updates = Array.from(updatesMap.values());

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
 * Reubica los partidos PENDIENTE de un torneo durante Modo Lluvia (reducción o restauración de canchas)
 * aplicando Compactación Continua Earliest-Fit ordenada cronológicamente por horario original.
 * Garantiza que los partidos FINALIZADO y EN_CURSO queden 100% fijos como ocupación inmutable en sus canchas y horarios originales.
 * En situación de emergencia (lluvia), no bloquea por disponibilidad de pareja, permitiendo jugar en cualquier horario
 * dentro del día lógico hasta el límite de trasnoche (dayLimitMs).
 */
async function asignarHorariosModoLluviaMCF(organizadorId, torneoId, overrideCanchas, externalTx = null) {
  const db = externalTx || prisma;

  const torneo = await db.torneo.findUnique({
    where: { id: torneoId },
    include: {
      organizador: true,
      categorias: true,
    },
  });

  if (!torneo || torneo.organizadorId !== organizadorId) {
    const error = new Error('Torneo no encontrado o no autorizado.');
    error.statusCode = 404;
    throw error;
  }

  const organizador = torneo.organizador;
  const canchasClub = organizador.cantidadCanchas || 1;
  const cantidadCanchas = Math.max(1, overrideCanchas || canchasClub);
  const DURACION_MS = DURACION_PARTIDO_MIN * 60 * 1000;

  const refFecha = requireTorneoFecha(torneo);
  const baseFriday = proximaFechaPorDia('Viernes', refFecha);
  const baseSaturday = proximaFechaPorDia('Sabado', refFecha);

  const friInicioMin = horaAMinutos(organizador.viernesInicio);
  const friDayStartMs = baseFriday.getTime() + friInicioMin * 60 * 1000;

  const satInicioMin = horaAMinutos(organizador.sabadoInicio);
  const satDayStartMs = baseSaturday.getTime() + satInicioMin * 60 * 1000;

  // 1. Cargar todos los partidos del torneo
  const todosLosPartidos = await db.partido.findMany({
    where: {
      categoria: { torneoId },
    },
    include: {
      categoria: { select: { id: true, nombre: true } },
      pareja1: { select: { id: true, jugador1: true, jugador2: true, resolucionManual: true } },
      pareja2: { select: { id: true, jugador1: true, jugador2: true, resolucionManual: true } },
    },
  });

  // 2. Inicializar timelines de canchas habilitadas (1..cantidadCanchas) y asignaciones de parejas
  const courtTimelines = new Map();
  for (let c = 1; c <= cantidadCanchas; c++) {
    courtTimelines.set(c, []);
  }

  const parejaAssignments = new Map();

  function addInterval(cancha, pareja1Id, pareja2Id, startMs, endMs) {
    if (cancha && cancha <= cantidadCanchas && courtTimelines.has(cancha)) {
      courtTimelines.get(cancha).push({ startMs, endMs });
    }
    if (pareja1Id) {
      if (!parejaAssignments.has(pareja1Id)) parejaAssignments.set(pareja1Id, []);
      parejaAssignments.get(pareja1Id).push({ startMs, endMs });
    }
    if (pareja2Id) {
      if (!parejaAssignments.has(pareja2Id)) parejaAssignments.set(pareja2Id, []);
      parejaAssignments.get(pareja2Id).push({ startMs, endMs });
    }
  }

  // Pre-sembrar partidos inmutables: FINALIZADO y EN_CURSO
  const partidosAAsignar = [];

  for (const p of todosLosPartidos) {
    if (p.estado === 'FINALIZADO' || p.estado === 'EN_CURSO') {
      if (p.fechaHora) {
        const startMs = new Date(p.fechaHora).getTime();
        const endMs = startMs + DURACION_MS;
        addInterval(p.canchaNumero, p.pareja1Id, p.pareja2Id, startMs, endMs);
      }
    } else if (p.estado === 'PENDIENTE') {
      if (p.pareja1Id && p.pareja2Id) {
        partidosAAsignar.push(p);
      }
    }
  }

  // 3. Ordenar partidos pendientes cronológicamente por horario original (preservando antigüedad de turno)
  partidosAAsignar.sort((a, b) => {
    const tA = a.fechaHora ? new Date(a.fechaHora).getTime() : 0;
    const tB = b.fechaHora ? new Date(b.fechaHora).getTime() : 0;
    if (tA !== tB) return tA - tB;
    if ((a.canchaNumero || 0) !== (b.canchaNumero || 0)) {
      return (a.canchaNumero || 0) - (b.canchaNumero || 0);
    }
    return a.id.localeCompare(b.id);
  });

  const updatesMap = new Map();

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

  // 4. Asignación Global Earliest-Fit para cada partido
  for (const partido of partidosAAsignar) {
    const origStartMs = partido.fechaHora ? new Date(partido.fechaHora).getTime() : null;
    const origDate = origStartMs ? new Date(origStartMs) : parseFechaLocal(refFecha);
    const origDiaInfo = getDiaCalendarioConTrasnoche(origDate, organizador);
    const dayLimitMs = origDiaInfo.dayLimitMs;
    const isFriday = origDiaInfo.logicalDate.getDay() === 5;
    const sessionDayStartMs = isFriday ? friDayStartMs : satDayStartMs;

    let bestCandidate = null;
    let T = sessionDayStartMs;

    while (T + DURACION_MS <= dayLimitMs) {
      const tEnd = T + DURACION_MS;
      for (let c = 1; c <= cantidadCanchas; c++) {
        if (
          isCourtFree(c, T, tEnd) &&
          isPairFree(partido.pareja1Id, T, tEnd) &&
          isPairFree(partido.pareja2Id, T, tEnd)
        ) {
          bestCandidate = { T, cancha: c };
          break;
        }
      }
      if (bestCandidate !== null) break;
      T += 15 * 60 * 1000;
    }

    if (bestCandidate !== null) {
      addInterval(bestCandidate.cancha, partido.pareja1Id, partido.pareja2Id, bestCandidate.T, bestCandidate.T + DURACION_MS);
      updatesMap.set(partido.id, {
        id: partido.id,
        sinHorarioAsignado: false,
        fechaHora: new Date(bestCandidate.T),
        canchaNumero: bestCandidate.cancha,
      });
    } else {
      updatesMap.set(partido.id, {
        id: partido.id,
        sinHorarioAsignado: true,
        fechaHora: null,
        canchaNumero: null,
      });
    }
  }

  // 5. Calcular diffs y métricas de cambio
  const updates = Array.from(updatesMap.values());
  const cambios = [];
  let partidosReprogramados = 0;
  let partidosSinCambio = 0;
  let partidosSinHorarioNuevo = 0;

  function formatParejaNombre(p, origen) {
    if (p) return `${p.jugador1} / ${p.jugador2}`;
    if (origen) return origen;
    return 'Por definirse';
  }

  for (const u of updates) {
    const original = todosLosPartidos.find((p) => p.id === u.id);
    const origStartMs = original?.fechaHora ? new Date(original.fechaHora).getTime() : null;
    const origCancha = original?.canchaNumero;

    if (u.sinHorarioAsignado || !u.fechaHora) {
      partidosSinHorarioNuevo++;
      partidosReprogramados++;
      cambios.push({
        partidoId: u.id,
        pareja1: formatParejaNombre(original?.pareja1, original?.origenPareja1),
        pareja2: formatParejaNombre(original?.pareja2, original?.origenPareja2),
        categoria: original?.categoria?.nombre || '',
        antes: { fechaHora: original?.fechaHora ? new Date(original.fechaHora).toISOString() : null, canchaNumero: origCancha },
        despues: { fechaHora: null, canchaNumero: null, sinHorarioAsignado: true },
      });
    } else {
      const newStartMs = u.fechaHora.getTime();
      const cambioHorario = !origStartMs || newStartMs !== origStartMs;
      if (cambioHorario) {
        partidosReprogramados++;
        cambios.push({
          partidoId: u.id,
          pareja1: formatParejaNombre(original?.pareja1, original?.origenPareja1),
          pareja2: formatParejaNombre(original?.pareja2, original?.origenPareja2),
          categoria: original?.categoria?.nombre || '',
          antes: { fechaHora: original?.fechaHora ? new Date(original.fechaHora).toISOString() : null, canchaNumero: origCancha },
          despues: { fechaHora: u.fechaHora.toISOString(), canchaNumero: u.canchaNumero },
        });
      } else {
        partidosSinCambio++;
      }
    }
  }

  // 6. Persistir en base de datos
  if (updates.length > 0) {
    for (const u of updates) {
      await db.partido.update({
        where: { id: u.id },
        data: {
          fechaHora: u.fechaHora,
          canchaNumero: u.canchaNumero,
          sinHorarioAsignado: u.sinHorarioAsignado,
        },
      });
    }
  }

  return {
    partidosReprogramados,
    partidosSinCambio,
    partidosSinHorarioNuevo,
    cambios,
    total: updates.length,
  };
}

/**
 * Obtiene las zonas de una categoría con sus posiciones y partidos
 */
async function getZonasByCategoria(organizadorId, categoriaId) {
  await getCategoriaById(organizadorId, categoriaId);

  return await prisma.zona.findMany({
    where: { categoriaId },
    include: {
      zonaParejas: {
        include: {
          pareja: true,
        },
        orderBy: [
          { posicion: 'asc' },
          { puntos: 'desc' },
          { pg: 'desc' },
        ],
      },
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
    orderBy: { nombre: 'asc' },
  });
}

/**
 * Limpia todos los resultados de las zonas de una categoría
 */
async function limpiarResultadosZonas(organizadorId, categoriaId) {
  await getCategoriaById(organizadorId, categoriaId);

  await prisma.$transaction(async (tx) => {
    const partidosZonas = await tx.partido.findMany({
      where: { categoriaId, zonaId: { not: null } },
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
        where: { categoriaId, formato: 'MINI_BRACKET' },
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

    const zonas = await tx.zona.findMany({ where: { categoriaId } });
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
          posicion: 0,
        },
      });
    }

    const faseViejas = await tx.faseEliminatoria.findMany({ where: { categoriaId } });
    if (faseViejas.length > 0) {
      await tx.partido.deleteMany({
        where: { faseEliminatoriaId: { in: faseViejas.map((f) => f.id) } },
      });
      await tx.faseEliminatoria.deleteMany({ where: { categoriaId } });
    }
  });

  return { message: 'Resultados de zonas reseteados.' };
}

/**
 * Reestructura manualmente las zonas de la categoría
 */
async function reestructurarZonas(organizadorId, categoriaId, zonasPayload) {
  const categoria = await getCategoriaById(organizadorId, categoriaId);

  if (categoria.estado === 'BORRADOR') {
    throw new Error('La categoría está en borrador. Iniciá la categoría primero.');
  }

  await prisma.$transaction(async (tx) => {
    const fases = await tx.faseEliminatoria.findMany({ where: { categoriaId } });
    if (fases.length > 0) {
      await tx.partido.deleteMany({
        where: { faseEliminatoriaId: { in: fases.map((f) => f.id) } },
      });
      await tx.faseEliminatoria.deleteMany({ where: { categoriaId } });
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
        data: { formato, clasifican, requiereArmadoManual: false },
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

      await generarPartidosZonaHelper(tx, categoriaId, zona.id, formato, size, parejasEnEstaZona);
    }
  });

  return { message: 'Zonas reestructuradas correctamente.' };
}

module.exports = {
  iniciarCategoria,
  iniciarCategoriaConDisponibilidad,
  iniciarTorneo: iniciarCategoria,
  iniciarTorneoConDisponibilidad: iniciarCategoriaConDisponibilidad,
  asignarHorariosAutomatico,
  getZonasByCategoria,
  limpiarResultadosZonas,
  reestructurarZonas,
  fusionarSlotsEnVentanas,
  interseccionVentanas,
  parseSlotToDate,
  proximaFechaPorDia,
  slotIdToMsWindow,
  asignarHorariosModoLluviaMCF,
};
