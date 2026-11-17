'use strict';

require('./utils/testEnvGuard');
const { ensureTestDb } = require('./utils/testEnvGuard');
const { resetTestDb } = require('./reset-test-db');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const prisma = require('../src/lib/prisma');
const partidos = require('../src/services/partido.service');
const { JWT_SECRET } = require('../src/config/env');
const { startTestServer } = require('./utils/testServer');

let baseUrl, numero = 0;
async function escenario(ronda = 8, vacio = false) {
  const org = await prisma.organizador.create({ data: { nombre: 'Club cruces', email: `cruces-${++numero}@example.com`, passwordHash: 'test' } });
  const torneo = await prisma.torneo.create({ data: { organizadorId: org.id, nombre: 'Cruces', slug: `cruces-${numero}`,
    fecha: new Date('2027-01-08T12:00:00-03:00'), estado: 'EN_CURSO' } });
  const categoria = await prisma.categoria.create({ data: { torneoId: torneo.id, nombre: '5ta', estado: 'EN_CURSO',
    parejas: { create: Array.from({ length: ronda }, (_, i) => ({ orden: i + 1, jugador1: `Pareja ${i + 1}`, jugador2: 'Cruce' })) },
  }, include: { parejas: { orderBy: { orden: 'asc' } } } });
  const fases = [];
  for (let r = ronda; r >= 2; r /= 2) {
    const fase = await prisma.faseEliminatoria.create({ data: { categoriaId: categoria.id, ronda: r, nombre: `Ronda ${r}` } });
    const ps = [];
    for (let pos = 1; pos <= r / 2; pos++) {
      const primero = r === ronda;
      const i = 2 * (pos - 1);
      const origen = (indice) => `${indice % 2 + 1}° Zona ${String.fromCharCode(65 + Math.floor(indice / 2))}`;
      ps.push(await prisma.partido.create({ data: { categoriaId: categoria.id, faseEliminatoriaId: fase.id, posicionEnRonda: pos,
        pareja1Id: primero ? categoria.parejas[i].id : null,
        pareja2Id: primero && !(vacio && pos === 1) ? categoria.parejas[i + 1].id : null,
        origenPareja1: primero ? origen(i) : `Ganador Partido #${2 * pos - 1}`,
        origenPareja2: primero ? vacio && pos === 1 ? null : origen(i + 1) : `Ganador Partido #${2 * pos}`,
      } }));
    }
    fases.push({ ...fase, partidos: ps });
  }
  return { org, torneo, categoria, fases, primero: fases[0].partidos[0], otro: fases[0].partidos[1] };
}
const foto = async (ctx) => ({
  categoria: await prisma.categoria.findUnique({ where: { id: ctx.categoria.id } }),
  torneo: await prisma.torneo.findUnique({ where: { id: ctx.torneo.id } }),
  partidos: await prisma.partido.findMany({ where: { categoriaId: ctx.categoria.id }, include: { sets: { orderBy: { numero: 'asc' } } }, orderBy: { id: 'asc' } }),
});
async function http(ctx, id, data, ruta = 'bracket', method = 'PATCH') {
  const response = await fetch(`${baseUrl}/partidos/${id}/${ruta}`, { method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ id: ctx.org.id }, JWT_SECRET, { expiresIn: '1h' })}` },
    body: JSON.stringify(data) });
  return { status: response.status, body: await response.json() };
}
async function rechazarSinCambios(ctx, id, data, mensaje) {
  const antes = await foto(ctx);
  const r = await http(ctx, id, data);
  assert.equal(r.status, 400, JSON.stringify(r.body));
  if (mensaje) assert.equal(r.body.error, mensaje);
  assert.deepEqual(await foto(ctx), antes, 'El rechazo no escribe parejas, orígenes, sets ni estados');
}

async function intercambioYPropagacion(ronda) {
  const ctx = await escenario(ronda);
  const origenes = (ps) => ps.flatMap((p) => [p.origenPareja1, p.origenPareja2]).filter(Boolean).sort();
  const r = await http(ctx, ctx.primero.id, { origenPareja1: ctx.otro.origenPareja2, liberarEnOtros: true });
  assert.equal(r.status, 200);
  const primera = await prisma.partido.findMany({ where: { faseEliminatoriaId: ctx.fases[0].id }, orderBy: { posicionEnRonda: 'asc' } });
  assert.deepEqual(origenes(primera), origenes(ctx.fases[0].partidos));
  assert.equal(primera[0].pareja1Id, ctx.otro.pareja2Id);
  assert.equal(primera[1].pareja2Id, ctx.primero.pareja1Id);
  assert.equal(primera[1].origenPareja2, ctx.primero.origenPareja1);
  for (const p of primera) {
    const resultado = await http(ctx, p.id, { sets: [{ gamesPareja1: 6, gamesPareja2: 0 }, { gamesPareja1: 6, gamesPareja2: 0 }] }, 'resultado', 'PUT');
    assert.equal(resultado.status, 200, JSON.stringify(resultado.body));
  }
  const siguiente = await prisma.partido.findMany({ where: { faseEliminatoriaId: ctx.fases[1].id }, orderBy: { posicionEnRonda: 'asc' } });
  for (const p of primera) {
    const destino = siguiente.find((q) => q.posicionEnRonda === Math.ceil(p.posicionEnRonda / 2));
    assert.equal(destino[p.posicionEnRonda % 2 ? 'pareja1Id' : 'pareja2Id'], p.pareja1Id, 'Cada ganador llega al lugar derivado de su partido anterior');
  }
  console.log(`PASS primera ronda ${ronda}: intercambio, parejas con su origen y propagación completa de ganadores`);
}

async function run() {
  await ensureTestDb();
  resetTestDb();
  const { server, baseUrl: url } = await startTestServer();
  baseUrl = url;
  try {
    const ctx = await escenario();
    await rechazarSinCambios(ctx, ctx.fases[1].partidos[0].id, { origenPareja1: ctx.fases[1].partidos[1].origenPareja1, liberarEnOtros: true }, 'Solo se pueden editar los cruces de la primera ronda.');
    for (const origenPareja1 of ['9° Zona Z', 'Texto cualquiera']) {
      await rechazarSinCambios(ctx, ctx.primero.id, { origenPareja1 }, 'Ese origen no está en esta ronda.');
    }
    await rechazarSinCambios(ctx, ctx.primero.id, { origenPareja1: null }, 'Cada clasificado tiene que seguir en el cuadro.');
    await rechazarSinCambios(ctx, ctx.primero.id, { origenPareja1: ctx.otro.origenPareja1 }); // Sin liberarEnOtros.
    await rechazarSinCambios(ctx, ctx.primero.id, { origenPareja1: ctx.primero.origenPareja2 });
    for (const estado of ['EN_CURSO', 'FINALIZADO']) {
      await prisma.partido.update({ where: { id: ctx.otro.id }, data: { estado } });
      await rechazarSinCambios(ctx, ctx.otro.id, { origenPareja1: ctx.primero.origenPareja1, liberarEnOtros: true });
      await rechazarSinCambios(ctx, ctx.primero.id, { origenPareja1: ctx.otro.origenPareja1, liberarEnOtros: true });
    }
    await prisma.partido.update({ where: { id: ctx.otro.id }, data: { estado: 'PENDIENTE', esBye: true } });
    await rechazarSinCambios(ctx, ctx.otro.id, { origenPareja1: ctx.primero.origenPareja1, liberarEnOtros: true });
    await rechazarSinCambios(ctx, ctx.primero.id, { origenPareja1: ctx.otro.origenPareja1, liberarEnOtros: true });
    console.log('PASS segunda ronda, origen inventado, vaciado, liberarEnOtros, mismo origen, estados y BYE: 400 sin cambios');

    const duplicado = await escenario();
    await prisma.partido.update({ where: { id: duplicado.fases[0].partidos[2].id }, data: { origenPareja1: duplicado.otro.origenPareja1 } });
    await rechazarSinCambios(duplicado, duplicado.primero.id, { origenPareja1: duplicado.otro.origenPareja1, liberarEnOtros: true });

    const vacio = await escenario(8, true);
    const r = await http(vacio, vacio.primero.id, { origenPareja2: vacio.otro.origenPareja1, liberarEnOtros: true });
    assert.equal(r.status, 200);
    const despues = await foto(vacio);
    assert.equal(despues.partidos.find((p) => p.id === vacio.primero.id).pareja2Id, vacio.otro.pareja1Id);
    assert.equal(despues.partidos.find((p) => p.id === vacio.otro.id).origenPareja1, null);
    assert.equal(despues.partidos.find((p) => p.id === vacio.otro.id).pareja1Id, null);
    assert.deepEqual(new Set(despues.partidos.filter((p) => p.faseEliminatoriaId === vacio.fases[0].id).flatMap((p) => [p.origenPareja1, p.origenPareja2]).filter(Boolean)),
      new Set(vacio.fases[0].partidos.flatMap((p) => [p.origenPareja1, p.origenPareja2]).filter(Boolean)));
    console.log('PASS mover a un lugar vacío conserva todos los orígenes y mueve su pareja');

    const rollback = await escenario();
    const antes = await foto(rollback);
    const transaccion = prisma.$transaction;
    prisma.$transaction = (fn, opciones) => transaccion.call(prisma, async (tx) => { await fn(tx); throw new Error('Rollback de cruce'); }, opciones);
    try { await assert.rejects(() => partidos.updateBracketMatch(rollback.org.id, rollback.primero.id,
      { origenPareja1: rollback.otro.origenPareja1, liberarEnOtros: true }), /Rollback de cruce/); }
    finally { prisma.$transaction = transaccion; }
    assert.deepEqual(await foto(rollback), antes);
    await intercambioYPropagacion(8);
    await intercambioYPropagacion(32);
  } finally { await new Promise((resolve) => server.close(resolve)); await prisma.$disconnect(); }
}
run().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
