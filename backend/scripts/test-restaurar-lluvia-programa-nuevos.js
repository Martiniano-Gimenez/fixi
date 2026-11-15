'use strict';

require('./utils/testEnvGuard');
const { ensureTestDb } = require('./utils/testEnvGuard');
const { resetTestDb } = require('./reset-test-db');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const prisma = require('../src/lib/prisma');
const { JWT_SECRET } = require('../src/config/env');
const { startTestServer } = require('./utils/testServer');
const zonas = require('../src/services/zona.service');
const organizadores = require('../src/services/organizador.service');
const overrides = require('../src/services/canchasOverrides.service');
const { getSlotsValidosSet } = require('../src/services/slots.service');
const { getDiaCalendarioConTrasnoche } = require('../src/utils/dateUtils');

const VIE = '2027-01-08', SAB = '2027-01-09', DOM = '2027-01-10';
const D = 75 * 60_000;
const fecha = (dia, hora) => new Date(`${dia}T${hora}:00-03:00`);
const conHorario = (p) => Boolean(p.fechaHora && p.canchaNumero && !p.sinHorarioAsignado);
let baseUrl, numero = 0;
async function http(ctx, method, ruta, body) {
  const r = await fetch(`${baseUrl}${ruta}`, { method, headers: { 'Content-Type': 'application/json',
    Authorization: `Bearer ${jwt.sign({ id: ctx.org.id }, JWT_SECRET, { expiresIn: '1h' })}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await r.json();
  assert.ok(r.status >= 200 && r.status < 300, `${r.status}: ${JSON.stringify(json)}`);
  return json;
}
const todos = (ctx) => prisma.partido.findMany({ where: { categoria: { torneoId: ctx.torneo.id } },
  include: { pareja1: { include: { slotsSeleccionados: true } }, pareja2: { include: { slotsSeleccionados: true } }, sets: true }, orderBy: { id: 'asc' } });
const lluvia = (ctx, dia) => http(ctx, 'POST', `/torneos/${ctx.torneo.id}/canchas-override`, { canchasDisponiblesOverride: 1, diaKey: dia });
const restaurar = (ctx, dia) => http(ctx, 'POST', `/torneos/${ctx.torneo.id}/canchas-override`, { canchasDisponiblesOverride: 3, ...(dia ? { diaKey: dia } : {}) });

async function escenario(dosDias = false, cantidadDestino = 2) {
  const org = await prisma.organizador.create({ data: { email: `restaurar-nuevos-${++numero}@example.com`, nombre: 'Club restauración', passwordHash: 'test', cantidadCanchas: 3,
    viernesInicio: '18:00', viernesFin: '23:00', sabadoInicio: '09:00', sabadoFin: '18:00', domingoInicio: '09:00', domingoFin: '23:00' } });
  const torneo = await prisma.torneo.create({ data: { organizadorId: org.id, nombre: 'Restauración', slug: `restaurar-nuevos-${numero}`, fecha: fecha(VIE, '12:00'), estado: 'EN_CURSO' } });
  const cat = await prisma.categoria.create({ data: { torneoId: torneo.id, nombre: '5ta', estado: 'EN_CURSO' } });
  const otra = await prisma.categoria.create({ data: { torneoId: torneo.id, nombre: '7ma', estado: 'EN_CURSO' } });
  const amplios = [...getSlotsValidosSet(org)];
  const viernes = amplios.filter((s) => s.startsWith('Viernes-'));
  let orden = 0;
  async function zona(categoriaId, nombre, cantidad, slots = amplios) {
    const z = await prisma.zona.create({ data: { categoriaId, nombre } });
    const parejas = [];
    for (let i = 0; i < cantidad; i++) {
      const p = await prisma.pareja.create({ data: { categoriaId, orden: ++orden, jugador1: `${nombre} ${i}`, jugador2: 'Pareja',
        slotsSeleccionados: { create: slots.map((slotId) => ({ slotId })) } } });
      parejas.push(p);
      await prisma.zonaPareja.create({ data: { zonaId: z.id, parejaId: p.id } });
    }
    await zonas.generarPartidosZonaHelper(prisma, categoriaId, z.id, 'ROUND_ROBIN', cantidad, parejas);
    const partidos = await prisma.partido.findMany({ where: { zonaId: z.id }, orderBy: { posicionEnRonda: 'asc' } });
    return { ...z, parejas, partidos };
  }
  const origen = await zona(cat.id, 'Zona A', 3, viernes);
  const destino = await zona(cat.id, 'Zona B', cantidadDestino, viernes);
  const fija = await zona(otra.id, 'Zona C', 3);
  const fija2 = await zona(otra.id, 'Zona D', 2);
  for (const [i, p] of [...fija.partidos, ...fija2.partidos].entries()) {
    await prisma.partido.update({ where: { id: p.id }, data: { estado: 'FINALIZADO', ganadorId: p.pareja1Id,
      fechaHora: new Date(+fecha(VIE, '18:00') + i * D), canchaNumero: 1, sinHorarioAsignado: false } });
  }
  for (const [i, p] of origen.partidos.entries()) await prisma.partido.update({ where: { id: p.id },
    data: { fechaHora: new Date(+fecha(VIE, '18:00') + i * D), canchaNumero: 2, sinHorarioAsignado: false } });
  for (const [i, p] of destino.partidos.entries()) await prisma.partido.update({ where: { id: p.id },
    data: { fechaHora: new Date(+fecha(VIE, '19:15') + i * D), canchaNumero: 3, sinHorarioAsignado: false } });
  const registrada = await zona(otra.id, 'Zona registrada', 2);
  await prisma.partido.update({ where: { id: registrada.partidos[0].id }, data: { fechaHora: fecha(VIE, '18:00'), canchaNumero: 3, sinHorarioAsignado: false } });
  if (dosDias) {
    for (let i = 0; i < 2; i++) {
      const z = await zona(otra.id, `Zona sábado ${i}`, 2);
      await prisma.partido.update({ where: { id: z.partidos[0].id }, data: { fechaHora: fecha(SAB, '14:00'), canchaNumero: i + 2, sinHorarioAsignado: false } });
    }
  }
  const fase = await prisma.faseEliminatoria.create({ data: { categoriaId: otra.id, nombre: 'Final', ronda: 2 } });
  await prisma.partido.create({ data: { categoriaId: otra.id, faseEliminatoriaId: fase.id, posicionEnRonda: 1,
    fechaHora: fecha(DOM, '19:00'), canchaNumero: 1, sinHorarioAsignado: false, horarioManual: true } });
  await prisma.partido.create({ data: { categoriaId: otra.id, faseEliminatoriaId: fase.id, posicionEnRonda: 2, sinHorarioAsignado: true } });
  const ctx = { org, torneo, cat, origen, destino, registrada, viernes, zona };
  const previa = await zona(cat.id, 'Zona previa sin horario', 2, viernes);
  ctx.sinHorarioPrevio = previa.partidos[0].id;
  await prisma.partido.update({ where: { id: ctx.sinHorarioPrevio }, data: { sinHorarioAsignado: true } });
  ctx.originales = new Map((await todos(ctx)).filter(conHorario).map((p) => [p.id, { fechaHora: p.fechaHora, canchaNumero: p.canchaNumero }]));
  await lluvia(ctx, VIE);
  if (dosDias) await lluvia(ctx, SAB);
  ctx.cuadro = (await todos(ctx)).filter((p) => p.faseEliminatoriaId);
  return ctx;
}

async function editar(ctx, operacion, restringido = false) {
  const antes = new Set((await todos(ctx)).map((p) => p.id));
  if (operacion === 'mover') {
    await http(ctx, 'POST', `/categorias/${ctx.cat.id}/zonas/mover-pareja`, {
      parejaId: ctx.origen.parejas[0].id, zonaOrigenId: ctx.origen.id, zonaDestinoId: ctx.destino.id,
    });
  } else {
    await http(ctx, 'POST', `/categorias/${ctx.cat.id}/zonas/agregar-pareja`, {
      zonaDestinoId: ctx.destino.id, jugador1: 'Nueva', jugador2: 'Pareja', slotIds: restringido ? ['Viernes-18:00'] : ctx.viernes,
    });
  }
  const nuevos = (await todos(ctx)).filter((p) => !antes.has(p.id));
  assert.equal(nuevos.length, operacion === 'mover' ? (ctx.destino.parejas.length === 3 ? 5 : 4) : (ctx.destino.parejas.length === 3 ? 4 : 3));
  assert.ok(nuevos.every((p) => !conHorario(p) && p.sinHorarioAsignado), 'Los nuevos no entran durante la lluvia');
  return new Set(nuevos.map((p) => p.id));
}

async function invariantes(ctx, nuevos) {
  const ps = await todos(ctx);
  assert.equal(ps.find((p) => p.id === ctx.sinHorarioPrevio).fechaHora, null, 'El pendiente sin horario anterior a la lluvia se conserva');
  assert.deepEqual(ps.filter((p) => p.faseEliminatoriaId), ctx.cuadro, 'La restauración nueva no modifica el cuadro');
  const agendados = ps.filter((p) => !p.esBye && conHorario(p));
  for (let i = 0; i < agendados.length; i++) {
    const p = agendados[i];
    const dia = getDiaCalendarioConTrasnoche(p.fechaHora, ctx.org).key;
    assert.ok(p.canchaNumero <= overrides.getCanchasDia(ctx.torneo.id, dia, 3).canchas);
    if (ctx.originales.has(p.id)) assert.ok(+p.fechaHora >= +ctx.originales.get(p.id).fechaHora, 'Nadie se adelanta al horario previo a la lluvia');
    for (const q of agendados.slice(i + 1)) if (+p.fechaHora < +q.fechaHora + D && +q.fechaHora < +p.fechaHora + D) {
      assert.notEqual(p.canchaNumero, q.canchaNumero, 'No hay canchas superpuestas');
      for (const id of [p.pareja1Id, p.pareja2Id].filter(Boolean)) assert.ok(id !== q.pareja1Id && id !== q.pareja2Id, 'No hay parejas superpuestas');
    }
    if (nuevos.has(p.id)) {
      const slot = `${dia === VIE ? 'Viernes' : 'Sabado'}-${String(p.fechaHora.getHours()).padStart(2, '0')}:${String(p.fechaHora.getMinutes()).padStart(2, '0')}`;
      for (const pareja of [p.pareja1, p.pareja2].filter(Boolean)) if (pareja.slotsSeleccionados.length) {
        assert.ok(pareja.slotsSeleccionados.some((s) => s.slotId === slot), 'Los nuevos respetan la disponibilidad');
      }
    }
  }
  return ps;
}

async function caso(operacion, restringido = false, cantidadDestino = 2) {
  const ctx = await escenario(false, cantidadDestino);
  const nuevos = await editar(ctx, operacion, restringido);
  await invariantes(ctx, nuevos);
  const antes = await todos(ctx);
  const respuesta = await restaurar(ctx, VIE);
  const despues = await invariantes(ctx, nuevos);
  const asignados = despues.filter((p) => nuevos.has(p.id) && conHorario(p));
  assert.equal(respuesta.reprogramacion.partidosNuevosProgramados, asignados.length);
  assert.equal(respuesta.reprogramacion.partidosNuevosSinHorario, nuevos.size - asignados.length);
  if (restringido) assert.ok(asignados.length < nuevos.size && respuesta.reprogramacion.partidosNuevosSinHorario > 0);
  else assert.equal(asignados.length, nuevos.size, 'Con las canchas restauradas todos los nuevos entran');
  assert.deepEqual(despues.map((p) => p.id), antes.map((p) => p.id), 'No se pierden partidos');
  const p = despues.find((p) => p.id === ctx.registrada.partidos[0].id);
  assert.equal(+p.fechaHora, +ctx.originales.get(p.id).fechaHora, 'El registrado vuelve exactamente a su horario previo');
  assert.equal(p.canchaNumero, ctx.originales.get(p.id).canchaNumero);
  for (const original of antes.filter((p) => conHorario(p) && !ctx.originales.has(p.id))) {
    assert.deepEqual(despues.find((p) => p.id === original.id), original, 'No se mueve ningún otro partido');
  }
  const segunda = await restaurar(ctx, VIE);
  assert.equal(segunda.reprogramacion.ejecutada, false, 'Restaurar sin lluvia previa sigue siendo una operación vacía');
  assert.deepEqual(await todos(ctx), despues);
  console.log(`PASS ${operacion}, restringido=${restringido}, destino=${cantidadDestino}: ${asignados.length} nuevos programados, ${nuevos.size - asignados.length} sin lugar; registro previo y cuadro conservados`);
}

async function dosLluvias(orden, editarEntreLluvias = false) {
  const ctx = await escenario(!editarEntreLluvias);
  const nuevos = await editar(ctx, 'mover');
  if (editarEntreLluvias) await lluvia(ctx, SAB);
  await invariantes(ctx, nuevos);
  const ids = (await todos(ctx)).map((p) => p.id);
  for (const dia of orden) {
    const antes = await todos(ctx);
    const respuesta = await restaurar(ctx, dia);
    const despues = await invariantes(ctx, nuevos);
    assert.deepEqual(despues.map((p) => p.id), ids);
    if (dia === SAB) {
      assert.equal(respuesta.reprogramacion.partidosNuevosProgramados, 0, 'Los nuevos solo tienen disponibilidad el viernes');
      assert.ok(despues.filter((p) => nuevos.has(p.id)).every((p) => !conHorario(p)) || orden[0] === VIE);
    }
    for (const p of antes.filter((p) => nuevos.has(p.id) && conHorario(p))) assert.deepEqual(despues.find((q) => q.id === p.id), p);
  }
  assert.ok((await todos(ctx)).filter((p) => nuevos.has(p.id)).every(conHorario));
  assert.equal(await prisma.overrideCanchasDia.count({ where: { torneoId: ctx.torneo.id } }), 0);
  console.log(`PASS dos lluvias restauradas en orden ${orden.filter(Boolean).join(' → ') || 'global'}, edición entre lluvias=${editarEntreLluvias}; sin solapes ni adelantos`);
}

async function run() {
  await ensureTestDb();
  resetTestDb();
  const { server, baseUrl: url } = await startTestServer();
  baseUrl = url;
  try {
    await caso('mover');
    await caso('agregar');
    await caso('agregar', true);
    await caso('agregar', false, 3); // MINI_BRACKET: P3/P4 reutilizan las dependencias del asignador.
    await dosLluvias([VIE, SAB]);
    await dosLluvias([SAB, VIE]);
    await dosLluvias([SAB, VIE], true);
    await dosLluvias([undefined]); // Restaurar todas las jornadas en una sola transacción.

    const ctx = await escenario();
    const z = await ctx.zona(ctx.cat.id, 'Zona sin horario deliberado', 2, ctx.viernes);
    const m = await ctx.zona(ctx.cat.id, 'Zona manual sin horario', 2, ctx.viernes);
    await prisma.partido.update({ where: { id: m.partidos[0].id }, data: { horarioManual: true, sinHorarioAsignado: true } });
    const manualAntes = await prisma.partido.findUnique({ where: { id: m.partidos[0].id } });
    const nuevos = new Set([z.partidos[0].id]);
    const respuesta = await restaurar(ctx, VIE);
    assert.equal(respuesta.reprogramacion.partidosNuevosProgramados, 1, 'No hay una marca para distinguir el pendiente no manual dejado sin horario a propósito');
    assert.deepEqual(await prisma.partido.findUnique({ where: { id: m.partidos[0].id } }), manualAntes, 'horarioManual excluye el partido de la asignación');
    await invariantes(ctx, nuevos);

    const rollback = await escenario();
    await editar(rollback, 'mover');
    const antes = await todos(rollback);
    const cacheAntes = structuredClone(overrides.getOverridesTorneo(rollback.torneo.id));
    const transaccion = prisma.$transaction;
    prisma.$transaction = (fn, opciones) => transaccion.call(prisma, async (tx) => { await fn(tx); throw new Error('Rollback restauración nuevos'); }, opciones);
    try {
      await assert.rejects(() => organizadores.reprogramarPorReduccionCanchas(rollback.org.id, rollback.torneo.id, 3, null, VIE), /Rollback restauración nuevos/);
    } finally { prisma.$transaction = transaccion; }
    assert.deepEqual(await todos(rollback), antes);
    assert.deepEqual(overrides.getOverridesTorneo(rollback.torneo.id), cacheAntes, 'La caché solo cambia después del commit');
    assert.equal(await prisma.overrideCanchasDia.count({ where: { torneoId: rollback.torneo.id } }), 1);
    console.log('PASS sin marca de intención, exclusión manual y rollback completo de horarios, overrides y caché');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
  }
}
run().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
