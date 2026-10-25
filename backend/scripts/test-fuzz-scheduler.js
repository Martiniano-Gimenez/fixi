'use strict';

const { ensureTestDb } = require('./utils/testEnvGuard');
const { resetTestDb } = require('./reset-test-db');
const { startTestServer } = require('./utils/testServer');
const { obtenerConflictosBase, clasificarPasoMonotonia } = require('./utils/monotoniaPrecheck');
const prisma = require('../src/lib/prisma');
const organizadorService = require('../src/services/organizador.service');
const zonaService = require('../src/services/zona.service');
const disponibilidadService = require('../src/services/disponibilidad.service');
const partidoService = require('../src/services/partido.service');
const { generarEliminatoria } = require('../src/services/faseEliminatoria.service');
const { programarHorariosEliminatorias } = require('../src/services/eliminatoriaScheduler.service');
const canchasOverridesService = require('../src/services/canchasOverrides.service');
const fs = require('fs');
const { hashEstadoTorneo, hashPlanPrecheck } = require('./utils/estadoCanonico');
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
// Si está definida, cada semilla escribe "<semilla> <etapa> <sha256>" por etapa (estado canónico sin UUID,
// ver utils/estadoCanonico.js). Sirve para comparar corridas: misma semilla, mismos hashes.
const FUZZ_HASH_OUT = process.env.FUZZ_HASH_OUT || null;

async function registrarHashEtapa(seed, etapa, { torneoId = null, categoriasPlan = null } = {}) {
  if (!FUZZ_HASH_OUT) return;
  const hash = categoriasPlan ? await hashPlanPrecheck(prisma, categoriasPlan) : await hashEstadoTorneo(prisma, torneoId);
  fs.appendFileSync(FUZZ_HASH_OUT, `${seed} ${etapa} ${hash}
`);
}

const r32FuzzStats = {
  totalR32NoBye: 0,
  sinHorarioR32: 0,
  seedsConR32: new Set(),
  seedsConR32ConHorario: new Set(),
  seedsConSinHorarioR32: new Set(),
};

// Métrica informativa (no es invariante): partidos que la reducción por lluvia deja sin horario
// (pasan a la bandeja de pendientes), por perfil del generador y día reducido.
const bandejaStats = {};
function registrarBandeja(perfil, dia, seed, cantidad) {
  const k = `perfil=${perfil} dia=${dia}`;
  if (!bandejaStats[k]) bandejaStats[k] = { semillasReducidas: 0, semillasConBandeja: 0, partidos: 0 };
  bandejaStats[k].semillasReducidas++;
  if (cantidad > 0) bandejaStats[k].semillasConBandeja++;
  bandejaStats[k].partidos += cantidad;
}

/**
 * Mapa partidoId → minutosDespuesDelCierre tal como lo expone getEstadoEnVivo (admin).
 */
async function mapaMinutosEnVivo(organizadorId, torneoId) {
  const estado = await organizadorService.getEstadoEnVivo(organizadorId, torneoId);
  const mapa = new Map();
  const listas = [
    estado.partidosEnCurso,
    estado.proximosPartidos,
    estado.partidosEnCanchaFantasma,
    estado.partidosFinalizados,
  ];
  for (const lista of listas) {
    for (const p of lista || []) mapa.set(p.id, p.minutosDespuesDelCierre);
  }
  return mapa;
}

const perfilStats = {
  standard: {
    nombre: 'Standard / Estrés Original (Semillas Pares)',
    totalSeeds: 0,
    seedsConR32: new Set(),
    seedsConR32ConHorario: new Set(),
    seedsConSinHorarioR32: new Set(),
    totalR32NoBye: 0,
    sinHorarioR32: 0,
    fallasPorInvariante: {},
  },
  sabado_extendido: {
    nombre: 'Sábado Extendido (Semillas Impares)',
    totalSeeds: 0,
    seedsConR32: new Set(),
    seedsConR32ConHorario: new Set(),
    seedsConSinHorarioR32: new Set(),
    totalR32NoBye: 0,
    sinHorarioR32: 0,
    fallasPorInvariante: {},
  },
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

const manualFuzzInvariantsStats = {
  failingSeeds: new Set(),
  porRegla: {
    loopDestrabeSinPartidos: new Set(),
    regla1o5Parejas: new Set(),
    formatoCantidadPartidos: new Set(),
    parejasNullOOrigen: new Set(),
    horarioOPendiente: new Set(),
    miniBracketOrigenPersistido: new Set(),
    excepcionesNoControladas: new Set(),
  },
};

const planesInicioStats = {
  totalCategorias: 0,
  iniciadasPlanNormal: 0,
  iniciadasPlanEmergencia: 0,
  iniciadasFallbackViables: 0,
  noIniciadas: 0,
  porSemilla: [],
};

const monotoniaSaltosStats = {
  saltos: [],
  resumen: {
    soloZonaDestrabada: 0,
    aumentoOtrasZonas: 0,
    totalSaltos: 0,
  },
  trazasOtrasZonas: [],
};

const manualZoneSizesStats = {
  distribucion: { '2': 0, '3': 0, '4': 0, '5+': 0 },
  tamaniosExactos: {},
  semillasPorTamanio: {},
  trazasSemillasEspeciales: [],
};

const perfilManual4Stats = {
  totalSeeds: 0,
  seeds: new Set(),
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
 * Mapea los conflictos base a sus zonas correspondientes para clasificar incrementos.
 */
function mapearConflictosPorZona(conflictosList, session) {
  const map = new Map();
  for (const item of conflictosList) {
    const catId = item.categoriaId;
    let zKey = null;
    let tam = item.tamanoZona || 0;
    if (item.zonaId || item.zona) {
      zKey = `${catId}:${item.zonaId || item.zona}`;
    } else if (item.partidoId && session && Array.isArray(session.categoriasPlan)) {
      for (const cPlan of session.categoriasPlan) {
        if (cPlan.categoriaId === catId) {
          for (const z of cPlan.zonas || []) {
            if ((z.partidos || []).some((p) => p.id === item.partidoId)) {
              zKey = `${catId}:${z.id || z.nombre}`;
              tam = z.parejaIds?.length || 0;
              break;
            }
          }
        }
      }
    }
    if (!zKey) zKey = `${catId}:UNKNOWN`;
    if (!map.has(zKey)) {
      map.set(zKey, { count: 0, items: [], motivos: new Set(), tamanoZona: tam });
    }
    const entry = map.get(zKey);
    entry.count++;
    entry.items.push(item);
    if (item.motivo) entry.motivos.add(item.motivo);
    if (!entry.tamanoZona && tam) entry.tamanoZona = tam;
  }
  return map;
}

/**
 * Captura todos los partidos agendados en una sesión para detectar desplazamientos.
 */
function capturarHorariosPartidos(session) {
  const map = new Map();
  if (!session || !Array.isArray(session.categoriasPlan)) return map;
  for (const cPlan of session.categoriasPlan) {
    for (const z of cPlan.zonas || []) {
      for (const p of z.partidos || []) {
        if (p.canchaNumero && p.fechaHora && !p.sinHorarioAsignado) {
          map.set(p.id, {
            partidoId: p.id,
            posicionEnRonda: p.posicionEnRonda,
            canchaNumero: p.canchaNumero,
            fechaHora: p.fechaHora,
            categoriaId: cPlan.categoriaId,
            categoriaNombre: cPlan.nombre,
            zonaId: z.id || z.nombre,
            zonaNombre: z.nombre,
          });
        }
      }
    }
  }
  return map;
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
  diaLluviaKey = null,
  minutosEnVivoPorPartido = null,
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

  // 3b. Partidos después del cierre del club en Modo Lluvia (decisión de producto: extensión intencional).
  // - Solo pueden quedar después del cierre partidos de la jornada de lluvia.
  // - getEstadoEnVivo debe marcar exactamente los minutos después del cierre (0 si termina antes).
  // El cierre se calcula con la ventana propia del fuzz (getVentanasClub), independiente del helper.
  if (diaLluviaKey) {
    for (const p of agendados) {
      const info = getDiaCalendarioConTrasnoche(p.fechaHora, organizador);
      if (!info) continue;
      const dow = info.logicalDate.getDay();
      const cierreMs = dow === 5 ? ventanasClub.viernes.endMs : dow === 6 ? ventanasClub.sabado.endMs : null;
      if (cierreMs === null) continue;
      const finMs = new Date(p.fechaHora).getTime() + DURACION_MS;
      const esperado = finMs > cierreMs ? Math.ceil((finMs - cierreMs) / 60000) : 0;

      if (esperado > 0 && info.key !== diaLluviaKey) {
        recordFailure(
          `fuera_cierre_otra_jornada:${etapa}`,
          seed,
          `Partido ${p.id} de ${info.key} (sin lluvia) termina ${esperado} min después del cierre del club`
        );
      }

      if (minutosEnVivoPorPartido) {
        const marcado = minutosEnVivoPorPartido.get(p.id);
        const coincide = marcado === undefined ? esperado === 0 : marcado === esperado;
        if (!coincide) {
          recordFailure(
            `fuera_cierre_marcado:${etapa}`,
            seed,
            `Partido ${p.id} termina ${esperado} min después del cierre y En Vivo marca ${marcado}`
          );
        }
      }
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
  if (typeof recordFailure !== 'function') {
    // Sin recordFailure las fallas de invariantes se perdían en silencio
    throw new Error('runSingleSeed requiere una función recordFailure');
  }
  const rng = createPRNG(seed);

  const origRandom = Math.random;
  Math.random = () => rng.next();

  try {
    await limpiarDatosTorneo();

    const perfilGenerador = seed % 2 === 0 ? 'standard' : 'sabado_extendido';
    const esPerfilExtendido = perfilGenerador === 'sabado_extendido';
    perfilStats[perfilGenerador].totalSeeds++;

    const cantidadCanchas = esPerfilExtendido ? rng.int(4, 6) : rng.int(2, 6);
    const viernesInicio = rng.pick(['15:00', '16:00', '17:00', '18:00']);
    const viernesFin = rng.pick(['23:30', '00:30', '01:30', '02:00']);
    const sabadoInicio = esPerfilExtendido ? '08:00' : rng.pick(['08:00', '09:00', '10:00']);
    const sabadoFin = esPerfilExtendido
      ? rng.pick(['01:30', '02:00', '02:30', '03:00'])
      : rng.pick(['23:30', '00:30', '01:30', '02:00']);
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
    const activarPerfilManual4 = process.env.FUZZ_PERFIL_MANUAL4 !== '0';
    const esPerfilManual4 = activarPerfilManual4 && (seed % 5 === 0);
    if (esPerfilManual4) {
      perfilManual4Stats.totalSeeds++;
      perfilManual4Stats.seeds.add(seed);
    }

    const numCategorias = esPerfilExtendido ? rng.int(1, 2) : rng.int(2, 3);
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

      if (esPerfilManual4 && cIdx === 0) {
        const numParejas = 4;
        const parejasData = [];
        for (let pIdx = 1; pIdx <= numParejas; pIdx++) {
          parejasData.push({
            categoriaId: cat.id,
            jugador1: `S${seed}_M4_P${pIdx}_A`,
            jugador2: `S${seed}_M4_P${pIdx}_B`,
            orden: pIdx,
          });
        }
        await prisma.pareja.createMany({ data: parejasData });
        const parejasCreadas = await prisma.pareja.findMany({
          where: { categoriaId: cat.id },
          orderBy: { orden: 'asc' },
        });

        // Forzar incompatibilidad: P1 y P2 en Viernes-18:00, P3 y P4 en Viernes-19:15
        const manualSlots = [
          ['Viernes-18:00'],
          ['Viernes-18:00'],
          ['Viernes-19:15'],
          ['Viernes-19:15'],
        ];
        const slotParejaRows = [];
        for (let i = 0; i < parejasCreadas.length; i++) {
          for (const slotId of manualSlots[i]) {
            slotParejaRows.push({ parejaId: parejasCreadas[i].id, slotId });
          }
        }
        await prisma.slotPareja.createMany({ data: slotParejaRows });
        continue;
      }

      const numParejas = esPerfilExtendido && cIdx === 0 ? rng.int(27, 28) : rng.int(8, 30);
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
    let pasoPrecheck = 0;
    await registrarHashEtapa(seed, `precheck-${pasoPrecheck++}`, { categoriasPlan: session?.categoriasPlan || [] });

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

    // Medición de tamaños de zona manual justo después del PRIMER preCheck y antes de cualquier destrabe (Punto 2.a)
    if (session && Array.isArray(session.categoriasPlan)) {
      for (const cPlan of session.categoriasPlan) {
        for (const z of cPlan.zonas || []) {
          if (z.requiereArmadoManual) {
            const sz = z.parejaIds ? z.parejaIds.length : 0;
            if (sz > 0) {
              manualZoneSizesStats.tamaniosExactos[sz] = (manualZoneSizesStats.tamaniosExactos[sz] || 0) + 1;
              if (!manualZoneSizesStats.semillasPorTamanio[sz]) {
                manualZoneSizesStats.semillasPorTamanio[sz] = new Set();
              }
              manualZoneSizesStats.semillasPorTamanio[sz].add(seed);
              if (sz === 2) manualZoneSizesStats.distribucion['2']++;
              else if (sz === 3) manualZoneSizesStats.distribucion['3']++;
              else if (sz === 4) manualZoneSizesStats.distribucion['4']++;
              else if (sz >= 5) manualZoneSizesStats.distribucion['5+']++;
            }
          }
        }
      }
    }

    if (seed === 382 || seed === 496) {
      if (session && Array.isArray(session.categoriasPlan)) {
        let traza = `\n--- TRAZA LITERAL SEMILLA ${seed} (Primer Pre-Check, antes de destrabe) ---\n`;
        traza += `Club: ${organizador.nombre}, Canchas: ${organizador.cantidadCanchas}\n`;
        for (const cp of session.categoriasPlan) {
          const manuales = (cp.zonas || []).filter((z) => z.requiereArmadoManual);
          traza += `Categoría "${cp.nombre}" (ID ${cp.categoriaId}): ${cp.zonas?.length || 0} zonas totales, ${manuales.length} zonas manuales (sinGrupo)\n`;
          for (const z of cp.zonas || []) {
            traza += `  - Zona "${z.nombre}" (formato: ${z.formato}, requiereArmadoManual: ${z.requiereArmadoManual}): ${z.parejaIds?.length || 0} parejas [${(z.parejaIds || []).join(', ')}]\n`;
            if (z.requiereArmadoManual) {
              traza += `    >>> Zona manual (sinGrupo) con ${z.parejaIds?.length || 0} parejas.\n`;
            }
          }
        }
        manualZoneSizesStats.trazasSemillasEspeciales.push(traza);
      }
    }

    if (process.env.FAST_PRECHECK_ONLY === '1') {
      return;
    }

    const resolverConflictosLoop = async ({ initialPreCheck, initialSession, esLoopReset = false }) => {
      let curPreCheck = initialPreCheck;
      let curSession = initialSession;
      let prevConflictosCat = (curPreCheck.conflictos || []).length;
      let baseConflictosList = obtenerConflictosBase(curPreCheck, curSession);
      let prevBaseConflictos = baseConflictosList.length;
      const triedActions = new Set();
      let maxGuard = 0;

      while (curPreCheck.bloqueado && prevBaseConflictos > 0 && maxGuard < 10) {
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
        const baseAntesPaso = baseConflictosList;

        // Mapear estado antes de la acción para clasificar saltos de monotonía
        const scheduleBefore = capturarHorariosPartidos(curSession);
        const mapBefore = mapearConflictosPorZona(baseConflictosList, curSession);
        const targetCatId = conf.categoriaId;
        let targetZonaKey = null;
        if (conf.zonaId || conf.zona) {
          targetZonaKey = `${targetCatId}:${conf.zonaId || conf.zona}`;
        } else if (conf.partidoId && curSession && Array.isArray(curSession.categoriasPlan)) {
          for (const cPlan of curSession.categoriasPlan) {
            if (cPlan.categoriaId === targetCatId) {
              for (const z of cPlan.zonas || []) {
                if ((z.partidos || []).some((p) => p.id === conf.partidoId)) {
                  targetZonaKey = `${targetCatId}:${z.id || z.nombre}`;
                  break;
                }
              }
            }
          }
        }
        if (!targetZonaKey) targetZonaKey = `${targetCatId}:UNKNOWN`;
        const confZonaBefore = mapBefore.get(targetZonaKey)?.count || 0;
        let confOtrasBefore = 0;
        for (const [k, v] of mapBefore.entries()) {
          if (k !== targetZonaKey) confOtrasBefore += v.count;
        }

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

        curPreCheck = await organizadorService.preCheckInicioTorneo(organizador.id, torneo.id, {
          isReCheck: true,
        });
        curSession = organizadorService.preCheckSessions.get(torneo.id);
        registrarZonasManuales(curSession);
        await registrarHashEtapa(seed, `precheck-${pasoPrecheck++}`, { categoriasPlan: curSession?.categoriasPlan || [] });

        // Verificar invariante nuevo: si una zona manual quedó 100% destrabada, tiene que tener partidos creados
        if (curSession && Array.isArray(curSession.categoriasPlan)) {
          for (const cPlan of curSession.categoriasPlan) {
            for (const z of cPlan.zonas || []) {
              const zKey = `${cPlan.categoriaId}:${z.nombre}`;
              if (zonasManualesVistas.has(zKey) && !z.requiereArmadoManual) {
                if (!Array.isArray(z.partidos) || z.partidos.length === 0) {
                  manualFuzzInvariantsStats.failingSeeds.add(seed);
                  manualFuzzInvariantsStats.porRegla.loopDestrabeSinPartidos.add(seed);
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

        const currentConflictosCat = (curPreCheck.conflictos || []).length;
        baseConflictosList = obtenerConflictosBase(curPreCheck, curSession);
        const currentBaseConflictos = baseConflictosList.length;

        // Clasificar estado después de la acción
        const mapAfter = mapearConflictosPorZona(baseConflictosList, curSession);
        const scheduleAfter = capturarHorariosPartidos(curSession);
        const confZonaAfter = mapAfter.get(targetZonaKey)?.count || 0;
        let confOtrasAfter = 0;
        const motivosOtras = new Set();
        for (const [k, v] of mapAfter.entries()) {
          if (k !== targetZonaKey) {
            confOtrasAfter += v.count;
            const prevEntry = mapBefore.get(k);
            if (!prevEntry || v.count > prevEntry.count) {
              for (const m of v.motivos) motivosOtras.add(m);
            }
          }
        }
        const deltaZona = confZonaAfter - confZonaBefore;
        const deltaOtras = confOtrasAfter - confOtrasBefore;

        // Regla R2 (utils/monotoniaPrecheck.js): ninguna otra zona ni categoría sube (zona por zona) y,
        // si la zona resuelta sube, sus ítems nuevos son partidos sin horario. Sin break: registra y sigue.
        const paso = clasificarPasoMonotonia({
          antes: baseAntesPaso,
          despues: baseConflictosList,
          zonaObjetivo: targetZonaKey,
        });
        if (!paso.ok) {
          recordFailure(
            'precheck_monotonia:post-inicio',
            seed,
            `Paso de resolución (${conf.motivo}) no explicado [${paso.violaciones.join(', ')}]: zonas=${JSON.stringify(paso.zonasQueSuben)} categorias=${JSON.stringify(paso.categoriasQueSuben)} items=${JSON.stringify(paso.itemsNoExplicados)}`
          );
        }

        // Informativo: saltos del total de conflictos base (se clasifican, no fallan)
        if (currentBaseConflictos > prevBaseConflictos) {
          const tamZona = conf.tamanoZona || (conf.parejasManuales ? conf.parejasManuales.length : 0) || mapAfter.get(targetZonaKey)?.tamanoZona || 4;
          const motivosZona = Array.from(mapAfter.get(targetZonaKey)?.motivos || []).join(', ') || '-';
          const motivosOtrasStr = Array.from(motivosOtras).join(', ') || '-';
          const tipoSalto = deltaOtras > 0 ? 'AUMENTO_OTRAS_ZONAS' : 'SOLO_ZONA_DESTRABADA';

          if ([8, 23, 100, 138, 270].includes(seed)) {
            console.log(`\n=====================================================================================`);
            console.log(`📌 TRAZA LITERAL SALTO MONOTONÍA SEMILLA ${seed} (Motivo: ${conf.motivo})`);
            console.log(`=====================================================================================`);
            console.log(`- Zona objetivo: ${targetZonaKey} (Tamaño: ${tamZona})`);
            console.log(`- Conflictos totales: ${prevBaseConflictos} -> ${currentBaseConflictos} (Delta: ${currentBaseConflictos - prevBaseConflictos})`);
            console.log(`- Partidos de la zona ANTES del destrabe:`);
            let partidosAntes = [];
            for (const [pId, info] of scheduleBefore.entries()) {
              if (`${info.categoriaId}:${info.zonaId}` === targetZonaKey || `${info.categoriaId}:${info.zonaNombre}` === targetZonaKey) {
                partidosAntes.push(info);
                console.log(`    * Pos ${info.posicionEnRonda} | ID ${pId} | Cancha ${info.canchaNumero || 'NULL'} | FechaHora ${info.fechaHora ? new Date(info.fechaHora).toISOString() : 'NULL'} | SinHorario: false`);
              }
            }
            if (partidosAntes.length === 0) {
              console.log(`    (Zona manual sin partidos generados en memoria, requiereArmadoManual=true)`);
            }

            console.log(`- Partidos de la zona DESPUÉS del destrabe:`);
            let fechaReferencia = null;
            if (curSession && curSession.categoriasPlan) {
              for (const cp of curSession.categoriasPlan) {
                for (const z of cp.zonas || []) {
                  const zKey = `${cp.categoriaId}:${z.id || z.nombre}`;
                  if (zKey === targetZonaKey || `${cp.categoriaId}:${z.nombre}` === targetZonaKey) {
                    for (const p of z.partidos || []) {
                      if (p.fechaHora) fechaReferencia = new Date(p.fechaHora);
                      console.log(`    * Pos ${p.posicionEnRonda} | ID ${p.id} | Cancha ${p.canchaNumero || 'NULL'} | FechaHora ${p.fechaHora ? new Date(p.fechaHora).toISOString() : 'NULL'} | SinHorario: ${p.sinHorarioAsignado}`);
                    }
                  }
                }
              }
            }

            const { generarGrillaOrganizador } = require('../src/services/slots.service');
            const grillaClub = generarGrillaOrganizador(organizador);
            const diaNombre = fechaReferencia && fechaReferencia.getUTCDay() === 5 ? 'viernes' : 'sabado';
            const slotsDelDia = grillaClub[diaNombre] || [];
            console.log(`- Franjas y canchas libres del club para el día (${diaNombre.toUpperCase()}): ${organizador.cantidadCanchas} canchas totales`);
            const ocupacion = {};
            for (const [pId, info] of scheduleAfter.entries()) {
              if (info.fechaHora && info.canchaNumero) {
                const dt = new Date(info.fechaHora);
                const diaMatch = dt.getUTCDay() === 5 ? 'viernes' : 'sabado';
                if (diaMatch === diaNombre) {
                  const hh = String(dt.getUTCHours()).padStart(2, '0');
                  const mm = String(dt.getUTCMinutes()).padStart(2, '0');
                  const sKey = `${diaNombre}_${hh}:${mm}`;
                  if (!ocupacion[sKey]) ocupacion[sKey] = new Set();
                  ocupacion[sKey].add(info.canchaNumero);
                }
              }
            }

            for (const s of slotsDelDia) {
              const ocup = ocupacion[s] || new Set();
              const libres = [];
              for (let c = 1; c <= organizador.cantidadCanchas; c++) {
                if (!ocup.has(c)) libres.push(c);
              }
              console.log(`    * Slot ${s}: ${libres.length}/${organizador.cantidadCanchas} canchas libres [${libres.join(', ')}]`);
            }
          }

          monotoniaSaltosStats.saltos.push({
            semilla: seed,
            motivoAccion: conf.motivo,
            tamanoZona: tamZona,
            confZonaAntes: confZonaBefore,
            confZonaDespues: confZonaAfter,
            deltaZona,
            confOtrasAntes: confOtrasBefore,
            confOtrasDespues: confOtrasAfter,
            deltaOtras,
            totalAntes: prevBaseConflictos,
            totalDespues: currentBaseConflictos,
            deltaTotal: currentBaseConflictos - prevBaseConflictos,
            tipoSalto,
            motivosZona,
            motivosOtras: motivosOtrasStr,
          });

          if (deltaOtras > 0) {
            monotoniaSaltosStats.resumen.aumentoOtrasZonas++;
            if (monotoniaSaltosStats.trazasOtrasZonas.length < 10) {
              for (const [pId, infoAfter] of scheduleAfter.entries()) {
                const zKeyAfter = `${infoAfter.categoriaId}:${infoAfter.zonaId}`;
                if (zKeyAfter === targetZonaKey && !scheduleBefore.has(pId)) {
                  for (const [pPrevId, infoPrev] of scheduleBefore.entries()) {
                    if (
                      infoPrev.canchaNumero === infoAfter.canchaNumero &&
                      new Date(infoPrev.fechaHora).getTime() === new Date(infoAfter.fechaHora).getTime()
                    ) {
                      const infoPrevNow = scheduleAfter.get(pPrevId);
                      const nuevaFranja = infoPrevNow ? `${infoPrevNow.canchaNumero} @ ${new Date(infoPrevNow.fechaHora).toISOString()}` : 'SIN HORARIO';
                      monotoniaSaltosStats.trazasOtrasZonas.push({
                        seed,
                        zonaDestrabada: infoAfter.zonaNombre,
                        canchaOcupada: infoAfter.canchaNumero,
                        franjaOcupada: new Date(infoAfter.fechaHora).toISOString(),
                        partidoDestrabado: `P${infoAfter.posicionEnRonda}`,
                        partidoDesplazadoId: pPrevId,
                        partidoDesplazadoInfo: `${infoPrev.categoriaNombre} - ${infoPrev.zonaNombre} - P${infoPrev.posicionEnRonda}`,
                        franjaPerdida: new Date(infoPrev.fechaHora).toISOString(),
                        estadoNuevoDesplazado: nuevaFranja,
                      });
                    }
                  }
                }
              }
            }
          } else {
            monotoniaSaltosStats.resumen.soloZonaDestrabada++;
          }
          monotoniaSaltosStats.resumen.totalSaltos++;
        }
        prevBaseConflictos = currentBaseConflictos;

        // Invariante informativo: monotonía a nivel categorías con conflicto (tercera definición)
        if (!esLoopReset && currentConflictosCat > prevConflictosCat) {
          recordFailure(
            'precheck_monotonia_categorias:post-inicio',
            seed,
            `El total de categorías en conflicto subió tras resolver (${conf.motivo}): pasó de ${prevConflictosCat} a ${currentConflictosCat}`
          );
        }
        prevConflictosCat = currentConflictosCat;
      }

      return { preCheck: curPreCheck, session: curSession };
    };

    const resLoop1 = await resolverConflictosLoop({
      initialPreCheck: preCheck,
      initialSession: session,
      esLoopReset: false,
    });
    preCheck = resLoop1.preCheck;
    session = resLoop1.session;

    // =========================================================================
    // ETAPA 1: POST-INICIO
    // =========================================================================
    let planIdToUse = preCheck.planId || (preCheck.permiteInicioEmergencia ? preCheck.planEmergenciaId : null);

    // Ante un torneo bloqueado sin plan: intentar forceReset (re-pre-check completo)
    // y reintentar el loop de destrabe antes de declarar terminal una categoría (Punto 3.d)
    if (!planIdToUse && preCheck.bloqueado) {
      preCheck = await organizadorService.preCheckInicioTorneo(organizador.id, torneo.id, { forceReset: true });
      session = organizadorService.preCheckSessions.get(torneo.id);
      registrarZonasManuales(session);
      await registrarHashEtapa(seed, `precheck-${pasoPrecheck++}`, { categoriasPlan: session?.categoriasPlan || [] });

      const resLoopReset = await resolverConflictosLoop({
        initialPreCheck: preCheck,
        initialSession: session,
        esLoopReset: true,
      });
      preCheck = resLoopReset.preCheck;
      session = resLoopReset.session;
      planIdToUse = preCheck.planId || (preCheck.permiteInicioEmergencia ? preCheck.planEmergenciaId : null);
    }

    let planTipo = 'NINGUNO';
    let catNormal = 0;
    let catEmergencia = 0;
    let catFallback = 0;
    let catNoIniciadas = 0;

    if (planIdToUse) {
      if (planIdToUse === preCheck.planId) {
        planTipo = 'NORMAL';
        catNormal = categorias.length;
      } else if (planIdToUse === preCheck.planEmergenciaId) {
        planTipo = 'EMERGENCIA';
        catEmergencia = categorias.length;
      }
      await organizadorService.iniciarTorneoMultiCategoria(organizador.id, torneo.id, planIdToUse);
    } else {
      // Categorías viables
      const todasCategorias = await prisma.categoria.findMany({ where: { torneoId: torneo.id } });
      const confs = preCheck.conflictos || [];
      const terminalCatIds = new Set();
      for (const catConf of confs) {
        terminalCatIds.add(catConf.categoriaId);
      }
      const categoriasViables = todasCategorias.filter((c) => !terminalCatIds.has(c.id));
      let algunaIniciada = false;
      for (const cat of categoriasViables) {
        try {
          await zonaService.iniciarCategoriaConDisponibilidad(organizador.id, cat.id);
          algunaIniciada = true;
        } catch (_) {}
      }
      if (algunaIniciada) {
        catFallback = categoriasViables.length;
        catNoIniciadas = todasCategorias.length - catFallback;
        planTipo = 'FALLBACK_VIABLES';
        await prisma.torneo.update({ where: { id: torneo.id }, data: { estado: 'EN_CURSO' } });
      } else {
        catNoIniciadas = todasCategorias.length;
        planTipo = 'NINGUNO_BLOQUEADO';
        planesInicioStats.totalCategorias += categorias.length;
        planesInicioStats.noIniciadas += catNoIniciadas;
        planesInicioStats.porSemilla.push({
          semilla: seed,
          totalCategorias: categorias.length,
          normal: 0,
          emergencia: 0,
          fallback: 0,
          noIniciadas: catNoIniciadas,
          planTipo,
        });
        return;
      }
    }

    planesInicioStats.totalCategorias += categorias.length;
    planesInicioStats.iniciadasPlanNormal += catNormal;
    planesInicioStats.iniciadasPlanEmergencia += catEmergencia;
    planesInicioStats.iniciadasFallbackViables += catFallback;
    planesInicioStats.noIniciadas += catNoIniciadas;
    planesInicioStats.porSemilla.push({
      semilla: seed,
      totalCategorias: categorias.length,
      normal: catNormal,
      emergencia: catEmergencia,
      fallback: catFallback,
      noIniciadas: catNoIniciadas,
      planTipo,
    });

    if (process.env.STOP_POST_INICIO === '1') {
      return;
    }

    await registrarHashEtapa(seed, 'post-inicio', { torneoId: torneo.id });
    const partidosIniciales = await prisma.partido.findMany({
      where: { categoria: { torneoId: torneo.id } },
      include: { faseEliminatoria: true },
    });
    const zonasTorneo = await prisma.zona.findMany({
      where: { categoria: { torneoId: torneo.id } },
      include: { zonaParejas: true, partidos: true },
    });

    // Invariante 1: Origen persistido en MINI_BRACKET (aplica a TODAS las zonas MINI_BRACKET del torneo)
    for (const z of zonasTorneo) {
      if (z.formato === 'MINI_BRACKET') {
        for (const p of z.partidos) {
          if (p.posicionEnRonda >= 3) {
            if (!p.origenPareja1 || !p.origenPareja2) {
              manualFuzzInvariantsStats.porRegla.miniBracketOrigenPersistido.add(seed);
              recordFailure(
                'mini_bracket_origen_persistido:post-inicio',
                seed,
                `Partido P${p.posicionEnRonda} de MINI_BRACKET (zona ${z.nombre}) no tiene origen definido`
              );
            }
          }
        }
      }
    }

    // Invariante 2: Zonas manuales en DB (aplica ÚNICAMENTE a zonas que nacieron como manuales)
    for (const z of zonasTorneo) {
      const zKey = `${z.categoriaId}:${z.nombre}`;
      const esManualNacida = zonasManualesVistas.has(zKey);
      if (!esManualNacida) continue;

      const pCount = z.zonaParejas.length;
      // Regla: zonas de 1 o de 5+ parejas nunca pueden quedar con requiereArmadoManual false
      if ((pCount <= 1 || pCount >= 5) && !z.requiereArmadoManual) {
        manualFuzzInvariantsStats.failingSeeds.add(seed);
        manualFuzzInvariantsStats.porRegla.regla1o5Parejas.add(seed);
        recordFailure(
          'precheck_zona_manual_partidos:post-inicio',
          seed,
          `Zona manual "${z.nombre}" tiene ${pCount} parejas pero quedó con requiereArmadoManual=false en la base`
        );
      }

      if (!z.requiereArmadoManual) {
        let expectedPartidos = 0;
        if (z.formato === 'MINI_BRACKET') {
          expectedPartidos = 4;
        } else if (z.formato === 'ROUND_ROBIN') {
          if (pCount === 2) expectedPartidos = 1;
          else if (pCount === 3) expectedPartidos = 3;
          else if (pCount === 4) expectedPartidos = 6;
          else expectedPartidos = (pCount * (pCount - 1)) / 2;
        }

        if (z.partidos.length !== expectedPartidos) {
          manualFuzzInvariantsStats.failingSeeds.add(seed);
          manualFuzzInvariantsStats.porRegla.formatoCantidadPartidos.add(seed);
          recordFailure(
            'precheck_zona_manual_partidos:post-inicio',
            seed,
            `Zona manual "${z.nombre}" (${z.formato}, ${pCount} parejas) tiene ${z.partidos.length} partidos en DB pero se esperaban ${expectedPartidos}`
          );
        }

        for (const p of z.partidos) {
          if (z.formato === 'MINI_BRACKET' && p.posicionEnRonda >= 3) {
            if (p.pareja1Id !== null || p.pareja2Id !== null) {
              manualFuzzInvariantsStats.failingSeeds.add(seed);
              manualFuzzInvariantsStats.porRegla.parejasNullOOrigen.add(seed);
              recordFailure(
                'precheck_zona_manual_partidos:post-inicio',
                seed,
                `Partido P${p.posicionEnRonda} de MINI_BRACKET manual tiene parejas definidas en DB en lugar de null`
              );
            }
          } else {
            if (!p.pareja1Id || !p.pareja2Id) {
              manualFuzzInvariantsStats.failingSeeds.add(seed);
              manualFuzzInvariantsStats.porRegla.parejasNullOOrigen.add(seed);
              recordFailure(
                'precheck_zona_manual_partidos:post-inicio',
                seed,
                `Partido ${p.id} de zona manual ${z.nombre} tiene parejas null inesperadas`
              );
            }
          }

          const tieneHorarioCancha = Boolean(p.fechaHora && p.canchaNumero);
          const esPendiente = Boolean(p.sinHorarioAsignado || p.estado === 'PENDIENTE');
          if (!tieneHorarioCancha && !esPendiente) {
            manualFuzzInvariantsStats.failingSeeds.add(seed);
            manualFuzzInvariantsStats.porRegla.horarioOPendiente.add(seed);
            recordFailure(
              'precheck_zona_manual_partidos:post-inicio',
              seed,
              `Partido ${p.id} de zona manual no tiene horario/cancha ni está marcado como pendiente/sinHorarioAsignado`
            );
          }
        }
      }
    }

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

    let seedHasR32 = false;
    let seedHasR32ConHorario = false;
    let seedHasSinHorario = false;
    for (const p of partidosIniciales) {
      if (p.faseEliminatoria && p.faseEliminatoria.ronda >= 32 && !p.esBye) {
        r32FuzzStats.totalR32NoBye++;
        perfilStats[perfilGenerador].totalR32NoBye++;
        seedHasR32 = true;
        if (p.fechaHora && !p.sinHorarioAsignado) {
          seedHasR32ConHorario = true;
        } else {
          r32FuzzStats.sinHorarioR32++;
          perfilStats[perfilGenerador].sinHorarioR32++;
          seedHasSinHorario = true;
        }
      }
    }
    if (seedHasR32) {
      r32FuzzStats.seedsConR32.add(seed);
      perfilStats[perfilGenerador].seedsConR32.add(seed);
    }
    if (seedHasR32ConHorario) {
      r32FuzzStats.seedsConR32ConHorario.add(seed);
      perfilStats[perfilGenerador].seedsConR32ConHorario.add(seed);
    }
    if (seedHasSinHorario) {
      r32FuzzStats.seedsConSinHorarioR32.add(seed);
      perfilStats[perfilGenerador].seedsConSinHorarioR32.add(seed);
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

    // Orden explícito (sesión 81): candidatosEstado[0] y [1] deciden qué partido se finaliza y cuál queda
    // en curso; sin orderBy salían en orden de inserción. (fechaHora, cancha) es único entre agendados.
    const partidosTrasManual = await prisma.partido.findMany({
      where: { categoria: { torneoId: torneo.id } },
      orderBy: [{ fechaHora: 'asc' }, { canchaNumero: 'asc' }, { categoria: { nombre: 'asc' } }, { posicionEnRonda: 'asc' }],
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

    await registrarHashEtapa(seed, 'pre-reduccion', { torneoId: torneo.id });
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

    await registrarHashEtapa(seed, 'post-reduccion', { torneoId: torneo.id });
    const partidosPostReduccion = await prisma.partido.findMany({
      where: { categoria: { torneoId: torneo.id } },
      include: { faseEliminatoria: true },
    });

    // Métrica informativa: partidos que tenían horario y la reducción dejó sin horario (pasan a la bandeja)
    const aBandeja = partidosPostReduccion.filter((p) => {
      const orig = antesMap.get(p.id);
      return (
        orig && orig.fechaHora && !orig.sinHorarioAsignado &&
        p.estado !== 'FINALIZADO' && p.sinHorarioAsignado && !p.fechaHora
      );
    }).length;
    registrarBandeja(perfilGenerador, targetDiaKey === friKey ? 'viernes' : 'sabado', seed, aBandeja);

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
      diaLluviaKey: targetDiaKey,
      minutosEnVivoPorPartido: await mapaMinutosEnVivo(organizador.id, torneo.id),
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

    await registrarHashEtapa(seed, 'post-restauracion', { torneoId: torneo.id });
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
      diaLluviaKey: targetDiaKey,
      minutosEnVivoPorPartido: await mapaMinutosEnVivo(organizador.id, torneo.id),
    });

    // =========================================================================
    // ETAPA 4: DOMINGO - REDUCCION Y RESTAURACION (INVARIANTE OTRAS JORNADAS INTACTAS)
    // =========================================================================
    const baseSunday = zonaService.proximaFechaPorDia('Domingo', refFecha);
    const domKey = getDiaCalendarioConTrasnoche(parseFechaLocal(baseSunday), horariosClubObj).key;

    await registrarHashEtapa(seed, 'pre-reduccion-dom', { torneoId: torneo.id });
    const partidosAntesLluviaDom = await prisma.partido.findMany({
      where: { categoria: { torneoId: torneo.id } },
      include: { faseEliminatoria: true },
    });
    const antesDomMap = new Map(partidosAntesLluviaDom.map((p) => [p.id, p]));

    const canchasReducidasDom = rng.int(1, cantidadCanchas - 1);

    const domPartidosCandidatos = partidosAntesLluviaDom.filter((p) => {
      if (!p.fechaHora || !p.canchaNumero || p.sinHorarioAsignado || p.esBye) return false;
      const dKey = getDiaCalendarioConTrasnoche(p.fechaHora, horariosClubObj)?.key;
      return dKey === domKey && p.canchaNumero <= canchasReducidasDom;
    });
    if (domPartidosCandidatos.length >= 1) {
      await prisma.partido.update({
        where: { id: domPartidosCandidatos[0].id },
        data: {
          estado: 'FINALIZADO',
          ganadorId: domPartidosCandidatos[0].pareja1Id || domPartidosCandidatos[0].pareja2Id,
        },
      });
    }

    await organizadorService.reprogramarPorReduccionCanchas(
      organizador.id,
      torneo.id,
      canchasReducidasDom,
      null,
      domKey
    );

    await registrarHashEtapa(seed, 'post-reduccion-dom', { torneoId: torneo.id });
    const partidosPostReduccionDom = await prisma.partido.findMany({
      where: { categoria: { torneoId: torneo.id } },
      include: { faseEliminatoria: true },
    });

    for (const p of partidosPostReduccionDom) {
      const orig = antesDomMap.get(p.id);
      if (!orig) continue;

      if (orig.fechaHora) {
        const origDiaKey = getDiaCalendarioConTrasnoche(orig.fechaHora, horariosClubObj)?.key;
        if (origDiaKey && origDiaKey !== domKey) {
          const origTime = new Date(orig.fechaHora).getTime();
          const newTime = p.fechaHora ? new Date(p.fechaHora).getTime() : null;
          if (
            origTime !== newTime ||
            orig.canchaNumero !== p.canchaNumero ||
            orig.sinHorarioAsignado !== p.sinHorarioAsignado
          ) {
            recordFailure(
              'modo_lluvia_domingo:post-reduccion',
              seed,
              `Partido ${p.id} de otra jornada (${origDiaKey} != ${domKey}) fue modificado en reducción de domingo`
            );
          }
        }
      }
    }

    await organizadorService.reprogramarPorReduccionCanchas(
      organizador.id,
      torneo.id,
      cantidadCanchas,
      null,
      domKey
    );

    await registrarHashEtapa(seed, 'post-restauracion-dom', { torneoId: torneo.id });
    const partidosPostRestauracionDom = await prisma.partido.findMany({
      where: { categoria: { torneoId: torneo.id } },
      include: { faseEliminatoria: true },
    });

    for (const p of partidosPostRestauracionDom) {
      const orig = antesDomMap.get(p.id);
      if (!orig) continue;

      if (orig.fechaHora) {
        const origDiaKey = getDiaCalendarioConTrasnoche(orig.fechaHora, horariosClubObj)?.key;
        if (origDiaKey && origDiaKey !== domKey) {
          const origTime = new Date(orig.fechaHora).getTime();
          const newTime = p.fechaHora ? new Date(p.fechaHora).getTime() : null;
          if (
            origTime !== newTime ||
            orig.canchaNumero !== p.canchaNumero ||
            orig.sinHorarioAsignado !== p.sinHorarioAsignado
          ) {
            recordFailure(
              'modo_lluvia_domingo:post-restauracion',
              seed,
              `Partido ${p.id} de otra jornada (${origDiaKey} != ${domKey}) fue modificado en restauración de domingo`
            );
          }
        }
      }
    }
  } finally {
    Math.random = origRandom;
  }
}

async function runFuzzSuite() {
  await ensureTestDb();
  if (FUZZ_HASH_OUT) fs.writeFileSync(FUZZ_HASH_OUT, '');
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
    'modo_lluvia_domingo:post-reduccion',
    'modo_lluvia_domingo:post-restauracion',
    'precheck_monotonia:post-inicio',
    'precheck_monotonia_categorias:post-inicio',
    'precheck_zona_manual_partidos:post-inicio',
    'mini_bracket_origen_persistido:post-inicio',
    'excepcion_no_controlada:fuzz',
    'fuera_cierre_otra_jornada:post-reduccion',
    'fuera_cierre_otra_jornada:post-restauracion',
    'fuera_cierre_marcado:post-reduccion',
    'fuera_cierre_marcado:post-restauracion',
  ];

  const INFORMATIVE_INVARIANTS = new Set([
    'precheck_monotonia_categorias:post-inicio',
  ]);

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
    if (!entry) {
      // Una clave fuera de INVARIANT_KEYS se descartaba sin aviso y la falla no llegaba al exit code.
      // Al lanzar, runSingleSeed la registra como excepcion_no_controlada:fuzz.
      throw new Error(`recordFailure: invariante desconocida "${invariantKey}" (agregala a INVARIANT_KEYS)`);
    }
    entry.fallasCount++;
    if (!entry.semillasAfectadas.has(seed)) {
      entry.semillasAfectadas.add(seed);
      if (entry.minSeed === null || seed < entry.minSeed) {
        entry.minSeed = seed;
        entry.primerDetalle = detail;
      }
    }
    const perfilKey = seed % 2 === 0 ? 'standard' : 'sabado_extendido';
    const pEntry = perfilStats[perfilKey].fallasPorInvariante;
    if (!pEntry[invariantKey]) {
      pEntry[invariantKey] = new Set();
    }
    pEntry[invariantKey].add(seed);
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
        manualFuzzInvariantsStats.porRegla.excepcionesNoControladas.add(seed);
        recordFailure(
          'excepcion_no_controlada:fuzz',
          seed,
          `${err.message} - Stack: ${err.stack?.split('\n')[1]?.trim() || ''}`
        );
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
  console.log(`📊 REPORTE GLOBAL DE INVARIANTES POR ETAPA (${TOTAL_SEEDS} semillas)`);
  console.log('='.repeat(85));

  const resumenTabla = INVARIANT_KEYS.map((k) => {
    const [invariante, etapa] = k.split(':');
    const isInfo = INFORMATIVE_INVARIANTS.has(k);
    return {
      invariante,
      etapa,
      estado: stats[k].semillasAfectadas.size === 0 ? 'PASS' : (isInfo ? `INFO (${stats[k].semillasAfectadas.size})` : 'FAIL'),
      semillasConFalla: stats[k].semillasAfectadas.size,
      semillaMinima: stats[k].minSeed ?? '-',
    };
  });

  console.table(resumenTabla);

  console.log('\n' + '='.repeat(85));
  console.log('📊 DESGLOSE DE FALLAS POR PERFIL DEL GENERADOR:');
  console.log('='.repeat(85));
  const desglosePerfilTabla = INVARIANT_KEYS.map((k) => {
    const [invariante, etapa] = k.split(':');
    const isInfo = INFORMATIVE_INVARIANTS.has(k);
    const stdFallas = perfilStats.standard.fallasPorInvariante[k]?.size || 0;
    const extFallas = perfilStats.sabado_extendido.fallasPorInvariante[k]?.size || 0;
    const totalFallas = stats[k].semillasAfectadas.size;
    const tag = isInfo ? 'INFO' : 'FAIL';
    return {
      invariante,
      etapa,
      'Standard (Par)': stdFallas === 0 ? 'PASS (0)' : `${tag} (${stdFallas})`,
      'SabadoExt (Impar)': extFallas === 0 ? 'PASS (0)' : `${tag} (${extFallas})`,
      'Total (500)': totalFallas === 0 ? 'PASS (0)' : `${tag} (${totalFallas})`,
    };
  });
  console.table(desglosePerfilTabla);

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
  console.log('='.repeat(85) + '\n');

  console.log('='.repeat(85));
  console.log('📌 CATEGORÍAS INICIADAS POR PLAN NORMAL VS PLAN DE EMERGENCIA:');
  console.log('='.repeat(85));
  console.log(`- Total categorías evaluadas: ${planesInicioStats.totalCategorias}`);
  const pctNormal = planesInicioStats.totalCategorias > 0
    ? ((planesInicioStats.iniciadasPlanNormal / planesInicioStats.totalCategorias) * 100).toFixed(1)
    : '0';
  const pctEmergencia = planesInicioStats.totalCategorias > 0
    ? ((planesInicioStats.iniciadasPlanEmergencia / planesInicioStats.totalCategorias) * 100).toFixed(1)
    : '0';
  const pctFallback = planesInicioStats.totalCategorias > 0
    ? ((planesInicioStats.iniciadasFallbackViables / planesInicioStats.totalCategorias) * 100).toFixed(1)
    : '0';
  console.log(`- Categorías iniciadas por Plan Normal: ${planesInicioStats.iniciadasPlanNormal} (${pctNormal}%)`);
  console.log(`- Categorías iniciadas por Plan Emergencia: ${planesInicioStats.iniciadasPlanEmergencia} (${pctEmergencia}%)`);
  console.log(`- Categorías viables iniciadas por Fallback: ${planesInicioStats.iniciadasFallbackViables} (${pctFallback}%)`);
  console.log(`- Categorías terminales no iniciadas: ${planesInicioStats.noIniciadas}`);
  console.log('='.repeat(85) + '\n');

  console.log('='.repeat(85));
  console.log('📌 CLASIFICACIÓN DE SALTOS DE MONOTONÍA (PRECHECK_MONOTONIA):');
  console.log('='.repeat(85));
  console.log(`- Total saltos detectados: ${monotoniaSaltosStats.resumen.totalSaltos}`);
  console.log(`- Saltos explicados SOLO por la zona destrabada (deltaOtras <= 0): ${monotoniaSaltosStats.resumen.soloZonaDestrabada}`);
  console.log(`- Saltos con aumento en OTRAS zonas (deltaOtras > 0): ${monotoniaSaltosStats.resumen.aumentoOtrasZonas}`);
  if (monotoniaSaltosStats.saltos.length > 0) {
    console.log('\n- Tabla de saltos por semilla:');
    console.table(monotoniaSaltosStats.saltos);
  }
  if (monotoniaSaltosStats.trazasOtrasZonas.length > 0) {
    console.log('\n- Trazas de desplazamiento en otras zonas:');
    for (const t of monotoniaSaltosStats.trazasOtrasZonas) {
      console.log(`  [Semilla ${t.seed}] Zona destrabada: ${t.zonaDestrabada} (${t.partidoDestrabado}) ocupó cancha ${t.canchaOcupada} @ ${t.franjaOcupada}`);
      console.log(`     -> Desplazó a: ${t.partidoDesplazadoInfo} (perdió franja ${t.franjaPerdida}, nuevo estado: ${t.estadoNuevoDesplazado})`);
    }
  }
  console.log('='.repeat(85) + '\n');

  console.log('='.repeat(85));
  console.log('📌 DISTRIBUCIÓN DE TAMAÑOS DE ZONA MANUAL (sinGrupo):');
  console.log('='.repeat(85));
  console.log(`- Distribución por rangos: 2: ${manualZoneSizesStats.distribucion['2']}, 3: ${manualZoneSizesStats.distribucion['3']}, 4: ${manualZoneSizesStats.distribucion['4']}, 5+: ${manualZoneSizesStats.distribucion['5+']}`);
  console.log(`- Tamaños exactos: ${JSON.stringify(manualZoneSizesStats.tamaniosExactos)}`);
  for (const [sz, count] of Object.entries(manualZoneSizesStats.tamaniosExactos)) {
    const sList = Array.from(manualZoneSizesStats.semillasPorTamanio[sz] || []).sort((a, b) => a - b);
    console.log(`  * Tamaño ${sz} (${count} zonas): semillas ${JSON.stringify(sList)}`);
  }
  if (manualZoneSizesStats.trazasSemillasEspeciales.length > 0) {
    console.log('\n- Trazas literales de formación de zonas de 5 (Semillas 382 y 496):');
    for (const tr of manualZoneSizesStats.trazasSemillasEspeciales) {
      console.log(tr);
    }
  }
  console.log('='.repeat(85) + '\n');

  console.log('='.repeat(85));
  console.log('📌 DESGLOSE PRECHECK_ZONA_MANUAL_PARTIDOS (REGLAS DEL INVARIANTE REFORZADO):');
  console.log('='.repeat(85));
  const failingSeedsArr = Array.from(manualFuzzInvariantsStats.failingSeeds).sort((a, b) => a - b);
  console.log(`- Total semillas con fallas en zona manual: ${failingSeedsArr.length}`);
  console.log(`- Semilla mínima: ${failingSeedsArr[0] ?? '-'}`);
  console.log(`- Conteo por regla nueva:`);
  console.log(`    * [Loop destrabe sin partidos (memoria)]: ${manualFuzzInvariantsStats.porRegla.loopDestrabeSinPartidos.size} semillas`);
  console.log(`    * [Formato / cantidad partidos (DB)]: ${manualFuzzInvariantsStats.porRegla.formatoCantidadPartidos.size} semillas`);
  console.log(`    * [Parejas null indebidas / origen faltante (DB)]: ${manualFuzzInvariantsStats.porRegla.parejasNullOOrigen.size} semillas`);
  console.log(`    * [Horario / cancha vs pendiente (DB)]: ${manualFuzzInvariantsStats.porRegla.horarioOPendiente.size} semillas`);
  console.log(`    * [Regla 1 o 5+ parejas (no permitir false)]: ${manualFuzzInvariantsStats.porRegla.regla1o5Parejas.size} semillas`);
  console.log(`    * [Mini bracket sin origen persistido (global)]: ${manualFuzzInvariantsStats.porRegla.miniBracketOrigenPersistido.size} semillas`);
  console.log(`    * [Excepciones no controladas]: ${manualFuzzInvariantsStats.porRegla.excepcionesNoControladas.size} semillas`);

  const LISTA_85_PREVIA = [
    8, 10, 16, 23, 34, 40, 50, 69, 70, 76, 78, 80, 86, 90, 104, 112, 116, 127, 130, 132, 133, 138, 142, 144, 147, 148, 158, 162, 165, 166, 168, 174, 185, 186, 188, 191, 212, 218, 228, 232, 236, 240, 245, 250, 264, 270, 274, 279, 280, 310, 313, 323, 325, 328, 330, 340, 352, 353, 362, 363, 366, 367, 373, 374, 378, 380, 382, 385, 386, 390, 405, 409, 420, 439, 440, 443, 448, 455, 456, 471, 472, 476, 482, 491, 492
  ];
  const setRunner = new Set(failingSeedsArr);
  const setPrevia = new Set(LISTA_85_PREVIA);

  const enRunnerNoPrevia = failingSeedsArr.filter((s) => !setPrevia.has(s));
  const enPreviaNoRunner = LISTA_85_PREVIA.filter((s) => !setRunner.has(s));

  console.log(`- Comparación de semillas (Runner vs Lista 85):`);
  console.log(`    * Semillas en runner pero NO en lista de 85: ${JSON.stringify(enRunnerNoPrevia)}`);
  console.log(`    * Semillas en lista de 85 pero NO en runner: ${JSON.stringify(enPreviaNoRunner)}`);
  console.log(`    * Coincidencia exacta: ${enRunnerNoPrevia.length === 0 && enPreviaNoRunner.length === 0 ? 'SÍ (100% idénticas)' : 'NO'}`);
  console.log(`- Semillas afectadas del runner: ${JSON.stringify(failingSeedsArr)}`);
  console.log('='.repeat(85) + '\n');

  console.log('='.repeat(85));
  console.log('📊 MÉTRICAS R32 EN POST-INICIO (POR PERFIL Y GLOBAL):');
  console.log('='.repeat(85));
  for (const pKey of ['standard', 'sabado_extendido']) {
    const p = perfilStats[pKey];
    const pctConHorario = p.seedsConR32.size > 0
      ? ((p.seedsConR32ConHorario.size / p.seedsConR32.size) * 100).toFixed(1)
      : '0';
    const pctP = p.totalR32NoBye > 0
      ? ((p.sinHorarioR32 / p.totalR32NoBye) * 100).toFixed(1)
      : '0';
    console.log(`[PERFIL: ${p.nombre}]`);
    console.log(`  - Total semillas del perfil: ${p.totalSeeds}`);
    console.log(`  - Semillas con partidos R32 no-BYE: ${p.seedsConR32.size} (${((p.seedsConR32.size / p.totalSeeds) * 100).toFixed(1)}%)`);
    console.log(`  - Semillas con R32 con horario asignado: ${p.seedsConR32ConHorario.size}/${p.seedsConR32.size} (${pctConHorario}%)`);
    console.log(`  - Total de partidos R32 no-BYE generados: ${p.totalR32NoBye}`);
    console.log(`  - Partidos R32 no-BYE sin horario: ${p.sinHorarioR32} (${pctP}%)`);
    console.log(`  - Semillas con al menos un R32 sin horario: ${p.seedsConSinHorarioR32.size}/${p.seedsConR32.size}`);
    console.log('');
  }
  const pctConHorarioTotal = r32FuzzStats.seedsConR32.size > 0
    ? ((r32FuzzStats.seedsConR32ConHorario.size / r32FuzzStats.seedsConR32.size) * 100).toFixed(1)
    : '0';
  console.log('[TOTAL GLOBAL COMBINADO]');
  console.log(`  - Total semillas: ${TOTAL_SEEDS}`);
  console.log(`  - Semillas con partidos R32 no-BYE: ${r32FuzzStats.seedsConR32.size} (${((r32FuzzStats.seedsConR32.size / TOTAL_SEEDS) * 100).toFixed(1)}%)`);
  console.log(`  - Semillas con R32 con horario asignado: ${r32FuzzStats.seedsConR32ConHorario.size}/${r32FuzzStats.seedsConR32.size} (${pctConHorarioTotal}%)`);
  console.log(`  - Total partidos R32 no-BYE: ${r32FuzzStats.totalR32NoBye}`);
  console.log(`  - Partidos R32 no-BYE sin horario: ${r32FuzzStats.sinHorarioR32}`);
  console.log('='.repeat(85) + '\n');

  console.log('='.repeat(85));
  console.log('📌 LISTA EXACTA DE SEMILLAS POR INVARIANTE (JSON):');
  console.log('='.repeat(85));
  for (const k of INVARIANT_KEYS) {
    const list = Array.from(stats[k].semillasAfectadas).sort((a, b) => a - b);
    console.log(`[SEMILLAS] ${k} (${list.length}): ${JSON.stringify(list)}`);
  }
  console.log('='.repeat(85) + '\n');

  console.log('📥 PARTIDOS QUE LA REDUCCIÓN DEJA SIN HORARIO (BANDEJA), POR PERFIL Y DÍA:');
  for (const k of Object.keys(bandejaStats).sort()) {
    const b = bandejaStats[k];
    console.log(`[BANDEJA] ${k} semillasReducidas=${b.semillasReducidas} semillasConBandeja=${b.semillasConBandeja} partidos=${b.partidos}`);
  }
  console.log('='.repeat(85) + '\n');

  let hayFallas = false;
  for (const k of INVARIANT_KEYS) {
    if (stats[k].minSeed !== null) {
      if (INFORMATIVE_INVARIANTS.has(k)) {
        console.log(
          `ℹ️  [${k}] (Informativo) Semilla mínima: ${stats[k].minSeed} (${stats[k].semillasAfectadas.size}/${TOTAL_SEEDS} semillas) -> ${stats[k].primerDetalle}`
        );
      } else {
        hayFallas = true;
        console.error(
          `❌ [${k}] Semilla mínima: ${stats[k].minSeed} (${stats[k].semillasAfectadas.size}/${TOTAL_SEEDS} semillas) -> ${stats[k].primerDetalle}`
        );
      }
    }
  }

  if (hayFallas) {
    process.exit(1);
  }
  process.exit(0);
}

if (require.main === module) {
  runFuzzSuite().catch((err) => {
    console.error('❌ Error fatal en test-fuzz-scheduler:', err);
    process.exit(1);
  });
}

module.exports = { runFuzzSuite, runSingleSeed, planesInicioStats, monotoniaSaltosStats, manualZoneSizesStats };
