'use strict';

/**
 * test-solape-finales-extension.js
 * La final del domingo puede programarse hasta domDayEndMs + 2 turnos (eliminatoriaScheduler.service.js,
 * maxEndAllowedMs). Los partidos ya agendados se clasificaban en sábado o domingo por la ventana
 * [domDayStartMs, domDayEndMs): una final en la extensión caía en la línea de tiempo del sábado y el domingo
 * la veía libre. Al programar una sola categoría (auto-asignación al terminar sus zonas) quedaban dos finales
 * en la misma cancha y a la misma hora. La regla: la ocupación ya agendada se clasifica por jornada lógica
 * (getDiaCalendarioConTrasnoche contra clavesJornadasTorneo).
 *
 * Torneo del viernes 16/10/2026. Las categorías chicas tienen 6 parejas (2 zonas de 3, semifinales y final).
 * Los "partidos de otras categorías" de S3 a S5 son partidos armados a mano (una categoría con su fase y un
 * solo partido, creados después de iniciar el torneo para que el scheduler no los reprograme): ocupan
 * exactamente el borde que se quiere probar.
 *
 * S1  Domingo 10:00-12:30, 4 canchas: terminar las zonas de A y después las de B (PUT /partidos/:id/resultado)
 *     no deja solapes y la final de A no cambia de horario ni de cancha.
 * S2  Igual con domingo 21:45-23:00: las finales quedan en la extensión pasada la medianoche (lunes 00:15).
 * S3  Control: un R32 ya agendado en la trasnoche del sábado (domingo 00:30) de otra categoría bloquea su
 *     cancha en el sábado: los R32 de B (POST /categorias/:id/sincronizar-cuadro) no lo pisan, y los cruces
 *     del domingo de B usan esa cancha.
 * S4  Lluvia del sábado a 1 cancha y finales de otras categorías en la extensión del domingo en las canchas 1 y
 *     2: al programar A, la de la cancha 2 (mayor a las del sábado) cuenta como ocupación del domingo.
 * S5  Control: una final de otra categoría que empieza justo en domDayEndMs se clasifica como domingo.
 * S6  Una final manual en la extensión es ocupación fija del domingo en la reprogramación por lluvia del
 *     domingo (todas las categorías en una corrida).
 */

require('./utils/testEnvGuard');
const { ensureTestDb } = require('./utils/testEnvGuard');
const { resetTestDb } = require('./reset-test-db');
const jwt = require('jsonwebtoken');
const prisma = require('../src/lib/prisma');
const { JWT_SECRET } = require('../src/config/env');
const { startTestServer } = require('./utils/testServer');
const canchasOverridesService = require('../src/services/canchasOverrides.service');
const zonaService = require('../src/services/zona.service');
const partidoService = require('../src/services/partido.service');
const { generarEliminatoria } = require('../src/services/faseEliminatoria.service');
const { programarHorariosEliminatorias } = require('../src/services/eliminatoriaScheduler.service');
const { parseFechaLocal } = require('../src/utils/dateUtils');

const VIE = '2026-10-16';
const SAB = '2026-10-17';
const DOM = '2026-10-18';
const D = 75 * 60 * 1000;
let BASE_URL = null;

function fecha(diaKey, hora) {
  const [y, m, d] = diaKey.split('-').map(Number);
  const [hh, mm] = hora.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}
const iso = (d) => (d ? new Date(d).toISOString() : null);

async function limpiarDb() {
  for (const m of ['setPartido', 'partido', 'faseEliminatoria', 'zonaPareja', 'zona', 'slotPareja', 'pareja', 'categoria', 'overrideCanchasDia', 'torneo', 'organizador']) {
    await prisma[m].deleteMany({});
  }
  await canchasOverridesService.loadFromDb();
}

async function setupTorneo({ canchas = 4, domInicio = '10:00', domFin = '12:30', sabFin = '24:00' } = {}) {
  await limpiarDb();
  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club Solape Finales', email: `test_solape_${Date.now()}_${Math.random()}@padel.test`, passwordHash: 'hash', cantidadCanchas: canchas,
      viernesInicio: '18:00', viernesFin: '23:00', sabadoInicio: '09:00', sabadoFin: sabFin, domingoInicio: domInicio, domingoFin: domFin,
    },
  });
  const torneo = await prisma.torneo.create({
    data: { organizadorId: org.id, nombre: 'Torneo Solape Finales', slug: `torneo-solape-${Date.now()}-${Math.floor(Math.random() * 10000)}`, fecha: parseFechaLocal(VIE), estado: 'BORRADOR' },
  });
  return { org, torneo, token: jwt.sign({ id: org.id, email: org.email }, JWT_SECRET, { expiresIn: '1h' }) };
}

/** Categoría con zonas y cuadro; turnos de zona: k-ésimo partido de la zona z en turnos[k * grupos + floor(z / canchas)]. */
async function armarCategoria(ctx, nombre, parejas, turnos, { canchas = 4, desfase = 0 } = {}) {
  const cat = await prisma.categoria.create({ data: { torneoId: ctx.torneo.id, nombre, estado: 'BORRADOR' } });
  for (let i = 1; i <= parejas; i++) {
    await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: `${nombre}${i}a`, jugador2: `${nombre}${i}b`, orden: i } });
  }
  await zonaService.iniciarCategoria(ctx.org.id, cat.id);
  await prisma.torneo.update({ where: { id: ctx.torneo.id }, data: { estado: 'EN_CURSO' } });
  await generarEliminatoria(ctx.org.id, cat.id);
  const zonas = await prisma.zona.findMany({ where: { categoriaId: cat.id }, orderBy: { nombre: 'asc' } });
  const grupos = Math.ceil(zonas.length / canchas);
  for (let z = 0; z < zonas.length; z++) {
    const ps = await prisma.partido.findMany({ where: { zonaId: zonas[z].id }, orderBy: { posicionEnRonda: 'asc' } });
    for (let k = 0; k < ps.length; k++) {
      await prisma.partido.update({
        where: { id: ps[k].id },
        data: { fechaHora: turnos[k * grupos + Math.floor(z / canchas)], canchaNumero: ((z + desfase) % canchas) + 1, sinHorarioAsignado: false },
      });
    }
  }
  return cat;
}

const TURNOS_CHICA = [fecha(VIE, '18:00'), fecha(VIE, '19:15'), fecha(SAB, '10:00')];

/** Partido de "otra categoría" armado a mano: una categoría con una sola fase y un solo partido. */
async function partidoFijo(ctx, nombre, ronda, fechaHora, canchaNumero) {
  const cat = await prisma.categoria.create({ data: { torneoId: ctx.torneo.id, nombre, estado: 'EN_CURSO' } });
  const fase = await prisma.faseEliminatoria.create({ data: { categoriaId: cat.id, nombre: `Fase ${ronda}`, ronda } });
  return prisma.partido.create({
    data: { categoriaId: cat.id, faseEliminatoriaId: fase.id, posicionEnRonda: 1, fechaHora, canchaNumero, sinHorarioAsignado: false, estado: 'PENDIENTE' },
  });
}

async function cargarZonas(ctx, cat) {
  for (let v = 0; v < 10; v++) {
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
}

async function postHttp(ctx, ruta, body) {
  const res = await fetch(`${BASE_URL}${ruta}`, {
    method: 'POST', headers: { Authorization: `Bearer ${ctx.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (res.status !== 200) throw new Error(`POST ${ruta} respondió ${res.status}: ${JSON.stringify(await res.json().catch(() => null))}`);
}

async function eliminatorias(ctx) {
  return prisma.partido.findMany({
    where: { categoria: { torneoId: ctx.torneo.id }, faseEliminatoriaId: { not: null }, esBye: false },
    include: { faseEliminatoria: true, categoria: true },
  });
}
async function finalDe(cat) {
  return prisma.partido.findFirst({ where: { categoriaId: cat.id, faseEliminatoria: { ronda: 2 } } });
}

/** Pares de cruces (no BYE, con horario) en la misma cancha que se pisan. */
function solapes(lista) {
  const ag = lista.filter((p) => p.fechaHora && p.canchaNumero && !p.sinHorarioAsignado);
  const res = [];
  for (let i = 0; i < ag.length; i++) for (let j = i + 1; j < ag.length; j++) {
    const a = ag[i], b = ag[j];
    if (a.canchaNumero !== b.canchaNumero) continue;
    const s1 = new Date(a.fechaHora).getTime(), s2 = new Date(b.fechaHora).getTime();
    if (Math.max(s1, s2) < Math.min(s1, s2) + D) {
      res.push(`c${a.canchaNumero} ${iso(a.fechaHora)}: ${a.categoria.nombre} ronda ${a.faseEliminatoria.ronda} y ${b.categoria.nombre} ronda ${b.faseEliminatoria.ronda}`);
    }
  }
  return res;
}

function falla(problemas) {
  if (problemas.length > 0) throw new Error(problemas.join(' ; '));
}

// ---------------------------------------------------------------------------
async function dosCategoriasEnCadena(opciones, horaFinalEsperada) {
  const ctx = await setupTorneo(opciones);
  const A = await armarCategoria(ctx, 'A', 6, TURNOS_CHICA);
  const B = await armarCategoria(ctx, 'B', 6, TURNOS_CHICA, { desfase: 2 });
  await programarHorariosEliminatorias(ctx.org.id, ctx.torneo.id);
  const problemas = [];
  const finalA0 = await finalDe(A);
  if (iso(finalA0.fechaHora) !== iso(horaFinalEsperada)) {
    throw new Error(`El escenario no dejó la final de A en la extensión: ${iso(finalA0.fechaHora)} (esperado ${iso(horaFinalEsperada)})`);
  }
  await cargarZonas(ctx, A);
  const finalA1 = await finalDe(A);
  await cargarZonas(ctx, B);
  const finalA2 = await finalDe(A);
  const s = solapes(await eliminatorias(ctx));
  if (s.length > 0) problemas.push(`${s.length} solapes: ${s.join(' | ')}`);
  if (`${iso(finalA2.fechaHora)}@${finalA2.canchaNumero}` !== `${iso(finalA1.fechaHora)}@${finalA1.canchaNumero}`) {
    problemas.push(`la final de A pasó de ${iso(finalA1.fechaHora)}@${finalA1.canchaNumero} a ${iso(finalA2.fechaHora)}@${finalA2.canchaNumero}`);
  }
  falla(problemas);
}

const s1_extension_mismo_dia = () => dosCategoriasEnCadena({ domInicio: '10:00', domFin: '12:30' }, fecha(DOM, '12:30'));
const s2_extension_pasada_medianoche = () => {
  const lunes0015 = fecha(DOM, '00:15');
  lunes0015.setDate(lunes0015.getDate() + 1);
  return dosCategoriasEnCadena({ domInicio: '21:45', domFin: '23:00' }, lunes0015);
};

async function s3_control_r32_trasnoche_sabado() {
  const ctx = await setupTorneo({ canchas: 4, domInicio: '09:00', domFin: '22:00', sabFin: '03:00' });
  const turnos = [
    fecha(VIE, '18:00'), fecha(VIE, '19:15'), fecha(VIE, '20:30'), fecha(VIE, '21:45'),
    fecha(SAB, '09:00'), fecha(SAB, '10:15'), fecha(SAB, '11:30'), fecha(SAB, '12:45'),
    fecha(SAB, '14:00'), fecha(SAB, '15:15'), fecha(SAB, '16:30'), fecha(SAB, '17:45'),
  ];
  const Bc = await armarCategoria(ctx, 'B', 36, turnos);
  // Un partido de zona de B el sábado a las 23:15 (cancha 4): el fin de zonas de B pasa a las 00:30 y sus R32
  // buscan turno desde la trasnoche del sábado.
  const zonaB = await prisma.partido.findFirst({ where: { categoriaId: Bc.id, zonaId: { not: null } }, orderBy: { id: 'asc' } });
  await prisma.partido.update({ where: { id: zonaB.id }, data: { fechaHora: fecha(SAB, '23:15'), canchaNumero: 4 } });
  const domingo0030 = fecha(DOM, '00:30');
  const r32Otro = await partidoFijo(ctx, 'Otra', 32, domingo0030, 1);
  await postHttp(ctx, `/categorias/${Bc.id}/sincronizar-cuadro`, {});
  const lista = await eliminatorias(ctx);
  const problemas = [];
  const s = solapes(lista);
  if (s.length > 0) problemas.push(`${s.length} solapes: ${s.join(' | ')}`);
  const r32B = lista.filter((p) => p.categoriaId === Bc.id && p.faseEliminatoria.ronda >= 32 && p.fechaHora);
  if (!r32B.some((p) => iso(p.fechaHora) === iso(domingo0030))) problemas.push('ningún R32 de B quedó en la trasnoche (el escenario no compite por la cancha 1 a las 00:30)');
  const domingoB = lista.filter((p) => p.categoriaId === Bc.id && p.faseEliminatoria.ronda < 32 && p.fechaHora && p.canchaNumero === 1);
  if (domingoB.length === 0) problemas.push('ningún cruce del domingo de B usa la cancha 1');
  if (!(await prisma.partido.findUnique({ where: { id: r32Otro.id } })).fechaHora) problemas.push('el R32 de la otra categoría perdió su horario');
  falla(problemas);
}

async function s4_lluvia_sabado_final_en_extension() {
  const ctx = await setupTorneo({ canchas: 4, domInicio: '10:00', domFin: '12:30' });
  const A = await armarCategoria(ctx, 'A', 6, TURNOS_CHICA);
  await programarHorariosEliminatorias(ctx.org.id, ctx.torneo.id);
  const finalA0 = await finalDe(A);
  if (iso(finalA0.fechaHora) !== iso(fecha(DOM, '12:30'))) throw new Error(`La final de A no quedó en la extensión: ${iso(finalA0.fechaHora)}`);
  await postHttp(ctx, `/torneos/${ctx.torneo.id}/canchas-override`, { canchasDisponiblesOverride: 1, diaKey: SAB });
  await partidoFijo(ctx, 'Otra1', 2, fecha(DOM, '12:30'), 1);
  await partidoFijo(ctx, 'Otra2', 2, fecha(DOM, '12:30'), 2);
  await cargarZonas(ctx, A);
  const s = solapes(await eliminatorias(ctx));
  falla(s.length > 0 ? [`${s.length} solapes: ${s.join(' | ')}`] : []);
}

async function s5_control_borde_dom_day_end() {
  const ctx = await setupTorneo({ canchas: 4, domInicio: '10:00', domFin: '12:30' });
  const A = await armarCategoria(ctx, 'A', 6, TURNOS_CHICA);
  await programarHorariosEliminatorias(ctx.org.id, ctx.torneo.id);
  // 12:30 es exactamente domDayEndMs (cierre del domingo)
  await partidoFijo(ctx, 'Otra', 2, fecha(DOM, '12:30'), 1);
  await cargarZonas(ctx, A);
  const s = solapes(await eliminatorias(ctx));
  falla(s.length > 0 ? [`${s.length} solapes: ${s.join(' | ')}`] : []);
}

async function s6_final_manual_en_extension_lluvia_domingo() {
  const ctx = await setupTorneo({ canchas: 4, domInicio: '10:00', domFin: '12:30' });
  const A = await armarCategoria(ctx, 'A', 6, TURNOS_CHICA);
  const B = await armarCategoria(ctx, 'B', 6, TURNOS_CHICA, { desfase: 2 });
  await programarHorariosEliminatorias(ctx.org.id, ctx.torneo.id);
  const finalA = await finalDe(A);
  if (iso(finalA.fechaHora) !== iso(fecha(DOM, '12:30')) || finalA.canchaNumero !== 1) throw new Error(`La final de A no quedó en la extensión en la cancha 1: ${iso(finalA.fechaHora)}@${finalA.canchaNumero}`);
  await partidoService.asignarHorarioManual(ctx.org.id, finalA.id, { slotId: 'Domingo-12:30', canchaNumero: 1 });
  // Lluvia del domingo: reprograma todas las categorías juntas (soloDomingo) con la final de A como fija
  await postHttp(ctx, `/torneos/${ctx.torneo.id}/canchas-override`, { canchasDisponiblesOverride: 3, diaKey: DOM });
  const problemas = [];
  const s = solapes(await eliminatorias(ctx));
  if (s.length > 0) problemas.push(`${s.length} solapes: ${s.join(' | ')}`);
  const finalA2 = await finalDe(A);
  if (iso(finalA2.fechaHora) !== iso(fecha(DOM, '12:30')) || finalA2.canchaNumero !== 1) problemas.push(`la final manual de A se movió a ${iso(finalA2.fechaHora)}@${finalA2.canchaNumero}`);
  const finalB = await finalDe(B);
  if (!finalB.fechaHora) problemas.push('la final de B quedó sin horario');
  falla(problemas);
}

async function run() {
  await ensureTestDb();
  resetTestDb();
  const { server, baseUrl } = await startTestServer();
  BASE_URL = baseUrl;

  console.log('='.repeat(85));
  console.log('🧪 SUITE: SOLAPE DE FINALES EN LA EXTENSIÓN DEL DOMINGO');
  console.log('='.repeat(85));

  const allTests = [
    { nombre: 'S1: finales en la extensión (12:30), A y después B: sin solapes', fn: s1_extension_mismo_dia },
    { nombre: 'S2: finales en la extensión pasada la medianoche (lunes 00:15)', fn: s2_extension_pasada_medianoche },
    { nombre: 'S3: control, R32 de la trasnoche del sábado ocupa el sábado', fn: s3_control_r32_trasnoche_sabado },
    { nombre: 'S4: lluvia del sábado, final en cancha 2 de la extensión cuenta como domingo', fn: s4_lluvia_sabado_final_en_extension },
    { nombre: 'S5: control, partido justo en domDayEndMs es del domingo', fn: s5_control_borde_dom_day_end },
    { nombre: 'S6: final manual en la extensión es fija en la lluvia del domingo', fn: s6_final_manual_en_extension_lluvia_domingo },
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
      console.error('Error fatal en test-solape-finales-extension.js:', e);
      process.exit(1);
    });
}

module.exports = { run };
