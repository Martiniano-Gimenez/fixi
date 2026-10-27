'use strict';

/**
 * test-armado-zonas-reparacion.js
 * Armado de zonas por disponibilidad (iniciarCategoriaConDisponibilidad / armarGruposPorCompatibilidad):
 *  - una pareja sin disponibilidad cargada (0 slots) es compatible con todas, como en evaluarCompatibilidadZona
 *    y en el scheduler; si ninguna pareja tiene slots, se mantiene el error que manda al sorteo;
 *  - si el armado voraz deja parejas sin zona, una búsqueda exacta con los mismos tamaños de calcularConfigZonas
 *    (con vuelta atrás entre zonas y tope de iteraciones) intenta dejar menos; se acepta solo si deja
 *    estrictamente menos, y las zonas reparadas salen en el orden de tamaños de configZonas.
 *
 * Las instancias son fixtures copiados del benchmark del armado (fixtures/armado-zonas/*.json) y
 * fixtures/armado-zonas/zonas-main.json guarda las zonas que arma main (d1b6729) en esas instancias.
 *
 * Z1  Pareja sin slots: (a) fixture mínimo de 3 parejas; (b) real-devdb-5ta, de 3 sin zona a 0; (c) control:
 *     si ninguna pareja tiene slots sigue el error de siempre.
 * Z2  real-excel-7ma-damas: de 3 sin zona a 0, zonas en el orden de tamaños [4,3,3,3,3].
 * Z3  fuzzchica-s120 (de 6 sin zona a 3) y fuzzchica-s104 (de 2 a 0).
 * Z4  Control: real-devdb-7ma y real-excel-5ta (sin parejas sin zona) quedan idénticas a main.
 * Z5  Control: fuzz-s5-4ta (4 parejas, sin zona de 4 posible) queda igual que en main.
 * Z6  Tope: 10 grupos de 4 parejas compatibles solo entre sí (40 parejas, tamaños [4,3,...,3]); la búsqueda
 *     llega al tope, termina rápido y devuelve un armado válido, no peor que el voraz.
 *
 * Los miembros de cada zona se leen en el orden de creación a partir de sus partidos (P1 = [0] vs [1],
 * P2 = [0] vs [2] en zonas de 3, P2 = [2] vs [3] en mini-bracket), porque zonaParejas no guarda el orden.
 */

require('./utils/testEnvGuard');
const { ensureTestDb } = require('./utils/testEnvGuard');
const { resetTestDb } = require('./reset-test-db');
const path = require('path');
const fs = require('fs');
const prisma = require('../src/lib/prisma');
const zonaService = require('../src/services/zona.service');
const { parseFechaLocal } = require('../src/utils/dateUtils');

const FIX = path.join(__dirname, 'fixtures', 'armado-zonas');
const leerFixture = (id) => JSON.parse(fs.readFileSync(path.join(FIX, `${id}.json`), 'utf8'));
const MAIN = leerFixture('zonas-main');

let contador = 0;

async function limpiarDb() {
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
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Crea club, torneo y categoría en BORRADOR con las parejas de la instancia (orden y slots). */
async function crearCategoria(inst) {
  contador++;
  const org = await prisma.organizador.create({
    data: { email: `armado-${contador}@test.com`, nombre: `Club armado ${contador}`, passwordHash: 'x', ...inst.club },
  });
  const torneo = await prisma.torneo.create({
    data: { nombre: `Armado ${contador}`, slug: `armado-${contador}`, fecha: parseFechaLocal(inst.fecha), estado: 'BORRADOR', organizadorId: org.id },
  });
  const cat = await prisma.categoria.create({ data: { torneoId: torneo.id, nombre: 'Cat', estado: 'BORRADOR' } });
  await prisma.pareja.createMany({
    data: inst.parejas.map((p) => ({ categoriaId: cat.id, jugador1: `P${p.orden}A`, jugador2: `P${p.orden}B`, orden: p.orden })),
  });
  const creadas = await prisma.pareja.findMany({ where: { categoriaId: cat.id } });
  const idPorOrden = new Map(creadas.map((c) => [c.orden, c.id]));
  const rows = [];
  for (const p of inst.parejas) for (const s of p.slots) rows.push({ parejaId: idPorOrden.get(p.orden), slotId: s });
  if (rows.length) await prisma.slotPareja.createMany({ data: rows });
  return { org, cat, ordenPorId: new Map(creadas.map((c) => [c.id, c.orden])) };
}

/** Zonas por nombre, con sus miembros en orden de creación (reconstruido desde los partidos). */
async function leerZonas(ctx) {
  const zonas = await prisma.zona.findMany({
    where: { categoriaId: ctx.cat.id },
    orderBy: { nombre: 'asc' },
    include: { zonaParejas: true, partidos: { orderBy: { posicionEnRonda: 'asc' } } },
  });
  const o = (id) => ctx.ordenPorId.get(id);
  return zonas.map((z) => {
    const size = z.zonaParejas.length;
    const p1 = z.partidos.find((p) => p.posicionEnRonda === 1);
    const p2 = z.partidos.find((p) => p.posicionEnRonda === 2);
    let ordenes;
    if (size === 2 && p1) ordenes = [o(p1.pareja1Id), o(p1.pareja2Id)];
    else if (size === 3 && p1 && p2) ordenes = [o(p1.pareja1Id), o(p1.pareja2Id), o(p2.pareja2Id)];
    else if (size === 4 && z.formato === 'MINI_BRACKET' && p1 && p2) ordenes = [o(p1.pareja1Id), o(p1.pareja2Id), o(p2.pareja1Id), o(p2.pareja2Id)];
    else ordenes = z.zonaParejas.map((zp) => o(zp.parejaId)).sort((a, b) => a - b);
    return { nombre: z.nombre, manual: z.requiereArmadoManual, ordenes };
  });
}

async function armar(inst) {
  const ctx = await crearCategoria(inst);
  await zonaService.iniciarCategoriaConDisponibilidad(ctx.org.id, ctx.cat.id);
  const zonas = await leerZonas(ctx);
  await limpiarDb();
  return {
    validas: zonas.filter((z) => !z.manual).map((z) => z.ordenes),
    sinZona: zonas.filter((z) => z.manual).flatMap((z) => z.ordenes).sort((a, b) => a - b),
  };
}

/** Cada zona válida: todos sus pares comparten un inicio, o alguna de las dos parejas no tiene slots. */
function validarCompatibilidad(inst, zonas) {
  const slots = new Map(inst.parejas.map((p) => [p.orden, new Set(p.slots)]));
  for (const z of zonas) {
    for (let i = 0; i < z.length; i++) {
      for (let j = i + 1; j < z.length; j++) {
        const a = slots.get(z[i]), b = slots.get(z[j]);
        const ok = a.size === 0 || b.size === 0 || [...a].some((s) => b.has(s));
        assert(ok, `zona [${z.join(',')}]: las parejas ${z[i]} y ${z[j]} no son compatibles`);
      }
    }
  }
}

const tamanos = (zonas) => zonas.map((z) => z.length).join(',');

// ---------------------------------------------------------------------------------------------------------

async function z1a_fixtureMinimo() {
  const inst = {
    club: { cantidadCanchas: 2, viernesInicio: '18:00', viernesFin: '23:00', sabadoInicio: '09:00', sabadoFin: '20:00', domingoInicio: '09:00', domingoFin: '20:00' },
    fecha: '2026-10-16',
    parejas: [
      { orden: 1, slots: ['Viernes-18:00', 'Viernes-18:15'] },
      { orden: 2, slots: ['Viernes-18:00'] },
      { orden: 3, slots: [] },
    ],
  };
  const r = await armar(inst);
  assert(r.sinZona.length === 0, `esperaba 0 parejas sin zona, hay ${r.sinZona.length}: [${r.sinZona}]`);
  assert(r.validas.length === 1 && r.validas[0].length === 3, `esperaba una zona de 3, hay [${tamanos(r.validas)}]`);
}

async function z1b_realDevdb5ta() {
  const inst = leerFixture('real-devdb-5ta');
  assert(inst.parejas.filter((p) => p.slots.length === 0).length === 1, 'el fixture tiene que tener una pareja sin slots');
  assert(MAIN['real-devdb-5ta'].sinGrupo.length === 3, 'en main quedaban 3 sin zona');
  const r = await armar(inst);
  assert(r.sinZona.length === 0, `esperaba 0 parejas sin zona (main: 3), hay ${r.sinZona.length}: [${r.sinZona}]`);
  assert(tamanos(r.validas) === '3,3,3,3,3,3,3,3,3', `tamaños inesperados: [${tamanos(r.validas)}]`);
  validarCompatibilidad(inst, r.validas);
}

async function z1c_ningunaConSlots() {
  const inst = {
    club: { cantidadCanchas: 2, viernesInicio: '18:00', viernesFin: '23:00', sabadoInicio: '09:00', sabadoFin: '20:00', domingoInicio: '09:00', domingoFin: '20:00' },
    fecha: '2026-10-16',
    parejas: [1, 2, 3].map((o) => ({ orden: o, slots: [] })),
  };
  const ctx = await crearCategoria(inst);
  let error = null;
  try {
    await zonaService.iniciarCategoriaConDisponibilidad(ctx.org.id, ctx.cat.id);
  } catch (e) {
    error = e;
  }
  const zonas = await prisma.zona.count({ where: { categoriaId: ctx.cat.id } });
  await limpiarDb();
  assert(error && error.statusCode === 400, 'esperaba un error 400');
  assert(error.message.startsWith('Ninguna pareja tiene disponibilidad horaria cargada.'), `mensaje inesperado: ${error.message}`);
  assert(zonas === 0, `no tenía que crear zonas, creó ${zonas}`);
}

async function z2_realExcel7maDamas() {
  const inst = leerFixture('real-excel-7ma-damas');
  assert(MAIN['real-excel-7ma-damas'].sinGrupo.length === 3, 'en main quedaban 3 sin zona');
  const r = await armar(inst);
  assert(r.sinZona.length === 0, `esperaba 0 parejas sin zona (main: 3), hay ${r.sinZona.length}: [${r.sinZona}]`);
  assert(tamanos(r.validas) === '4,3,3,3,3', `las zonas tienen que seguir el orden de configZonas [4,3,3,3,3], son [${tamanos(r.validas)}]`);
  validarCompatibilidad(inst, r.validas);
}

async function z3_fuzzchica() {
  const s120 = leerFixture('fuzzchica-s120-4ta');
  const r120 = await armar(s120);
  assert(r120.sinZona.length === 3, `fuzzchica-s120: esperaba 3 sin zona (main: 6), hay ${r120.sinZona.length}: [${r120.sinZona}]`);
  assert(tamanos(r120.validas) === '4,3', `fuzzchica-s120: tamaños [${tamanos(r120.validas)}], esperaba [4,3]`);
  validarCompatibilidad(s120, r120.validas);

  const s104 = leerFixture('fuzzchica-s104-4ta');
  const r104 = await armar(s104);
  assert(r104.sinZona.length === 0, `fuzzchica-s104: esperaba 0 sin zona (main: 2), hay ${r104.sinZona.length}: [${r104.sinZona}]`);
  assert(tamanos(r104.validas) === '3,3,3,2', `fuzzchica-s104: tamaños [${tamanos(r104.validas)}], esperaba [3,3,3,2]`);
  validarCompatibilidad(s104, r104.validas);
}

async function z4_controlSinCambios() {
  for (const id of ['real-devdb-7ma', 'real-excel-5ta']) {
    const r = await armar(leerFixture(id));
    const esperado = MAIN[id];
    assert(r.sinZona.length === 0, `${id}: esperaba 0 sin zona, hay ${r.sinZona.length}`);
    assert(JSON.stringify(r.validas) === JSON.stringify(esperado.grupos),
      `${id}: las zonas cambiaron respecto de main.\n   main: ${JSON.stringify(esperado.grupos)}\n   rama: ${JSON.stringify(r.validas)}`);
  }
}

async function z5_controlSinMejora() {
  const r = await armar(leerFixture('fuzz-s5-4ta'));
  const esperado = MAIN['fuzz-s5-4ta'];
  assert(JSON.stringify(r.validas) === JSON.stringify(esperado.grupos), `zonas válidas distintas de main: ${JSON.stringify(r.validas)}`);
  assert(JSON.stringify(r.sinZona) === JSON.stringify(esperado.sinGrupo), `zona manual distinta de main: [${r.sinZona}]`);
}

/** 10 grupos de 4 parejas; dentro de cada grupo comparten un inicio y con el resto no comparten ninguno. */
function instanciaTope() {
  const parejas = [];
  for (let g = 0; g < 10; g++) {
    const slot = `Viernes-${String(18 + Math.floor(g / 4)).padStart(2, '0')}:${String((g % 4) * 15).padStart(2, '0')}`;
    for (let k = 0; k < 4; k++) parejas.push({ orden: g * 4 + k + 1, slots: [slot] });
  }
  return {
    club: { cantidadCanchas: 4, viernesInicio: '18:00', viernesFin: '02:00', sabadoInicio: '09:00', sabadoFin: '02:00', domingoInicio: '09:00', domingoFin: '22:00' },
    fecha: '2026-10-16',
    parejas,
  };
}

async function z6_tope() {
  const inst = instanciaTope();
  const n = inst.parejas.length;
  const config = zonaService.calcularConfigZonas(n);
  assert(config.join(',') === `4,${Array(12).fill(3).join(',')}`, `config inesperada: ${config}`);
  const matriz = zonaService.construirMatrizCompatibilidad(inst.parejas.map((p) => p.slots));

  const t0 = Date.now();
  const res = zonaService.armarGruposPorCompatibilidad(inst.parejas, config, matriz);
  const ms = Date.now() - t0;
  const rep = res.reparacion;
  assert(rep && rep.intentada, 'la reparación tenía que intentarse (el voraz deja parejas sin zona)');
  assert(rep.llegoAlTope === true, `la búsqueda tenía que llegar al tope (iteraciones: ${rep.iteraciones})`);
  assert(ms < 10000, `tardó ${ms} ms`);
  assert(res.sinGrupo.length <= rep.sinGrupoAntes, `quedó peor que el voraz: ${res.sinGrupo.length} > ${rep.sinGrupoAntes}`);
  // Óptimo de esta instancia: 1 zona de 4 + 9 de 3 (una por grupo), 9 sin zona.
  assert(res.sinGrupo.length === 9, `esperaba 9 sin zona, hay ${res.sinGrupo.length}`);

  // Armado válido: zonas disjuntas, tamaños dentro de config y parejas compatibles.
  const vistos = new Set();
  const usados = { 2: 0, 3: 0, 4: 0 };
  for (const g of res.grupos) {
    usados[g.length]++;
    for (const i of g) {
      assert(!vistos.has(i), `la pareja ${i} está en dos zonas`);
      vistos.add(i);
    }
  }
  for (const i of res.sinGrupo) assert(!vistos.has(i), `la pareja ${i} está en una zona y sin zona`);
  assert(vistos.size + res.sinGrupo.length === n, 'faltan parejas');
  for (const s of [2, 3, 4]) assert(usados[s] <= config.filter((x) => x === s).length, `demasiadas zonas de ${s}`);
  validarCompatibilidad(inst, res.grupos.map((g) => g.map((i) => inst.parejas[i].orden)));

  // Por el camino real también termina y deja 9 sin zona.
  const r = await armar(inst);
  assert(r.sinZona.length === 9, `iniciarCategoriaConDisponibilidad: esperaba 9 sin zona, hay ${r.sinZona.length}`);
}

async function run() {
  await ensureTestDb();
  resetTestDb();
  await limpiarDb();

  const allTests = [
    { nombre: 'Z1a: pareja sin slots, fixture mínimo', fn: z1a_fixtureMinimo },
    { nombre: 'Z1b: real-devdb-5ta, de 3 sin zona a 0', fn: z1b_realDevdb5ta },
    { nombre: 'Z1c: ninguna pareja con slots, error de siempre', fn: z1c_ningunaConSlots },
    { nombre: 'Z2: real-excel-7ma-damas, de 3 sin zona a 0', fn: z2_realExcel7maDamas },
    { nombre: 'Z3: fuzzchica-s120 (6 a 3) y s104 (2 a 0)', fn: z3_fuzzchica },
    { nombre: 'Z4: control, real-devdb-7ma y real-excel-5ta iguales a main', fn: z4_controlSinCambios },
    { nombre: 'Z5: control, fuzz-s5-4ta igual a main', fn: z5_controlSinMejora },
    { nombre: 'Z6: tope de la búsqueda', fn: z6_tope },
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
      await limpiarDb();
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
      console.error('Error fatal en test-armado-zonas-reparacion.js:', e);
      process.exit(1);
    });
}

module.exports = { run };
