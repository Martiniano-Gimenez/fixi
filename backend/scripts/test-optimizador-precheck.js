'use strict';

/**
 * test-optimizador-precheck.js
 * Optimizador conjunto de zonas y horarios del pre-check (utils/optimizadorPrecheck.js + services/optimizadorPrecheck.service.js).
 *
 * A   Puro, contra fuerza bruta: en instancias chicas (6 parejas, grilla corta, 1-2 canchas) el optimizador llega al
 *     mismo mínimo de partidos sin horario que la enumeración completa de particiones y horarios, y el plan pasa el
 *     verificador independiente.
 * B   Zona de 4 (MINI_BRACKET): P3 y P4 después de P1 y P2, con 1 cancha quedan en cuatro turnos seguidos.
 * C   Capacidad: los partidos externos restan canchas; el verificador detecta cancha excedida, pareja doble,
 *     disponibilidad y P3/P4 antes de tiempo; asignarCanchas respeta externos en canchas concretas.
 * D   Un par sin ningún inicio común queda en zona (cuenta como sin horario), no en la zona manual.
 * E   Determinismo (mismas entradas, misma salida, también con las parejas en otro orden de llegada) y "nunca peor":
 *     si la base ya es óptima no cambia nada.
 * F   Integración con el pre-check (test.db): sin optimizador = armado de siempre; si el optimizador falla, devuelve
 *     un plan inválido, empata o no mejora, queda el armado de siempre; si mejora estrictamente, se adopta y queda
 *     guardado en PrecheckPlan; un re-check posterior no mueve nada.
 * H   Una categoría sin disponibilidad (sorteo) no apaga el optimizador: se optimiza la otra sin pisar sus canchas.
 * G   Un solo cálculo por torneo a la vez: dos "volver a armar" simultáneos comparten el resultado (un solo worker);
 *     pedidos distintos del mismo torneo corren de a uno; el worker que no responde se descarta.
 */

process.env.FIXI_OPTIMIZADOR = '1';
const { ensureTestDb } = require('./utils/testEnvGuard');
process.env.FIXI_OPTIMIZADOR = '1';
const assert = require('node:assert/strict');
const loadHighs = require('highs');
const { optimizar, validarSolucion, asignarCanchas, partidosDe, pk, qk } = require('../src/utils/optimizadorPrecheck');

// ---------------------------------------------------------------- A: generador y fuerza bruta
function prng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Instancia chica donde todo par tiene algún inicio común. */
function instancia(seed, { n = 6, G = 8, canchas = 1 } = {}) {
  const r = prng(seed);
  for (;;) {
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    const dominio = new Map(ids.map((id) => [id, Array.from({ length: G }, (_, i) => i).filter(() => r() < 0.6)]));
    const ok = ids.every((a, i) => ids.slice(i + 1).every((b) => dominio.get(a).some((x) => dominio.get(b).includes(x))));
    if (ok) return { ids, dominio, G, canchas };
  }
}
const config = (n) => { const z = Math.floor(n / 3); const c = Array(z).fill(3); if (n % 3 === 1) c[0] = 4; else if (n % 3 === 2) c.push(2); return c; };
function entradaDe(inst, extra = {}) {
  // Inicios consecutivos a 1 tick (15 min): los partidos de 5 ticks se pisan entre inicios vecinos.
  const grid = Array.from({ length: inst.G }, (_, i) => 100 + i);
  const base = extra.base || { zonas: [], sched: [] };
  return {
    canchas: inst.canchas, gridTick: grid, gridMs: grid.map((t) => t * 900000), uso: extra.uso || [], externosPorCancha: extra.externosPorCancha || [],
    categorias: [{ key: 'c', parejas: inst.ids.map((id, i) => ({ id, orden: i + 1, dominio: inst.dominio.get(id) })), config: config(inst.ids.length) }],
    base, semilla: 1, presupuestoMs: 20000, maxIteraciones: 400, estancamiento: 60, tiempoPorVueltaMs: 10000, ...extra.opciones,
  };
}
/** Mínimo de partidos sin horario por enumeración completa (particiones de tamaños fijos x horarios). */
function fuerzaBruta(inst) {
  const sizes = config(inst.ids.length).sort((a, b) => b - a);
  const particiones = [];
  (function rec(libres, k, acc) {
    if (k === sizes.length) { particiones.push(acc); return; }
    const [p0, ...resto] = libres;
    (function elegir(desde, cur) {
      if (cur.length === sizes[k] - 1) { rec(libres.filter((x) => x !== p0 && !cur.includes(x)), k + 1, [...acc, [p0, ...cur]]); return; }
      for (let i = desde; i < resto.length; i++) elegir(i + 1, [...cur, resto[i]]);
    })(0, []);
  })(inst.ids, 0, []);
  let mejor = Infinity;
  for (const part of particiones) {
    const partidos = [];
    for (const z of part) {
      if (z.length === 4) throw new Error('fuerza bruta sin zonas de 4');
      for (let a = 0; a < z.length; a++) for (let b = a + 1; b < z.length; b++) partidos.push([z[a], z[b]]);
    }
    const dom = partidos.map(([a, b]) => inst.dominio.get(a).filter((x) => inst.dominio.get(b).includes(x)));
    const usoTick = new Map(); const usoPar = new Map();
    let ag = 0;
    (function dfs(i, sinHorario) {
      if (sinHorario >= mejor) return;
      if (i === partidos.length) { mejor = sinHorario; return; }
      for (const s of dom[i]) {
        const ticks = [0, 1, 2, 3, 4].map((k) => s + k);
        if (ticks.some((t) => (usoTick.get(t) || 0) >= inst.canchas)) continue;
        if (partidos[i].some((p) => ticks.some((t) => usoPar.get(`${p}@${t}`)))) continue;
        ticks.forEach((t) => usoTick.set(t, (usoTick.get(t) || 0) + 1));
        partidos[i].forEach((p) => ticks.forEach((t) => usoPar.set(`${p}@${t}`, 1)));
        dfs(i + 1, sinHorario);
        ticks.forEach((t) => usoTick.set(t, usoTick.get(t) - 1));
        partidos[i].forEach((p) => ticks.forEach((t) => usoPar.delete(`${p}@${t}`)));
      }
      dfs(i + 1, sinHorario + 1);
      ag++;
    })(0, 0);
    void ag;
  }
  return mejor;
}
/** Base arbitraria: zonas por orden de llegada y nada agendado. */
function baseVacia(inst) {
  const zonas = []; let k = 0;
  for (const s of config(inst.ids.length).sort((a, b) => b - a)) { zonas.push({ catKey: 'c', ids: inst.ids.slice(k, k + s) }); k += s; }
  return { zonas, sched: [] };
}
const validar = (entrada, res) => validarSolucion({
  zonas: res.zonas, sched: new Map(res.horarios.map(([k, i]) => [k, i])),
  dominio: new Map(entrada.categorias[0].parejas.map((p) => [p.id, p.dominio])), gridTick: entrada.gridTick,
  canchas: entrada.canchas, uso: new Map(entrada.uso), config: { c: entrada.categorias[0].config },
});

async function main() {
  const highs = await loadHighs();

  // ---------------------------------------------------------------- A
  let casos = 0; let mejoradas = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const inst = instancia(seed, { n: seed % 2 ? 6 : 5, G: 8, canchas: 1 + (seed % 2) });
    const entrada = entradaDe(inst, { base: baseVacia(inst) });
    const res = await optimizar(entrada, { highs });
    assert.deepEqual(validar(entrada, res), [], `A${seed}: el plan debe pasar el verificador`);
    assert.deepEqual(res.errores, [], `A${seed}: sin errores`);
    assert.equal(res.sinGrupo.length, 0, `A${seed}: sin zona manual`);
    const opt = fuerzaBruta(inst);
    assert.equal(res.metricas.final.sinHorario, opt, `A${seed}: mismo mínimo que la fuerza bruta (${opt})`);
    casos++; if (res.metricas.final.sinHorario < res.metricas.inicial.sinHorario) mejoradas++;
  }
  assert.ok(mejoradas >= 6, `A: la base vacía se mejora en la mayoría de los casos (${mejoradas}/${casos})`);
  console.log(`✅ A: ${casos} instancias iguales a la fuerza bruta (${mejoradas} mejoradas desde la base vacía)`);

  // ---------------------------------------------------------------- B: zona de 4
  {
    const inst = { ids: ['a', 'b', 'c', 'd'], G: 24, canchas: 1, dominio: new Map() };
    for (const id of inst.ids) inst.dominio.set(id, Array.from({ length: 24 }, (_, i) => i));
    const entrada = entradaDe(inst, { base: { zonas: [{ catKey: 'c', ids: ['a', 'b', 'c', 'd'] }], sched: [] } });
    const res = await optimizar(entrada, { highs });
    assert.deepEqual(validar(entrada, res), []);
    assert.equal(res.metricas.final.sinHorario, 0, 'B: los 4 partidos entran con 1 cancha');
    const h = new Map(res.horarios.map(([k, i]) => [k, i]));
    const z = res.zonas[0]; const [p1, p2, p3, p4] = partidosDe({ ids: z.ids });
    const ini = (p) => entrada.gridTick[h.get(p.key)];
    assert.ok(ini(p3) >= ini(p1) + 5 && ini(p3) >= ini(p2) + 5, 'B: P3 después de P1 y P2');
    assert.ok(ini(p4) >= ini(p1) + 5 && ini(p4) >= ini(p2) + 5, 'B: P4 después de P1 y P2');
    assert.equal(new Set([p1, p2, p3, p4].map(ini)).size, 4, 'B: con 1 cancha cada partido tiene su turno');
    // con 2 canchas P1/P2 y P3/P4 pueden coincidir de a pares
    const entrada2 = entradaDe({ ...inst, canchas: 2, G: 12 }, { base: { zonas: [{ catKey: 'c', ids: ['a', 'b', 'c', 'd'] }], sched: [] } });
    const res2 = await optimizar(entrada2, { highs });
    assert.deepEqual(validar(entrada2, res2), []);
    assert.equal(res2.metricas.final.sinHorario, 0);
    // P3/P4 solo donde las 4 parejas pueden: si una pareja no puede en los inicios tardíos, no hay lugar para P3/P4
    const inst3 = { ids: ['a', 'b', 'c', 'd'], G: 12, canchas: 2, dominio: new Map([['a', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]], ['b', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]], ['c', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]], ['d', [0, 1, 2, 3, 4, 5]]]) };
    const entrada3 = entradaDe(inst3, { base: { zonas: [{ catKey: 'c', ids: ['a', 'b', 'c', 'd'] }], sched: [] } });
    const res3 = await optimizar(entrada3, { highs });
    assert.deepEqual(validar(entrada3, res3), []);
    const h3 = new Map(res3.horarios.map(([k, i]) => [k, i]));
    for (const pos of [3, 4]) {
      const i = h3.get(qk(res3.zonas[0].ids, pos));
      if (i !== undefined) assert.ok(inst3.dominio.get('d').includes(i), `B: P${pos} solo en inicios de la cuarta pareja`);
    }
    console.log('✅ B: zona de 4 con P3/P4 después de P1/P2 y dentro de la intersección de las 4 parejas');
  }

  // ---------------------------------------------------------------- C: capacidad, externos y verificador
  {
    const inst = instancia(3, { n: 3, G: 8, canchas: 2 });
    const uso = [];
    for (let t = 100; t < 108; t++) uso.push([t, 1]); // un externo ocupa una cancha toda la grilla
    const entrada = entradaDe({ ...inst, canchas: 2 }, { uso, base: { zonas: [{ catKey: 'c', ids: inst.ids }], sched: [] }, externosPorCancha: [{ cancha: 1, tick: 100 }, { cancha: 1, tick: 105 }] });
    const res = await optimizar(entrada, { highs });
    assert.deepEqual(validar(entrada, res), []);
    // con 1 cancha libre nunca hay dos partidos a la vez
    const ocupacion = new Map();
    for (const [, i] of res.horarios) for (let k = 0; k < 5; k++) ocupacion.set(entrada.gridTick[i] + k, (ocupacion.get(entrada.gridTick[i] + k) || 0) + 1);
    assert.ok([...ocupacion.values()].every((n) => n <= 1), 'C: los externos restan canchas');
    assert.ok(res.horarios.every(([, , cancha]) => cancha === 2), 'C: los partidos nuevos van a la cancha que dejan libre los externos');
    // verificador: cancha excedida, pareja doble, disponibilidad, P3 antes de P1
    const dominio = new Map([['a', [0, 1, 2, 3, 4, 5]], ['b', [0, 1, 2, 3, 4, 5]], ['c', [0, 1, 2, 3, 4, 5]], ['d', [0, 1, 2, 3, 4, 5]]]);
    const gridTick = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111];
    const zonas = [{ catKey: 'x', ids: ['a', 'b', 'c'] }];
    const k1 = pk('a', 'b'); const k2 = pk('a', 'c'); const k3 = pk('b', 'c');
    assert.deepEqual(validarSolucion({ zonas, sched: new Map([[k1, 0], [k2, 5], [k3, 10]]), dominio, gridTick, canchas: 1 }).filter((e) => !/fuera de disponibilidad/.test(e)), [], 'verificador: plan válido');
    assert.ok(validarSolucion({ zonas, sched: new Map([[k1, 0], [k2, 1]]), dominio, gridTick, canchas: 2 }).some((e) => /pareja doble/.test(e)), 'verificador: pareja doble');
    assert.ok(validarSolucion({ zonas, sched: new Map([[k1, 0], [k3, 1]]), dominio, gridTick, canchas: 1 }).some((e) => /canchas excedidas/.test(e)), 'verificador: canchas excedidas');
    assert.ok(validarSolucion({ zonas, sched: new Map([[k1, 8]]), dominio, gridTick, canchas: 1 }).some((e) => /fuera de disponibilidad/.test(e)), 'verificador: fuera de disponibilidad');
    const z4 = [{ catKey: 'x', ids: ['a', 'b', 'c', 'd'] }];
    assert.ok(validarSolucion({ zonas: z4, sched: new Map([[pk('a', 'b'), 0], [pk('c', 'd'), 0], [qk(['a', 'b', 'c', 'd'], 3), 2]]), dominio, gridTick, canchas: 3 }).some((e) => /antes de terminar/.test(e)), 'verificador: P3 antes de terminar P1/P2');
    // asignarCanchas: primera cancha libre y externos en canchas concretas
    const { canchas: cs } = asignarCanchas({ sched: new Map([['m1', 0], ['m2', 1]]), gridTick, canchas: 3, externosPorCancha: [{ cancha: 1, tick: 100 }] });
    assert.equal(cs.get('m1'), 2, 'asignarCanchas: la cancha 1 está tomada por un externo');
    assert.equal(cs.get('m2'), 3);
    const { sinCancha } = asignarCanchas({ sched: new Map([['m1', 0]]), gridTick, canchas: 1, externosPorCancha: [{ cancha: 1, tick: 100 }] });
    assert.deepEqual(sinCancha, ['m1'], 'asignarCanchas: sin cancha queda afuera');
    console.log('✅ C: externos, verificador y asignación de canchas');
  }

  // ---------------------------------------------------------------- D: par imposible
  {
    const inst = { ids: ['a', 'b', 'c'], G: 8, canchas: 1, dominio: new Map([['a', [0, 1, 2, 3]], ['b', [0, 1, 2, 3]], ['c', [5, 6, 7]]]) };
    const entrada = entradaDe(inst, { base: { zonas: [], sched: [] } });
    const res = await optimizar(entrada, { highs });
    assert.deepEqual(validar(entrada, res), []);
    assert.equal(res.zonas.length, 1, 'D: las tres parejas quedan en una zona');
    assert.equal(res.sinGrupo.length, 0, 'D: sin zona manual');
    assert.equal(res.metricas.final.sinHorario, 2, 'D: los dos partidos de c no tienen inicio común');
    console.log('✅ D: el par sin inicio común queda en la zona y cuenta como sin horario');
  }

  // ---------------------------------------------------------------- E: determinismo y nunca peor
  {
    const inst = instancia(7, { n: 6, G: 8, canchas: 1 });
    const e1 = entradaDe(inst, { base: baseVacia(inst) });
    const r1 = await optimizar(structuredClone(e1), { highs });
    const r2 = await optimizar(structuredClone(e1), { highs });
    const sin = (r) => JSON.stringify({ z: r.zonas, h: r.horarios, s: r.sinGrupo });
    assert.equal(sin(r1), sin(r2), 'E: mismas entradas, misma salida');
    const e3 = structuredClone(e1);
    e3.categorias[0].parejas.reverse(); // otro orden de llegada de las parejas (mismo orden de inscripción)
    const r3 = await optimizar(e3, { highs });
    assert.equal(sin(r3), sin(r1), 'E: el orden de llegada no cambia el resultado');
    const optimo = { zonas: r1.zonas, sched: r1.horarios.map(([k, i]) => [k, i]) };
    const r4 = await optimizar(entradaDe(inst, { base: optimo }), { highs });
    assert.equal(r4.metricas.final.sinHorario, r1.metricas.final.sinHorario, 'E: desde la base óptima no empeora');
    assert.ok(r4.metricas.final.sinHorario <= r4.metricas.inicial.sinHorario);
    console.log('✅ E: determinista y nunca peor que la base');
  }

  // ---------------------------------------------------------------- F y G: integración con el pre-check
  await ensureTestDb();
  require('./reset-test-db').resetTestDb();
  const prisma = require('../src/lib/prisma');
  const svc = require('../src/services/organizador.service');
  const opt = require('../src/services/optimizadorPrecheck.service');
  const { parseFechaLocal } = require('../src/utils/dateUtils');
  const fs = require('node:fs');
  const path = require('node:path');
  opt.config.presupuestoMs = 2500; opt.config.estancamiento = 40;
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'armado-zonas', 'real-excel-7ma-damas.json'), 'utf8'));
  let n = 0;
  async function torneoDe(inst) {
    n++;
    const org = await prisma.organizador.create({ data: { email: `opt-${n}@test.com`, nombre: `Club opt ${n}`, passwordHash: 'x', ...inst.club } });
    const torneo = await prisma.torneo.create({ data: { nombre: `Opt ${n}`, slug: `opt-${n}`, fecha: parseFechaLocal(inst.fecha), estado: 'BORRADOR', organizadorId: org.id } });
    const cat = await prisma.categoria.create({ data: { torneoId: torneo.id, nombre: 'Cat', estado: 'BORRADOR' } });
    await prisma.pareja.createMany({ data: inst.parejas.map((p) => ({ categoriaId: cat.id, jugador1: `P${p.orden}A`, jugador2: `P${p.orden}B`, orden: p.orden })) });
    const creadas = await prisma.pareja.findMany({ where: { categoriaId: cat.id } });
    const porOrden = new Map(creadas.map((c) => [c.orden, c.id]));
    const rows = inst.parejas.flatMap((p) => p.slots.map((s) => ({ parejaId: porOrden.get(p.orden), slotId: s })));
    if (rows.length) await prisma.slotPareja.createMany({ data: rows });
    return { org, torneo, cat };
  }
  const pre = (c, o) => svc.preCheckInicioTorneo(c.org.id, c.torneo.id, o);
  const sesion = (c) => svc.preCheckSessions.get(c.torneo.id);
  const firma = (c) => sesion(c).categoriasPlan.flatMap((cp) => cp.zonas.map((z) => JSON.stringify({
    n: z.nombre, m: [...z.parejaIds].sort(), r: z.requiereArmadoManual,
    p: z.partidos.map((p) => [p.posicionEnRonda, p.pareja1Id, p.pareja2Id, p.fechaHora && +new Date(p.fechaHora), p.canchaNumero, p.sinHorarioAsignado]),
  })));
  const metrica = (c) => opt.metricaPlan(sesion(c).categoriasPlan);

  // F1: sin optimizador = armado de siempre; con optimizador, nunca peor y el plan guardado coincide con la sesión
  const t1 = await torneoDe(fixture);
  await pre(t1, { forceReset: true, optimizar: false });
  const sinOpt = firma(t1); const mSin = metrica(t1);
  assert.equal(sesion(t1).optimizacion.intentada, false, 'F1: optimizar:false no intenta');
  await pre(t1, { forceReset: true });
  const mCon = metrica(t1);
  assert.ok(mCon.manual < mSin.manual || (mCon.manual === mSin.manual && mCon.sinHorario <= mSin.sinHorario), 'F1: nunca peor que el armado de siempre');
  const o1 = sesion(t1).optimizacion;
  if (mSin.manual === 0 && mSin.sinHorario === 0) assert.equal(o1.intentada, false, 'F1: sin pendientes no se optimiza');
  if (!o1.aplicada) assert.deepEqual(firma(t1), sinOpt, 'F1: si no se adopta, queda el armado de siempre');
  const fila = await prisma.precheckPlan.findUnique({ where: { torneoId: t1.torneo.id } });
  assert.equal(fila.contenido.categoriasPlan.reduce((a, c) => a + c.zonas.length, 0), sesion(t1).categoriasPlan.reduce((a, c) => a + c.zonas.length, 0), 'F1: el plan guardado es el de la sesión');
  const antes = firma(t1);
  await pre(t1, { isReCheck: true });
  assert.deepEqual(firma(t1), antes, 'F1: un re-check no mueve nada');
  console.log(`✅ F1: sin optimizador ${JSON.stringify(mSin)} -> con optimizador ${JSON.stringify(mCon)} (adoptado: ${o1.aplicada})`);

  // F1b: todas las instancias del benchmark del armado: nunca peor, plan válido y, si se adopta, mejora estricta
  let adoptadas = 0;
  for (const id of ['real-devdb-5ta', 'real-devdb-7ma', 'real-excel-5ta', 'fuzzchica-s120-4ta', 'fuzzchica-s104-4ta', 'fuzz-s5-4ta']) {
    const inst_ = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'armado-zonas', `${id}.json`), 'utf8'));
    const t = await torneoDe(inst_);
    await pre(t, { forceReset: true, optimizar: false });
    const antes_ = metrica(t);
    await pre(t, { forceReset: true });
    const despues_ = metrica(t);
    assert.ok(despues_.manual < antes_.manual || (despues_.manual === antes_.manual && despues_.sinHorario <= antes_.sinHorario), `F1b ${id}: nunca peor`);
    if (sesion(t).optimizacion.aplicada) {
      adoptadas++;
      assert.ok(despues_.manual < antes_.manual || despues_.sinHorario < antes_.sinHorario, `F1b ${id}: si se adopta, mejora estrictamente`);
    }
    console.log(`   ${id}: ${JSON.stringify(antes_)} -> ${JSON.stringify(despues_)}`);
  }
  console.log(`✅ F1b: ${adoptadas} de 6 instancias del benchmark mejoradas, ninguna empeorada`);

  // F2: fallbacks y reglas de reemplazo, con el optimizador simulado
  const original = opt.ejecutar;
  const t2 = await torneoDe(fixture);
  await pre(t2, { forceReset: true, optimizar: false });
  const base2 = firma(t2); const m2 = metrica(t2);
  try {
    opt.ejecutar = async () => null;
    await pre(t2, { forceReset: true });
    assert.deepEqual(firma(t2), base2, 'F2: si el optimizador no responde queda el armado de siempre');
    opt.ejecutar = async () => { throw new Error('se rompió'); };
    await pre(t2, { forceReset: true });
    assert.deepEqual(firma(t2), base2, 'F2: si el optimizador falla queda el armado de siempre');
    opt.ejecutar = async (id, entrada) => ({ ...(await original(id, { ...entrada, maxIteraciones: 0 })), errores: ['plan inválido'] });
    await pre(t2, { forceReset: true });
    assert.deepEqual(firma(t2), base2, 'F2: un plan inválido se descarta');
    opt.ejecutar = (id, entrada) => original(id, { ...entrada, maxIteraciones: 0 }); // devuelve la base: empate
    await pre(t2, { forceReset: true });
    if (m2.manual > 0 || m2.sinHorario > 0) {
      assert.equal(sesion(t2).optimizacion.intentada, true);
      assert.equal(sesion(t2).optimizacion.aplicada, false, 'F2: un empate no reemplaza al armado de siempre');
      assert.deepEqual(firma(t2), base2);
    }
  } finally { opt.ejecutar = original; }
  console.log('✅ F2: nulo, error, plan inválido y empate dejan el armado de siempre');

  // G: un solo cálculo por torneo a la vez
  const t3 = await torneoDe(fixture);
  await pre(t3, { forceReset: true, optimizar: false });
  const necesita = metrica(t3).manual > 0 || metrica(t3).sinHorario > 0;
  const lanzados0 = opt.estadisticas.lanzados;
  const [a, b] = await Promise.all([pre(t3, { forceReset: true }), pre(t3, { forceReset: true })]);
  assert.equal(a.bloqueado, b.bloqueado);
  assert.equal(opt.estadisticas.lanzados - lanzados0, necesita ? 1 : 0, 'G: dos "volver a armar" simultáneos lanzan un solo worker');
  // un pre-check común mientras corre un "volver a armar" espera y no lanza otro worker
  const lanzados1 = opt.estadisticas.lanzados;
  await Promise.all([pre(t3, { forceReset: true }), pre(t3, { isReCheck: true }), pre(t3)]);
  assert.equal(opt.estadisticas.lanzados - lanzados1, necesita ? 1 : 0, 'G: los pre-checks comunes esperan, sin worker propio');
  // el candado del optimizador: entradas idénticas comparten promesa; distintas corren de a una
  const inst = instancia(5, { n: 6, G: 8, canchas: 1 });
  const e = entradaDe(inst, { base: baseVacia(inst), opciones: { presupuestoMs: 3000 } });
  const l0 = opt.estadisticas.lanzados;
  const [x, y] = await Promise.all([opt.ejecutar('T-candado', e), opt.ejecutar('T-candado', structuredClone(e))]);
  assert.equal(opt.estadisticas.lanzados - l0, 1, 'G: entradas idénticas comparten el resultado');
  assert.deepEqual(x, y);
  const l1 = opt.estadisticas.lanzados; opt.estadisticas.maxActivos = 0;
  const e2 = { ...structuredClone(e), semilla: 2 };
  const r = await Promise.all([opt.ejecutar('T-candado', e), opt.ejecutar('T-candado', e2), opt.ejecutar('T-candado', { ...e, semilla: 3 })]);
  assert.equal(opt.estadisticas.lanzados - l1, 3, 'G: pedidos distintos del mismo torneo corren uno después del otro');
  assert.equal(opt.estadisticas.maxActivos, 1, 'G: nunca hay dos workers a la vez para un torneo');
  assert.ok(r.every((v) => v && v.errores.length === 0));
  // worker que no responde: se lo descarta y devuelve null
  const limite = opt.config.limiteDuroMs; opt.config.limiteDuroMs = 50;
  try { assert.equal(await opt.ejecutar('T-lento', { ...e, presupuestoMs: 20000, maxIteraciones: 100000, estancamiento: 100000, base: baseVacia(inst) }), null); }
  finally { opt.config.limiteDuroMs = limite; }
  console.log('✅ G: un solo cálculo por torneo a la vez');

  // H: una categoría sin disponibilidad (sorteo) no apaga el optimizador: la otra se optimiza, la del sorteo queda con
  // el armado de siempre y sus partidos ocupan canchas (nada se pisa)
  {
    const inst = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'armado-zonas', 'fuzzchica-s120-4ta.json'), 'utf8'));
    const t = await torneoDe(inst);
    const sorteo = await prisma.categoria.create({ data: { torneoId: t.torneo.id, nombre: 'Sorteo', estado: 'BORRADOR' } });
    await prisma.pareja.createMany({ data: [1, 2, 3, 4, 5, 6].map((o) => ({ categoriaId: sorteo.id, jugador1: `S${o}A`, jugador2: `S${o}B`, orden: o })) });
    const originalEjecutar = opt.ejecutar; const originalFijo = opt.armadoDesdePlan;
    let entradaVista = null; let planFijoVisto = null;
    opt.ejecutar = (id, entrada) => { entradaVista = entrada; return originalEjecutar(id, entrada); };
    opt.armadoDesdePlan = (planFijo) => { planFijoVisto = structuredClone(planFijo); return originalFijo(planFijo); };
    try { await pre(t, { forceReset: true }); } finally { opt.ejecutar = originalEjecutar; opt.armadoDesdePlan = originalFijo; }
    const o = sesion(t).optimizacion;
    assert.equal(o.intentada, true, 'H: el optimizador corre aunque haya una categoría por sorteo');
    assert.deepEqual(entradaVista.categorias.map((c) => c.key), [t.cat.id], 'H: solo se optimiza la categoría con disponibilidad');
    assert.equal(o.aplicada, true, 'H: la categoría con conflictos mejora');
    const plan = sesion(t).categoriasPlan;
    const resumen = (c) => c.zonas.map((z) => [z.nombre, [...z.parejaIds].sort(), z.partidos.map((p) => [p.posicionEnRonda, p.pareja1Id, p.pareja2Id, p.fechaHora && +new Date(p.fechaHora), p.canchaNumero])]);
    assert.ok(planFijoVisto && planFijoVisto.length === 1 && planFijoVisto[0].categoriaId === sorteo.id);
    assert.deepEqual(resumen(plan.find((c) => c.categoriaId === sorteo.id)), resumen(planFijoVisto[0]), 'H: la categoría por sorteo queda con el armado de siempre');
    // los partidos del sorteo ya agendados entran como ocupación
    const ticksSorteo = planFijoVisto[0].zonas.flatMap((z) => z.partidos.filter((p) => p.fechaHora && !p.sinHorarioAsignado)).length;
    assert.ok(ticksSorteo > 0 && entradaVista.externosPorCancha.length >= ticksSorteo, 'H: sus partidos cuentan como ocupación de canchas');
    // nada se pisa: ni canchas ni parejas en todo el torneo
    const intervalos = plan.flatMap((c) => c.zonas.flatMap((z) => z.partidos.filter((p) => p.fechaHora && !p.sinHorarioAsignado)
      .map((p) => ({ s: +new Date(p.fechaHora), cancha: p.canchaNumero }))));
    for (let i = 0; i < intervalos.length; i++) for (let j = i + 1; j < intervalos.length; j++) {
      const a = intervalos[i]; const b = intervalos[j];
      assert.ok(a.cancha !== b.cancha || a.s + 75 * 60000 <= b.s || b.s + 75 * 60000 <= a.s, 'H: dos partidos en la misma cancha a la vez');
    }
    console.log(`✅ H: con una categoría por sorteo se optimiza la otra (${JSON.stringify(o.base)} -> ${JSON.stringify(o.final)}) sin pisar canchas`);
  }

  await prisma.$disconnect();
  console.log('\n🎉 test-optimizador-precheck: OK');
}

main().then(() => process.exit(0)).catch((err) => { console.error('❌', err); process.exit(1); });
