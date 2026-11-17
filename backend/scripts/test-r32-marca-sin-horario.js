'use strict';

/**
 * test-r32-marca-sin-horario.js
 * Al terminar las zonas, generarEliminatoria se re-ejecuta sobre el cuadro existente
 * (verificarYAutoAsignarEliminatoria) y marcaba todos los R32 con sinHorarioAsignado: true aunque ya
 * estuvieran programados (faseEliminatoria.service.js, rama "poblar el bracket existente"). Ese estado
 * (marca en true y fechaHora no nula) hacía que la bandeja, en-vivo, el scheduler, la programación de zonas
 * y la lluvia del sábado los trataran como libres o sin horario. La regla: la marca solo se pone a los R32
 * que no tienen horario (sin fechaHora o sin canchaNumero).
 *
 * Escenario: club de 4 canchas; categoría de 36 parejas (12 zonas de 3, 24 clasificados, 8 R32 con rival);
 * torneo del viernes 16/10/2026. Mismos pasos que iniciarTorneoMultiCategoria después del plan
 * (iniciarCategoria, generarEliminatoria, horarios de zona y programarHorariosEliminatorias). Los resultados
 * de zona se cargan por PUT /api/partidos/:id/resultado, que dispara verificarYAutoAsignarEliminatoria.
 *
 * M1  Al terminar las zonas, los R32 programados conservan horario y cancha y quedan sin la marca; los BYE
 *     siguen como hoy (FINALIZADO, sin horario ni cancha, marca en false).
 * M2  Un R32 fijado a mano conserva horario, cancha, horarioManual y queda sin la marca; programar la
 *     categoría no lo mueve.
 * M3  Con las zonas de A terminadas, sincronizar el cuadro de B no solapa canchas con los R32 de A.
 * M4  En-vivo cuenta los R32 de A como próximos y la bandeja de pendientes no los muestra.
 * M5  Lluvia del sábado (2 canchas) con las zonas de A terminadas: contrato de la sesión 78. Cada R32
 *     automático queda reubicado en una cancha activa o sin horario y en partidosSinSlot; ninguno queda en
 *     una cancha cerrada sin figurar en partidosSinSlot ni como cancha fantasma. Al restaurar, vuelven a
 *     tener horario en las 4 canchas.
 * M6  Control: un R32 sin fechaHora al re-ejecutar generarEliminatoria sigue con la marca en true.
 * M6b Control: un R32 con fechaHora pero sin canchaNumero también queda marcado.
 */

require('./utils/testEnvGuard');
const { ensureTestDb } = require('./utils/testEnvGuard');
const { resetTestDb } = require('./reset-test-db');
const jwt = require('jsonwebtoken');
const prisma = require('../src/lib/prisma');
const { JWT_SECRET } = require('../src/config/env');
const { startTestServer } = require('./utils/testServer');
const canchasOverridesService = require('../src/services/canchasOverrides.service');
const organizadorService = require('../src/services/organizador.service');
const zonaService = require('../src/services/zona.service');
const partidoService = require('../src/services/partido.service');
const { generarEliminatoria } = require('../src/services/faseEliminatoria.service');
const { programarHorariosEliminatorias } = require('../src/services/eliminatoriaScheduler.service');
const { parseFechaLocal, getDiaCalendarioConTrasnoche } = require('../src/utils/dateUtils');

const VIE = '2026-10-16';
const SAB = '2026-10-17';
const DURACION_MS = 75 * 60 * 1000;
let BASE_URL = null;

function fecha(diaKey, hora) {
  const [y, m, d] = diaKey.split('-').map(Number);
  const [hh, mm] = hora.split(':').map(Number);
  const dt = new Date(y, m - 1, d, hh, mm, 0, 0);
  if (hh < 6) dt.setDate(dt.getDate() + 1);
  return dt;
}
const iso = (d) => (d ? new Date(d).toISOString() : null);

async function limpiarDb() {
  for (const m of ['setPartido', 'partido', 'faseEliminatoria', 'zonaPareja', 'zona', 'slotPareja', 'pareja', 'categoria', 'overrideCanchasDia', 'torneo', 'organizador']) {
    await prisma[m].deleteMany({});
  }
  await canchasOverridesService.loadFromDb();
}

async function setupTorneo() {
  await limpiarDb();
  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club Marca R32', email: `test_marca_r32_${Date.now()}_${Math.random()}@padel.test`, passwordHash: 'hash', cantidadCanchas: 4,
      viernesInicio: '18:00', viernesFin: '23:00', sabadoInicio: '09:00', sabadoFin: '24:00', domingoInicio: '09:00', domingoFin: '22:00',
    },
  });
  const torneo = await prisma.torneo.create({
    data: { organizadorId: org.id, nombre: 'Torneo Marca R32', slug: `torneo-marca-r32-${Date.now()}-${Math.floor(Math.random() * 10000)}`, fecha: parseFechaLocal(VIE), estado: 'BORRADOR' },
  });
  return { org, torneo, token: jwt.sign({ id: org.id, email: org.email }, JWT_SECRET, { expiresIn: '1h' }) };
}

/** 36 parejas, 12 zonas de 3, horarios de zona de viernes 18:00 a sábado 17:45 (4 zonas por turno). */
async function armarCategoria(ctx, nombre, desfaseCancha = 0) {
  const cat = await prisma.categoria.create({ data: { torneoId: ctx.torneo.id, nombre, estado: 'BORRADOR' } });
  for (let i = 1; i <= 36; i++) {
    await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: `${nombre}${i}a`, jugador2: `${nombre}${i}b`, orden: i } });
  }
  await zonaService.iniciarCategoria(ctx.org.id, cat.id);
  await prisma.torneo.update({ where: { id: ctx.torneo.id }, data: { estado: 'EN_CURSO' } });
  await generarEliminatoria(ctx.org.id, cat.id);
  const turnos = [
    fecha(VIE, '18:00'), fecha(VIE, '19:15'), fecha(VIE, '20:30'), fecha(VIE, '21:45'),
    fecha(SAB, '09:00'), fecha(SAB, '10:15'), fecha(SAB, '11:30'), fecha(SAB, '12:45'),
    fecha(SAB, '14:00'), fecha(SAB, '15:15'), fecha(SAB, '16:30'), fecha(SAB, '17:45'),
  ];
  const zonas = await prisma.zona.findMany({ where: { categoriaId: cat.id }, orderBy: { nombre: 'asc' } });
  const grupos = Math.ceil(zonas.length / 4);
  for (let z = 0; z < zonas.length; z++) {
    const ps = await prisma.partido.findMany({ where: { zonaId: zonas[z].id }, orderBy: { posicionEnRonda: 'asc' } });
    for (let k = 0; k < ps.length; k++) {
      await prisma.partido.update({
        where: { id: ps[k].id },
        data: { fechaHora: turnos[k * grupos + Math.floor(z / 4)], canchaNumero: ((z + desfaseCancha) % 4) + 1, sinHorarioAsignado: false },
      });
    }
  }
  return cat;
}

async function r32(cat) {
  return prisma.partido.findMany({
    where: { categoriaId: cat.id, faseEliminatoria: { ronda: { gte: 32 } } },
    orderBy: { posicionEnRonda: 'asc' },
  });
}
const conRival = (lista) => lista.filter((p) => !p.esBye);
const snap = (p) => `${iso(p.fechaHora)}@${p.canchaNumero}`;

/** Carga por HTTP todos los partidos de zona de la categoría; gana la pareja de menor orden. */
async function cargarZonas(ctx, cat) {
  for (let vuelta = 0; vuelta < 10; vuelta++) {
    const pend = await prisma.partido.findMany({
      where: { categoriaId: cat.id, zonaId: { not: null }, estado: { not: 'FINALIZADO' }, pareja1Id: { not: null }, pareja2Id: { not: null } },
      include: { pareja1: true, pareja2: true },
      orderBy: [{ fechaHora: 'asc' }, { canchaNumero: 'asc' }],
    });
    if (pend.length === 0) break;
    for (const p of pend) {
      const g1 = p.pareja1.orden < p.pareja2.orden;
      const sets = g1 ? [{ gamesPareja1: 6, gamesPareja2: 0 }, { gamesPareja1: 6, gamesPareja2: 0 }] : [{ gamesPareja1: 0, gamesPareja2: 6 }, { gamesPareja1: 0, gamesPareja2: 6 }];
      const res = await fetch(`${BASE_URL}/partidos/${p.id}/resultado`, {
        method: 'PUT', headers: { Authorization: `Bearer ${ctx.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sets }),
      });
      if (res.status !== 200) throw new Error(`PUT /partidos/${p.id}/resultado respondió ${res.status}`);
    }
  }
  const quedan = await prisma.partido.count({ where: { categoriaId: cat.id, zonaId: { not: null }, estado: { not: 'FINALIZADO' } } });
  if (quedan > 0) throw new Error(`Quedaron ${quedan} partidos de zona sin finalizar`);
}

/** Torneo con la categoría A iniciada y sus eliminatorias programadas como al iniciar el torneo. */
async function escenarioBase() {
  const ctx = await setupTorneo();
  const A = await armarCategoria(ctx, 'A');
  await programarHorariosEliminatorias(ctx.org.id, ctx.torneo.id);
  return { ctx, A };
}

function falla(problemas) {
  if (problemas.length > 0) throw new Error(problemas.join(' ; '));
}

// ---------------------------------------------------------------------------
async function m1_r32_programados_sin_marca() {
  const { ctx, A } = await escenarioBase();
  const antes = await r32(A);
  if (conRival(antes).some((p) => !p.fechaHora || !p.canchaNumero)) throw new Error('El escenario no programó todos los R32 con rival');
  await cargarZonas(ctx, A);
  const despues = await r32(A);
  const problemas = [];
  for (const p of despues) {
    const a = antes.find((x) => x.id === p.id);
    if (p.esBye) {
      if (p.estado !== 'FINALIZADO' || p.fechaHora !== null || p.canchaNumero !== null || p.sinHorarioAsignado !== false) {
        problemas.push(`BYE #${p.posicionEnRonda}: estado ${p.estado}, ${snap(p)}, marca ${p.sinHorarioAsignado}`);
      }
      continue;
    }
    if (snap(p) !== snap(a)) problemas.push(`R32 #${p.posicionEnRonda} cambió de ${snap(a)} a ${snap(p)}`);
    if (p.sinHorarioAsignado !== false) problemas.push(`R32 #${p.posicionEnRonda} quedó con sinHorarioAsignado ${p.sinHorarioAsignado} y fechaHora ${iso(p.fechaHora)}`);
    if (!p.pareja1Id || !p.pareja2Id) problemas.push(`R32 #${p.posicionEnRonda} sin las dos parejas`);
  }
  falla(problemas);
}

async function m2_r32_manual() {
  const { ctx, A } = await escenarioBase();
  const objetivo = conRival(await r32(A))[0];
  await partidoService.asignarHorarioManual(ctx.org.id, objetivo.id, { slotId: 'Sabado-23:15', canchaNumero: 1 });
  const fijado = await prisma.partido.findUnique({ where: { id: objetivo.id } });
  await cargarZonas(ctx, A);
  const problemas = [];
  const verificar = async (momento) => {
    const p = await prisma.partido.findUnique({ where: { id: objetivo.id } });
    if (snap(p) !== snap(fijado)) problemas.push(`${momento}: el R32 manual pasó de ${snap(fijado)} a ${snap(p)}`);
    if (p.horarioManual !== true) problemas.push(`${momento}: horarioManual ${p.horarioManual}`);
    if (p.sinHorarioAsignado !== false) problemas.push(`${momento}: sinHorarioAsignado ${p.sinHorarioAsignado}`);
  };
  await verificar('al terminar las zonas');
  await programarHorariosEliminatorias(ctx.org.id, ctx.torneo.id, A.id);
  await verificar('después de programar la categoría');
  falla(problemas);
}

async function sincronizarPorHttp(ctx, cat) {
  const res = await fetch(`${BASE_URL}/categorias/${cat.id}/sincronizar-cuadro`, {
    method: 'POST', headers: { Authorization: `Bearer ${ctx.token}`, 'Content-Type': 'application/json' }, body: '{}',
  });
  if (res.status !== 200) throw new Error(`POST sincronizar-cuadro respondió ${res.status}`);
}

function solapes(listaA, listaB) {
  const res = [];
  for (const a of listaA) for (const b of listaB) {
    if (!a.fechaHora || !b.fechaHora || a.canchaNumero !== b.canchaNumero) continue;
    const s1 = new Date(a.fechaHora).getTime();
    const s2 = new Date(b.fechaHora).getTime();
    if (Math.max(s1, s2) < Math.min(s1, s2) + DURACION_MS) res.push(`c${a.canchaNumero} ${iso(a.fechaHora)} (A#${a.posicionEnRonda} / B#${b.posicionEnRonda})`);
  }
  return res;
}

async function m3_otra_categoria_no_solapa() {
  const ctx = await setupTorneo();
  const A = await armarCategoria(ctx, 'A');
  const B = await armarCategoria(ctx, 'B', 2);
  await programarHorariosEliminatorias(ctx.org.id, ctx.torneo.id);
  await cargarZonas(ctx, A);
  await sincronizarPorHttp(ctx, B);
  const s = solapes(conRival(await r32(A)), conRival(await r32(B)));
  if (s.length > 0) throw new Error(`${s.length} solapes de cancha entre R32 de A y de B, p. ej. ${s.slice(0, 2).join(' | ')}`);
}

async function m4_en_vivo_y_bandeja() {
  const { ctx, A } = await escenarioBase();
  await cargarZonas(ctx, A);
  const ids = new Set(conRival(await r32(A)).map((p) => p.id));
  const estado = await organizadorService.getEstadoEnVivo(ctx.org.id, ctx.torneo.id);
  const bandeja = await organizadorService.getPartidosSinHorarioTorneo(ctx.org.id, ctx.torneo.id);
  const problemas = [];
  const proximos = estado.proximosPartidos.filter((p) => ids.has(p.id)).length;
  if (proximos !== ids.size) problemas.push(`en-vivo: ${proximos} de ${ids.size} R32 en proximosPartidos`);
  if (estado.resumenEstado.pendientesSinHorario !== 0) problemas.push(`en-vivo: pendientesSinHorario ${estado.resumenEstado.pendientesSinHorario}`);
  const enBandeja = bandeja.filter((p) => ids.has(p.id)).length;
  if (enBandeja !== 0) problemas.push(`bandeja: ${enBandeja} R32 de A`);
  falla(problemas);
}

/**
 * Contrato de la sesión 78 (CONTEXT.md, "R32 automáticos fuera de la ocupación antes de compactar"):
 * los R32 automáticos de la jornada afectada salen de la ocupación y se reubican en el tier 2, después del
 * fin de zonas de su categoría; si no hay turno, un R32 automático nunca conserva su horario viejo: queda
 * sin horario y en partidosSinSlot (zona.service.js, desasignarR32Automatico).
 */
async function m5_lluvia_sabado() {
  const { ctx, A } = await escenarioBase();
  await cargarZonas(ctx, A);
  await organizadorService.reprogramarPorReduccionCanchas(ctx.org.id, ctx.torneo.id, 2, null, SAB);
  const problemas = [];
  const sinSlot = canchasOverridesService.getCanchasDia(ctx.torneo.id, SAB, 4).partidosSinSlot || {};
  const estado = await organizadorService.getEstadoEnVivo(ctx.org.id, ctx.torneo.id);
  const fantasmas = new Set(estado.partidosEnCanchaFantasma.map((p) => p.id));
  for (const p of conRival(await r32(A))) {
    const reubicado = p.fechaHora && p.canchaNumero && p.canchaNumero <= 2 && p.sinHorarioAsignado === false
      && getDiaCalendarioConTrasnoche(p.fechaHora, ctx.org)?.key === SAB;
    const sinHorarioEnMapa = p.fechaHora === null && p.sinHorarioAsignado === true && Object.prototype.hasOwnProperty.call(sinSlot, p.id);
    if (!reubicado && !sinHorarioEnMapa) {
      problemas.push(`lluvia: R32 #${p.posicionEnRonda} en ${snap(p)} marca ${p.sinHorarioAsignado} (en partidosSinSlot: ${Object.prototype.hasOwnProperty.call(sinSlot, p.id)}, fantasma: ${fantasmas.has(p.id)})`);
    }
  }
  await organizadorService.reprogramarPorReduccionCanchas(ctx.org.id, ctx.torneo.id, null, null, SAB);
  for (const p of conRival(await r32(A))) {
    const ok = p.fechaHora && p.canchaNumero && p.canchaNumero <= 4 && p.sinHorarioAsignado === false
      && getDiaCalendarioConTrasnoche(p.fechaHora, ctx.org)?.key === SAB;
    if (!ok) problemas.push(`restauración: R32 #${p.posicionEnRonda} en ${snap(p)} marca ${p.sinHorarioAsignado}`);
  }
  falla(problemas);
}

async function m6_control_sin_fecha() {
  const { ctx, A } = await escenarioBase();
  const objetivo = conRival(await r32(A))[0];
  // Servicio interno sin ruta HTTP: updateFechaHora con null limpia el horario.
  await partidoService.updateFechaHora(ctx.org.id, objetivo.id, null);
  await cargarZonas(ctx, A);
  const p = await prisma.partido.findUnique({ where: { id: objetivo.id } });
  if (p.fechaHora !== null || p.sinHorarioAsignado !== true) throw new Error(`R32 sin horario quedó en ${snap(p)} con marca ${p.sinHorarioAsignado}`);
}

async function m6b_control_sin_cancha() {
  const { ctx, A } = await escenarioBase();
  const objetivo = conRival(await r32(A))[0];
  // Estado armado a mano: horario sin cancha
  await prisma.partido.update({ where: { id: objetivo.id }, data: { canchaNumero: null } });
  await cargarZonas(ctx, A);
  const p = await prisma.partido.findUnique({ where: { id: objetivo.id } });
  if (p.sinHorarioAsignado !== true) throw new Error(`R32 sin cancha quedó con marca ${p.sinHorarioAsignado} en ${snap(p)}`);
}

async function run() {
  await ensureTestDb();
  resetTestDb();
  const { server, baseUrl } = await startTestServer();
  BASE_URL = baseUrl;

  console.log('='.repeat(85));
  console.log('🧪 SUITE: MARCA SIN HORARIO EN R32 AL TERMINAR LAS ZONAS');
  console.log('='.repeat(85));

  const allTests = [
    { nombre: 'M1: fin de zonas, R32 programados conservan horario y sin marca', fn: m1_r32_programados_sin_marca },
    { nombre: 'M2: R32 manual conserva horario, manual y sin marca; programar no lo mueve', fn: m2_r32_manual },
    { nombre: 'M3: sincronizar B no solapa canchas con los R32 de A', fn: m3_otra_categoria_no_solapa },
    { nombre: 'M4: en-vivo los cuenta como próximos y la bandeja no los muestra', fn: m4_en_vivo_y_bandeja },
    { nombre: 'M5: lluvia del sábado y restauración según el contrato de la sesión 78', fn: m5_lluvia_sabado },
    { nombre: 'M6: control, R32 sin fechaHora sigue marcado', fn: m6_control_sin_fecha },
    { nombre: 'M6b: control, R32 sin canchaNumero queda marcado', fn: m6b_control_sin_cancha },
  ];

  const resultados = [];
  const fallas = [];
  for (const t of allTests) {
    try {
      await t.fn();
      resultados.push({ caso: t.nombre, estado: 'PASS' });
    } catch (err) {
      resultados.push({ caso: t.nombre, estado: 'FAIL' });
      fallas.push({ caso: t.nombre, error: err });
    }
  }

  await limpiarDb();
  await new Promise((resolve) => server.close(resolve));
  await prisma.$disconnect();

  console.log('\n' + '='.repeat(85));
  console.table(resultados);
  if (fallas.length > 0) {
    console.log(`\n❌ ${fallas.length}/${allTests.length} casos fallaron.`);
    for (const f of fallas) console.error(`🔴 [${f.caso}]\n   ${f.error.message}`);
    return false;
  }
  console.log(`\n✅ ${allTests.length}/${allTests.length} casos pasaron.`);
  return true;
}

if (require.main === module) {
  run()
    .then((ok) => process.exit(ok ? 0 : 1))
    .catch((e) => {
      console.error('Error fatal en test-r32-marca-sin-horario.js:', e);
      process.exit(1);
    });
}

module.exports = { run };
