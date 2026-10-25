'use strict';

/**
 * test-horario-club-cierre.js
 *
 * Decisión de producto: en Modo Lluvia los partidos pueden quedar agendados después del cierre
 * configurado del club (para que ningún partido quede sin jugar). Esos partidos se marcan, derivando
 * en lectura cuántos minutos terminan después del cierre (helper horarioClub.js), y la marca se expone
 * solo en getEstadoEnVivo (admin), nunca en la vista pública.
 *
 * Bloque A: helper + marca en getEstadoEnVivo + vista pública sin la marca.
 *
 * Cada test es independiente: los módulos nuevos se cargan dentro de cada test para que su ausencia
 * haga fallar solo ese test.
 */

require('./utils/testEnvGuard');
const { ensureTestDb } = require('./utils/testEnvGuard');
const { resetTestDb } = require('./reset-test-db');
const prisma = require('../src/lib/prisma');
const organizadorService = require('../src/services/organizador.service');
const zonaService = require('../src/services/zona.service');
const canchasOverridesService = require('../src/services/canchasOverrides.service');
const { calcularVentanaSabadoNoche } = require('../src/utils/ventanaSabadoNoche');
const { parseFechaLocal } = require('../src/utils/dateUtils');
const { DURACION_PARTIDO_MIN } = require('../src/services/slots.service');
const { startTestServer } = require('./utils/testServer');

const DURACION_MS = DURACION_PARTIDO_MIN * 60 * 1000;
const FECHA_TORNEO = '2026-09-04';
const DIA_SABADO = '2026-09-05';
const BASE_VIERNES_MS = zonaService.proximaFechaPorDia('Viernes', parseFechaLocal(FECHA_TORNEO)).getTime();
const BASE_SABADO_MS = zonaService.proximaFechaPorDia('Sabado', parseFechaLocal(FECHA_TORNEO)).getTime();

/** Hora del viernes (hh >= 24 es trasnoche del sábado). */
function vie(hh, mm = 0) {
  return new Date(BASE_VIERNES_MS + (hh * 60 + mm) * 60 * 1000);
}

/** Hora del sábado (hh >= 24 es trasnoche del domingo). */
function sab(hh, mm = 0) {
  return new Date(BASE_SABADO_MS + (hh * 60 + mm) * 60 * 1000);
}

function iso(d) {
  return d ? new Date(d).toISOString() : 'null';
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function cargarHelper() {
  return require('../src/utils/horarioClub');
}

const CLUB_BASE = {
  viernesInicio: '18:00',
  viernesFin: '23:30',
  sabadoInicio: '09:00',
  sabadoFin: '24:00',
  domingoInicio: '09:00',
  domingoFin: '22:00',
};

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
 * Torneo EN_CURSO con zonas round robin de 3 parejas. Cada zona: [[fechaHora, cancha] x3].
 */
async function crearEscenario(nombre, { club, canchas, zonas }) {
  const org = await prisma.organizador.create({
    data: {
      nombre: `Club ${nombre}`,
      email: `${nombre}@horario-club.test`,
      passwordHash: 'hash',
      cantidadCanchas: canchas,
      ...club,
    },
  });
  const torneo = await prisma.torneo.create({
    data: {
      nombre: `Torneo ${nombre}`,
      slug: `horario-club-${nombre}`,
      fecha: parseFechaLocal(FECHA_TORNEO),
      estado: 'EN_CURSO',
      organizadorId: org.id,
    },
  });
  const cat = await prisma.categoria.create({
    data: { torneoId: torneo.id, nombre: '6ta', estado: 'EN_CURSO' },
  });

  let orden = 1;
  for (let zi = 0; zi < zonas.length; zi++) {
    const zona = await prisma.zona.create({
      data: { categoriaId: cat.id, nombre: `Zona ${'ABCDEFGHIJ'[zi]}`, clasifican: 2, formato: 'ROUND_ROBIN' },
    });
    const parejas = [];
    for (let i = 0; i < 3; i++) {
      parejas.push(
        await prisma.pareja.create({
          data: { categoriaId: cat.id, jugador1: `Z${zi}P${i}a`, jugador2: `Z${zi}P${i}b`, orden: orden++ },
        })
      );
    }
    const cruces = [[0, 1], [0, 2], [1, 2]];
    for (let mi = 0; mi < 3; mi++) {
      const [fechaHora, cancha] = zonas[zi][mi];
      await prisma.partido.create({
        data: {
          categoriaId: cat.id,
          zonaId: zona.id,
          posicionEnRonda: mi + 1,
          pareja1Id: parejas[cruces[mi][0]].id,
          pareja2Id: parejas[cruces[mi][1]].id,
          fechaHora,
          canchaNumero: cancha,
          sinHorarioAsignado: false,
        },
      });
    }
  }
  return { org, torneo, cat };
}

// 15 partidos de sábado (5 zonas de 3) desde las 09:00. Con 1 cancha van en fila de 09:00 a 02:30 (fin 03:45).
function zonasSabado15() {
  const t = (k) => new Date(BASE_SABADO_MS + (9 * 60 + 75 * k) * 60 * 1000);
  const zonas = [];
  for (let c = 1; c <= 4; c++) zonas.push([[t(0), c], [t(1), c], [t(2), c]]);
  zonas.push([[t(3), 1], [t(4), 1], [t(5), 1]]);
  return zonas;
}

/**
 * (A1) Helper, sábado con cierre de trasnoche (02:00): un partido que termina justo al cierre
 * marca 0; uno que termina 15 min después marca 15.
 */
async function testA1_helperSabadoTrasnoche() {
  const { minutosDespuesDelCierre } = cargarHelper();
  const club = { ...CLUB_BASE, sabadoFin: '02:00' };
  const justo = minutosDespuesDelCierre(sab(24, 45), club); // 00:45 → termina 02:00
  const pasado = minutosDespuesDelCierre(sab(25, 0), club); // 01:00 → termina 02:15
  assert(justo === 0, `Partido que termina justo al cierre debía marcar 0, marcó ${justo}`);
  assert(pasado === 15, `Partido que termina 02:15 con cierre 02:00 debía marcar 15, marcó ${pasado}`);
}

/**
 * (A2) Helper, viernes lógico jugado en la madrugada del sábado: se mide contra viernesFin.
 * Viernes cierra 23:30; partido del sábado a las 03:00 (antes de la apertura del sábado) termina 04:15 → 285.
 */
async function testA2_helperViernesLogico() {
  const { minutosDespuesDelCierre } = cargarHelper();
  const m = minutosDespuesDelCierre(vie(27, 0), CLUB_BASE);
  assert(m === 285, `Partido de viernes lógico 03:00 (fin 04:15) con cierre 23:30 debía marcar 285, marcó ${m}`);
}

/**
 * (A3) Ejemplo del ticket: club que cierra a las 24:00, partido de las 04:15 (fin 05:30) → 330.
 */
async function testA3_helperEjemploTicket() {
  const { minutosDespuesDelCierre } = cargarHelper();
  const m = minutosDespuesDelCierre(sab(28, 15), CLUB_BASE);
  assert(m === 330, `Partido 04:15 (fin 05:30) con cierre 24:00 debía marcar 330, marcó ${m}`);
}

/**
 * (A4) Casos sin marca: partido sin horario, partido de domingo y club sin cierre configurado.
 */
async function testA4_helperSinMarca() {
  const { minutosDespuesDelCierre } = cargarHelper();
  assert(minutosDespuesDelCierre(null, CLUB_BASE) === 0, 'Partido sin horario debía marcar 0');
  assert(minutosDespuesDelCierre(sab(24 + 21, 30), CLUB_BASE) === 0, 'Partido de domingo debía marcar 0 (fuera de alcance)');
  const sinCierre = { ...CLUB_BASE, sabadoFin: null };
  assert(minutosDespuesDelCierre(sab(23, 30), sinCierre) === 0, 'Club sin sabadoFin debía marcar 0');
}

/**
 * (A5) Coherencia con la ventana nocturna de R32: un partido que termina justo en sabNightEndMs
 * marca 0 y uno que termina 15 min después marca 15 (misma fuente de cierre).
 */
async function testA5_coherenciaVentanaSabadoNoche() {
  const { minutosDespuesDelCierre } = cargarHelper();
  const clubes = [
    { ...CLUB_BASE, sabadoFin: '24:00' },
    { ...CLUB_BASE, sabadoFin: '23:00' },
    { ...CLUB_BASE, sabadoInicio: '08:00', sabadoFin: '02:30' },
  ];
  for (const club of clubes) {
    const { sabNightEndMs } = calcularVentanaSabadoNoche(club, BASE_SABADO_MS);
    const justo = minutosDespuesDelCierre(new Date(sabNightEndMs - DURACION_MS), club);
    const pasado = minutosDespuesDelCierre(new Date(sabNightEndMs - DURACION_MS + 15 * 60 * 1000), club);
    assert(
      justo === 0 && pasado === 15,
      `Club sábado ${club.sabadoInicio}-${club.sabadoFin}: fin en sabNightEndMs marcó ${justo} (esperado 0), 15 min después marcó ${pasado} (esperado 15)`
    );
  }
}

/**
 * (A6) Integración: club que cierra el sábado a las 24:00, reducción a 1 cancha. Las zonas quedan
 * agendadas en fila hasta la trasnoche y getEstadoEnVivo marca exactamente los minutos después del cierre.
 */
async function testA6_marcaEnEstadoEnVivo() {
  const esc = await crearEscenario('test-a6', { club: CLUB_BASE, canchas: 4, zonas: zonasSabado15() });
  await organizadorService.reprogramarPorReduccionCanchas(esc.org.id, esc.torneo.id, 1, null, DIA_SABADO);

  const partidos = await prisma.partido.findMany({ where: { categoriaId: esc.cat.id } });
  const sinHorario = partidos.filter((p) => !p.fechaHora || p.sinHorarioAsignado);
  assert(sinHorario.length === 0, `Precondición: todas las zonas debían entrar; quedaron ${sinHorario.length} sin horario`);

  const estado = await organizadorService.getEstadoEnVivo(esc.org.id, esc.torneo.id);
  const vistos = [
    ...(estado.proximosPartidos || []),
    ...(estado.partidosEnCurso || []),
    ...(estado.partidosEnCanchaFantasma || []),
  ];
  const cierreMs = sab(24, 0).getTime();
  let marcados = 0;
  for (const p of partidos) {
    const v = vistos.find((x) => x.id === p.id);
    assert(v, `Partido ${p.id} no aparece en getEstadoEnVivo`);
    const finMs = new Date(p.fechaHora).getTime() + DURACION_MS;
    const esperado = finMs > cierreMs ? Math.ceil((finMs - cierreMs) / 60000) : 0;
    assert(
      v.minutosDespuesDelCierre === esperado,
      `Partido ${iso(p.fechaHora)}: esperado minutosDespuesDelCierre=${esperado}, recibido ${v.minutosDespuesDelCierre}`
    );
    if (esperado > 0) marcados++;
  }
  assert(marcados > 0 && marcados < partidos.length, `Precondición: debían quedar partidos antes y después del cierre (marcados ${marcados}/${partidos.length})`);
}

/**
 * (A7) Vista pública: GET /api/public/:slug no incluye la marca (guarda; nunca se expone al público).
 */
async function testA7_vistaPublicaSinMarca() {
  const esc = await crearEscenario('test-a7', { club: CLUB_BASE, canchas: 4, zonas: zonasSabado15() });
  await organizadorService.reprogramarPorReduccionCanchas(esc.org.id, esc.torneo.id, 1, null, DIA_SABADO);

  const { server, baseUrl } = await startTestServer();
  try {
    const res = await fetch(`${baseUrl}/public/${esc.torneo.slug}`);
    assert(res.status === 200, `GET /public/${esc.torneo.slug} respondió ${res.status}`);
    const texto = await res.text();
    assert(texto.length > 0, 'La vista pública respondió vacía');
    assert(!texto.includes('minutosDespuesDelCierre'), 'La vista pública expone minutosDespuesDelCierre');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// ============================================================================
// Bloque B: tope de la jornada de lluvia del viernes = min(06:00, apertura del sábado)
// ============================================================================

function cargarDateUtils() {
  return require('../src/utils/dateUtils');
}

/**
 * (B1) dayLimitMs del viernes lógico con apertura del sábado a las 10:00: el tope es el sábado 06:00
 * (antes era la apertura del sábado, 10:00).
 */
async function testB1_topeViernesSeisAm() {
  const { getDiaCalendarioConTrasnoche } = cargarDateUtils();
  const club = { ...CLUB_BASE, sabadoInicio: '10:00' };
  const info = getDiaCalendarioConTrasnoche(vie(20, 0), club);
  assert(
    info.dayLimitMs === vie(24 + 6, 0).getTime(),
    `dayLimitMs del viernes debía ser sábado 06:00 (${iso(vie(30, 0))}), fue ${iso(info.dayLimitMs)}`
  );
}

/**
 * (B2) Si el sábado abre antes de las 06:00 (04:15), el viernes termina a la apertura del sábado
 * para no invadir el día lógico del sábado.
 */
async function testB2_topeViernesAperturaTemprana() {
  const { getDiaCalendarioConTrasnoche } = cargarDateUtils();
  const club = { ...CLUB_BASE, sabadoInicio: '04:15' };
  const info = getDiaCalendarioConTrasnoche(vie(22, 0), club);
  assert(
    info.dayLimitMs === vie(24 + 4, 15).getTime(),
    `dayLimitMs del viernes con apertura del sábado 04:15 debía ser sábado 04:15, fue ${iso(info.dayLimitMs)}`
  );
}

/**
 * (B3) El sábado sigue terminando el domingo 06:00 y la constante compartida existe con ese valor.
 */
async function testB3_sabadoYConstante() {
  const dateUtils = cargarDateUtils();
  const info = dateUtils.getDiaCalendarioConTrasnoche(sab(20, 0), CLUB_BASE);
  assert(info.dayLimitMs === sab(24 + 6, 0).getTime(), `dayLimitMs del sábado debía ser domingo 06:00, fue ${iso(info.dayLimitMs)}`);
  assert(
    dateUtils.HORA_FIN_JORNADA_LLUVIA_MIN === 6 * 60,
    `HORA_FIN_JORNADA_LLUVIA_MIN debía exportarse con valor 360, es ${dateUtils.HORA_FIN_JORNADA_LLUVIA_MIN}`
  );
}

/**
 * (B4) Integración: lluvia el viernes (cierre 23:30, el sábado abre 10:00), 12 partidos y 1 cancha.
 * Entran 9 (18:00 a 04:00, fin 05:15); los otros 3 quedan sin horario, en partidosSinSlot y en la
 * bandeja de pendientes. Ninguno se mueve a otro día ni termina después del sábado 06:00.
 */
async function testB4_viernesNoPasaDeLasSeis() {
  const club = { ...CLUB_BASE, sabadoInicio: '10:00' };
  const t = (k) => vie(18, 75 * k);
  const zonas = [];
  for (let c = 1; c <= 4; c++) zonas.push([[t(0), c], [t(1), c], [t(2), c]]);
  const esc = await crearEscenario('test-b4', { club, canchas: 4, zonas });

  await organizadorService.reprogramarPorReduccionCanchas(esc.org.id, esc.torneo.id, 1, null, '2026-09-04');

  const partidos = await prisma.partido.findMany({ where: { categoriaId: esc.cat.id } });
  const limiteMs = vie(30, 0).getTime();
  const agendados = partidos.filter((p) => p.fechaHora && !p.sinHorarioAsignado);
  const sinHorario = partidos.filter((p) => !p.fechaHora || p.sinHorarioAsignado);
  for (const p of agendados) {
    const finMs = new Date(p.fechaHora).getTime() + DURACION_MS;
    assert(finMs <= limiteMs, `Partido del viernes termina ${iso(finMs)}, después del sábado 06:00`);
    assert(new Date(p.fechaHora).getTime() >= vie(18, 0).getTime(), `Partido movido antes del viernes 18:00: ${iso(p.fechaHora)}`);
  }
  assert(
    agendados.length === 9 && sinHorario.length === 3,
    `Esperados 9 agendados y 3 sin horario; quedaron ${agendados.length} y ${sinHorario.length}`
  );

  const ov = await prisma.overrideCanchasDia.findUnique({
    where: { torneoId_diaKey: { torneoId: esc.torneo.id, diaKey: '2026-09-04' } },
  });
  const mapa = typeof ov?.partidosSinSlot === 'string' ? JSON.parse(ov.partidosSinSlot) : ov?.partidosSinSlot || {};
  const bandeja = await organizadorService.getPartidosSinHorarioTorneo(esc.org.id, esc.torneo.id);
  const idsBandeja = new Set(bandeja.map((p) => p.id));
  for (const p of sinHorario) {
    assert(Object.prototype.hasOwnProperty.call(mapa, p.id), `Partido sin horario ${p.id} no figura en partidosSinSlot`);
    assert(idsBandeja.has(p.id), `Partido sin horario ${p.id} no aparece en la bandeja de pendientes`);
  }
}

const TESTS = [
  ['A1', 'Helper: sábado con cierre de trasnoche', testA1_helperSabadoTrasnoche],
  ['A2', 'Helper: viernes lógico en la madrugada del sábado', testA2_helperViernesLogico],
  ['A3', 'Helper: ejemplo del ticket (cierre 24:00, partido 04:15)', testA3_helperEjemploTicket],
  ['A4', 'Helper: sin horario, domingo y club sin cierre marcan 0', testA4_helperSinMarca],
  ['A5', 'Helper coherente con la ventana nocturna de R32', testA5_coherenciaVentanaSabadoNoche],
  ['A6', 'getEstadoEnVivo marca los minutos después del cierre', testA6_marcaEnEstadoEnVivo],
  ['A7', 'La vista pública no expone la marca', testA7_vistaPublicaSinMarca],
  ['B1', 'Tope del viernes de lluvia en el sábado 06:00', testB1_topeViernesSeisAm],
  ['B2', 'Tope del viernes en la apertura del sábado si es anterior a las 06:00', testB2_topeViernesAperturaTemprana],
  ['B3', 'Sábado hasta el domingo 06:00 y constante compartida', testB3_sabadoYConstante],
  ['B4', 'Lluvia del viernes: lo que no entra antes de las 06:00 va a la bandeja', testB4_viernesNoPasaDeLasSeis],
];

async function run() {
  await ensureTestDb();
  resetTestDb();
  await canchasOverridesService.loadFromDb();

  console.log('='.repeat(80));
  console.log('🧪 SUITE: PARTIDOS DESPUÉS DEL CIERRE DEL CLUB EN MODO LLUVIA');
  console.log('='.repeat(80));

  const resultados = [];
  for (const [id, nombre, fn] of TESTS) {
    try {
      await limpiarDb();
      await fn();
      resultados.push({ id, estado: 'PASS' });
      console.log(`✅ (${id}) PASS: ${nombre}`);
    } catch (err) {
      resultados.push({ id, estado: 'FAIL' });
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
      console.error('Error fatal en test-horario-club-cierre.js:', e);
      process.exit(1);
    });
}

module.exports = { run };
