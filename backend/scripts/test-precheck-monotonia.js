'use strict';

/**
 * test-precheck-monotonia.js
 *
 * Decisión de producto (opción A, regla R2): al resolver un conflicto del pre-check el contador
 * puede subir, porque cuenta partidos. Destrabar una zona manual convierte 1 conflicto de zona en
 * los partidos de esa zona que no consiguen lugar: SIN_CANCHA_DISPONIBLE (zona de 3) o
 * PARTIDO_SIN_HORARIO (P3/P4 de mini-bracket). Lo mismo pasa al resolver P1/P2 de un mini-bracket:
 * P3/P4 empiezan a contar.
 *
 * La invariante del fuzz pasa a ser:
 *   - ninguna zona distinta de la resuelta sube su conteo (zona por zona, no la suma);
 *   - ninguna categoría sube su conteo sin contar la zona resuelta;
 *   - si la zona resuelta sube, todos sus ítems nuevos son partidos sin horario de esa zona.
 *
 * m1-m6: helper backend/scripts/utils/monotoniaPrecheck.js (m1-m3 con escenarios reales).
 * m7-m9: helper de UI frontend/src/utils/precheckDestrabe.js (aviso del modal del pre-check).
 * m10: zona manual destrabada con sus partidos creados (ex CASO 1 de tickets pendientes).
 *
 * Cada test es independiente: los helpers se cargan dentro de cada test para que su ausencia
 * haga fallar solo ese test.
 */

const { ensureTestDb } = require('./utils/testEnvGuard');
const path = require('path');
const { resetTestDb } = require('./reset-test-db');
const prisma = require('../src/lib/prisma');
const organizadorService = require('../src/services/organizador.service');
const disponibilidadService = require('../src/services/disponibilidad.service');
const canchasOverridesService = require('../src/services/canchasOverrides.service');
const { parseFechaLocal } = require('../src/utils/dateUtils');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function cargarHelper() {
  return require('./utils/monotoniaPrecheck');
}

async function cargarHelperUi() {
  const ruta = path.resolve(__dirname, '../../frontend/src/utils/precheckDestrabe.js');
  return import('file:///' + ruta.replace(/\\/g, '/'));
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

// ---------------------------------------------------------------------------
// Escenarios reales (1 cancha, viernes 18:00-22:00 o 23:00)
// ---------------------------------------------------------------------------

async function crearTorneo(nombre, viernesFin = '22:00') {
  const org = await prisma.organizador.create({
    data: {
      nombre,
      email: `${nombre}@padel.test`,
      passwordHash: 'hash',
      cantidadCanchas: 1,
      viernesInicio: '18:00',
      viernesFin,
      sabadoInicio: '09:00',
      sabadoFin: '22:00',
      domingoInicio: '09:00',
      domingoFin: '22:00',
    },
  });
  const torneo = await prisma.torneo.create({
    data: {
      nombre,
      slug: nombre,
      fecha: parseFechaLocal('2026-09-04'),
      estado: 'BORRADOR',
      organizadorId: org.id,
    },
  });
  return { org, torneo };
}

/** Crea una categoría con una pareja por elemento de slotsPorPareja (orden 1..n). */
async function crearCategoria(torneo, nombre, slotsPorPareja) {
  const cat = await prisma.categoria.create({
    data: { torneoId: torneo.id, nombre, estado: 'BORRADOR' },
  });
  const parejas = [];
  for (let i = 0; i < slotsPorPareja.length; i++) {
    const p = await prisma.pareja.create({
      data: { categoriaId: cat.id, jugador1: `${nombre}_A${i + 1}`, jugador2: `${nombre}_B${i + 1}`, orden: i + 1 },
    });
    for (const slotId of slotsPorPareja[i]) {
      await prisma.slotPareja.create({ data: { parejaId: p.id, slotId } });
    }
    parejas.push(p);
  }
  return { cat, parejas };
}

function contarUi(preCheck) {
  return (preCheck.conflictos || []).reduce((acc, c) => acc + (c.partidosSinHorario?.length || 0), 0);
}

function posicionDe(session, partidoId) {
  for (const cp of session.categoriasPlan) {
    for (const z of cp.zonas) {
      const p = z.partidos.find((x) => x.id === partidoId);
      if (p) return p.posicionEnRonda;
    }
  }
  return null;
}

/**
 * Zona de 3: 4ta ocupa la única cancha a las 18:00; 6ta tiene una zona manual (A1 y A2 a las 18:00,
 * A3 a las 19:15). Al darles 19:15 a A1 y A2 la zona se destraba: un partido entra a las 19:15 y los
 * otros dos quedan SIN_CANCHA_DISPONIBLE. Contador de la UI: 3 -> 4.
 */
async function escenarioZona3() {
  const { org, torneo } = await crearTorneo('mono-zona3');
  await crearCategoria(torneo, '4ta', [['Viernes-18:00'], ['Viernes-18:00'], ['Viernes-18:00']]);
  const { cat, parejas } = await crearCategoria(torneo, '6ta', [['Viernes-18:00'], ['Viernes-18:00'], ['Viernes-19:15']]);

  const antes = await organizadorService.preCheckInicioTorneo(org.id, torneo.id);
  const sessAntes = organizadorService.preCheckSessions.get(torneo.id);
  const { obtenerConflictosBase } = cargarHelper();
  const baseAntes = obtenerConflictosBase(antes, sessAntes);

  await disponibilidadService.setDisponibilidadDoble(org.id, parejas[0].id, ['Viernes-19:15'], parejas[1].id, ['Viernes-19:15']);
  const despues = await organizadorService.preCheckInicioTorneo(org.id, torneo.id, { isReCheck: true });
  const sessDespues = organizadorService.preCheckSessions.get(torneo.id);
  const baseDespues = obtenerConflictosBase(despues, sessDespues);

  return { cat, antes, despues, sessDespues, baseAntes, baseDespues };
}

/**
 * Zona de 4 (mini-bracket): A1/A2 a las 18:00 y A3/A4 a las 19:15. Al darles 19:15 a A1 y A2 la zona se
 * destraba: P1 y P2 entran y P3/P4 quedan PARTIDO_SIN_HORARIO. Contador de la UI: 1 -> 2.
 */
async function escenarioZona4() {
  const { org, torneo } = await crearTorneo('mono-zona4');
  const { cat, parejas } = await crearCategoria(torneo, '6ta', [
    ['Viernes-18:00'],
    ['Viernes-18:00'],
    ['Viernes-19:15'],
    ['Viernes-19:15'],
  ]);

  const antes = await organizadorService.preCheckInicioTorneo(org.id, torneo.id);
  const sessAntes = organizadorService.preCheckSessions.get(torneo.id);
  const { obtenerConflictosBase } = cargarHelper();
  const baseAntes = obtenerConflictosBase(antes, sessAntes);

  await disponibilidadService.setDisponibilidadDoble(org.id, parejas[0].id, ['Viernes-19:15'], parejas[1].id, ['Viernes-19:15']);
  const despues = await organizadorService.preCheckInicioTorneo(org.id, torneo.id, { isReCheck: true });
  const sessDespues = organizadorService.preCheckSessions.get(torneo.id);
  const baseDespues = obtenerConflictosBase(despues, sessDespues);

  return { cat, antes, despues, sessDespues, baseAntes, baseDespues };
}

/**
 * Ex CASO 2 de tickets pendientes: 1 cancha, 4 parejas solo a las 18:00 (mini-bracket). P1 entra a las
 * 18:00 y P2 queda sin cancha (P3/P4 son derivados y no cuentan como base). Al darles 19:15 a las
 * parejas de P2, P2 entra y P3/P4 pasan a contar. Base: 1 -> 2. Contador de la UI: 3 -> 2.
 */
async function escenarioMiniBracketP2() {
  const { org, torneo } = await crearTorneo('mono-mb-p2', '23:00');
  const { cat } = await crearCategoria(torneo, '6ta', [
    ['Viernes-18:00'],
    ['Viernes-18:00'],
    ['Viernes-18:00'],
    ['Viernes-18:00'],
  ]);

  const antes = await organizadorService.preCheckInicioTorneo(org.id, torneo.id);
  const sessAntes = organizadorService.preCheckSessions.get(torneo.id);
  const { obtenerConflictosBase } = cargarHelper();
  const baseAntes = obtenerConflictosBase(antes, sessAntes);

  const p2 = sessAntes.categoriasPlan[0].zonas[0].partidos.find((p) => p.posicionEnRonda === 2);
  await disponibilidadService.setDisponibilidadDoble(org.id, p2.pareja1Id, ['Viernes-19:15'], p2.pareja2Id, ['Viernes-19:15']);
  const despues = await organizadorService.preCheckInicioTorneo(org.id, torneo.id, { isReCheck: true });
  const sessDespues = organizadorService.preCheckSessions.get(torneo.id);
  const baseDespues = obtenerConflictosBase(despues, sessDespues);

  return { cat, p2Id: p2.id, antes, despues, sessDespues, baseAntes, baseDespues };
}

/**
 * Ex CASO 1 de tickets pendientes: 1 cancha, 3 parejas (A1/A2 a las 18:00, A3 a las 19:15).
 * Al destrabar, la zona queda con sus 3 partidos: 2 entran y 1 queda sin cancha. Contador: 1 -> 1.
 */
async function escenarioZona3SinOcupacion() {
  const { org, torneo } = await crearTorneo('mono-zona3-libre');
  const { cat, parejas } = await crearCategoria(torneo, '6ta', [['Viernes-18:00'], ['Viernes-18:00'], ['Viernes-19:15']]);

  const antes = await organizadorService.preCheckInicioTorneo(org.id, torneo.id);
  await disponibilidadService.setDisponibilidadDoble(org.id, parejas[0].id, ['Viernes-19:15'], parejas[1].id, ['Viernes-19:15']);
  const despues = await organizadorService.preCheckInicioTorneo(org.id, torneo.id, { isReCheck: true });
  const sessDespues = organizadorService.preCheckSessions.get(torneo.id);
  return { cat, antes, despues, sessDespues };
}

function itemZonaManual(baseAntes, categoriaId) {
  const it = baseAntes.find((i) => i.categoriaId === categoriaId && i.motivo === 'ZONA_MANUAL_INCOMPLETA');
  assert(it, `no hay ZONA_MANUAL_INCOMPLETA en la categoría ${categoriaId} antes del destrabe`);
  return it;
}

// ---------------------------------------------------------------------------
// Datos sintéticos para m4-m6 y m8
// ---------------------------------------------------------------------------

function item(categoriaId, zonaId, partidoId, motivo) {
  return { categoriaId, zonaId, zona: `Zona ${zonaId}`, partidoId, motivo };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function m1() {
  const { clasificarPasoMonotonia, claveZona } = cargarHelper();
  const { cat, antes, despues, baseAntes, baseDespues } = await escenarioZona3();
  assert(contarUi(antes) === 3 && contarUi(despues) === 4, `contador UI esperado 3 -> 4, fue ${contarUi(antes)} -> ${contarUi(despues)}`);

  const manual = itemZonaManual(baseAntes, cat.id);
  const paso = clasificarPasoMonotonia({ antes: baseAntes, despues: baseDespues, zonaObjetivo: claveZona(manual) });
  assert(paso.deltaTotal === 1, `deltaTotal esperado +1, fue ${paso.deltaTotal}`);
  assert(paso.ok === true, `el salto de la zona de 3 tiene que estar explicado: ${JSON.stringify(paso)}`);
  assert(paso.zonasQueSuben.length === 0, `ninguna otra zona sube: ${JSON.stringify(paso.zonasQueSuben)}`);
  const nuevos = paso.itemsNuevosZona.map((i) => i.motivo).sort();
  assert(
    JSON.stringify(nuevos) === JSON.stringify(['SIN_CANCHA_DISPONIBLE', 'SIN_CANCHA_DISPONIBLE']),
    `ítems nuevos esperados 2 SIN_CANCHA_DISPONIBLE, fueron ${JSON.stringify(nuevos)}`
  );
}

async function m2() {
  const { clasificarPasoMonotonia, claveZona } = cargarHelper();
  const { cat, antes, despues, sessDespues, baseAntes, baseDespues } = await escenarioZona4();
  assert(contarUi(antes) === 1 && contarUi(despues) === 2, `contador UI esperado 1 -> 2, fue ${contarUi(antes)} -> ${contarUi(despues)}`);

  const manual = itemZonaManual(baseAntes, cat.id);
  const paso = clasificarPasoMonotonia({ antes: baseAntes, despues: baseDespues, zonaObjetivo: claveZona(manual) });
  assert(paso.deltaTotal === 1, `deltaTotal esperado +1, fue ${paso.deltaTotal}`);
  assert(paso.ok === true, `el salto de la zona de 4 tiene que estar explicado: ${JSON.stringify(paso)}`);
  const nuevos = paso.itemsNuevosZona.map((i) => `P${posicionDe(sessDespues, i.partidoId)}:${i.motivo}`).sort();
  assert(
    JSON.stringify(nuevos) === JSON.stringify(['P3:PARTIDO_SIN_HORARIO', 'P4:PARTIDO_SIN_HORARIO']),
    `ítems nuevos esperados P3/P4 PARTIDO_SIN_HORARIO, fueron ${JSON.stringify(nuevos)}`
  );
}

async function m3() {
  const { clasificarPasoMonotonia, claveZona } = cargarHelper();
  const { p2Id, antes, despues, sessDespues, baseAntes, baseDespues } = await escenarioMiniBracketP2();
  assert(baseAntes.length === 1 && baseDespues.length === 2, `base esperada 1 -> 2, fue ${baseAntes.length} -> ${baseDespues.length}`);
  assert(contarUi(antes) === 3 && contarUi(despues) === 2, `contador UI esperado 3 -> 2, fue ${contarUi(antes)} -> ${contarUi(despues)}`);

  const p2Despues = sessDespues.categoriasPlan[0].zonas[0].partidos.find((p) => p.id === p2Id);
  assert(p2Despues && !p2Despues.sinHorarioAsignado && p2Despues.fechaHora, 'P2 tiene que quedar con horario');

  const paso = clasificarPasoMonotonia({ antes: baseAntes, despues: baseDespues, zonaObjetivo: claveZona(baseAntes[0]) });
  assert(paso.ok === true, `el salto por P3/P4 tiene que estar explicado: ${JSON.stringify(paso)}`);
  assert(paso.zonasQueSuben.length === 0 && paso.categoriasQueSuben.length === 0, 'ninguna otra zona ni categoría sube');
  const nuevos = paso.itemsNuevosZona.map((i) => `P${posicionDe(sessDespues, i.partidoId)}:${i.motivo}`).sort();
  assert(
    JSON.stringify(nuevos) === JSON.stringify(['P3:PARTIDO_SIN_HORARIO', 'P4:PARTIDO_SIN_HORARIO']),
    `ítems nuevos esperados P3/P4 PARTIDO_SIN_HORARIO, fueron ${JSON.stringify(nuevos)}`
  );
}

async function m4() {
  const { clasificarPasoMonotonia } = cargarHelper();
  // Se resuelve z1; z2 sube 1 y z3 baja 1: la suma de las otras zonas no cambia (y el total baja),
  // pero z2 empeoró y tiene que fallar.
  const antes = [
    item('c1', 'z1', 'p1', 'SIN_CANCHA_DISPONIBLE'),
    item('c1', 'z2', 'p3', 'SIN_CANCHA_DISPONIBLE'),
    item('c1', 'z3', 'p5', 'SIN_CANCHA_DISPONIBLE'),
  ];
  const despues = [
    item('c1', 'z2', 'p3', 'SIN_CANCHA_DISPONIBLE'),
    item('c1', 'z2', 'p4', 'SIN_CANCHA_DISPONIBLE'),
  ];
  const paso = clasificarPasoMonotonia({ antes, despues, zonaObjetivo: 'c1:z1' });
  assert(paso.deltaTotal === -1, `deltaTotal esperado -1, fue ${paso.deltaTotal}`);
  assert(paso.ok === false, 'tiene que fallar: otra zona subió aunque la suma de las otras zonas no cambió');
  assert(paso.violaciones.includes('OTRA_ZONA_SUBE'), `violaciones: ${JSON.stringify(paso.violaciones)}`);
  assert(
    paso.zonasQueSuben.length === 1 && paso.zonasQueSuben[0].zona === 'c1:z2' && paso.zonasQueSuben[0].antes === 1 && paso.zonasQueSuben[0].despues === 2,
    `zonasQueSuben: ${JSON.stringify(paso.zonasQueSuben)}`
  );
}

async function m5() {
  const { clasificarPasoMonotonia } = cargarHelper();
  // Se resuelve un partido de c1 y sube un partido en otra categoría (c2).
  const antes = [item('c1', 'z1', 'p1', 'SIN_CANCHA_DISPONIBLE'), item('c2', 'z9', 'p9', 'SIN_CANCHA_DISPONIBLE')];
  const despues = [item('c2', 'z9', 'p9', 'SIN_CANCHA_DISPONIBLE'), item('c2', 'z9', 'p10', 'SIN_CANCHA_DISPONIBLE')];
  const paso = clasificarPasoMonotonia({ antes, despues, zonaObjetivo: 'c1:z1' });
  assert(paso.ok === false, 'tiene que fallar: otra categoría subió');
  assert(paso.violaciones.includes('OTRA_CATEGORIA_SUBE'), `violaciones: ${JSON.stringify(paso.violaciones)}`);
  assert(
    paso.categoriasQueSuben.length === 1 && paso.categoriasQueSuben[0].categoriaId === 'c2' && paso.categoriasQueSuben[0].antes === 1 && paso.categoriasQueSuben[0].despues === 2,
    `categoriasQueSuben: ${JSON.stringify(paso.categoriasQueSuben)}`
  );
}

async function m6() {
  const { clasificarPasoMonotonia } = cargarHelper();
  // La zona objetivo sube con un ítem nuevo que no es un partido sin horario.
  const antes = [item('c1', 'z1', 'p1', 'SIN_CANCHA_DISPONIBLE'), item('c1', 'z2', 'p3', 'SIN_CANCHA_DISPONIBLE')];
  const despues = [
    item('c1', 'z1', 'p1', 'SIN_CANCHA_DISPONIBLE'),
    item('c1', 'z1', 'z1', 'ZONA_MANUAL_INCOMPLETA'),
    item('c1', 'z2', 'p3', 'SIN_CANCHA_DISPONIBLE'),
  ];
  const paso = clasificarPasoMonotonia({ antes, despues, zonaObjetivo: 'c1:z1' });
  assert(paso.zonasQueSuben.length === 0 && paso.categoriasQueSuben.length === 0, 'el caso solo prueba la zona objetivo');
  assert(paso.ok === false, 'tiene que fallar: el ítem nuevo de la zona objetivo no es un partido sin horario');
  assert(paso.violaciones.includes('ZONA_OBJETIVO_NO_EXPLICADA'), `violaciones: ${JSON.stringify(paso.violaciones)}`);
  assert(
    paso.itemsNoExplicados.length === 1 && paso.itemsNoExplicados[0].motivo === 'ZONA_MANUAL_INCOMPLETA',
    `itemsNoExplicados: ${JSON.stringify(paso.itemsNoExplicados)}`
  );
}

async function m7() {
  const { armarAvisoDestrabe } = await cargarHelperUi();

  // Sube el contador: zona de 3 con la cancha ocupada (3 -> 4).
  const z3 = await escenarioZona3();
  const aviso = armarAvisoDestrabe(z3.antes.conflictos, z3.despues.conflictos);
  assert(aviso, 'tiene que haber aviso al destrabar la zona');
  assert(aviso.subio === true && aviso.pendientesAntes === 3 && aviso.pendientesDespues === 4, `aviso: ${JSON.stringify(aviso)}`);
  const esperado = 'Destrabaste la Zona A de 6ta. Ya tiene sus partidos, pero 2 quedaron sin cancha: por eso los pendientes pasaron de 3 a 4.';
  assert(JSON.stringify(aviso.lineas) === JSON.stringify([esperado]), `líneas: ${JSON.stringify(aviso.lineas)}`);

  // No sube el contador: zona de 3 sin ocupación (1 -> 1).
  await limpiarDb();
  const libre = await escenarioZona3SinOcupacion();
  const aviso2 = armarAvisoDestrabe(libre.antes.conflictos, libre.despues.conflictos);
  assert(aviso2 && aviso2.subio === false, `aviso2: ${JSON.stringify(aviso2)}`);
  const esperado2 = 'Destrabaste la Zona A de 6ta. 1 de sus partidos todavía no tiene cancha.';
  assert(JSON.stringify(aviso2.lineas) === JSON.stringify([esperado2]), `líneas: ${JSON.stringify(aviso2.lineas)}`);
}

async function m8() {
  const { armarAvisoDestrabe } = await cargarHelperUi();
  // La zona sigue manual: no hay aviso.
  const conflictos = [
    {
      categoriaId: 'c1',
      nombreCategoria: '6ta',
      partidosSinHorario: [{ categoriaId: 'c1', zonaId: 'z1', zona: 'Zona A', partidoId: 'z1', motivo: 'ZONA_MANUAL_INCOMPLETA' }],
    },
  ];
  const aviso = armarAvisoDestrabe(conflictos, structuredClone(conflictos));
  assert(aviso === null, `no tiene que haber aviso: ${JSON.stringify(aviso)}`);
}

async function m9() {
  const { armarAvisoDestrabe } = await cargarHelperUi();
  // Resolver P2 de un mini-bracket no destraba ninguna zona: no hay aviso.
  const { antes, despues } = await escenarioMiniBracketP2();
  const aviso = armarAvisoDestrabe(antes.conflictos, despues.conflictos);
  assert(aviso === null, `no tiene que haber aviso: ${JSON.stringify(aviso)}`);
}

async function m10() {
  // Zona manual destrabada: deja de requerir armado manual y tiene sus 3 partidos creados.
  const { despues, sessDespues } = await escenarioZona3SinOcupacion();
  const zona = sessDespues.categoriasPlan[0].zonas[0];
  assert(zona.requiereArmadoManual === false, 'la zona tiene que quedar destrabada');
  assert(Array.isArray(zona.partidos) && zona.partidos.length === 3, `la zona tiene que tener 3 partidos, tiene ${zona.partidos?.length || 0}`);
  assert(contarUi(despues) === 1, `contador UI esperado 1, fue ${contarUi(despues)}`);
}

const TESTS = [
  ['m1', 'zona de 3 destrabada: 1 ZONA_MANUAL -> 2 SIN_CANCHA_DISPONIBLE, salto explicado', m1],
  ['m2', 'zona de 4 destrabada: 1 ZONA_MANUAL -> P3/P4 PARTIDO_SIN_HORARIO, salto explicado', m2],
  ['m3', 'mini-bracket: resolver P2 hace contar P3/P4, salto explicado (UI 3 -> 2)', m3],
  ['m4', 'otra zona sube aunque la suma de las otras zonas no cambie: falla (zona por zona)', m4],
  ['m5', 'otra categoría sube: falla', m5],
  ['m6', 'ítem nuevo en la zona objetivo que no es un partido sin horario: falla', m6],
  ['m7', 'UI: aviso al destrabar una zona (sube y no sube el contador)', m7],
  ['m8', 'UI: sin aviso si la zona sigue manual', m8],
  ['m9', 'UI: sin aviso al resolver P2 de un mini-bracket', m9],
  ['m10', 'zona manual destrabada tiene sus partidos creados', m10],
];

async function run() {
  await ensureTestDb();
  resetTestDb();
  await canchasOverridesService.loadFromDb();

  console.log('='.repeat(80));
  console.log('🧪 SUITE: MONOTONÍA DEL PRE-CHECK (REGLA R2)');
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
      console.error('Error fatal en test-precheck-monotonia.js:', e);
      process.exit(1);
    });
}

module.exports = { run };
