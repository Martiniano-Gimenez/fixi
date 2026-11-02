'use strict';

const { ensureTestDb } = require('./utils/testEnvGuard');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const prisma = require('../src/lib/prisma');
const { JWT_SECRET } = require('../src/config/env');
const { startTestServer } = require('./utils/testServer');
const svc = require('../src/services/organizador.service');
const { generarPropuestasZona, minutosFuera, compararCosto } = require('../src/utils/propuestasZona');
const { verificarProgramacionZona } = require('../src/utils/programacionZona');
const { fusionarSlotsEnVentanas, slotIdToMsWindow } = require('../src/services/zona.service');
const { generarSlotsDia } = require('../src/services/slots.service');
const FECHA = new Date('2026-11-06T15:00:00Z');
const viernes = (a, b) => generarSlotsDia('Viernes', a, b);
const sabado = (a, b) => generarSlotsDia('Sabado', a, b);
const ventana = (slotId) => ({ slotId, ...slotIdToMsWindow(slotId, FECHA) });

function entrada(slots, { formato = 'ROUND_ROBIN', club = viernes('09:00', '23:00'), canchas = 2 } = {}) {
  const parejas = slots.map((s, i) => ({ id: `id-${i}`, orden: i + 1, ventanas: fusionarSlotsEnVentanas(s, FECHA) }));
  const cruces = [];
  if (formato === 'MINI_BRACKET') cruces.push([0, 1], [2, 3], [null, null], [null, null]);
  else for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) cruces.push([i, j]);
  return { formato, parejas, grilla: club.map(ventana), ventanasClub: fusionarSlotsEnVentanas(club, FECHA), cantidadCanchas: canchas,
    partidos: cruces.map(([a, b], i) => ({ posicionEnRonda: i + 1, pareja1Id: parejas[a]?.id, pareja2Id: parejas[b]?.id, sinHorarioAsignado: true })) };
}
function verificarPropuestas(e, resultado) {
  assert.ok(resultado.propuestas.length <= 3);
  const firmas = new Set();
  for (const p of resultado.propuestas) {
    assert.ok(p.cambios.length >= 1 && p.cambios.length <= 2);
    const firma = JSON.stringify(p.cambios);
    assert.ok(!firmas.has(firma)); firmas.add(firma);
    let minutos = 0;
    const parejas = e.parejas.map((par) => {
      const nuevos = p.cambios.find((c) => c.parejaId === par.id)?.slotsToAdd || [];
      const ws = nuevos.map((s) => { assert.ok(e.grilla.some((g) => g.slotId === s)); return ventana(s); });
      minutos += minutosFuera(ws, par.ventanas);
      return { ...par, ventanas: [...par.ventanas, ...ws] };
    });
    assert.equal(p.minutosAgregados, minutos);
    assert.equal(verificarProgramacionZona({ ...e, parejas, partidos: e.partidos.map((q, i) => ({
      ...q, ...p.partidosPropuestos[i], sinHorarioAsignado: false,
    })) }).estado, 'FACTIBLE');
  }
}
function testGenerador() {
  assert.equal(minutosFuera([ventana('Viernes-10:00'), ventana('Viernes-10:15')], [ventana('Viernes-09:00')]), 75);
  assert.ok(compararCosto({ parejas: 1, minutos: 150, horas: [10] }, { parejas: 2, minutos: 15, horas: [1, 2] }) < 0);
  assert.ok(compararCosto({ parejas: 1, minutos: 15, horas: [10] }, { parejas: 1, minutos: 30, horas: [1] }) < 0);
  const orden = entrada([viernes('09:00', '10:30'), ['Viernes-11:30']], { club: viernes('09:00', '14:00') });
  const rOrden = generarPropuestasZona(orden);
  verificarPropuestas(orden, rOrden);
  assert.deepEqual(rOrden.propuestas.map((p) => p.cambios[0].parejaId), ['id-1', 'id-1', 'id-0'], 'Menor disponibilidad original antes que clave natural');

  const aislada = entrada([viernes('18:00', '23:00'), viernes('18:00', '23:00'), ['Sabado-09:00']], { club: viernes('18:00', '23:00') });
  const r = generarPropuestasZona(aislada);
  verificarPropuestas(aislada, r);
  assert.ok(r.propuestas.some((p) => p.cambios.length === 1 && p.cambios[0].parejaId === 'id-2' && p.cambios[0].slotsToAdd.length === 2), 'La aislada necesita dos inicios distintos');
  assert.deepEqual(generarPropuestasZona(aislada), r, 'Dos corridas idénticas');
  const permutado = structuredClone(aislada), ids = new Map(permutado.parejas.map((p, i) => [p.id, `uuid-${3 - i}`]));
  permutado.parejas = permutado.parejas.reverse().map((p) => ({ ...p, id: ids.get(p.id) }));
  permutado.partidos = permutado.partidos.reverse().map((p) => ({ ...p, pareja1Id: ids.get(p.pareja1Id), pareja2Id: ids.get(p.pareja2Id) }));
  permutado.grilla.reverse();
  const rp = generarPropuestasZona(permutado);
  assert.deepEqual(rp.propuestas.map((p) => p.clave), r.propuestas.map((p) => p.clave));
  assert.deepEqual(rp.propuestas.map((p) => p.partidosPropuestos), r.propuestas.map((p) => p.partidosPropuestos));
  assert.deepEqual(rp.propuestas.map((p) => p.cambios.map((c) => c.slotsToAdd)), r.propuestas.map((p) => p.cambios.map((c) => c.slotsToAdd)));

  const dos = entrada([['Viernes-09:00'], ['Viernes-12:00']]);
  const rDos = generarPropuestasZona(dos); assert.ok(rDos.propuestas.length); verificarPropuestas(dos, rDos);
  const rr4 = entrada([viernes('18:00', '23:00'), viernes('18:00', '23:00'), viernes('18:00', '23:00'), ['Sabado-09:00']], { club: viernes('18:00', '23:00'), canchas: 2 });
  const r4 = generarPropuestasZona(rr4); assert.ok(r4.propuestas.length); verificarPropuestas(rr4, r4);
  const mini = entrada([['Viernes-18:00'], ['Viernes-18:00', 'Viernes-20:30'], ['Viernes-18:00', 'Viernes-20:30'], ['Viernes-18:00', 'Viernes-20:30']], { formato: 'MINI_BRACKET', club: viernes('18:00', '23:00') });
  mini.partidos[0] = { ...mini.partidos[0], fechaHora: new Date(ventana('Viernes-18:00').startMs), canchaNumero: 1, sinHorarioAsignado: false };
  mini.partidos[1] = { ...mini.partidos[1], fechaHora: new Date(ventana('Viernes-18:00').startMs), canchaNumero: 2, sinHorarioAsignado: false };
  const rm = generarPropuestasZona(mini); assert.ok(rm.propuestas.length); verificarPropuestas(mini, rm);
  for (const p of rm.propuestas) assert.deepEqual(p.partidosPropuestos.slice(0, 2), [1, 2].map((canchaNumero, i) => ({ posicionEnRonda: i + 1, fechaHora: '2026-11-06T21:00:00.000Z', canchaNumero })));
  const imposible = entrada(Array.from({ length: 4 }, () => ['Sabado-09:00']), { formato: 'MINI_BRACKET', club: viernes('18:00', '23:00') });
  assert.deepEqual(generarPropuestasZona(imposible).propuestas, [], 'Cuatro parejas a modificar exceden el límite');
  assert.equal(generarPropuestasZona({ ...dos, maxNodos: 0 }).busquedaIncompleta, true);
  const noche = entrada([['Viernes-09:00'], ['Sabado-00:00']], { club: sabado('23:45', '02:00') });
  verificarPropuestas(noche, generarPropuestasZona(noche));
  const domingo = entrada([['Viernes-09:00'], ['Viernes-10:00']], { club: generarSlotsDia('Domingo', '09:00', '12:00') });
  assert.deepEqual(generarPropuestasZona(domingo).propuestas, []);
  console.log('PASS: generador RR2/3/4, mini, costo/unión, límite, trasnoche, domingo y determinismo sin UUID');
}

async function crearCaso(nombre, slots, canchas = 2) {
  const org = await prisma.organizador.create({ data: { nombre, email: `${nombre}@propuestas.test`, passwordHash: 'test', cantidadCanchas: canchas,
    viernesInicio: '09:00', viernesFin: '03:00', sabadoInicio: '08:00', sabadoFin: '03:00' } });
  const torneo = await prisma.torneo.create({ data: { nombre, slug: nombre, fecha: FECHA, organizadorId: org.id } });
  const cat = await prisma.categoria.create({ data: { nombre: '7ma Damas', torneoId: torneo.id } });
  const parejas = [];
  for (let i = 0; i < slots.length; i++) parejas.push(await prisma.pareja.create({ data: { categoriaId: cat.id, orden: i + 1,
    jugador1: `Pareja ${i + 1}`, jugador2: nombre, slotsSeleccionados: { create: slots[i].map((slotId) => ({ slotId })) } } }));
  return { org, torneo, cat, parejas };
}
async function leerParejas(caso) {
  return prisma.pareja.findMany({ where: { categoriaId: caso.cat.id }, orderBy: { orden: 'asc' },
    select: { id: true, resolucionManual: true, slotsSeleccionados: { orderBy: { slotId: 'asc' }, select: { slotId: true } } } });
}
function propuestas(pre) { return pre.conflictos.flatMap((c) => c.partidosSinHorario).find((p) => p.propuestasZona?.length)?.propuestasZona || []; }

async function testApi(baseUrl) {
  async function post(caso, action, data = {}, token = jwt.sign({ id: caso.org.id, email: caso.org.email }, JWT_SECRET)) {
    const response = await fetch(`${baseUrl}/torneos/${caso.torneo.id}/pre-check-inicio${action}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    return { status: response.status, body: await response.json() };
  }
  const caso = await crearCaso('api-propuesta', [viernes('18:00', '23:00'), viernes('18:00', '23:00'), ['Sabado-09:00']]);
  const first = await post(caso, ''); assert.equal(first.status, 200);
  const pre = first.body, p = propuestas(pre).find((p) => p.cambios.length === 1 && p.cambios[0].slotsToAdd.length === 2);
  assert.ok(p); assert.ok(pre.revision);
  const again = await post(caso, '', { isReCheck: true });
  assert.equal(again.body.revision, pre.revision, 'Lectura idéntica conserva revisión');
  assert.deepEqual(propuestas(again.body), propuestas(pre));
  const antes = await leerParejas(caso);
  const applied = await post(caso, '/propuestas/aplicar', { clave: p.clave, revision: pre.revision });
  assert.equal(applied.status, 200); assert.equal(applied.body.bloqueado, false);
  const despues = await leerParejas(caso);
  for (let i = 0; i < antes.length; i++) {
    const cambio = p.cambios.find((c) => c.parejaId === antes[i].id);
    if (!cambio) assert.deepEqual(despues[i], antes[i], 'No modifica parejas fuera de la propuesta');
    else {
      assert.equal(despues[i].resolucionManual, true);
      assert.deepEqual(despues[i].slotsSeleccionados.map((s) => s.slotId), [...new Set([...antes[i].slotsSeleccionados.map((s) => s.slotId), ...cambio.slotsToAdd])].sort());
    }
  }
  const plan = svc.preCheckSessions.get(caso.torneo.id).categoriasPlan[0].zonas[0];
  assert.deepEqual(plan.partidos.map((q) => ({ posicionEnRonda: q.posicionEnRonda, fechaHora: new Date(q.fechaHora).toISOString(), canchaNumero: q.canchaNumero })), p.partidosPropuestos);
  const vieja = await post(caso, '/propuestas/aplicar', { clave: p.clave, revision: pre.revision });
  assert.equal(vieja.status, 409); assert.equal(vieja.body.codigo, 'REVISION_PRECHECK_VIEJA'); assert.ok(vieja.body.preCheck.revision);
  assert.deepEqual(await leerParejas(caso), despues);
  assert.equal((await post(caso, '/propuestas/aplicar', {})).status, 400);
  const otro = await crearCaso('otro-club', [['Viernes-18:00'], ['Sabado-09:00']]);
  assert.equal((await post(caso, '/propuestas/aplicar', { clave: p.clave, revision: applied.body.revision }, jwt.sign({ id: otro.org.id }, JWT_SECRET))).status, 403);

  const noFactible = await crearCaso('estado-no-factible', [['Viernes-09:00'], ['Viernes-12:00']]);
  const noPre = (await post(noFactible, '')).body, noProp = propuestas(noPre)[0]; assert.ok(noProp);
  const catAjena = await prisma.categoria.create({ data: { nombre: 'Ocupación', torneoId: noFactible.torneo.id } });
  // Se ocupan ambas canchas en el único inicio común de esta propuesta, sin re-check intermedio.
  await prisma.partido.createMany({ data: [1, 2].map((canchaNumero) => ({ categoriaId: catAjena.id, posicionEnRonda: canchaNumero,
    fechaHora: new Date(noProp.partidosPropuestos[0].fechaHora), canchaNumero })) });
  const prev = await leerParejas(noFactible);
  const noRes = await post(noFactible, '/propuestas/aplicar', { clave: noProp.clave, revision: noPre.revision });
  assert.equal(noRes.status, 409); assert.equal(noRes.body.codigo, 'PROPUESTA_NO_FACTIBLE'); assert.ok(noRes.body.preCheck);
  assert.deepEqual(await leerParejas(noFactible), prev, '409 no agrega disponibilidad');

  const concurrente = await crearCaso('aplicar-dos-veces', [['Viernes-09:00'], ['Viernes-12:00']]);
  const cp = (await post(concurrente, '')).body, propuesta = propuestas(cp)[0]; assert.ok(propuesta);
  const respuestas = await Promise.all([post(concurrente, '/propuestas/aplicar', { clave: propuesta.clave, revision: cp.revision }),
    post(concurrente, '/propuestas/aplicar', { clave: propuesta.clave, revision: cp.revision })]);
  assert.deepEqual(respuestas.map((r) => r.status).sort(), [200, 409]);

  const mini = await crearCaso('api-mini', [['Viernes-18:00'], ['Viernes-18:00', 'Viernes-20:30'],
    ['Viernes-18:00', 'Viernes-20:30'], ['Viernes-18:00', 'Viernes-20:30']]);
  const mp = (await post(mini, '')).body, opt = propuestas(mp)[0]; assert.ok(opt);
  const miniPlan = svc.preCheckSessions.get(mini.torneo.id).categoriasPlan[0].zonas[0];
  const fijos = miniPlan.partidos.slice(0, 2).map((p) => [p.fechaHora.getTime(), p.canchaNumero]);
  const miniAplicado = await post(mini, '/propuestas/aplicar', { clave: opt.clave, revision: mp.revision });
  assert.equal(miniAplicado.status, 200); assert.equal(miniAplicado.body.bloqueado, false);
  assert.deepEqual(miniPlan.partidos.slice(0, 2).map((p) => [p.fechaHora.getTime(), p.canchaNumero]), fijos);

  const duplicado = await crearCaso('claves-duplicadas', [viernes('18:00', '23:00'), viernes('18:00', '23:00'), ['Sabado-09:00']]);
  const catDuplicada = await prisma.categoria.create({ data: { nombre: '7ma Damas', torneoId: duplicado.torneo.id } });
  for (let i = 0; i < 3; i++) await prisma.pareja.create({ data: { categoriaId: catDuplicada.id, orden: i + 1,
    jugador1: `Pareja ${i + 1}`, jugador2: 'claves-duplicadas',
    slotsSeleccionados: { create: (i === 2 ? ['Sabado-09:00'] : viernes('18:00', '23:00')).map((slotId) => ({ slotId })) } } });
  const ambigua = (await post(duplicado, '')).body;
  assert.ok(ambigua.conflictos.length === 2);
  for (const c of ambigua.conflictos) for (const p of c.partidosSinHorario) {
    assert.deepEqual(p.propuestasZona, [], 'Una clave ambigua nunca aplica en otra categoría');
    assert.equal(p.busquedaPropuestasIncompleta, true);
  }
  console.log('PASS: API aplica testigo, atomicidad visible, revisión vieja, estado no factible, permisos y concurrencia');
}

async function testZonaE() {
  const caso = await crearCaso('zona-e-real', [[...viernes('18:00', '03:00'), ...sabado('15:00', '03:00')], viernes('13:00', '17:00'),
    [...viernes('19:00', '22:00'), ...sabado('15:00', '20:00')]], 6);
  const otro = await prisma.torneo.create({ data: { nombre: 'Ocupación del club', slug: 'ocupacion-zona-e', fecha: FECHA, organizadorId: caso.org.id } });
  const cat = await prisma.categoria.create({ data: { nombre: 'Agenda', torneoId: otro.id } });
  const agenda = [];
  for (let canchaNumero = 1; canchaNumero <= 6; canchaNumero++) for (const slot of ['Viernes-18:00', 'Viernes-19:30', 'Viernes-21:30', 'Sabado-16:00', 'Sabado-17:45']) {
    agenda.push({ categoriaId: cat.id, posicionEnRonda: agenda.length + 1, canchaNumero, fechaHora: new Date(ventana(slot).startMs) });
  }
  await prisma.partido.createMany({ data: agenda });
  const pre = await svc.preCheckInicioTorneo(caso.org.id, caso.torneo.id);
  const ps = propuestas(pre); assert.ok(ps.length, 'Zona E trae al menos una propuesta');
  assert.ok(ps.every((p) => p.cambios.length <= 2));
  assert.equal(ps[0].cambios.length, 2, 'El caso E con canchas ocupadas requiere dos parejas');
  const antes = await leerParejas(caso), agendaAntes = await prisma.partido.findMany({ where: { categoriaId: cat.id }, orderBy: { posicionEnRonda: 'asc' } });
  const snapshotAntes = structuredClone(svc.preCheckSessions.get(caso.torneo.id).categoriasPlan);
  const transaction = prisma.$transaction;
  prisma.$transaction = (fn, opts) => transaction.call(prisma, async (tx) => {
    const create = tx.slotPareja.createMany.bind(tx.slotPareja); let escrituras = 0;
    tx.slotPareja.createMany = (q) => { if (++escrituras === 2) throw new Error('Fallo simulado en segunda pareja'); return create(q); };
    return fn(tx);
  }, opts);
  try { await assert.rejects(svc.aplicarPropuestaZona(caso.org.id, caso.torneo.id, { clave: ps[0].clave, revision: pre.revision }), /Fallo simulado/); }
  finally { prisma.$transaction = transaction; }
  assert.deepEqual(await leerParejas(caso), antes, 'Rollback de ambas disponibilidades');
  assert.deepEqual(svc.preCheckSessions.get(caso.torneo.id).categoriasPlan, snapshotAntes, 'El testigo no se adopta antes del commit');
  const after = await svc.aplicarPropuestaZona(caso.org.id, caso.torneo.id, { clave: ps[0].clave, revision: pre.revision });
  assert.equal(after.bloqueado, false);
  assert.deepEqual(await prisma.partido.findMany({ where: { categoriaId: cat.id }, orderBy: { posicionEnRonda: 'asc' } }), agendaAntes);
  const despues = await leerParejas(caso);
  for (let i = 0; i < antes.length; i++) if (!ps[0].cambios.some((c) => c.parejaId === antes[i].id)) assert.deepEqual(antes[i], despues[i]);
  const recheck = await svc.preCheckInicioTorneo(caso.org.id, caso.torneo.id, { isReCheck: true }); assert.equal(recheck.bloqueado, false);
  console.log('PASS: zona E, ocupación de seis canchas, propuesta aplicada y re-check resuelto');
}

async function main() {
  await ensureTestDb(); testGenerador();
  const { server, baseUrl } = await startTestServer();
  try { await testApi(baseUrl); await testZonaE(); }
  finally { await new Promise((r) => server.close(r)); await prisma.$disconnect(); }
}
main().then(() => process.exit(0)).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
