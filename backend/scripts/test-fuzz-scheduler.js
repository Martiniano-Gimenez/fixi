'use strict';

const { ensureTestDb } = require('./utils/testEnvGuard');
const { resetTestDb } = require('./reset-test-db');
const { startTestServer } = require('./utils/testServer');
const prisma = require('../src/lib/prisma');
const organizadorService = require('../src/services/organizador.service');
const zonaService = require('../src/services/zona.service');
const disponibilidadService = require('../src/services/disponibilidad.service');
const partidoService = require('../src/services/partido.service');
const { generarEliminatoria } = require('../src/services/faseEliminatoria.service');
const { programarHorariosEliminatorias } = require('../src/services/eliminatoriaScheduler.service');
const canchasOverridesService = require('../src/services/canchasOverrides.service');
const {
  generarGrillaOrganizador,
  horaAMinutos,
  DURACION_PARTIDO_MIN,
} = require('../src/services/slots.service');
const {
  parseFechaLocal,
  getDiaCalendarioConTrasnoche,
} = require('../src/utils/dateUtils');

const DURACION_MS = DURACION_PARTIDO_MIN * 60 * 1000;
const START_SEED = Number(process.env.START_SEED || 1);
const TOTAL_SEEDS = Number(process.env.FUZZ_SEEDS || 500);
const END_SEED = START_SEED + TOTAL_SEEDS - 1;

const FUZZ_METRICAS = process.env.FUZZ_METRICAS === '1';

const r32FuzzStats = {
  totalR32NoBye: 0,
  sinHorarioR32: 0,
  seedsConR32: new Set(),
  seedsConSinHorarioR32: new Set(),
};

const manualFuzzStats = {
  totalSeedsConZonasDe4: new Set(),
  seedsConReasignacionAceptada: new Set(),
  intentosPartidos: 0,
  llamadasAsignar: 0,
  aceptadas: 0,
  rechazadas: 0,
  mensajesRechazo: {},
};

/**
 * PRNG determinístico (Mulberry32)
 */
function createPRNG(seed) {
  let state = seed >>> 0;
  function next() {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function int(min, max) {
    return Math.floor(next() * (max - min + 1)) + min;
  }
  function pick(arr) {
    if (!arr || arr.length === 0) return null;
    return arr[int(0, arr.length - 1)];
  }
  function shuffle(arr) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = int(0, i);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
  return { next, int, pick, shuffle };
}

/**
 * Limpia todos los datos de la base de test entre semillas sin recrear el proceso.
 */
async function limpiarDatosTorneo() {
  organizadorService.preCheckSessions.clear();
  organizadorService.planesCache.clear();
  await prisma.setPartido.deleteMany({});
  await prisma.partido.deleteMany({});
  await prisma.faseEliminatoria.deleteMany({});
  await prisma.zonaPareja.deleteMany({});
  await prisma.zona.deleteMany({});
  await prisma.slotPareja.deleteMany({});
  await prisma.pareja.deleteMany({});
  await prisma.categoria.deleteMany({});
  await prisma.overrideCanchasDia.deleteMany({});
  await prisma.torneo.deleteMany({});
  await prisma.organizador.deleteMany({});
  await canchasOverridesService.loadFromDb();
}

/**
 * Calcula los límites horarios [startMs, endMs] configurados del club para Viernes, Sábado y Domingo,
 * incluyendo dayLimitMs para Modo Lluvia y extensión de +150m para Finales en Domingo.
 */
function getVentanasClub(organizador, refFecha) {
  const baseFriday = zonaService.proximaFechaPorDia('Viernes', refFecha);
  const baseSaturday = zonaService.proximaFechaPorDia('Sabado', refFecha);
  const baseSunday = zonaService.proximaFechaPorDia('Domingo', refFecha);

  const horariosClubObj = {
    viernesInicio: organizador.viernesInicio,
    viernesFin: organizador.viernesFin,
    sabadoInicio: organizador.sabadoInicio,
    sabadoFin: organizador.sabadoFin,
    domingoInicio: organizador.domingoInicio,
    domingoFin: organizador.domingoFin,
  };

  const buildWindow = (baseDate, inicioStr, finStr, dayLimitMs = null) => {
    const inicioMin = horaAMinutos(inicioStr);
    const finMin = horaAMinutos(finStr);
    let effectiveFinMin = finMin;
    if (effectiveFinMin <= inicioMin) {
      effectiveFinMin += 24 * 60;
    }
    const startMs = baseDate.getTime() + inicioMin * 60 * 1000;
    const endMs = baseDate.getTime() + effectiveFinMin * 60 * 1000;
    return {
      startMs,
      endMs,
      dayLimitMs: dayLimitMs || endMs,
    };
  };

  const friLimitMs = getDiaCalendarioConTrasnoche(parseFechaLocal(baseFriday), horariosClubObj)?.dayLimitMs;
  const satLimitMs = getDiaCalendarioConTrasnoche(parseFechaLocal(baseSaturday), horariosClubObj)?.dayLimitMs;
  const sunLimitMs = getDiaCalendarioConTrasnoche(parseFechaLocal(baseSunday), horariosClubObj)?.dayLimitMs;

  return {
    viernes: buildWindow(baseFriday, organizador.viernesInicio, organizador.viernesFin, friLimitMs),
    sabado: buildWindow(baseSaturday, organizador.sabadoInicio, organizador.sabadoFin, satLimitMs),
    domingo: buildWindow(baseSunday, organizador.domingoInicio, organizador.domingoFin, sunLimitMs),
  };
}

/**
 * Genera disponibilidad aleatoria en bloques continuos (con granularidad de 15 min y trasnoche)
 */
function generarSlotsDisponibilidadPareja(rng, grilla) {
  const allSlots = [...grilla.viernes, ...grilla.sabado];
  if (allSlots.length === 0) return [];

  const roll = rng.next();
  if (roll < 0.15) {
    return allSlots;
  }

  const selected = new Set();
  const numRanges = rng.int(1, 3);
  for (let r = 0; r < numRanges; r++) {
    const daySlots = rng.next() < 0.45 ? grilla.viernes : grilla.sabado;
    if (daySlots.length === 0) continue;
    const len = rng.int(Math.min(3, daySlots.length), Math.min(daySlots.length, rng.int(6, 24)));
    const startIdx = rng.int(0, Math.max(0, daySlots.length - len));
    for (let i = startIdx; i < Math.min(daySlots.length, startIdx + len); i++) {
      selected.add(daySlots[i]);
    }
  }

  if (selected.size === 0) {
    selected.add(rng.pick(allSlots));
  }
  return Array.from(selected);
}

/**
 * Cuenta solo los conflictos base en pre-check, excluyendo P3/P4 derivados de MINI_BRACKET
 * mientras P1 o P2 de esa misma zona no tengan horario asignado.
 */
function obtenerConflictosBase(preCheck, session) {
  const derivedMatchIds = new Set();
  if (session && Array.isArray(session.categoriasPlan)) {
    for (const cPlan of session.categoriasPlan) {
      for (const z of cPlan.zonas || []) {
        if (z.formato !== 'MINI_BRACKET') continue;
        const p1 = (z.partidos || []).find((p) => p.posicionEnRonda === 1);
        const p2 = (z.partidos || []).find((p) => p.posicionEnRonda === 2);
        const p1SinHorario = !p1 || !p1.fechaHora || p1.sinHorarioAsignado;
        const p2SinHorario = !p2 || !p2.fechaHora || p2.sinHorarioAsignado;
        if (p1SinHorario || p2SinHorario) {
          for (const p of z.partidos || []) {
            if (p.posicionEnRonda >= 3 && p.id) {
              derivedMatchIds.add(p.id);
            }
          }
        }
      }
    }
  }

  const baseList = [];
  for (const catConf of preCheck.conflictos || []) {
    for (const item of catConf.partidosSinHorario || []) {
      if (derivedMatchIds.has(item.partidoId)) continue;
      baseList.push(item);
    }
  }
  return baseList;
}

/**
 * Verifica los invariantes 1 a 6 sobre el estado de los partidos en la etapa indicada:
 * - post-inicio
 * - post-reduccion
 * - post-restauracion
 */
function verificarInvariantesPorEtapa({
  partidos,
  zonas,
  organizador,
  refFecha,
  recordFailure,
  seed,
  etapa,
  allowDayLimitMs = false,
  partidosSinSlotMap = {},
  overrideDiaKey = null,
  partidosManualesSet = new Set(),
}) {
  const ventanasClub = getVentanasClub(organizador, refFecha);

  const agendados = partidos.filter(
    (p) => p.fechaHora && p.canchaNumero && !p.sinHorarioAsignado && !p.esBye
  );

  // 1. Ninguna cancha con dos partidos solapados
  const porCancha = new Map();
  for (const p of agendados) {
    if (!porCancha.has(p.canchaNumero)) porCancha.set(p.canchaNumero, []);
    const startMs = new Date(p.fechaHora).getTime();
    porCancha.get(p.canchaNumero).push({ p, startMs, endMs: startMs + DURACION_MS });
  }
  for (const [cancha, lista] of porCancha.entries()) {
    lista.sort((a, b) => a.startMs - b.startMs);
    for (let i = 0; i < lista.length; i++) {
      for (let j = i + 1; j < lista.length; j++) {
        if (lista[i].startMs < lista[j].endMs && lista[i].endMs > lista[j].startMs) {
          recordFailure(
            `cancha_sin_solapamiento:${etapa}`,
            seed,
            `Cancha ${cancha} tiene partidos solapados: ${lista[i].p.id} (${new Date(lista[i].startMs).toISOString()}) y ${lista[j].p.id} (${new Date(lista[j].startMs).toISOString()})`
          );
        }
      }
    }
  }

  // 2. Ninguna pareja con dos partidos solapados
  const porPareja = new Map();
  for (const p of agendados) {
    const startMs = new Date(p.fechaHora).getTime();
    const endMs = startMs + DURACION_MS;
    for (const parejaId of [p.pareja1Id, p.pareja2Id]) {
      if (!parejaId) continue;
      if (!porPareja.has(parejaId)) porPareja.set(parejaId, []);
      porPareja.get(parejaId).push({ p, startMs, endMs });
    }
  }
  for (const [parejaId, lista] of porPareja.entries()) {
    lista.sort((a, b) => a.startMs - b.startMs);
    for (let i = 0; i < lista.length; i++) {
      for (let j = i + 1; j < lista.length; j++) {
        if (lista[i].startMs < lista[j].endMs && lista[i].endMs > lista[j].startMs) {
          recordFailure(
            `pareja_sin_solapamiento:${etapa}`,
            seed,
            `Pareja ${parejaId} tiene partidos solapados: ${lista[i].p.id} y ${lista[j].p.id}`
          );
        }
      }
    }
  }

  // 3. Partidos alineados a la grilla de 15 min y dentro del horario permitido
  // Excepciones de diseño:
  // - En modo lluvia (post-reduccion / post-restauracion) se puede agendar hasta dayLimitMs.
  // - Las finales (ronda 2) pueden extenderse hasta +150 min del cierre dominical.
  const friMaxEndMs = allowDayLimitMs
    ? Math.max(ventanasClub.viernes.endMs, ventanasClub.viernes.dayLimitMs)
    : ventanasClub.viernes.endMs;
  const satMaxEndMs = allowDayLimitMs
    ? Math.max(ventanasClub.sabado.endMs, ventanasClub.sabado.dayLimitMs)
    : ventanasClub.sabado.endMs;

  for (const p of agendados) {
    const d = new Date(p.fechaHora);
    const startMs = d.getTime();
    const endMs = startMs + DURACION_MS;
    if (d.getMinutes() % 15 !== 0 || d.getSeconds() !== 0 || d.getMilliseconds() !== 0) {
      recordFailure(
        `grilla_15m_y_horario_club:${etapa}`,
        seed,
        `Partido ${p.id} no está alineado a grilla de 15 min: ${d.toISOString()}`
      );
    }

    const isFinalDomingo = p.faseEliminatoria && Number(p.faseEliminatoria.ronda) === 2;
    const sunMaxEndMs = isFinalDomingo
      ? ventanasClub.domingo.endMs + 150 * 60 * 1000
      : ventanasClub.domingo.endMs;

    const inFri = startMs >= ventanasClub.viernes.startMs && endMs <= friMaxEndMs;
    const inSat = startMs >= ventanasClub.sabado.startMs && endMs <= satMaxEndMs;
    const inSun = startMs >= ventanasClub.domingo.startMs && endMs <= sunMaxEndMs;

    if (!inFri && !inSat && !inSun) {
      recordFailure(
        `grilla_15m_y_horario_club:${etapa}`,
        seed,
        `Partido ${p.id} (${d.toISOString()} -> ${new Date(endMs).toISOString()}) cae fuera del horario permitido`
      );
    }
  }

  // 4. Sin partidos de zona en domingo
  for (const p of agendados) {
    if (!p.zonaId) continue;
    const d = new Date(p.fechaHora);
    const startMs = d.getTime();
    const diaInfo = getDiaCalendarioConTrasnoche(d, organizador);
    const isSundayLogical = diaInfo?.logicalDate?.getDay() === 0;
    const isInSundayWindow = startMs >= ventanasClub.domingo.startMs;
    if (isSundayLogical || isInSundayWindow) {
      recordFailure(
        `sin_zonas_en_domingo:${etapa}`,
        seed,
        `Partido de zona ${p.id} agendado en domingo: ${d.toISOString()}`
      );
    }
  }

  // 5. P3/P4 de mini-bracket empiezan después del fin de P1 y P2
  // (P3/P4 con horario se permiten con P1/P2 en partidosSinSlot solo si P3/P4 están en una jornada distinta de la del override. Si están en el mismo día, es falla.)
  const zonasMiniBracket = zonas.filter((z) => z.formato === 'MINI_BRACKET');
  for (const z of zonasMiniBracket) {
    const zPartidos = partidos.filter((p) => p.zonaId === z.id);
    const p1 = zPartidos.find((p) => p.posicionEnRonda === 1);
    const p2 = zPartidos.find((p) => p.posicionEnRonda === 2);
    const p3 = zPartidos.find((p) => p.posicionEnRonda === 3);
    const p4 = zPartidos.find((p) => p.posicionEnRonda === 4);

    for (const m of [p3, p4].filter(Boolean)) {
      if (m.fechaHora && !m.sinHorarioAsignado) {
        const mStart = new Date(m.fechaHora).getTime();
        const p1Valid = p1 && p1.fechaHora && !p1.sinHorarioAsignado;
        const p2Valid = p2 && p2.fechaHora && !p2.sinHorarioAsignado;

        const mDiaKey = getDiaCalendarioConTrasnoche(m.fechaHora, organizador)?.key;
        const esDistintaJornada = Boolean(overrideDiaKey && mDiaKey && mDiaKey !== overrideDiaKey);

        const p1Allowed = p1Valid || (esDistintaJornada && Boolean(p1 && partidosSinSlotMap[p1.id]));
        const p2Allowed = p2Valid || (esDistintaJornada && Boolean(p2 && partidosSinSlotMap[p2.id]));
        if (!p1Allowed || !p2Allowed) {
          recordFailure(
            `mini_bracket_orden_p3_p4:${etapa}`,
            seed,
            `Zona ${z.nombre}: P${m.posicionEnRonda} tiene horario (${new Date(mStart).toISOString()}) pero P1 o P2 no tienen horario`
          );
        } else if (!partidosManualesSet.has(m.id)) {
          const endTimes = [];
          if (p1Valid) endTimes.push(new Date(p1.fechaHora).getTime() + DURACION_MS);
          if (p2Valid) endTimes.push(new Date(p2.fechaHora).getTime() + DURACION_MS);
          if (endTimes.length > 0) {
            const minAllowed = Math.max(...endTimes);
            if (mStart < minAllowed) {
              recordFailure(
                `mini_bracket_orden_p3_p4:${etapa}`,
                seed,
                `Zona ${z.nombre}: P${m.posicionEnRonda} empieza en ${new Date(mStart).toISOString()} antes del fin de P1/P2 (${new Date(minAllowed).toISOString()})`
              );
            }
          }
        }
      }
    }
  }

  // 6. Eliminatorias: descanso de al menos 75 min entre rondas y nada antes del fin de zonas
  const partidosElim = partidos.filter((p) => p.faseEliminatoriaId != null);
  const maxEndZonasPorCat = new Map();
  for (const p of agendados) {
    if (p.zonaId) {
      const endMs = new Date(p.fechaHora).getTime() + DURACION_MS;
      const cur = maxEndZonasPorCat.get(p.categoriaId) || 0;
      if (endMs > cur) maxEndZonasPorCat.set(p.categoriaId, endMs);
    }
  }

  const elimMap = new Map();
  for (const pe of partidosElim) {
    if (pe.faseEliminatoria) {
      elimMap.set(`${pe.categoriaId}:${pe.faseEliminatoria.ronda}:${pe.posicionEnRonda}`, pe);
    }
  }

  for (const pe of partidosElim) {
    if (!pe.fechaHora || pe.sinHorarioAsignado || pe.esBye || !pe.faseEliminatoria) continue;
    const peStart = new Date(pe.fechaHora).getTime();

    // 6a. Nada antes del fin de zonas
    const maxZonaEnd = maxEndZonasPorCat.get(pe.categoriaId) || 0;
    if (maxZonaEnd > 0 && peStart < maxZonaEnd) {
      recordFailure(
        `eliminatorias_descanso_y_post_zonas:${etapa}`,
        seed,
        `Partido eliminatoria (ronda ${pe.faseEliminatoria.ronda}) arranca en ${new Date(peStart).toISOString()} antes del fin de zonas (${new Date(maxZonaEnd).toISOString()})`
      );
    }

    // 6b. Descanso de al menos 75 min entre rondas
    const parentRonda = pe.faseEliminatoria.ronda * 2;
    const p1 = elimMap.get(`${pe.categoriaId}:${parentRonda}:${pe.posicionEnRonda * 2 - 1}`);
    const p2 = elimMap.get(`${pe.categoriaId}:${parentRonda}:${pe.posicionEnRonda * 2}`);
    for (const parent of [p1, p2].filter(Boolean)) {
      if (parent.fechaHora && !parent.sinHorarioAsignado && !parent.esBye) {
        const parentEnd = new Date(parent.fechaHora).getTime() + DURACION_MS;
        const restMs = peStart - parentEnd;
        if (restMs < 75 * 60 * 1000) {
          recordFailure(
            `eliminatorias_descanso_y_post_zonas:${etapa}`,
            seed,
            `Descanso insuficiente (${Math.round(restMs / 60000)} min < 75 min) entre ronda ${parentRonda} (${new Date(parentEnd).toISOString()}) y ronda ${pe.faseEliminatoria.ronda} (${new Date(peStart).toISOString()})`
          );
        }
      }
    }
  }
}

async function runSingleSeed(seed, recordFailure) {
  const rng = createPRNG(seed);

  const origRandom = Math.random;
  Math.random = () => rng.next();

  try {
    await limpiarDatosTorneo();

    const cantidadCanchas = rng.int(2, 6);
    const viernesInicio = rng.pick(['15:00', '16:00', '17:00', '18:00']);
    const viernesFin = rng.pick(['23:30', '00:30', '01:30', '02:00']);
    const sabadoInicio = rng.pick(['08:00', '09:00', '10:00']);
    const sabadoFin = rng.pick(['23:30', '00:30', '01:30', '02:00']);
    const domingoInicio = rng.pick(['08:00', '09:00', '10:00']);
    const domingoFin = rng.pick(['21:00', '22:00', '23:00']);

    const organizador = await prisma.organizador.create({
      data: {
        nombre: `Club Fuzz Seed ${seed}`,
        email: `fuzz-seed-${seed}@padel.test`,
        passwordHash: 'hash',
        cantidadCanchas,
        viernesInicio,
        viernesFin,
        sabadoInicio,
        sabadoFin,
        domingoInicio,
        domingoFin,
      },
    });

    const refFechaStr = '2026-09-04'; // Viernes
    const refFecha = parseFechaLocal(refFechaStr);
    const torneo = await prisma.torneo.create({
      data: {
        nombre: `Torneo Fuzz ${seed}`,
        slug: `torneo-fuzz-${seed}`,
        fecha: refFecha,
        estado: 'BORRADOR',
        organizadorId: organizador.id,
      },
    });

    const grilla = generarGrillaOrganizador(organizador);
    const numCategorias = rng.int(2, 3);
    const nombresCat = ['4ta', '5ta', '6ta', '7ma'];
    const categorias = [];

    for (let cIdx = 0; cIdx < numCategorias; cIdx++) {
      const cat = await prisma.categoria.create({
        data: {
          torneoId: torneo.id,
          nombre: nombresCat[cIdx],
          estado: 'BORRADOR',
        },
      });
      categorias.push(cat);

      const numParejas = rng.int(8, 30);
      const parejasData = [];
      const slotsPorOrden = new Map();

      for (let pIdx = 1; pIdx <= numParejas; pIdx++) {
        parejasData.push({
          categoriaId: cat.id,
          jugador1: `S${seed}_C${cIdx + 1}_P${pIdx}_A`,
          jugador2: `S${seed}_C${cIdx + 1}_P${pIdx}_B`,
          orden: pIdx,
        });
        slotsPorOrden.set(pIdx, generarSlotsDisponibilidadPareja(rng, grilla));
      }

      await prisma.pareja.createMany({ data: parejasData });
      const parejasCreadas = await prisma.pareja.findMany({
        where: { categoriaId: cat.id },
        orderBy: { orden: 'asc' },
      });

      const slotParejaRows = [];
      for (const p of parejasCreadas) {
        const slots = slotsPorOrden.get(p.orden) || [];
        for (const slotId of slots) {
          slotParejaRows.push({ parejaId: p.id, slotId });
        }
      }

      if (slotParejaRows.length > 0) {
        await prisma.slotPareja.createMany({ data: slotParejaRows });
      }
    }

    // =========================================================================
    // PRE-CHECK: MONOTONÍA (NO SUBE) Y ZONAS MANUALES DESTRABADAS CON PARTIDOS
    // =========================================================================
    let preCheck = await organizadorService.preCheckInicioTorneo(organizador.id, torneo.id);
    let session = organizadorService.preCheckSessions.get(torneo.id);

    const zonasManualesVistas = new Set();
    const registrarZonasManuales = (sess) => {
      if (!sess || !Array.isArray(sess.categoriasPlan)) return;
      for (const cPlan of sess.categoriasPlan) {
        for (const z of cPlan.zonas || []) {
          if (z.requiereArmadoManual) {
            zonasManualesVistas.add(`${cPlan.categoriaId}:${z.nombre}`);
          }
        }
      }
    };
    registrarZonasManuales(session);

    let baseConflictosList = obtenerConflictosBase(preCheck, session);
    let prevBaseConflictos = baseConflictosList.length;
    const triedActions = new Set();
    let maxGuard = 0;

    while (preCheck.bloqueado && prevBaseConflictos > 0 && maxGuard < 10) {
      maxGuard++;

      // Elegir un conflicto base que aún no hayamos intentado con el mismo slot
      let conf = null;
      for (const cand of baseConflictosList) {
        if (!triedActions.has(cand.partidoId)) {
          conf = cand;
          break;
        }
      }
      if (!conf) {
        conf = baseConflictosList[0];
      }
      if (!conf) break;

      triedActions.add(conf.partidoId);
      let resolvedActionTaken = false;

      if (conf.motivo === 'ZONA_MANUAL_INCOMPLETA') {
        const manuales = conf.parejasManuales || [];
        let slotElegido = null;
        for (const pm of manuales) {
          if (pm.slotsQueDestraban && pm.slotsQueDestraban.length > 0) {
            slotElegido = pm.slotsQueDestraban[0];
            break;
          }
        }
        if (!slotElegido && manuales.length > 0 && manuales[0].slotsViables?.length > 0) {
          slotElegido = manuales[0].slotsViables[0];
        }

        if (slotElegido && manuales.length >= 2) {
          if (conf.crucesIncompatibles && conf.crucesIncompatibles.length > 0) {
            // Destrabar todos los cruces incompatibles de la zona manual con el slot elegido
            for (const cruce of conf.crucesIncompatibles) {
              await disponibilidadService.setDisponibilidadDoble(
                organizador.id,
                cruce.p1Id,
                [slotElegido],
                cruce.p2Id,
                [slotElegido]
              );
            }
            resolvedActionTaken = true;
          } else {
            // Caso MINI_BRACKET P3/P4: agregar slotElegido a los pares de la zona
            for (let i = 0; i < manuales.length; i += 2) {
              const pA = manuales[i];
              const pB = manuales[i + 1] || manuales[0];
              if (pA && pB && pA.id !== pB.id) {
                await disponibilidadService.setDisponibilidadDoble(
                  organizador.id,
                  pA.id,
                  [slotElegido],
                  pB.id,
                  [slotElegido]
                );
                resolvedActionTaken = true;
              }
            }
          }
        }
      } else if (conf.pareja1Id && conf.pareja2Id) {
        const slotElegido =
          conf.opcionesResolucion?.[0]?.slotId ||
          conf.slotsViables?.[0] ||
          null;
        if (slotElegido) {
          await disponibilidadService.setDisponibilidadDoble(
            organizador.id,
            conf.pareja1Id,
            [slotElegido],
            conf.pareja2Id,
            [slotElegido]
          );
          resolvedActionTaken = true;
        }
      }

      if (!resolvedActionTaken) {
        continue;
      }

      preCheck = await organizadorService.preCheckInicioTorneo(organizador.id, torneo.id, {
        isReCheck: true,
      });
      session = organizadorService.preCheckSessions.get(torneo.id);
      registrarZonasManuales(session);

      // Verificar invariante nuevo: si una zona manual quedó 100% destrabada, tiene que tener partidos creados
      if (session && Array.isArray(session.categoriasPlan)) {
        for (const cPlan of session.categoriasPlan) {
          for (const z of cPlan.zonas || []) {
            const zKey = `${cPlan.categoriaId}:${z.nombre}`;
            if (zonasManualesVistas.has(zKey) && !z.requiereArmadoManual) {
              if (!Array.isArray(z.partidos) || z.partidos.length === 0) {
                recordFailure(
                  'precheck_zona_manual_partidos:post-inicio',
                  seed,
                  `Zona manual "${z.nombre}" (cat ${cPlan.nombre}) quedó 100% destrabada (requiereArmadoManual=false) pero tiene 0 partidos creados`
                );
              }
            }
          }
        }
      }

      baseConflictosList = obtenerConflictosBase(preCheck, session);
      const currentBaseConflictos = baseConflictosList.length;

      // Exigir que el total de conflictos base nunca suba (sin break: registra y sigue)
      if (currentBaseConflictos > prevBaseConflictos) {
        recordFailure(
          'precheck_monotonia:post-inicio',
          seed,
          `El total de conflictos base subió tras resolver (${conf.motivo}): pasó de ${prevBaseConflictos} a ${currentBaseConflictos}`
        );
      }
      prevBaseConflictos = currentBaseConflictos;
    }

    // =========================================================================
    // ETAPA 1: POST-INICIO
    // =========================================================================
    const planIdToUse = preCheck.planId || preCheck.planEmergenciaId || null;
    if (planIdToUse) {
      await organizadorService.iniciarTorneoMultiCategoria(organizador.id, torneo.id, planIdToUse);
    } else {
      for (const cat of categorias) {
        await zonaService.iniciarCategoria(organizador.id, cat.id);
      }
      await zonaService.asignarHorariosAutomatico(
        organizador.id,
        categorias.map((c) => c.id)
      );
      await prisma.torneo.update({ where: { id: torneo.id }, data: { estado: 'EN_CURSO' } });
      for (const cat of categorias) {
        try {
          await generarEliminatoria(organizador.id, cat.id);
        } catch (_) {}
      }
      await programarHorariosEliminatorias(organizador.id, torneo.id);
    }

    const partidosIniciales = await prisma.partido.findMany({
      where: { categoria: { torneoId: torneo.id } },
      include: { faseEliminatoria: true },
    });
    const zonasTorneo = await prisma.zona.findMany({
      where: { categoria: { torneoId: torneo.id } },
    });

    verificarInvariantesPorEtapa({
      partidos: partidosIniciales,
      zonas: zonasTorneo,
      organizador,
      refFecha,
      recordFailure,
      seed,
      etapa: 'post-inicio',
      allowDayLimitMs: false,
    });

    if (FUZZ_METRICAS) {
      let seedHasR32 = false;
      let seedHasSinHorario = false;
      for (const p of partidosIniciales) {
        if (p.faseEliminatoria && p.faseEliminatoria.ronda >= 32 && !p.esBye) {
          r32FuzzStats.totalR32NoBye++;
          seedHasR32 = true;
          if (!p.fechaHora || p.sinHorarioAsignado) {
            r32FuzzStats.sinHorarioR32++;
            seedHasSinHorario = true;
          }
        }
      }
      if (seedHasR32) r32FuzzStats.seedsConR32.add(seed);
      if (seedHasSinHorario) r32FuzzStats.seedsConSinHorarioR32.add(seed);
    }

    // =========================================================================
    // ETAPA 2: POST-REDUCCION (MODO LLUVIA)
    // =========================================================================
    const horariosClubObj = {
      viernesInicio: organizador.viernesInicio,
      viernesFin: organizador.viernesFin,
      sabadoInicio: organizador.sabadoInicio,
      sabadoFin: organizador.sabadoFin,
      domingoInicio: organizador.domingoInicio,
      domingoFin: organizador.domingoFin,
    };

    // Reasignar al azar algunos P3/P4 con asignarHorarioManual a horarios anteriores al fin de su R1 (permitido por diseño)
    const partidosManualesSet = new Set();
    const ventanasFuzz = getVentanasClub(organizador, refFecha);

    const hasMiniBracket = zonasTorneo.some((z) => z.formato === 'MINI_BRACKET');
    if (hasMiniBracket) {
      manualFuzzStats.totalSeedsConZonasDe4.add(seed);
    }

    for (const z of zonasTorneo) {
      if (z.formato !== 'MINI_BRACKET') continue;
      const zPartidos = partidosIniciales.filter((p) => p.zonaId === z.id);
      const p1 = zPartidos.find((p) => p.posicionEnRonda === 1);
      const p2 = zPartidos.find((p) => p.posicionEnRonda === 2);
      const p3 = zPartidos.find((p) => p.posicionEnRonda === 3);
      const p4 = zPartidos.find((p) => p.posicionEnRonda === 4);

      if (!p1?.fechaHora || !p2?.fechaHora) continue;
      const r1EndMax = Math.max(
        new Date(p1.fechaHora).getTime() + DURACION_MS,
        new Date(p2.fechaHora).getTime() + DURACION_MS
      );

      for (const m of [p3, p4].filter(Boolean)) {
        if (!m.fechaHora || m.sinHorarioAsignado) continue;
        if (rng.next() < 0.35) {
          const targetDayInfo = getDiaCalendarioConTrasnoche(m.fechaHora, horariosClubObj);
          if (!targetDayInfo) continue;
          const isFriday = targetDayInfo.logicalDate.getDay() === 5;
          const dayWindow = isFriday ? ventanasFuzz.viernes : ventanasFuzz.sabado;
          const dayStartMs = dayWindow.startMs;

          const candidateStarts = [];
          for (let t = dayStartMs; t + DURACION_MS <= r1EndMax; t += 15 * 60 * 1000) {
            candidateStarts.push(t);
          }

          if (candidateStarts.length > 0) {
            manualFuzzStats.intentosPartidos++;
            const shufStarts = rng.shuffle(candidateStarts);
            let asignado = false;
            for (const tCand of shufStarts.slice(0, 6)) {
              for (let c = 1; c <= cantidadCanchas; c++) {
                manualFuzzStats.llamadasAsignar++;
                try {
                  await partidoService.asignarHorarioManual(organizador.id, m.id, {
                    fechaHora: new Date(tCand),
                    canchaNumero: c,
                  });
                  manualFuzzStats.aceptadas++;
                  manualFuzzStats.seedsConReasignacionAceptada.add(seed);
                  partidosManualesSet.add(m.id);
                  asignado = true;
                  break;
                } catch (err) {
                  manualFuzzStats.rechazadas++;
                  const msg = err.message || 'Sin mensaje';
                  manualFuzzStats.mensajesRechazo[msg] = (manualFuzzStats.mensajesRechazo[msg] || 0) + 1;
                }
              }
              if (asignado) break;
            }
          }
        }
      }
    }

    const baseFriday = zonaService.proximaFechaPorDia('Viernes', refFecha);
    const baseSaturday = zonaService.proximaFechaPorDia('Sabado', refFecha);
    const friKey = getDiaCalendarioConTrasnoche(parseFechaLocal(baseFriday), horariosClubObj).key;
    const satKey = getDiaCalendarioConTrasnoche(parseFechaLocal(baseSaturday), horariosClubObj).key;

    const targetDiaKey = rng.next() < 0.5 ? friKey : satKey;
    const canchasReducidas = rng.int(1, cantidadCanchas - 1);

    const partidosTrasManual = await prisma.partido.findMany({
      where: { categoria: { torneoId: torneo.id } },
      include: { faseEliminatoria: true },
    });

    const candidatosEstado = partidosTrasManual.filter((p) => {
      if (!p.fechaHora || !p.canchaNumero || p.sinHorarioAsignado || p.esBye) return false;
      if (!p.pareja1Id || !p.pareja2Id) return false;
      const dKey = getDiaCalendarioConTrasnoche(p.fechaHora, horariosClubObj)?.key;
      return dKey === targetDiaKey && p.canchaNumero <= canchasReducidas;
    });

    if (candidatosEstado.length >= 1) {
      await prisma.partido.update({
        where: { id: candidatosEstado[0].id },
        data: { estado: 'FINALIZADO', ganadorId: candidatosEstado[0].pareja1Id },
      });
    }
    if (candidatosEstado.length >= 2) {
      await prisma.partido.update({
        where: { id: candidatosEstado[1].id },
        data: { estado: 'EN_CURSO' },
      });
    }

    const partidosAntesLluvia = await prisma.partido.findMany({
      where: { categoria: { torneoId: torneo.id } },
      include: { faseEliminatoria: true },
    });
    const antesMap = new Map(partidosAntesLluvia.map((p) => [p.id, p]));
    const countAgendadosAntes = partidosAntesLluvia.filter(
      (p) => p.fechaHora && p.canchaNumero && !p.sinHorarioAsignado && !p.esBye
    ).length;

    await organizadorService.reprogramarPorReduccionCanchas(
      organizador.id,
      torneo.id,
      canchasReducidas,
      null,
      targetDiaKey
    );

    const diaOverrideInfo = canchasOverridesService.getCanchasDia(
      torneo.id,
      targetDiaKey,
      cantidadCanchas
    );
    const partidosSinSlotMap = diaOverrideInfo?.partidosSinSlot || {};

    // Invariante: que no aparezcan ids de otras jornadas en partidosSinSlot del día reducido
    for (const sinSlotId of Object.keys(partidosSinSlotMap)) {
      const orig = antesMap.get(sinSlotId);
      if (orig && orig.fechaHora) {
        const origDiaKey = getDiaCalendarioConTrasnoche(orig.fechaHora, horariosClubObj)?.key;
        if (origDiaKey && origDiaKey !== targetDiaKey) {
          recordFailure(
            'modo_lluvia:post-reduccion',
            seed,
            `partidosSinSlot de ${targetDiaKey} contiene el partido ${sinSlotId} que pertenece a otra jornada (${origDiaKey})`
          );
        }
      }
    }

    const partidosPostReduccion = await prisma.partido.findMany({
      where: { categoria: { torneoId: torneo.id } },
      include: { faseEliminatoria: true },
    });

    for (const p of partidosPostReduccion) {
      const orig = antesMap.get(p.id);
      if (!orig) continue;

      if (orig.estado === 'FINALIZADO' || orig.estado === 'EN_CURSO') {
        const origTime = orig.fechaHora ? new Date(orig.fechaHora).getTime() : null;
        const newTime = p.fechaHora ? new Date(p.fechaHora).getTime() : null;
        if (origTime !== newTime || orig.canchaNumero !== p.canchaNumero || p.estado !== orig.estado) {
          recordFailure(
            'modo_lluvia:post-reduccion',
            seed,
            `Partido ${orig.estado} ${p.id} fue alterado en reducción de modo lluvia`
          );
        }
      }

      if (orig.fechaHora) {
        const origDiaKey = getDiaCalendarioConTrasnoche(orig.fechaHora, horariosClubObj)?.key;
        if (origDiaKey && origDiaKey !== targetDiaKey) {
          const origTime = new Date(orig.fechaHora).getTime();
          const newTime = p.fechaHora ? new Date(p.fechaHora).getTime() : null;
          if (
            origTime !== newTime ||
            orig.canchaNumero !== p.canchaNumero ||
            orig.sinHorarioAsignado !== p.sinHorarioAsignado
          ) {
            recordFailure(
              'modo_lluvia:post-reduccion',
              seed,
              `Partido ${p.id} de otro día (${origDiaKey} != ${targetDiaKey}) fue modificado en reducción`
            );
          }
        }
      }

      // Excepción de diseño: no marcar falla a PENDIENTE en cancha > activas si está en partidosSinSlot
      if (p.estado === 'PENDIENTE' && p.fechaHora && !p.sinHorarioAsignado && p.canchaNumero) {
        const pDiaKey = getDiaCalendarioConTrasnoche(p.fechaHora, horariosClubObj)?.key;
        if (
          pDiaKey === targetDiaKey &&
          p.canchaNumero > canchasReducidas &&
          !partidosSinSlotMap[p.id]
        ) {
          recordFailure(
            'modo_lluvia:post-reduccion',
            seed,
            `Partido PENDIENTE ${p.id} quedó en cancha ${p.canchaNumero} > canchasActivas (${canchasReducidas}) sin estar en partidosSinSlot`
          );
        }
      }
    }

    verificarInvariantesPorEtapa({
      partidos: partidosPostReduccion,
      zonas: zonasTorneo,
      organizador,
      refFecha,
      recordFailure,
      seed,
      etapa: 'post-reduccion',
      allowDayLimitMs: true,
      partidosSinSlotMap,
      overrideDiaKey: targetDiaKey,
      partidosManualesSet,
    });

    // =========================================================================
    // ETAPA 3: POST-RESTAURACION (MODO LLUVIA)
    // =========================================================================
    await organizadorService.reprogramarPorReduccionCanchas(
      organizador.id,
      torneo.id,
      cantidadCanchas,
      null,
      targetDiaKey
    );

    const partidosPostRestauracion = await prisma.partido.findMany({
      where: { categoria: { torneoId: torneo.id } },
      include: { faseEliminatoria: true },
    });

    for (const p of partidosPostRestauracion) {
      const orig = antesMap.get(p.id);
      if (!orig) continue;

      if (orig.estado === 'FINALIZADO' || orig.estado === 'EN_CURSO') {
        const origTime = orig.fechaHora ? new Date(orig.fechaHora).getTime() : null;
        const newTime = p.fechaHora ? new Date(p.fechaHora).getTime() : null;
        if (origTime !== newTime || orig.canchaNumero !== p.canchaNumero || p.estado !== orig.estado) {
          recordFailure(
            'modo_lluvia:post-restauracion',
            seed,
            `Partido ${orig.estado} ${p.id} fue alterado tras restauración de modo lluvia`
          );
        }
      }

      if (orig.fechaHora) {
        const origDiaKey = getDiaCalendarioConTrasnoche(orig.fechaHora, horariosClubObj)?.key;
        if (origDiaKey && origDiaKey !== targetDiaKey) {
          const origTime = new Date(orig.fechaHora).getTime();
          const newTime = p.fechaHora ? new Date(p.fechaHora).getTime() : null;
          if (
            origTime !== newTime ||
            orig.canchaNumero !== p.canchaNumero ||
            orig.sinHorarioAsignado !== p.sinHorarioAsignado
          ) {
            recordFailure(
              'modo_lluvia:post-restauracion',
              seed,
              `Partido ${p.id} de otro día (${origDiaKey} != ${targetDiaKey}) fue modificado en restauración`
            );
          }
        }
      }
    }

    const countAgendadosPostRestauracion = partidosPostRestauracion.filter(
      (p) => p.fechaHora && p.canchaNumero && !p.sinHorarioAsignado && !p.esBye
    ).length;

    if (countAgendadosPostRestauracion < countAgendadosAntes) {
      recordFailure(
        'modo_lluvia:post-restauracion',
        seed,
        `Pérdida de partidos agendados tras reducir y restaurar en ${targetDiaKey}: antes=${countAgendadosAntes}, después=${countAgendadosPostRestauracion}`
      );
    }

    verificarInvariantesPorEtapa({
      partidos: partidosPostRestauracion,
      zonas: zonasTorneo,
      organizador,
      refFecha,
      recordFailure,
      seed,
      etapa: 'post-restauracion',
      allowDayLimitMs: true,
      partidosManualesSet,
    });
  } finally {
    Math.random = origRandom;
  }
}

async function runFuzzSuite() {
  await ensureTestDb();
  resetTestDb();
  const { server, baseUrl } = await startTestServer();

  console.log('='.repeat(85));
  console.log(`🎲 FUZZ SCHEDULER SUITE POR ETAPA (${TOTAL_SEEDS} semillas reproducibles, rango ${START_SEED}..${END_SEED})`);
  console.log(`🌐 Test Server activo en: ${baseUrl}`);
  console.log('='.repeat(85));

  const STAGES = ['post-inicio', 'post-reduccion', 'post-restauracion'];
  const STATIC_BASE_KEYS = [
    'cancha_sin_solapamiento',
    'pareja_sin_solapamiento',
    'grilla_15m_y_horario_club',
    'sin_zonas_en_domingo',
    'mini_bracket_orden_p3_p4',
    'eliminatorias_descanso_y_post_zonas',
  ];

  const INVARIANT_KEYS = [
    ...STATIC_BASE_KEYS.flatMap((base) => STAGES.map((st) => `${base}:${st}`)),
    'modo_lluvia:post-reduccion',
    'modo_lluvia:post-restauracion',
    'precheck_monotonia:post-inicio',
    'precheck_zona_manual_partidos:post-inicio',
  ];

  const stats = {};
  for (const k of INVARIANT_KEYS) {
    stats[k] = {
      fallasCount: 0,
      semillasAfectadas: new Set(),
      minSeed: null,
      primerDetalle: null,
    };
  }

  function recordFailure(invariantKey, seed, detail) {
    const entry = stats[invariantKey];
    if (!entry) return;
    entry.fallasCount++;
    if (!entry.semillasAfectadas.has(seed)) {
      entry.semillasAfectadas.add(seed);
      if (entry.minSeed === null || seed < entry.minSeed) {
        entry.minSeed = seed;
        entry.primerDetalle = detail;
      }
    }
  }

  const startTime = Date.now();

  try {
    for (let seed = START_SEED; seed <= END_SEED; seed++) {
      const beforeSeedFailures = INVARIANT_KEYS.reduce(
        (acc, k) => acc + stats[k].semillasAfectadas.size,
        0
      );

      try {
        await runSingleSeed(seed, recordFailure);
      } catch (err) {
        console.error(`❌ [SEED ${seed}] Excepción no controlada: ${err.message}`);
        throw err;
      }

      const afterSeedFailures = INVARIANT_KEYS.reduce(
        (acc, k) => acc + stats[k].semillasAfectadas.size,
        0
      );

      if (afterSeedFailures > beforeSeedFailures) {
        const failedInvariantsForSeed = INVARIANT_KEYS.filter((k) =>
          stats[k].semillasAfectadas.has(seed)
        );
        console.log(`⚠️  Semilla ${seed} falló en: ${failedInvariantsForSeed.join(', ')}`);
      }

      const semillasEjecutadas = seed - START_SEED + 1;
      if (semillasEjecutadas % 50 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`⏱️  Progreso: ${semillasEjecutadas}/${TOTAL_SEEDS} semillas ejecutadas (${elapsed}s)`);
      }
    }
  } finally {
    await limpiarDatosTorneo();
    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
  }

  console.log('\n' + '='.repeat(85));
  console.log(`📊 REPORTE DE INVARIANTES POR ETAPA (${TOTAL_SEEDS} semillas)`);
  console.log('='.repeat(85));

  const resumenTabla = INVARIANT_KEYS.map((k) => {
    const [invariante, etapa] = k.split(':');
    return {
      invariante,
      etapa,
      estado: stats[k].semillasAfectadas.size === 0 ? 'PASS' : 'FAIL',
      semillasConFalla: stats[k].semillasAfectadas.size,
      semillaMinima: stats[k].minSeed ?? '-',
    };
  });

  console.table(resumenTabla);

  console.log('\n' + '='.repeat(85));
  console.log('📌 ESTADÍSTICAS DE REASIGNACIÓN MANUAL P3/P4 PRE-R1:');
  console.log('='.repeat(85));
  console.log(`- Semillas con zonas de 4 (MINI_BRACKET): ${manualFuzzStats.totalSeedsConZonasDe4.size}`);
  console.log(`- Semillas con al menos una reasignación aceptada: ${manualFuzzStats.seedsConReasignacionAceptada.size}`);
  const pct = manualFuzzStats.totalSeedsConZonasDe4.size > 0
    ? ((manualFuzzStats.seedsConReasignacionAceptada.size / manualFuzzStats.totalSeedsConZonasDe4.size) * 100).toFixed(1)
    : '0';
  console.log(`- Porcentaje de semillas con zonas de 4 con reasignación aceptada: ${pct}%`);
  console.log(`- Partidos P3/P4 candidatos con intento: ${manualFuzzStats.intentosPartidos}`);
  console.log(`- Total llamadas a asignarHorarioManual: ${manualFuzzStats.llamadasAsignar}`);
  console.log(`- Llamadas aceptadas: ${manualFuzzStats.aceptadas}`);
  console.log(`- Llamadas rechazadas: ${manualFuzzStats.rechazadas}`);
  console.log('- Detalle de mensajes de rechazo:');
  for (const [msg, cnt] of Object.entries(manualFuzzStats.mensajesRechazo)) {
    console.log(`    * [${cnt} veces] ${msg}`);
  }
  console.log('='.repeat(85) + '\n');

  if (FUZZ_METRICAS) {
    console.log('='.repeat(85));
    console.log('📊 MÉTRICAS R32 EN POST-INICIO (FUZZ_METRICAS=1):');
    console.log('='.repeat(85));
    console.log(`- Semillas con partidos R32 no-BYE: ${r32FuzzStats.seedsConR32.size} (${((r32FuzzStats.seedsConR32.size / TOTAL_SEEDS) * 100).toFixed(1)}%)`);
    console.log(`- Total de partidos R32 no-BYE generados: ${r32FuzzStats.totalR32NoBye}`);
    console.log(`- Partidos R32 no-BYE sin horario: ${r32FuzzStats.sinHorarioR32}`);
    const pctP = r32FuzzStats.totalR32NoBye > 0 ? ((r32FuzzStats.sinHorarioR32 / r32FuzzStats.totalR32NoBye) * 100).toFixed(1) : '0';
    console.log(`- Porcentaje de partidos R32 sin horario: ${pctP}% (${r32FuzzStats.sinHorarioR32}/${r32FuzzStats.totalR32NoBye})`);
    const pctS = r32FuzzStats.seedsConR32.size > 0 ? ((r32FuzzStats.seedsConSinHorarioR32.size / r32FuzzStats.seedsConR32.size) * 100).toFixed(1) : '0';
    console.log(`- Semillas con al menos un R32 sin horario: ${r32FuzzStats.seedsConSinHorarioR32.size}/${r32FuzzStats.seedsConR32.size} (${pctS}%)`);
    console.log('='.repeat(85) + '\n');
  }

  let hayFallas = false;
  for (const k of INVARIANT_KEYS) {
    if (stats[k].minSeed !== null) {
      hayFallas = true;
      console.error(
        `❌ [${k}] Semilla mínima: ${stats[k].minSeed} (${stats[k].semillasAfectadas.size}/${TOTAL_SEEDS} semillas) -> ${stats[k].primerDetalle}`
      );
    }
  }

  if (hayFallas) {
    process.exit(1);
  }
}

if (require.main === module) {
  runFuzzSuite().catch((err) => {
    console.error('❌ Error fatal en test-fuzz-scheduler:', err);
    process.exit(1);
  });
}

module.exports = { runFuzzSuite };
