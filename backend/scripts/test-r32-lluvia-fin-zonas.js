'use strict';

/**
 * test-r32-lluvia-fin-zonas.js
 *
 * Ticket (3): al reducir canchas por lluvia en sábado, los partidos de zona se compactan
 * y pueden terminar después de un R32 ya fijado.
 *
 * Contrato esperado (decisiones tomadas):
 * - R32 automáticos (horarioManual false) de la jornada afectada salen de la ocupación antes de
 *   compactar zonas (cancha activa o inactiva) y se reubican en tier 2 con piso de fin de zonas.
 * - Si alguna zona de la categoría queda con partidos sin horario, los R32 automáticos de esa
 *   categoría quedan sinHorarioAsignado: true y registrados en partidosSinSlot (Regla B).
 * - R32 automático que no entra antes de dayLimitMs: sinHorarioAsignado: true, sin horario viejo.
 * - R32 manuales: en cancha activa no se mueven; en cancha inactiva se reubican sin tocar horarioManual.
 *
 * Escenarios armados a mano (club de 4 canchas, sábado 09:00 a 06:00 del domingo,
 * reducción a 1 cancha). Con 1 cancha entran 16 partidos: de 09:00 a 03:45 (fin 05:00).
 *
 * Cada test es independiente: limpia la base, arma su escenario y reporta PASS/FAIL.
 */

require('./utils/testEnvGuard');
const { ensureTestDb } = require('./utils/testEnvGuard');
const { resetTestDb } = require('./reset-test-db');
const prisma = require('../src/lib/prisma');
const organizadorService = require('../src/services/organizador.service');
const zonaService = require('../src/services/zona.service');
const canchasOverridesService = require('../src/services/canchasOverrides.service');
const { getFasesEliminatorias } = require('../src/services/faseEliminatoria.service');
const {
  calcularDescansosEliminatoria,
  indexarPartidosEliminatoria,
  resolverPadresEHijoEliminatoria,
} = require('../src/utils/bracketWarnings');
const { parseFechaLocal } = require('../src/utils/dateUtils');
const { DURACION_PARTIDO_MIN } = require('../src/services/slots.service');

const DURACION_MS = DURACION_PARTIDO_MIN * 60 * 1000;
const FECHA_TORNEO = '2026-09-04';
const DIA_SABADO = '2026-09-05';
const CANCHAS_CLUB = 4;
const CANCHAS_LLUVIA = 1;

const BASE_SABADO_MS = zonaService.proximaFechaPorDia('Sabado', parseFechaLocal(FECHA_TORNEO)).getTime();

// Inicio de la ventana nocturna de R32 para el club de prueba (sábado 09:00 a 24:00):
// max(09:00, min(20:45, 24:00 - 150 min)) = 20:45. Valor fijo como oráculo independiente del código.
const SAB_NOCHE_MS = BASE_SABADO_MS + (20 * 60 + 45) * 60 * 1000;

/** Hora del sábado (hh >= 24 es trasnoche del domingo). */
function sab(hh, mm = 0) {
  return new Date(BASE_SABADO_MS + (hh * 60 + mm) * 60 * 1000);
}

/** Turno k de la grilla de 75 min desde las 09:00 del sábado. */
function turno(k) {
  return new Date(BASE_SABADO_MS + (9 * 60 + 75 * k) * 60 * 1000);
}

function iso(d) {
  return d ? new Date(d).toISOString() : 'null';
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function limpiarDb() {
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
 * Arma un torneo EN_CURSO con una categoría, zonas ROUND_ROBIN con horario fijo en sábado,
 * cruces de R32 sin parejas definidas y, opcionalmente, octavos en domingo.
 *
 * zonas: [[ [k, cancha], ... ], ...]  (1 partido → zona de 2 parejas, 3 partidos → zona de 3)
 * r32 / octavos: [{ pos, fechaHora, cancha, manual, esBye }]
 */
async function crearEscenario(nombre, { zonas, r32 = [], octavos = [] }) {
  const org = await prisma.organizador.create({
    data: {
      nombre: `Club ${nombre}`,
      email: `${nombre}@r32-lluvia.test`,
      passwordHash: 'hash',
      cantidadCanchas: CANCHAS_CLUB,
      viernesInicio: '18:00',
      viernesFin: '23:00',
      sabadoInicio: '09:00',
      sabadoFin: '24:00',
      domingoInicio: '09:00',
      domingoFin: '22:00',
    },
  });

  const torneo = await prisma.torneo.create({
    data: {
      nombre: `Torneo ${nombre}`,
      slug: `r32-lluvia-${nombre}`,
      fecha: parseFechaLocal(FECHA_TORNEO),
      estado: 'EN_CURSO',
      organizadorId: org.id,
    },
  });

  const cat = await prisma.categoria.create({
    data: { torneoId: torneo.id, nombre: '6ta', estado: 'EN_CURSO' },
  });

  const letras = 'ABCDEFGHIJ';
  let orden = 1;
  const partidosZonaCreados = [];
  for (let zi = 0; zi < zonas.length; zi++) {
    // Round robin: array de [k, cancha] (1 partido → 2 parejas, 3 partidos → 3 parejas).
    // Mini-bracket: { formato: 'MINI_BRACKET', partidos: [P1, P2, P3, P4] } con 4 parejas;
    // P3 y P4 se crean sin parejas definidas (ganadores/perdedores de Ronda 1).
    const raw = zonas[zi];
    const esMiniBracket = !Array.isArray(raw) && raw.formato === 'MINI_BRACKET';
    const spec = esMiniBracket ? raw.partidos : raw;
    const size = esMiniBracket ? 4 : spec.length === 1 ? 2 : 3;
    const zona = await prisma.zona.create({
      data: {
        categoriaId: cat.id,
        nombre: `Zona ${letras[zi]}`,
        clasifican: size === 2 ? 1 : 2,
        formato: esMiniBracket ? 'MINI_BRACKET' : 'ROUND_ROBIN',
      },
    });
    const parejas = [];
    for (let i = 0; i < size; i++) {
      parejas.push(
        await prisma.pareja.create({
          data: { categoriaId: cat.id, jugador1: `${letras[zi]}${i + 1}a`, jugador2: `${letras[zi]}${i + 1}b`, orden: orden++ },
        })
      );
    }
    const cruces = esMiniBracket
      ? [[0, 1], [2, 3], null, null]
      : size === 2 ? [[0, 1]] : [[0, 1], [0, 2], [1, 2]];
    const creadosZona = [];
    for (let mi = 0; mi < cruces.length; mi++) {
      // [null, null] = partido de zona que ya estaba sin horario (ej. pendiente del inicio de emergencia)
      const [k, cancha] = spec[mi];
      const sinHorarioPrevio = k === null;
      creadosZona.push(
        await prisma.partido.create({
          data: {
            categoriaId: cat.id,
            zonaId: zona.id,
            posicionEnRonda: mi + 1,
            pareja1Id: cruces[mi] ? parejas[cruces[mi][0]].id : null,
            pareja2Id: cruces[mi] ? parejas[cruces[mi][1]].id : null,
            fechaHora: sinHorarioPrevio ? null : turno(k),
            canchaNumero: sinHorarioPrevio ? null : cancha,
            sinHorarioAsignado: sinHorarioPrevio,
          },
        })
      );
    }
    partidosZonaCreados.push(creadosZona);
  }

  const crearFase = async (nombreFase, ronda, cruces) => {
    if (cruces.length === 0) return [];
    const fase = await prisma.faseEliminatoria.create({
      data: { categoriaId: cat.id, nombre: nombreFase, ronda },
    });
    const creados = [];
    for (const c of cruces) {
      // Parejas propias del cruce (fuera de las zonas) cuando el escenario pide el cruce ya definido
      let pareja1Id = null;
      let pareja2Id = null;
      if (c.conParejas) {
        const pa = await prisma.pareja.create({
          data: { categoriaId: cat.id, jugador1: `R${ronda}-${c.pos}-1a`, jugador2: `R${ronda}-${c.pos}-1b`, orden: orden++ },
        });
        const pb = await prisma.pareja.create({
          data: { categoriaId: cat.id, jugador1: `R${ronda}-${c.pos}-2a`, jugador2: `R${ronda}-${c.pos}-2b`, orden: orden++ },
        });
        pareja1Id = pa.id;
        pareja2Id = pb.id;
      }
      creados.push(
        await prisma.partido.create({
          data: {
            categoriaId: cat.id,
            faseEliminatoriaId: fase.id,
            posicionEnRonda: c.pos,
            pareja1Id,
            pareja2Id,
            origenPareja1: `1° Zona ${letras[(c.pos - 1) % zonas.length]}`,
            origenPareja2: c.esBye ? null : `2° Zona ${letras[c.pos % zonas.length]}`,
            fechaHora: c.esBye ? null : c.fechaHora || null,
            canchaNumero: c.esBye ? null : c.cancha || null,
            sinHorarioAsignado: false,
            esBye: Boolean(c.esBye),
            horarioManual: Boolean(c.manual),
          },
        })
      );
    }
    return creados;
  };

  const r32Creados = await crearFase('Dieciseisavos de Final', 32, r32);
  const octavosCreados = await crearFase('Octavos de Final', 16, octavos);

  return { org, torneo, cat, zonas: partidosZonaCreados, r32: r32Creados, octavos: octavosCreados };
}

async function reducir(esc) {
  return organizadorService.reprogramarPorReduccionCanchas(esc.org.id, esc.torneo.id, CANCHAS_LLUVIA, null, DIA_SABADO);
}

async function restaurar(esc) {
  return organizadorService.reprogramarPorReduccionCanchas(esc.org.id, esc.torneo.id, CANCHAS_CLUB, null, DIA_SABADO);
}

async function cargarPartidos(esc) {
  return prisma.partido.findMany({
    where: { categoria: { torneoId: esc.torneo.id } },
    include: { faseEliminatoria: { select: { ronda: true } } },
  });
}

async function leerPartidosSinSlot(esc) {
  const ov = await prisma.overrideCanchasDia.findUnique({
    where: { torneoId_diaKey: { torneoId: esc.torneo.id, diaKey: DIA_SABADO } },
  });
  if (!ov || !ov.partidosSinSlot) return {};
  return typeof ov.partidosSinSlot === 'string' ? JSON.parse(ov.partidosSinSlot) : ov.partidosSinSlot;
}

function conHorario(p) {
  return Boolean(p.fechaHora && !p.sinHorarioAsignado && !p.esBye);
}

function finDeZonas(partidos) {
  const zona = partidos.filter((p) => p.zonaId);
  const sinHorario = zona.filter((p) => !conHorario(p));
  const ends = zona.filter(conHorario).map((p) => new Date(p.fechaHora).getTime() + DURACION_MS);
  return { maxEndMs: ends.length ? Math.max(...ends) : null, sinHorario };
}

/** Sin solapamientos de cancha ni de pareja entre partidos con horario. */
function verificarSinSolapamientos(partidos, etapa) {
  const agendados = partidos.filter(conHorario);
  const solapan = (a, b) => {
    const aS = new Date(a.fechaHora).getTime();
    const bS = new Date(b.fechaHora).getTime();
    return aS < bS + DURACION_MS && bS < aS + DURACION_MS;
  };
  for (let i = 0; i < agendados.length; i++) {
    for (let j = i + 1; j < agendados.length; j++) {
      const a = agendados[i];
      const b = agendados[j];
      if (!solapan(a, b)) continue;
      assert(
        a.canchaNumero !== b.canchaNumero,
        `[${etapa}] Solapamiento en cancha ${a.canchaNumero}: ${a.id} (${iso(a.fechaHora)}) y ${b.id} (${iso(b.fechaHora)})`
      );
      const parejasA = [a.pareja1Id, a.pareja2Id].filter(Boolean);
      const compartida = [b.pareja1Id, b.pareja2Id].filter(Boolean).find((id) => parejasA.includes(id));
      assert(
        !compartida,
        `[${etapa}] Solapamiento de pareja ${compartida}: ${a.id} (${iso(a.fechaHora)}) y ${b.id} (${iso(b.fechaHora)})`
      );
    }
  }
}

function assertR32NoAntesDeFinZonas(partidos, etapa) {
  const { maxEndMs } = finDeZonas(partidos);
  const r32Auto = partidos.filter((p) => p.faseEliminatoria?.ronda === 32 && !p.horarioManual && conHorario(p));
  for (const p of r32Auto) {
    assert(
      maxEndMs === null || new Date(p.fechaHora).getTime() >= maxEndMs,
      `[${etapa}] R32 automático ${p.id} inicia ${iso(p.fechaHora)}, antes del fin de zonas ${iso(maxEndMs)}`
    );
  }
}

function assertR32NoAntesDeSabNoche(partidos, etapa) {
  const r32 = partidos.filter((p) => p.faseEliminatoria?.ronda === 32 && conHorario(p));
  for (const p of r32) {
    assert(
      new Date(p.fechaHora).getTime() >= SAB_NOCHE_MS,
      `[${etapa}] R32 ${p.id} (pos ${p.posicionEnRonda}) inicia ${iso(p.fechaHora)}, antes de la ventana nocturna ${iso(SAB_NOCHE_MS)}`
    );
  }
}

function assertSinHorario(p, etapa) {
  assert(
    p.sinHorarioAsignado === true && p.fechaHora === null && p.canchaNumero === null,
    `[${etapa}] R32 automático ${p.id} (pos ${p.posicionEnRonda}) debía quedar sin horario; quedó sinHorarioAsignado=${p.sinHorarioAsignado}, fechaHora=${iso(p.fechaHora)}, cancha=${p.canchaNumero}`
  );
}

// 4 zonas de 3 (12 partidos) en 4 canchas a las 09:00 / 10:15 / 11:30.
// Con 1 cancha entran todas: de 09:00 a 22:45 (fin 00:00).
const ZONAS_12 = [
  [[0, 1], [1, 1], [2, 1]],
  [[0, 2], [1, 2], [2, 2]],
  [[0, 3], [1, 3], [2, 3]],
  [[0, 4], [1, 4], [2, 4]],
];

// 16 partidos: las 4 zonas anteriores + Zona E (3) en cancha 1 + Zona F (2 parejas) en cancha 2.
// Con 1 cancha entran justo: de 09:00 a 03:45 (fin 05:00). No queda lugar para ningún R32.
const ZONAS_16 = [
  ...ZONAS_12,
  [[3, 1], [4, 1], [5, 1]],
  [[3, 2]],
];

// 18 partidos: las 4 zonas + Zona E y Zona F (3 cada una). Con 1 cancha no entran (máximo 16).
const ZONAS_18 = [
  ...ZONAS_12,
  [[3, 1], [4, 1], [5, 1]],
  [[3, 2], [4, 2], [5, 2]],
];

/**
 * (a) R32 automático en cancha ACTIVA, todas las zonas entran tras la reducción:
 * debe quedar con inicio >= fin de zonas y sin solapamientos.
 */
async function testA_r32AutoCanchaActivaZonasEntran() {
  const esc = await crearEscenario('test-a', {
    zonas: ZONAS_12,
    r32: [{ pos: 1, fechaHora: sab(20, 45), cancha: 1 }],
  });

  await reducir(esc);
  const partidos = await cargarPartidos(esc);

  const { sinHorario } = finDeZonas(partidos);
  assert(sinHorario.length === 0, `[post-reduccion] Precondición: todas las zonas debían entrar; quedaron ${sinHorario.length} partidos de zona sin horario`);
  verificarSinSolapamientos(partidos, 'post-reduccion');

  const r32 = partidos.find((p) => p.id === esc.r32[0].id);
  assert(conHorario(r32), `[post-reduccion] R32 automático debía tener horario; sinHorarioAsignado=${r32.sinHorarioAsignado}, fechaHora=${iso(r32.fechaHora)}`);
  assert(r32.canchaNumero <= CANCHAS_LLUVIA, `[post-reduccion] R32 en cancha inactiva ${r32.canchaNumero}`);
  assertR32NoAntesDeFinZonas(partidos, 'post-reduccion');
  assertR32NoAntesDeSabNoche(partidos, 'post-reduccion');
}

/**
 * (b) Igual que (a) pero con el R32 automático en cancha INACTIVA.
 */
async function testB_r32AutoCanchaInactivaZonasEntran() {
  const esc = await crearEscenario('test-b', {
    zonas: ZONAS_12,
    r32: [{ pos: 1, fechaHora: sab(20, 45), cancha: 3 }],
  });

  await reducir(esc);
  const partidos = await cargarPartidos(esc);

  const { sinHorario } = finDeZonas(partidos);
  assert(sinHorario.length === 0, `[post-reduccion] Precondición: todas las zonas debían entrar; quedaron ${sinHorario.length} partidos de zona sin horario`);
  verificarSinSolapamientos(partidos, 'post-reduccion');

  const r32 = partidos.find((p) => p.id === esc.r32[0].id);
  assert(conHorario(r32), `[post-reduccion] R32 automático debía tener horario; sinHorarioAsignado=${r32.sinHorarioAsignado}, fechaHora=${iso(r32.fechaHora)}`);
  assert(r32.canchaNumero <= CANCHAS_LLUVIA, `[post-reduccion] R32 en cancha inactiva ${r32.canchaNumero}`);
  assertR32NoAntesDeFinZonas(partidos, 'post-reduccion');
}

/**
 * (c) Las zonas no entran (quedan partidos de zona sin horario): los R32 automáticos de la
 * categoría (cancha activa e inactiva) quedan sinHorarioAsignado y en partidosSinSlot.
 */
async function testC_zonasNoEntranR32SinHorario() {
  const esc = await crearEscenario('test-c', {
    zonas: ZONAS_18,
    r32: [
      { pos: 1, fechaHora: sab(20, 45), cancha: 1 },
      { pos: 2, fechaHora: sab(20, 45), cancha: 3 },
    ],
  });

  await reducir(esc);
  const partidos = await cargarPartidos(esc);

  const { sinHorario } = finDeZonas(partidos);
  assert(sinHorario.length > 0, '[post-reduccion] Precondición: debían quedar partidos de zona sin horario');
  verificarSinSolapamientos(partidos, 'post-reduccion');

  const sinSlot = await leerPartidosSinSlot(esc);
  for (const r of esc.r32) {
    const p = partidos.find((x) => x.id === r.id);
    assertSinHorario(p, 'post-reduccion');
    assert(
      Object.prototype.hasOwnProperty.call(sinSlot, r.id),
      `[post-reduccion] R32 ${r.id} (pos ${r.posicionEnRonda}) no figura en partidosSinSlot`
    );
  }
}

const LIMITE_SABADO_MS = BASE_SABADO_MS + 30 * 60 * 60 * 1000; // domingo 06:00 (dayLimitMs del sábado)

function enMapa(sinSlot, id) {
  return Object.prototype.hasOwnProperty.call(sinSlot, id);
}

function assertHayLugarParaR32(partidos, etapa) {
  const { maxEndMs } = finDeZonas(partidos);
  const pisoMs = Math.max(SAB_NOCHE_MS, maxEndMs || 0);
  assert(
    pisoMs + DURACION_MS <= LIMITE_SABADO_MS,
    `[${etapa}] Precondición: debía quedar lugar para el R32 antes de las 06:00 (fin de zonas conocido ${iso(maxEndMs)})`
  );
}

// Mini-bracket con P1 sin horario previo (pendiente de emergencia) y P2/P3/P4 con horario
// (P3/P4 fijados a mano antes de jugarse la Ronda 1). En lluvia, P3/P4 pierden el horario por
// ronda1SinHorario sin buscar turno, aunque haya canchas libres.
const MB_P1_PENDIENTE = { formato: 'MINI_BRACKET', partidos: [[null, null], [3, 1], [4, 1], [4, 2]] };

/**
 * (c2) Un partido de zona que YA estaba sin horario antes de la corrida (pendiente del inicio de
 * emergencia, fuera del mapa del día) NO dispara la Regla B: con lugar libre, el R32 automático
 * queda con horario, después del fin de zonas conocido y de la ventana nocturna.
 */
async function testC2_pendienteEmergenciaNoDisparaReglaB() {
  const esc = await crearEscenario('test-c2', {
    zonas: [...ZONAS_12, [[null, null]]],
    r32: [{ pos: 1, fechaHora: sab(20, 45), cancha: 1 }],
  });
  const emergencia = esc.zonas[4][0];

  await reducir(esc);
  const partidos = await cargarPartidos(esc);
  verificarSinSolapamientos(partidos, 'post-reduccion');

  const sinSlot = await leerPartidosSinSlot(esc);
  const pEm = partidos.find((p) => p.id === emergencia.id);
  assert(!conHorario(pEm) && !enMapa(sinSlot, pEm.id), '[post-reduccion] Precondición: el pendiente de emergencia debía seguir sin horario y fuera del mapa');
  assertHayLugarParaR32(partidos, 'post-reduccion');

  const r32 = partidos.find((p) => p.id === esc.r32[0].id);
  assert(
    conHorario(r32),
    `[post-reduccion] R32 automático debía quedar CON horario (el pendiente de emergencia no dispara la Regla B); quedó sinHorarioAsignado=${r32.sinHorarioAsignado}, fechaHora=${iso(r32.fechaHora)}`
  );
  assert(r32.canchaNumero <= CANCHAS_LLUVIA, `[post-reduccion] R32 en cancha inactiva ${r32.canchaNumero}`);
  assertR32NoAntesDeFinZonas(partidos, 'post-reduccion');
  assertR32NoAntesDeSabNoche(partidos, 'post-reduccion');
}

/**
 * (c3) Un partido de zona que TENÍA horario queda sin horario por esta corrida y aun así hay lugar
 * para el R32: el R32 automático queda sinHorarioAsignado y en partidosSinSlot.
 * Escenario: P3/P4 de un mini-bracket pierden el horario porque P1 ya estaba sin horario
 * (por dayLimitMs o conflicto de pareja no se puede armar con lugar libre: ver BITACORA sesión 78).
 */
async function testC3_zonaDesasignadaEnCorridaDisparaReglaB() {
  const esc = await crearEscenario('test-c3', {
    zonas: [...ZONAS_12, MB_P1_PENDIENTE],
    r32: [{ pos: 1, fechaHora: sab(20, 45), cancha: 1 }],
  });
  const [p1, , p3, p4] = esc.zonas[4];

  await reducir(esc);
  const partidos = await cargarPartidos(esc);
  verificarSinSolapamientos(partidos, 'post-reduccion');

  const sinSlot = await leerPartidosSinSlot(esc);
  assert(!conHorario(partidos.find((p) => p.id === p1.id)), '[post-reduccion] Precondición: P1 debía seguir sin horario');
  for (const z of [p3, p4]) {
    const pz = partidos.find((p) => p.id === z.id);
    assert(
      !conHorario(pz) && enMapa(sinSlot, z.id),
      `[post-reduccion] Precondición: P${z.posicionEnRonda} tenía horario y debía quedar sin horario y en el mapa (sinHorario=${pz.sinHorarioAsignado}, fechaHora=${iso(pz.fechaHora)})`
    );
  }
  assertHayLugarParaR32(partidos, 'post-reduccion');

  const r32 = partidos.find((p) => p.id === esc.r32[0].id);
  assertSinHorario(r32, 'post-reduccion');
  assert(enMapa(sinSlot, r32.id), `[post-reduccion] R32 ${r32.id} no figura en partidosSinSlot`);
}

/**
 * (c4) Dos corridas de lluvia el mismo día y restauración:
 * - 1ª reducción (a 2 canchas): P3/P4 pierden horario → el R32 automático queda sin horario.
 * - 2ª reducción (a 1 cancha): P3/P4 siguen sin entrar; ya no tenían horario al empezar la corrida,
 *   pero están en el mapa del día (los desplazó la lluvia) → el R32 sigue sin horario aunque haya lugar.
 * - El organizador le asigna horario a P1 y se restauran las canchas: P3/P4 vuelven a entrar y el R32
 *   se recupera después del fin de zonas incluyendo a P3/P4 y de la ventana nocturna.
 */
async function testC4_dosCorridasYRestauracion() {
  const esc = await crearEscenario('test-c4', {
    zonas: [...ZONAS_12, MB_P1_PENDIENTE],
    r32: [{ pos: 1, fechaHora: sab(20, 45), cancha: 1 }],
  });
  const [p1, , p3, p4] = esc.zonas[4];
  const r32Id = esc.r32[0].id;

  // 1ª corrida
  await organizadorService.reprogramarPorReduccionCanchas(esc.org.id, esc.torneo.id, 2, null, DIA_SABADO);
  let partidos = await cargarPartidos(esc);
  let sinSlot = await leerPartidosSinSlot(esc);
  verificarSinSolapamientos(partidos, 'post-reduccion-1');
  assertSinHorario(partidos.find((p) => p.id === r32Id), 'post-reduccion-1');
  assert(enMapa(sinSlot, r32Id), '[post-reduccion-1] R32 no figura en partidosSinSlot');

  // 2ª corrida
  await reducir(esc);
  partidos = await cargarPartidos(esc);
  sinSlot = await leerPartidosSinSlot(esc);
  verificarSinSolapamientos(partidos, 'post-reduccion-2');
  for (const z of [p3, p4]) {
    const pz = partidos.find((p) => p.id === z.id);
    assert(!conHorario(pz) && enMapa(sinSlot, z.id), `[post-reduccion-2] Precondición: P${z.posicionEnRonda} debía seguir sin horario y en el mapa`);
  }
  assertHayLugarParaR32(partidos, 'post-reduccion-2');
  assertSinHorario(partidos.find((p) => p.id === r32Id), 'post-reduccion-2');
  assert(enMapa(sinSlot, r32Id), '[post-reduccion-2] R32 no figura en partidosSinSlot');

  // El organizador le asigna horario a P1 (estado intermedio: la restauración recompacta la jornada)
  await prisma.partido.update({
    where: { id: p1.id },
    data: { fechaHora: turno(0), canchaNumero: 2, sinHorarioAsignado: false },
  });

  // Restauración
  await restaurar(esc);
  partidos = await cargarPartidos(esc);
  verificarSinSolapamientos(partidos, 'post-restauracion');
  const { sinHorario } = finDeZonas(partidos);
  assert(sinHorario.length === 0, `[post-restauracion] Precondición: con P1 agendado todas las zonas debían entrar; quedaron ${sinHorario.length} sin horario`);
  const r32 = partidos.find((p) => p.id === r32Id);
  assert(
    conHorario(r32),
    `[post-restauracion] R32 no se recuperó (sinHorarioAsignado=${r32.sinHorarioAsignado}, fechaHora=${iso(r32.fechaHora)})`
  );
  assertR32NoAntesDeFinZonas(partidos, 'post-restauracion');
  assertR32NoAntesDeSabNoche(partidos, 'post-restauracion');
}

/**
 * (d) Todas las zonas entran pero el R32 automático no entra antes de dayLimitMs:
 * queda sinHorarioAsignado, sin conservar su horario original (cancha activa e inactiva).
 */
async function testD_r32NoEntraAntesDeDayLimit() {
  const esc = await crearEscenario('test-d', {
    zonas: ZONAS_16,
    r32: [
      { pos: 1, fechaHora: sab(20, 45), cancha: 1 },
      { pos: 2, fechaHora: sab(20, 45), cancha: 3 },
    ],
  });

  await reducir(esc);
  const partidos = await cargarPartidos(esc);

  const sinSlot = await leerPartidosSinSlot(esc);
  for (const r of esc.r32) {
    const p = partidos.find((x) => x.id === r.id);
    assertSinHorario(p, 'post-reduccion');
    assert(
      Object.prototype.hasOwnProperty.call(sinSlot, r.id),
      `[post-reduccion] R32 ${r.id} (pos ${r.posicionEnRonda}) no figura en partidosSinSlot`
    );
  }

  // Precondición del escenario (distingue este caso de (c)): con los R32 fuera, las 16 de zona entran.
  const { sinHorario } = finDeZonas(partidos);
  assert(sinHorario.length === 0, `[post-reduccion] Precondición: todas las zonas debían entrar; quedaron ${sinHorario.length} partidos de zona sin horario`);
  verificarSinSolapamientos(partidos, 'post-reduccion');
}

/**
 * (e) R32 manual en cancha ACTIVA: no se mueve, horarioManual sigue true y
 * getFasesEliminatorias devuelve INICIA_ANTES_FIN_ZONAS.
 */
async function testE_r32ManualCanchaActivaNoSeMueve() {
  const horaManual = sab(20, 45);
  const esc = await crearEscenario('test-e', {
    zonas: ZONAS_12,
    r32: [{ pos: 1, fechaHora: horaManual, cancha: 1, manual: true }],
  });

  await reducir(esc);
  const partidos = await cargarPartidos(esc);
  verificarSinSolapamientos(partidos, 'post-reduccion');

  const r32 = partidos.find((p) => p.id === esc.r32[0].id);
  assert(
    r32.fechaHora && new Date(r32.fechaHora).getTime() === horaManual.getTime() && r32.canchaNumero === 1 && !r32.sinHorarioAsignado,
    `[post-reduccion] R32 manual se movió: esperado ${iso(horaManual)} C1, recibido ${iso(r32.fechaHora)} C${r32.canchaNumero} sinHorario=${r32.sinHorarioAsignado}`
  );
  assert(r32.horarioManual === true, `[post-reduccion] R32 manual perdió horarioManual (=${r32.horarioManual})`);

  const fases = await getFasesEliminatorias(esc.org.id, esc.cat.id);
  const r32Fase = fases.flatMap((f) => f.partidos).find((p) => p.id === r32.id);
  const codigos = (r32Fase.advertencias || []).map((a) => a.codigo);
  assert(
    codigos.includes('INICIA_ANTES_FIN_ZONAS'),
    `[post-reduccion] getFasesEliminatorias no devolvió INICIA_ANTES_FIN_ZONAS para el R32 manual (advertencias: ${JSON.stringify(codigos)})`
  );
}

/**
 * (e2) R32 manual CON las dos parejas definidas en cancha ACTIVA: no se mueve,
 * horarioManual sigue true y getFasesEliminatorias devuelve INICIA_ANTES_FIN_ZONAS.
 */
async function testE2_r32ManualConParejasCanchaActivaNoSeMueve() {
  const horaManual = sab(20, 45);
  const esc = await crearEscenario('test-e2', {
    zonas: ZONAS_12,
    r32: [{ pos: 1, fechaHora: horaManual, cancha: 1, manual: true, conParejas: true }],
  });
  assert(esc.r32[0].pareja1Id && esc.r32[0].pareja2Id, 'Precondición: el R32 debía tener las dos parejas definidas');

  await reducir(esc);
  const partidos = await cargarPartidos(esc);
  verificarSinSolapamientos(partidos, 'post-reduccion');

  const r32 = partidos.find((p) => p.id === esc.r32[0].id);
  assert(
    r32.fechaHora && new Date(r32.fechaHora).getTime() === horaManual.getTime() && r32.canchaNumero === 1 && !r32.sinHorarioAsignado,
    `[post-reduccion] R32 manual con parejas se movió: esperado ${iso(horaManual)} C1, recibido ${iso(r32.fechaHora)} C${r32.canchaNumero} sinHorario=${r32.sinHorarioAsignado}`
  );
  assert(r32.horarioManual === true, `[post-reduccion] R32 manual perdió horarioManual (=${r32.horarioManual})`);

  const fases = await getFasesEliminatorias(esc.org.id, esc.cat.id);
  const r32Fase = fases.flatMap((f) => f.partidos).find((p) => p.id === r32.id);
  const codigos = (r32Fase.advertencias || []).map((a) => a.codigo);
  assert(
    codigos.includes('INICIA_ANTES_FIN_ZONAS'),
    `[post-reduccion] getFasesEliminatorias no devolvió INICIA_ANTES_FIN_ZONAS para el R32 manual con parejas (advertencias: ${JSON.stringify(codigos)})`
  );
}

/**
 * (f) R32 manual en cancha INACTIVA: se reubica en cancha activa y horarioManual sigue true.
 */
async function testF_r32ManualCanchaInactivaSeReubica() {
  const esc = await crearEscenario('test-f', {
    zonas: ZONAS_12,
    r32: [{ pos: 1, fechaHora: sab(20, 45), cancha: 3, manual: true }],
  });

  await reducir(esc);
  const partidos = await cargarPartidos(esc);
  verificarSinSolapamientos(partidos, 'post-reduccion');

  const r32 = partidos.find((p) => p.id === esc.r32[0].id);
  assert(conHorario(r32), `[post-reduccion] R32 manual quedó sin horario (sinHorarioAsignado=${r32.sinHorarioAsignado}, fechaHora=${iso(r32.fechaHora)})`);
  assert(
    r32.canchaNumero >= 1 && r32.canchaNumero <= CANCHAS_LLUVIA,
    `[post-reduccion] R32 manual sigue en cancha inactiva ${r32.canchaNumero}`
  );
  assert(r32.horarioManual === true, `[post-reduccion] R32 manual perdió horarioManual (=${r32.horarioManual})`);
}

/**
 * (g) Ciclo reducción → restauración: sin solapamientos, ningún R32 automático antes del fin de
 * zonas, y los R32 que quedaron sin horario en la reducción se recuperan si entran.
 * No se exige que vuelvan a su horario original.
 */
async function testG_cicloReduccionRestauracion() {
  const esc = await crearEscenario('test-g', {
    zonas: ZONAS_16,
    r32: [
      { pos: 1, fechaHora: sab(20, 45), cancha: 1 },
      { pos: 2, fechaHora: sab(20, 45), cancha: 3 },
    ],
  });

  await reducir(esc);
  const postReduccion = await cargarPartidos(esc);
  verificarSinSolapamientos(postReduccion, 'post-reduccion');
  assertR32NoAntesDeFinZonas(postReduccion, 'post-reduccion');
  assertR32NoAntesDeSabNoche(postReduccion, 'post-reduccion');

  const r32SinHorario = postReduccion.filter((p) => p.faseEliminatoria?.ronda === 32 && !p.esBye && !conHorario(p));
  assert(
    r32SinHorario.length > 0,
    '[post-reduccion] Precondición: algún R32 automático debía quedar sin horario (con 1 cancha no entra antes de las 06:00)'
  );

  await restaurar(esc);
  const postRestauracion = await cargarPartidos(esc);
  verificarSinSolapamientos(postRestauracion, 'post-restauracion');
  assertR32NoAntesDeFinZonas(postRestauracion, 'post-restauracion');
  assertR32NoAntesDeSabNoche(postRestauracion, 'post-restauracion');

  const { sinHorario } = finDeZonas(postRestauracion);
  assert(sinHorario.length === 0, `[post-restauracion] Precondición: con 4 canchas todas las zonas debían entrar; quedaron ${sinHorario.length} sin horario`);

  for (const r of r32SinHorario) {
    const p = postRestauracion.find((x) => x.id === r.id);
    assert(
      conHorario(p),
      `[post-restauracion] R32 ${r.id} (pos ${r.posicionEnRonda}) no se recuperó (sinHorarioAsignado=${p.sinHorarioAsignado}, fechaHora=${iso(p.fechaHora)})`
    );
  }
}

/**
 * (h) Octavos con un padre R32 sin horario (el otro padre es BYE): el octavo conserva su
 * horario del domingo y no genera advertencias de descanso.
 */
async function testH_octavosConPadreR32SinHorario() {
  const horaOctavo = sab(24 + 9, 0); // domingo 09:00
  const esc = await crearEscenario('test-h', {
    zonas: ZONAS_16,
    r32: [
      { pos: 1, fechaHora: sab(20, 45), cancha: 1 },
      { pos: 2, esBye: true },
    ],
    octavos: [{ pos: 1, fechaHora: horaOctavo, cancha: 1 }],
  });

  await reducir(esc);
  const partidos = await cargarPartidos(esc);
  verificarSinSolapamientos(partidos, 'post-reduccion');

  const padre = partidos.find((p) => p.id === esc.r32[0].id);
  assertSinHorario(padre, 'post-reduccion');

  const octavo = partidos.find((p) => p.id === esc.octavos[0].id);
  assert(
    octavo.fechaHora && new Date(octavo.fechaHora).getTime() === horaOctavo.getTime() && octavo.canchaNumero === 1 && !octavo.sinHorarioAsignado,
    `[post-reduccion] Octavo cambió: esperado ${iso(horaOctavo)} C1, recibido ${iso(octavo.fechaHora)} C${octavo.canchaNumero} sinHorario=${octavo.sinHorarioAsignado}`
  );

  const eliminatoriasMap = indexarPartidosEliminatoria(partidos.filter((p) => p.faseEliminatoriaId));
  const { padres, hijo } = resolverPadresEHijoEliminatoria({ partido: octavo, eliminatoriasMap });
  assert(padres.length === 2, `[post-reduccion] Se esperaban 2 padres R32 para el octavo, se resolvieron ${padres.length}`);
  const { advertencias } = calcularDescansosEliminatoria({
    partido: octavo,
    fechaHoraPropuesta: octavo.fechaHora,
    padres,
    hijo,
    finZonas: null,
  });
  const descanso = advertencias.filter((a) => a.codigo.startsWith('DESCANSO_'));
  assert(descanso.length === 0, `[post-reduccion] El octavo generó advertencias de descanso: ${JSON.stringify(descanso)}`);
}

/**
 * (i) R32 automático reubicado conserva su cancha original si sigue activa y está libre en el
 * horario elegido (evita cambios de cancha silenciosos). Reducción a 3 canchas y restauración a 4:
 * el R32 de las 22:00 en cancha 3 queda a las 22:00 en cancha 3 en ambas etapas.
 */
async function testI_r32ConservaCanchaOriginal() {
  const horaR32 = sab(22, 0);
  const esc = await crearEscenario('test-i', {
    zonas: ZONAS_12,
    r32: [{ pos: 1, fechaHora: horaR32, cancha: 3 }],
  });

  const verificar = async (etapa) => {
    const partidos = await cargarPartidos(esc);
    verificarSinSolapamientos(partidos, etapa);
    assertR32NoAntesDeFinZonas(partidos, etapa);
    const r32 = partidos.find((p) => p.id === esc.r32[0].id);
    assert(
      conHorario(r32) && new Date(r32.fechaHora).getTime() === horaR32.getTime() && r32.canchaNumero === 3,
      `[${etapa}] R32 debía quedar ${iso(horaR32)} C3; quedó ${iso(r32.fechaHora)} C${r32.canchaNumero} sinHorario=${r32.sinHorarioAsignado}`
    );
  };

  await organizadorService.reprogramarPorReduccionCanchas(esc.org.id, esc.torneo.id, 3, null, DIA_SABADO);
  await verificar('post-reduccion');
  await restaurar(esc);
  await verificar('post-restauracion');
}

/**
 * (j) Restauración: un R32 automático que la lluvia dejó después del cierre del club (sábado 24:00)
 * vuelve dentro de la ventana nocturna y del horario del club si entra. Al restaurar, su horario
 * actual no es piso: el piso es max(ventana nocturna, fin de zonas de su categoría).
 */
async function testJ_r32VuelveDentroDelHorarioAlRestaurar() {
  const esc = await crearEscenario('test-j', {
    zonas: ZONAS_12,
    r32: [{ pos: 1, fechaHora: sab(20, 45), cancha: 1 }],
  });
  const cierreMs = BASE_SABADO_MS + 24 * 60 * 60 * 1000; // sábado 24:00

  await reducir(esc);
  let partidos = await cargarPartidos(esc);
  let r32 = partidos.find((p) => p.id === esc.r32[0].id);
  assert(
    conHorario(r32) && new Date(r32.fechaHora).getTime() + DURACION_MS > cierreMs,
    `[post-reduccion] Precondición: el R32 debía quedar después del cierre del club (quedó ${iso(r32.fechaHora)}, sinHorario=${r32.sinHorarioAsignado})`
  );

  await restaurar(esc);
  partidos = await cargarPartidos(esc);
  verificarSinSolapamientos(partidos, 'post-restauracion');
  assertR32NoAntesDeFinZonas(partidos, 'post-restauracion');
  assertR32NoAntesDeSabNoche(partidos, 'post-restauracion');

  r32 = partidos.find((p) => p.id === esc.r32[0].id);
  assert(conHorario(r32), `[post-restauracion] R32 quedó sin horario (fechaHora=${iso(r32.fechaHora)})`);
  const finMs = new Date(r32.fechaHora).getTime() + DURACION_MS;
  assert(
    finMs <= cierreMs,
    `[post-restauracion] R32 debía volver dentro del horario del club (cierre ${iso(cierreMs)}); inicia ${iso(r32.fechaHora)} y termina ${iso(finMs)}`
  );
}

const TESTS = [
  ['a', 'R32 automático en cancha activa, zonas entran', testA_r32AutoCanchaActivaZonasEntran],
  ['b', 'R32 automático en cancha inactiva, zonas entran', testB_r32AutoCanchaInactivaZonasEntran],
  ['c', 'Zonas no entran: R32 automáticos sin horario y en partidosSinSlot', testC_zonasNoEntranR32SinHorario],
  ['c2', 'Pendiente de emergencia previo no dispara la Regla B', testC2_pendienteEmergenciaNoDisparaReglaB],
  ['c3', 'Zona desasignada en esta corrida dispara la Regla B con lugar libre', testC3_zonaDesasignadaEnCorridaDisparaReglaB],
  ['c4', 'Dos corridas el mismo día y restauración', testC4_dosCorridasYRestauracion],
  ['d', 'R32 automático no entra antes de dayLimitMs', testD_r32NoEntraAntesDeDayLimit],
  ['e', 'R32 manual en cancha activa no se mueve y avisa', testE_r32ManualCanchaActivaNoSeMueve],
  ['e2', 'R32 manual con parejas en cancha activa no se mueve y avisa', testE2_r32ManualConParejasCanchaActivaNoSeMueve],
  ['f', 'R32 manual en cancha inactiva se reubica', testF_r32ManualCanchaInactivaSeReubica],
  ['g', 'Ciclo reducción → restauración', testG_cicloReduccionRestauracion],
  ['h', 'Octavo con padre R32 sin horario', testH_octavosConPadreR32SinHorario],
  ['i', 'R32 automático reubicado conserva su cancha original si está libre', testI_r32ConservaCanchaOriginal],
  ['j', 'Al restaurar, el R32 fuera de horario vuelve dentro del horario del club', testJ_r32VuelveDentroDelHorarioAlRestaurar],
];

async function run() {
  await ensureTestDb();
  resetTestDb();
  await canchasOverridesService.loadFromDb();

  console.log('='.repeat(80));
  console.log('🧪 SUITE: R32 AUTOMÁTICOS VS FIN DE ZONAS EN LLUVIA DE SÁBADO');
  console.log('='.repeat(80));

  const resultados = [];
  for (const [id, nombre, fn] of TESTS) {
    try {
      await limpiarDb();
      await fn();
      resultados.push({ test: id, nombre, estado: 'PASS', detalle: '' });
      console.log(`✅ (${id}) PASS: ${nombre}`);
    } catch (err) {
      resultados.push({ test: id, nombre, estado: 'FAIL', detalle: err.message });
      console.log(`❌ (${id}) FAIL: ${nombre}\n   ${err.message}`);
    }
  }

  await limpiarDb();
  await prisma.$disconnect();

  const fallidos = resultados.filter((r) => r.estado === 'FAIL');
  console.log('\n' + '-'.repeat(80));
  console.log(`Resultado: ${resultados.length - fallidos.length}/${resultados.length} PASS, ${fallidos.length} FAIL`);
  return fallidos.length === 0;
}

if (require.main === module) {
  run()
    .then((ok) => process.exit(ok ? 0 : 1))
    .catch((e) => {
      console.error('Error fatal en test-r32-lluvia-fin-zonas.js:', e);
      process.exit(1);
    });
}

module.exports = { run };
