'use strict';
const { ensureTestDb } = require('./utils/testEnvGuard');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const prisma = require('../src/lib/prisma');
const svc = require('../src/services/organizador.service');
const { guardarPlan, comprobarRevision } = require('../src/services/precheckPlan.service');

async function caso(nombre, slots = [[], []]) {
  const org = await prisma.organizador.create({ data: { nombre, email: `${nombre}@persistencia.test`, passwordHash: 'test',
    cantidadCanchas: 2, viernesInicio: '09:00', viernesFin: '23:00', sabadoInicio: '09:00', sabadoFin: '23:00' } });
  const torneo = await prisma.torneo.create({ data: { nombre, slug: nombre, organizadorId: org.id, fecha: new Date('2026-11-06T15:00:00Z') } });
  const cat = await prisma.categoria.create({ data: { torneoId: torneo.id, nombre: 'Prueba' } });
  for (const [i, s] of slots.entries()) await prisma.pareja.create({ data: { categoriaId: cat.id, orden: i + 1,
    jugador1: `Pareja ${i}`, jugador2: nombre, slotsSeleccionados: { create: s.map((slotId) => ({ slotId })) } } });
  return { org, torneo, cat };
}
const pre = (c, opts) => svc.preCheckInicioTorneo(c.org.id, c.torneo.id, opts);
const fila = (c) => prisma.precheckPlan.findUnique({ where: { torneoId: c.torneo.id } });
const sesion = (c) => svc.preCheckSessions.get(c.torneo.id);
async function main() {
  await ensureTestDb();
  const c = await caso('reinicio');
  await pre(c);
  const original = structuredClone(sesion(c).categoriasPlan);
  const nuevoProceso = spawnSync(process.execPath, ['-e', `
    require('./scripts/utils/testEnvGuard');
    const s = require('./src/services/organizador.service');
    if (s.preCheckSessions.size) process.exit(2);
    s.preCheckInicioTorneo(${JSON.stringify(c.org.id)}, ${JSON.stringify(c.torneo.id)})
      .then(() => { console.log('PLAN:' + JSON.stringify(s.preCheckSessions.get(${JSON.stringify(c.torneo.id)}).categoriasPlan)); process.exit(0); })
      .catch(e => { console.error(e); process.exit(1); });
  `], { cwd: path.resolve(__dirname, '..'), env: process.env, encoding: 'utf8' });
  assert.equal(nuevoProceso.status, 0, nuevoProceso.stderr);
  assert.equal(nuevoProceso.stdout.split('PLAN:')[1].trim(), JSON.stringify(original), 'Otro proceso recupera el mismo plan');
  svc.preCheckSessions.clear(); svc.planesCache.clear();
  await pre(c);
  assert.deepEqual(sesion(c).categoriasPlan, original, 'Reinicio: mismo armado y horarios');
  sesion(c).expiresAt = 0;
  await pre(c);
  assert.deepEqual(sesion(c).categoriasPlan, original, 'TTL solo descarta cache');
  // El inicio también funciona sin ninguna sesión ni plan cacheado.
  const planGuardado = (await fila(c)).contenido.plan;
  svc.preCheckSessions.clear(); svc.planesCache.clear();
  const transaccionOriginal = prisma.$transaction.bind(prisma);
  prisma.$transaction = (fn, opts) => transaccionOriginal(async (tx) => {
    tx.partido.create = async () => { throw new Error('fallo inicio'); };
    return fn(tx);
  }, opts);
  try { await assert.rejects(svc.iniciarTorneoMultiCategoria(c.org.id, c.torneo.id, planGuardado.planId), /fallo inicio/); }
  finally { prisma.$transaction = transaccionOriginal; }
  assert.ok(await fila(c)); assert.equal(await prisma.zona.count({ where: { categoriaId: c.cat.id } }), 0);
  await svc.iniciarTorneoMultiCategoria(c.org.id, c.torneo.id, planGuardado.planId);
  assert.equal(await fila(c), null);
  const zonas = await prisma.zona.findMany({ where: { categoriaId: c.cat.id }, include: { zonaParejas: true, partidos: true } });
  for (const z of original[0].zonas) {
    const real = zonas.find((v) => v.nombre === z.nombre);
    assert.deepEqual(real.zonaParejas.map((p) => p.parejaId).sort(), [...z.parejaIds].sort());
    for (const p of z.partidos) {
      const realP = real.partidos.find((v) => v.posicionEnRonda === p.posicionEnRonda);
      assert.equal(+realP.fechaHora, +p.fechaHora); assert.equal(realP.canchaNumero, p.canchaNumero);
      assert.equal(realP.sinHorarioAsignado, p.sinHorarioAsignado);
    }
  }
  const n = await caso('nomina'); await pre(n);
  const guardada = await fila(n);
  await prisma.pareja.create({ data: { categoriaId: n.cat.id, orden: 3, jugador1: 'Nueva', jugador2: 'Pareja' } });
  assert.equal((await pre(n)).nominaCambio, true);
  assert.deepEqual(await fila(n), guardada, 'No se toca el plan por cambio de nomina');
  await pre(n, { forceReset: true });
  assert.notEqual((await fila(n)).nomina, guardada.nomina);
  const t = await caso('rollback'); await pre(t);
  const antes = await fila(t), memoria = structuredClone(sesion(t).categoriasPlan);
  const transaction = prisma.$transaction.bind(prisma);
  prisma.$transaction = (fn, opts) => transaction(async (tx) => {
    const create = tx.precheckPlan.updateMany.bind(tx.precheckPlan);
    tx.precheckPlan.updateMany = async (q) => { await create(q); throw new Error('rollback persistencia'); };
    return fn(tx);
  }, opts);
  try { await assert.rejects(pre(t, { forceReset: true }), /rollback persistencia/); }
  finally { prisma.$transaction = transaction; }
  assert.deepEqual(await fila(t), antes); assert.deepEqual(sesion(t).categoriasPlan, memoria);
  // Dos escritores que leyeron la misma revisión: solo el primero puede guardar.
  const revision = sesion(t).guardadoRevision;
  const [uno, dos] = await Promise.allSettled([
    prisma.$transaction(async (tx) => guardarPlan(tx, sesion(t), antes.firma)),
    (async () => { await new Promise((r) => setTimeout(r, 100)); return prisma.$transaction((tx) => comprobarRevision(tx, t.torneo.id, revision)); })(),
  ]);
  assert.equal(uno.status, 'fulfilled'); assert.equal(dos.status, 'rejected');
  assert.equal(dos.reason.statusCode, 409);
  const resultados = await Promise.all([pre(t), pre(t)]);
  assert.ok(resultados.every((r) => r.planId));
  // Una propuesta y sus disponibilidades se guardan en la misma transacción.
  const f = await caso('fijacion-atomica', [['Viernes-09:00'], ['Viernes-12:00']]);
  let pf = await pre(f); const z = sesion(f).categoriasPlan[0].zonas[0];
  const consulta = { categoriaId: f.cat.id, zonaId: z.id, posicionEnRonda: 1, revision: pf.revision };
  const opciones = await svc.getOpcionesPartidoZona(f.org.id, f.torneo.id, consulta);
  const opcion = opciones.opciones.find((o) => o.estado !== 'NO_DISPONIBLE');
  const fija = { ...consulta, clave: opcion.clave };
  const slotsAntes = await prisma.slotPareja.count(), durableAntes = await fila(f);
  prisma.$transaction = (fn, opts) => transaction(async (tx) => {
    tx.precheckPlan.updateMany = async () => { throw new Error('fallo durable'); };
    return fn(tx);
  }, opts);
  try { await assert.rejects(svc.fijarPartidoZona(f.org.id, f.torneo.id, fija), /fallo durable/); }
  finally { prisma.$transaction = transaction; }
  assert.equal(await prisma.slotPareja.count(), slotsAntes); assert.deepEqual(await fila(f), durableAntes);
  pf = await svc.fijarPartidoZona(f.org.id, f.torneo.id, fija);
  const fixed = structuredClone(sesion(f).categoriasPlan);
  svc.preCheckSessions.clear(); svc.planesCache.clear();
  await pre(f);
  assert.deepEqual(sesion(f).categoriasPlan, fixed); assert.equal(sesion(f).categoriasPlan[0].zonas[0].partidos[0].fijadoManual, true);
  console.log('PASS: reinicio, TTL, nomina, rollback, CAS concurrente, fijacion atomica y plan guardado = iniciado');
}
main().then(async () => { await prisma.$disconnect(); process.exit(0); }).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
