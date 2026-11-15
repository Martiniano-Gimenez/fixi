'use strict';

require('./utils/testEnvGuard');
const { ensureTestDb } = require('./utils/testEnvGuard');
const { resetTestDb } = require('./reset-test-db');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const prisma = require('../src/lib/prisma');
const { JWT_SECRET } = require('../src/config/env');
const { startTestServer } = require('./utils/testServer');
const fase = require('../src/services/faseEliminatoria.service');
const partido = require('../src/services/partido.service');
const zonaService = require('../src/services/zona.service');

let baseUrl;
const marcador = (contra = 4) => ({ sets: [1, 2].map(() => ({ gamesPareja1: 6, gamesPareja2: contra })) });
const SIMPLE = marcador(0);

async function http(f, method, ruta, body, token = f.token) {
  const r = await fetch(`${baseUrl}${ruta}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
}

async function fixture({ jugar = true, dos = false, clasifican = 2 } = {}) {
  const clave = randomUUID();
  const org = await prisma.organizador.create({ data: { nombre: 'Club desempate', email: `${clave}@test.local`, passwordHash: 'x', cantidadCanchas: 2,
    viernesInicio: '15:00', viernesFin: '23:00', sabadoInicio: '09:00', sabadoFin: '23:00', domingoInicio: '09:00', domingoFin: '23:00' } });
  const torneo = await prisma.torneo.create({ data: { organizadorId: org.id, nombre: 'Empate exacto', slug: clave, fecha: new Date('2026-11-20T15:00:00Z'), estado: 'EN_CURSO' } });
  const cat = await prisma.categoria.create({ data: { torneoId: torneo.id, nombre: '6ta', estado: 'EN_CURSO' } });
  const parejas = [];
  for (const [i, nombre] of ['A', 'B', 'C'].entries()) {
    parejas.push(await prisma.pareja.create({ data: { categoriaId: cat.id, orden: i + 1, jugador1: nombre, jugador2: `${nombre}2`, telefono: '3515551234', indicaciones: 'privado' } }));
  }
  const zona = await prisma.zona.create({ data: { categoriaId: cat.id, nombre: 'Zona A', formato: 'ROUND_ROBIN', clasifican } });
  await prisma.zonaPareja.createMany({ data: parejas.map(p => ({ zonaId: zona.id, parejaId: p.id })) });
  const partidos = [];
  for (const [i, [a, b]] of [[0, 1], [1, 2], [2, 0]].entries()) {
    partidos.push(await prisma.partido.create({ data: { categoriaId: cat.id, zonaId: zona.id, posicionEnRonda: i + 1,
      pareja1Id: parejas[a].id, pareja2Id: parejas[b].id, fechaHora: new Date(`2026-11-20T${15 + i * 2}:00:00Z`), canchaNumero: 1 } }));
  }
  await fase.generarEliminatoria(org.id, cat.id);
  const f = { org, torneo, cat, zona, parejas, partidos, token: jwt.sign({ id: org.id, email: org.email }, JWT_SECRET, { expiresIn: '1h' }) };
  if (jugar) for (const [i, p] of partidos.entries()) await partido.cargarResultado(org.id, p.id, marcador(dos ? [3, 4, 2][i] : 4));
  return f;
}

const ruta = f => `/categorias/${f.cat.id}/zonas/${f.zona.id}/desempate`;
const ids = f => f.parejas.map(p => p.id);
async function tabla(f) {
  const zonas = await zonaService.getZonasByCategoria(f.org.id, f.cat.id);
  return zonas.find(z => z.id === f.zona.id);
}
async function snapshot(f) {
  return {
    partidos: await prisma.partido.findMany({ where: { categoriaId: f.cat.id }, include: { sets: { orderBy: { numero: 'asc' } } }, orderBy: { id: 'asc' } }),
    tabla: await prisma.zonaPareja.findMany({ where: { zonaId: f.zona.id }, orderBy: { parejaId: 'asc' } }),
    cat: await prisma.categoria.findUnique({ where: { id: f.cat.id } }),
    torneo: await prisma.torneo.findUnique({ where: { id: f.torneo.id } }),
  };
}
async function rechaza(f, method, path, body, status = 400, token) {
  const antes = await snapshot(f);
  const r = await http(f, method, path, body, token);
  assert.equal(r.status, status, JSON.stringify(r.json));
  assert.equal(typeof r.json.error, 'string');
  assert.deepEqual(await snapshot(f), antes, 'Un rechazo no cambia tabla, resultados, cuadro ni estados');
  return r;
}

async function dosEmpatadas() {
  const f = await fixture({ dos: true });
  const z = await tabla(f);
  const [a, b, c] = ids(f);
  assert.deepEqual(z.zonaParejas.map(zp => zp.parejaId), [c, a, b]);
  assert.deepEqual(z.empatePendiente, []);
  assert.equal(z.zonaParejas[1].gf < z.zonaParejas[2].gf, true, 'Games a favor no es un criterio extra');
  const fin = (await snapshot(f)).partidos.find(p => p.faseEliminatoriaId);
  assert.deepEqual([fin.pareja1Id, fin.pareja2Id].sort(), [c, a].sort());
  // La regla no depende del orden de entrada ni de los identificadores.
  assert.deepEqual(fase.ordenarZonaParejas([...z.zonaParejas].reverse(), z.formato, z.partidos).map(zp => zp.parejaId), [c, a, b]);
  await rechaza(f, 'PUT', ruta(f), { orden: [a, b] });
}

async function tripleYLecturas() {
  const f = await fixture({ clasifican: 3 });
  const z = await tabla(f);
  assert.deepEqual(new Set(z.empatePendiente), new Set(ids(f)));
  const actual = await snapshot(f);
  assert.equal(actual.cat.estado, 'EN_CURSO');
  assert.equal(actual.torneo.estado, 'EN_CURSO');
  for (const p of actual.partidos.filter(p => p.faseEliminatoriaId)) {
    assert.equal(p.pareja1Id, null); assert.equal(p.pareja2Id, null); assert.equal(p.ganadorId, null);
  }
  assert.equal(actual.partidos.find(p => p.esBye).estado, 'PENDIENTE');
  const privado = await http(f, 'GET', `/categorias/${f.cat.id}/zonas`);
  assert.deepEqual(new Set(privado.json[0].empatePendiente), new Set(ids(f)));
  const publico = await http(f, 'GET', `/public/${f.torneo.slug}`);
  const zonaPublica = publico.json.categorias[0].zonas[0];
  assert.deepEqual(new Set(zonaPublica.empatePendiente), new Set(ids(f)));
  assert.deepEqual(Object.keys(zonaPublica).sort(), ['id', 'nombre', 'formato', 'clasifican', 'empatePendiente', 'tabla', 'partidos'].sort());
  assert.equal(JSON.stringify(publico.json).includes('3515551234'), false);
  assert.equal(JSON.stringify(publico.json).includes('privado'), false);
  // También debe funcionar al crear el cuadro después de completadas las zonas.
  await fase.borrarEliminatoria(f.org.id, f.cat.id);
  await fase.generarEliminatoria(f.org.id, f.cat.id);
  for (const p of (await snapshot(f)).partidos.filter(p => p.faseEliminatoriaId)) {
    assert.equal(p.pareja1Id, null); assert.equal(p.pareja2Id, null);
    assert.equal(p.estado, 'PENDIENTE');
  }
}

async function manualValido() {
  const f = await fixture();
  const orden = ids(f).reverse();
  const antes = await snapshot(f);
  const transaction = prisma.$transaction;
  prisma.$transaction = (fn, ...args) => transaction.call(prisma, async tx => { await fn(tx); throw new Error('Rollback desempate'); }, ...args);
  try { await assert.rejects(() => zonaService.resolverDesempateZona(f.org.id, f.cat.id, f.zona.id, orden), /Rollback desempate/); }
  finally { prisma.$transaction = transaction; }
  assert.deepEqual(await snapshot(f), antes);
  const r = await http(f, 'PUT', ruta(f), { orden });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json, { message: 'Desempate guardado.', zonaId: f.zona.id, orden, empatePendiente: [] });
  const z = await tabla(f);
  assert.deepEqual(z.empatePendiente, []);
  assert.deepEqual(z.zonaParejas.map(zp => zp.parejaId), orden);
  const fin = (await snapshot(f)).partidos.find(p => p.faseEliminatoriaId);
  assert.deepEqual([fin.pareja1Id, fin.pareja2Id].sort(), orden.slice(0, 2).sort());
  const publico = (await http(f, 'GET', `/public/${f.torneo.slug}`)).json.categorias[0].zonas[0];
  assert.deepEqual(publico.empatePendiente, []);
  assert.deepEqual(publico.tabla.map(zp => zp.parejaId), orden);
  assert.ok(publico.tabla.every(zp => zp.posicion === 0), 'No se expone la marca interna del orden manual');
  await rechaza(f, 'PUT', ruta(f), { orden });
}

async function validaciones() {
  const f = await fixture();
  for (const orden of [[], ids(f).slice(0, 2), [...ids(f), randomUUID()], [ids(f)[0], ids(f)[0], ids(f)[2]],
    [ids(f)[0], ids(f)[1], randomUUID()], null, 'abc', [1, 2, 3]]) {
    await rechaza(f, 'PUT', ruta(f), { orden });
  }
  await rechaza(f, 'PUT', ruta(f), {});
  const ajeno = await fixture();
  await rechaza(f, 'PUT', ruta(f), { orden: ids(f) }, 403, ajeno.token);
  await rechaza(f, 'PUT', `/categorias/${f.cat.id}/zonas/${ajeno.zona.id}/desempate`, { orden: ids(f) });
  const sinTerminar = await fixture({ jugar: false });
  assert.deepEqual((await tabla(sinTerminar)).empatePendiente, []);
  await rechaza(sinTerminar, 'PUT', ruta(sinTerminar), { orden: ids(sinTerminar) });
  await prisma.torneo.update({ where: { id: f.torneo.id }, data: { estado: 'FINALIZADO' } });
  await rechaza(f, 'PUT', ruta(f), { orden: ids(f) });
}

async function invalidarManual() {
  for (const camino of ['corregir', 'borrar', 'parcial', 'limpiar']) {
    const f = await fixture();
    assert.equal((await http(f, 'PUT', ruta(f), { orden: ids(f).reverse() })).status, 200);
    if (camino === 'limpiar') await zonaService.limpiarResultadosZonas(f.org.id, f.cat.id);
    else if (camino === 'borrar') await partido.borrarResultado(f.org.id, f.partidos[0].id);
    else await partido.cargarResultado(f.org.id, f.partidos[0].id, camino === 'parcial' ? { sets: marcador().sets.slice(0, 1) } : marcador());
    assert.ok((await snapshot(f)).tabla.every(zp => zp.posicion === 0));
    const z = await tabla(f);
    assert.equal(z.empatePendiente.length, camino === 'corregir' ? 3 : 0);
    for (const p of (await snapshot(f)).partidos.filter(p => p.faseEliminatoriaId)) {
      assert.equal(p.pareja1Id, null); assert.equal(p.pareja2Id, null);
    }
  }
}

async function cuadroProtegido() {
  for (const estado of ['EN_CURSO', 'FINALIZADO']) {
    const f = await fixture();
    await http(f, 'PUT', ruta(f), { orden: ids(f).reverse() });
    const fin = (await snapshot(f)).partidos.find(p => p.faseEliminatoriaId);
    if (estado === 'EN_CURSO') await partido.updateEstado(f.org.id, fin.id, estado);
    else await partido.cargarResultado(f.org.id, fin.id, SIMPLE);
    const r = await rechaza(f, 'PUT', `/partidos/${f.partidos[0].id}/resultado`, marcador());
    assert.match(r.json.error, /clasificación.*final/);
    assert.match(r.json.error, estado === 'EN_CURSO' ? /Volvelo a pendiente/ : /Borrá primero/);
  }
  // Resolver un empate tampoco puede reemplazar participantes de un cuadro jugado histórico.
  const f = await fixture();
  const fin = (await snapshot(f)).partidos.find(p => p.faseEliminatoriaId);
  await prisma.partido.update({ where: { id: fin.id }, data: { pareja1Id: ids(f)[0], pareja2Id: ids(f)[1], estado: 'EN_CURSO' } });
  await rechaza(f, 'PUT', ruta(f), { orden: ids(f).reverse() });
}

async function miniSinCambios() {
  const filas = [1, 2, 3, 4].map(posicion => ({ parejaId: `mini${posicion}`, posicion, puntos: 3, pg: 1, sf: 2, sc: 2, gf: 12, gc: 12 }));
  const r = fase.resolverPosicionesZona([...filas].reverse(), 'MINI_BRACKET', []);
  assert.deepEqual(r.ordenadas, filas); assert.deepEqual(r.empatePendiente, []);
}

async function run() {
  await ensureTestDb();
  resetTestDb();
  const { server, baseUrl: url } = await startTestServer();
  baseUrl = url;
  try {
    for (const prueba of [dosEmpatadas, tripleYLecturas, manualValido, validaciones, invalidarManual, cuadroProtegido, miniSinCambios]) {
      await prueba();
      console.log(`PASS ${prueba.name}`);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    await prisma.$disconnect();
  }
}
run().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
