'use strict';

/**
 * test-dieciseisavos-al-completar-zonas.js
 * Si el torneo se inicia con partidos de zona sin horario, los dieciseisavos de esa categoría quedan sin horario
 * (eliminatoriaScheduler, paso 4). Al asignarle horario a mano (asignarHorarioManual) al último partido de zona
 * sin horario de la categoría, se programan sus dieciseisavos con programarHorariosEliminatorias, sin mover nada
 * que ya tenga horario.
 *
 * Escenario: club de 6 canchas. Categoría A: 36 parejas, 12 zonas de 3 en las canchas 1 a 4, cuadro de 32
 * (8 dieciseisavos con rival). Categoría B: 6 parejas, 2 zonas en las canchas 5 y 6, sin dieciseisavos.
 * Dos partidos de zona de A quedan sin horario y se programa el cuadro como al iniciar el torneo.
 *
 * D1  Con un partido de zona todavía sin horario no se programa nada; con el último, se programan los 8
 *     dieciseisavos y la respuesta lo dice. Octavos, partidos de zona y la categoría B no cambian.
 * D2  Un dieciseisavos con horario puesto a mano no se mueve; se programan los otros 7.
 * D3  Si la programación falla, el horario asignado queda guardado y los dieciseisavos siguen pendientes.
 */

require('./utils/testEnvGuard');
const { ensureTestDb } = require('./utils/testEnvGuard');
const { resetTestDb } = require('./reset-test-db');
const prisma = require('../src/lib/prisma');
const canchasOverridesService = require('../src/services/canchasOverrides.service');
const zonaService = require('../src/services/zona.service');
const partidoService = require('../src/services/partido.service');
const { generarEliminatoria } = require('../src/services/faseEliminatoria.service');
const scheduler = require('../src/services/eliminatoriaScheduler.service');
const { parseFechaLocal } = require('../src/utils/dateUtils');

const VIE = '2026-10-16';
const SAB = '2026-10-17';

function fecha(diaKey, hora) {
  const [y, m, d] = diaKey.split('-').map(Number);
  const [hh, mm] = hora.split(':').map(Number);
  const dt = new Date(y, m - 1, d, hh, mm, 0, 0);
  if (hh < 6) dt.setDate(dt.getDate() + 1);
  return dt;
}
const iso = (d) => (d ? new Date(d).toISOString() : null);
const snap = (p) => `${iso(p.fechaHora)}@${p.canchaNumero}@${p.sinHorarioAsignado}`;
const TURNOS = [
  fecha(VIE, '18:00'), fecha(VIE, '19:15'), fecha(VIE, '20:30'), fecha(VIE, '21:45'),
  fecha(SAB, '09:00'), fecha(SAB, '10:15'), fecha(SAB, '11:30'), fecha(SAB, '12:45'),
  fecha(SAB, '14:00'), fecha(SAB, '15:15'), fecha(SAB, '16:30'), fecha(SAB, '17:45'),
];

async function limpiarDb() {
  for (const m of ['setPartido', 'partido', 'faseEliminatoria', 'zonaPareja', 'zona', 'slotPareja', 'pareja', 'categoria', 'overrideCanchasDia', 'torneo', 'organizador']) {
    await prisma[m].deleteMany({});
  }
  await canchasOverridesService.loadFromDb();
}

/** Crea la categoría, sus zonas y su cuadro, y reparte los partidos de zona en las canchas dadas. */
async function armarCategoria(ctx, nombre, parejas, canchas) {
  const cat = await prisma.categoria.create({ data: { torneoId: ctx.torneo.id, nombre, estado: 'BORRADOR' } });
  for (let i = 1; i <= parejas; i++) {
    await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: `${nombre}${i}a`, jugador2: `${nombre}${i}b`, orden: i } });
  }
  await zonaService.iniciarCategoria(ctx.org.id, cat.id);
  await prisma.torneo.update({ where: { id: ctx.torneo.id }, data: { estado: 'EN_CURSO' } });
  await generarEliminatoria(ctx.org.id, cat.id);
  const zonas = await prisma.zona.findMany({ where: { categoriaId: cat.id }, orderBy: { nombre: 'asc' } });
  const porTurno = canchas.length;
  const grupos = Math.ceil(zonas.length / porTurno);
  for (let z = 0; z < zonas.length; z++) {
    const ps = await prisma.partido.findMany({ where: { zonaId: zonas[z].id }, orderBy: { posicionEnRonda: 'asc' } });
    for (let k = 0; k < ps.length; k++) {
      await prisma.partido.update({
        where: { id: ps[k].id },
        data: { fechaHora: TURNOS[k * grupos + Math.floor(z / porTurno)], canchaNumero: canchas[z % porTurno], sinHorarioAsignado: false },
      });
    }
  }
  return cat;
}

/** Torneo iniciado con dos partidos de zona de A sin horario, como "Iniciar dejando N pendientes". */
async function escenario() {
  await limpiarDb();
  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club Dieciseisavos', email: `test_r32_zonas_${Date.now()}_${Math.random()}@padel.test`, passwordHash: 'hash', cantidadCanchas: 6,
      viernesInicio: '18:00', viernesFin: '23:00', sabadoInicio: '09:00', sabadoFin: '24:00', domingoInicio: '09:00', domingoFin: '22:00',
    },
  });
  const torneo = await prisma.torneo.create({
    data: { organizadorId: org.id, nombre: 'Torneo Dieciseisavos', slug: `torneo-r32-zonas-${Date.now()}-${Math.floor(Math.random() * 10000)}`, fecha: parseFechaLocal(VIE), estado: 'BORRADOR' },
  });
  const ctx = { org, torneo };
  const A = await armarCategoria(ctx, 'A', 36, [1, 2, 3, 4]);
  const B = await armarCategoria(ctx, 'B', 6, [5, 6]);
  // Los dos últimos partidos de la zona L de A quedan sin horario (guardamos dónde iban para asignarlos a mano).
  const zonaL = await prisma.zona.findFirst({ where: { categoriaId: A.id }, orderBy: { nombre: 'desc' } });
  const sueltos = await prisma.partido.findMany({ where: { zonaId: zonaL.id }, orderBy: { posicionEnRonda: 'desc' }, take: 2 });
  const destinos = sueltos.map((p) => ({ id: p.id, fechaHora: iso(p.fechaHora), canchaNumero: p.canchaNumero }));
  await prisma.partido.updateMany({ where: { id: { in: sueltos.map((p) => p.id) } }, data: { fechaHora: null, canchaNumero: null, sinHorarioAsignado: true } });
  await scheduler.programarHorariosEliminatorias(org.id, torneo.id);
  return { ctx, A, B, destinos };
}

const dieciseisavos = (cat) => prisma.partido.findMany({
  where: { categoriaId: cat.id, esBye: false, faseEliminatoria: { ronda: { gte: 32 } } }, orderBy: { posicionEnRonda: 'asc' },
});
const sinHorario = (p) => !p.fechaHora || !p.canchaNumero || p.sinHorarioAsignado;
const todos = async (torneoId) => new Map((await prisma.partido.findMany({
  where: { categoria: { torneoId } }, include: { faseEliminatoria: true, categoria: true },
})).map((p) => [p.id, p]));

function falla(problemas) {
  if (problemas.length > 0) throw new Error(problemas.join(' ; '));
}

async function d1_programa_al_completar() {
  const { ctx, A, destinos } = await escenario();
  const problemas = [];
  const r32Antes = await dieciseisavos(A);
  if (r32Antes.length !== 8 || !r32Antes.every(sinHorario)) throw new Error('El escenario no dejó los 8 dieciseisavos sin horario');
  const antes = await todos(ctx.torneo.id);

  const primero = await partidoService.asignarHorarioManual(ctx.org.id, destinos[0].id, destinos[0]);
  if (primero.dieciseisavosProgramados !== 0) problemas.push(`Con un partido de zona pendiente informó ${primero.dieciseisavosProgramados}`);
  if (!(await dieciseisavos(A)).every(sinHorario)) problemas.push('Con un partido de zona pendiente se programaron dieciseisavos');

  const segundo = await partidoService.asignarHorarioManual(ctx.org.id, destinos[1].id, destinos[1]);
  if (segundo.dieciseisavosProgramados !== 8) problemas.push(`Al completar las zonas informó ${segundo.dieciseisavosProgramados} dieciseisavos, no 8`);
  const r32Despues = await dieciseisavos(A);
  if (r32Despues.some(sinHorario)) problemas.push('Quedaron dieciseisavos sin horario al completar las zonas');

  const despues = await todos(ctx.torneo.id);
  const asignados = new Set(destinos.map((d) => d.id));
  for (const [id, p] of despues) {
    if (asignados.has(id) || (p.faseEliminatoria?.ronda >= 32 && p.categoriaId === A.id)) continue;
    const a = antes.get(id);
    if (snap(a) !== snap(p)) {
      const que = p.faseEliminatoria ? p.faseEliminatoria.nombre : 'zona';
      problemas.push(`${p.categoria.nombre} ${que} #${p.posicionEnRonda} cambió de ${snap(a)} a ${snap(p)}`);
    }
  }
  falla(problemas);
}

async function d2_r32_manual_no_se_mueve() {
  const { ctx, A, destinos } = await escenario();
  const [manual] = await dieciseisavos(A);
  await partidoService.asignarHorarioManual(ctx.org.id, manual.id, { slotId: 'Sabado-23:15', canchaNumero: 1 });
  const fijado = await prisma.partido.findUnique({ where: { id: manual.id } });
  for (const d of destinos) await partidoService.asignarHorarioManual(ctx.org.id, d.id, d);
  const problemas = [];
  const despues = await prisma.partido.findUnique({ where: { id: manual.id } });
  if (snap(despues) !== snap(fijado)) problemas.push(`El dieciseisavos manual pasó de ${snap(fijado)} a ${snap(despues)}`);
  if (despues.horarioManual !== true) problemas.push(`horarioManual ${despues.horarioManual}`);
  const otros = (await dieciseisavos(A)).filter((p) => p.id !== manual.id);
  if (otros.some(sinHorario)) problemas.push('Quedaron dieciseisavos sin horario');
  falla(problemas);
}

async function d3_falla_la_programacion() {
  const { ctx, A, destinos } = await escenario();
  await partidoService.asignarHorarioManual(ctx.org.id, destinos[0].id, destinos[0]);
  const original = scheduler.programarHorariosEliminatorias;
  const errorOriginal = console.error;
  let registrado = false;
  scheduler.programarHorariosEliminatorias = async () => { throw new Error('falla simulada'); };
  console.error = (...args) => { if (String(args[0]).includes('dieciseisavos')) registrado = true; };
  let res;
  try {
    res = await partidoService.asignarHorarioManual(ctx.org.id, destinos[1].id, destinos[1]);
  } finally {
    scheduler.programarHorariosEliminatorias = original;
    console.error = errorOriginal;
  }
  const problemas = [];
  if (res.dieciseisavosProgramados !== 0) problemas.push(`Con la falla informó ${res.dieciseisavosProgramados}`);
  if (!registrado) problemas.push('La falla no quedó en el log');
  const guardado = await prisma.partido.findUnique({ where: { id: destinos[1].id } });
  if (iso(guardado.fechaHora) !== destinos[1].fechaHora || guardado.canchaNumero !== destinos[1].canchaNumero || guardado.sinHorarioAsignado) {
    problemas.push(`El horario asignado no quedó guardado: ${snap(guardado)}`);
  }
  if (!(await dieciseisavos(A)).every(sinHorario)) problemas.push('Con la falla, los dieciseisavos no siguieron pendientes');
  falla(problemas);
}

async function run() {
  await ensureTestDb();
  resetTestDb();
  await canchasOverridesService.loadFromDb();
  const allTests = [
    { nombre: 'D1: se programan al completar las zonas, sin mover nada más', fn: d1_programa_al_completar },
    { nombre: 'D2: un dieciseisavos manual no se mueve', fn: d2_r32_manual_no_se_mueve },
    { nombre: 'D3: si falla la programación, el horario queda guardado', fn: d3_falla_la_programacion },
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
      console.error('Error fatal en test-dieciseisavos-al-completar-zonas.js:', e);
      process.exit(1);
    });
}

module.exports = { run };
