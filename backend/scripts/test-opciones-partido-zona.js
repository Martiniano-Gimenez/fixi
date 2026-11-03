'use strict';

const { ensureTestDb } = require('./utils/testEnvGuard');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { obtenerOpcionesPartidoZona, listarPartidosZona } = require('../src/utils/opcionesPartidoZona');
let generaciones = 0;
require('../src/utils/opcionesPartidoZona').obtenerOpcionesPartidoZona = (...args) => {
  generaciones++; return obtenerOpcionesPartidoZona(...args);
};
const prisma = require('../src/lib/prisma');
const svc = require('../src/services/organizador.service');
const { startTestServer } = require('./utils/testServer');
const { JWT_SECRET } = require('../src/config/env');
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
function fijar(e, posicion, slotId, canchaNumero = 1) {
  Object.assign(e.partidos.find((p) => p.posicionEnRonda === posicion), {
    fechaHora: new Date(ventana(slotId).startMs), canchaNumero, sinHorarioAsignado: false,
  });
}
function todas(e, posicion = 1) {
  const { opciones } = obtenerOpcionesPartidoZona(e, posicion);
  assert.equal(new Set(opciones.map((o) => o.slotId)).size, opciones.length, 'Un inicio aparece una sola vez');
  assert.deepEqual(opciones.map((o) => o.fechaHora), opciones.map((o) => o.fechaHora).sort(), 'Orden cronológico');
  return opciones.filter((o) => o.estado !== 'NO_DISPONIBLE');
}
function testPuro() {
  const e = entrada([viernes('13:00', '17:00'), []], {
    club: ['Viernes-22:45', 'Sabado-09:00', 'Viernes-17:15', 'Viernes-13:15', 'Viernes-13:00'], canchas: 3,
  });
  const originales = structuredClone(e);
  const opciones = todas(e);
  assert.deepEqual(opciones.map((o) => o.slotId), ['Viernes-13:00', 'Viernes-13:15', 'Viernes-17:15', 'Viernes-22:45', 'Sabado-09:00']);
  assert.deepEqual(opciones.map((o) => [o.diasNuevos, o.minutosAmpliacion]), [[0, 0], [0, 0], [0, 90], [0, 420], [1, 0]]);
  assert.deepEqual(opciones[0].parejasAAmpliar, []);
  assert.deepEqual(opciones[2].parejasAAmpliar, ['id-0'], 'No pide cambios a la pareja libre');
  assert.ok(opciones.every((o) => o.verificada));
  assert.ok(opciones.every((o) => !Object.hasOwn(o, 'canchaNumero')), 'La respuesta no contiene cancha');
  assert.deepEqual(e, originales, 'Sin mutaciones');
  const dos = entrada([['Viernes-13:00'], ['Viernes-16:00']], { club: ['Viernes-14:30'] });
  assert.deepEqual(todas(dos)[0].parejasAAmpliar, ['id-0', 'id-1']);
  const cronologica = entrada([['Viernes-16:00'], ['Viernes-16:00']], { club: viernes('15:00', '18:00') });
  assert.equal(todas(cronologica)[0].slotId, 'Viernes-15:00', 'Una ampliación mayor no reordena la grilla');
  assert.equal(todas(cronologica).find((o) => o.slotId === 'Viernes-16:00').estado, 'ENTRA');

  const pagina = entrada([[], []]);
  const primera = obtenerOpcionesPartidoZona(pagina, 1);
  assert.equal(primera.opciones.length, pagina.grilla.length);
  assert.equal(primera.siguienteCursor, undefined);
  assert.equal(todas(pagina).length, pagina.grilla.length);
  assert.throws(() => obtenerOpcionesPartidoZona(pagina, 999), (e) => e.statusCode === 404);

  // Identidad y orden naturales, incluso cambiando UUID y la inserción de grilla/parejas/partidos/maps.
  const perm = structuredClone(pagina), ids = new Map(perm.parejas.map((p, i) => [p.id, `uuid-${2 - i}`]));
  perm.parejas = perm.parejas.map((p) => ({ ...p, id: ids.get(p.id) })).reverse();
  perm.partidos = perm.partidos.map((p) => ({ ...p, pareja1Id: ids.get(p.pareja1Id), pareja2Id: ids.get(p.pareja2Id) })).reverse();
  perm.grilla.reverse();
  assert.deepEqual(obtenerOpcionesPartidoZona(perm, 1), primera);
  assert.deepEqual(obtenerOpcionesPartidoZona(pagina, 1), primera);
  const permFuera = structuredClone(dos);
  permFuera.parejas = permFuera.parejas.map((p) => ({ ...p, id: ids.get(p.id) })).reverse();
  permFuera.partidos = permFuera.partidos.map((p) => ({ ...p, pareja1Id: ids.get(p.pareja1Id), pareja2Id: ids.get(p.pareja2Id) }));
  assert.deepEqual(todas(permFuera), todas(dos).map((o) => ({ ...o, parejasAAmpliar: o.parejasAAmpliar.map((id) => ids.get(id)) })));

  const noche = entrada([viernes('18:00', '03:00'), viernes('18:00', '03:00')], {
    club: ['Viernes-00:00', 'Sabado-01:00', 'Domingo-09:00'],
  });
  const nocturnas = todas(noche);
  assert.deepEqual(nocturnas.map((o) => o.slotId), ['Viernes-00:00', 'Sabado-01:00']);
  assert.equal(nocturnas[0].fechaHora, '2026-11-07T03:00:00.000Z', 'Viernes lógico 00:00 es sábado civil');
  assert.equal(nocturnas[1].fechaHora, '2026-11-08T04:00:00.000Z', 'Sábado lógico 01:00 es domingo civil');
  assert.equal(nocturnas[0].diasNuevos, 0); assert.equal(nocturnas[1].diasNuevos, 2);

  const ocupada = entrada([[], []], { club: viernes('09:00', '13:00'), canchas: 3 });
  ocupada.courtTimelines = new Map([1, 2, 3].map((c) => [c, [ventana('Viernes-09:00')]]));
  ocupada.parejaAssignments = new Map([['id-0', [ventana('Viernes-10:15')]]]);
  assert.deepEqual(todas(ocupada).map((o) => o.slotId), ['Viernes-11:30', 'Viernes-11:45'], 'Respeta intervalos completos de ocupación externa y de la pareja');
  const bloqueadas = obtenerOpcionesPartidoZona(ocupada, 1).opciones;
  assert.equal(bloqueadas[0].motivo, 'SIN_CANCHA');
  assert.deepEqual(bloqueadas.find((o) => o.slotId === 'Viernes-10:15').parejasOcupadas, ['id-0']);
  assert.equal(bloqueadas.find((o) => o.slotId === 'Viernes-10:15').motivo, 'PAREJA_OCUPADA');
  assert.equal(opciones[0].estado, 'ENTRA'); assert.equal(opciones[2].estado, 'PEDIR_1');
  assert.equal(todas(dos)[0].estado, 'PEDIR_VARIAS');
  const canchaBaja = entrada([[], []], { club: ['Viernes-09:00'], canchas: 3 });
  const clave = todas(canchaBaja)[0].clave;
  canchaBaja.courtTimelines = new Map([[1, [ventana('Viernes-09:00')]]]);
  assert.equal(todas(canchaBaja)[0].clave, clave, 'La clave no depende de qué cancha quede libre');

  const rr = entrada([[], [], []], { club: viernes('09:00', '12:45'), canchas: 2 });
  fijar(rr, 2, 'Viernes-09:00');
  assert.deepEqual(todas(rr, 1).map((o) => o.slotId), ['Viernes-10:15', 'Viernes-11:30'], 'Solo conserva opciones que permiten el tercer partido; excluye solapes propios y NO_FACTIBLE');
  assert.deepEqual(obtenerOpcionesPartidoZona(rr, 2), { opciones: [] });
  const incompleta = { ...rr, maxNodosOpcion: 0 };
  assert.ok(todas(incompleta, 1).some((o) => !o.verificada), 'Una búsqueda incompleta se devuelve');
  const sinLugar = entrada([[], [], []], { club: ['Viernes-09:00'], canchas: 3 });
  assert.deepEqual(todas(sinLugar), [], 'No hay programación completa ni ampliando toda la disponibilidad');
  const cuatro = entrada([[], [], [], []], { club: viernes('09:00', '14:00'), canchas: 2 });
  assert.ok(todas(cuatro).some((o) => o.verificada), 'ROUND_ROBIN de 4');
  const tres = entrada([[], [], []], { club: viernes('09:00', '15:00') });
  fijar(tres, 2, 'Viernes-10:15');
  assert.ok(todas(tres, 1).some((o) => o.slotId === 'Viernes-09:00'), 'Se puede jugar seguido sin descanso extra');

  const mini = entrada([['Viernes-09:00'], ['Viernes-09:00'], ['Viernes-09:00'], ['Viernes-09:00']], {
    formato: 'MINI_BRACKET', club: viernes('09:00', '14:00'), canchas: 2,
  });
  assert.deepEqual(todas(mini, 3), [], 'P3 espera P1 y P2');
  assert.ok(obtenerOpcionesPartidoZona(mini, 3).opciones.every((o) => o.motivo === 'ESPERA_BASES'));
  fijar(mini, 1, 'Viernes-09:00');
  assert.deepEqual(todas(mini, 4), [], 'No alcanza con un solo partido base');
  fijar(mini, 2, 'Viernes-09:00', 2);
  let opcionesMini = todas(mini, 3);
  assert.equal(opcionesMini[0].slotId, 'Viernes-10:15');
  assert.deepEqual(opcionesMini[0].parejasAAmpliar, mini.parejas.map((p) => p.id), 'Contempla las cuatro parejas posibles');
  mini.parejaAssignments = new Map([['id-3', [ventana('Viernes-10:15')]]]);
  opcionesMini = todas(mini, 3);
  assert.ok(opcionesMini.every((o) => ventana(o.slotId).startMs >= ventana('Viernes-11:30').startMs));
  mini.parejaAssignments.clear(); fijar(mini, 4, 'Viernes-10:15', 1);
  assert.ok(todas(mini, 3).some((o) => o.slotId === 'Viernes-10:15'), 'P3/P4 pueden coincidir en distintas canchas');
  const lista = listarPartidosZona(mini);
  assert.equal(lista[0].estado, 'FIJO'); assert.equal(lista[2].estado, 'PENDIENTE');
  assert.equal(lista[2].origen, 'Ganador P1 vs Ganador P2'); assert.equal(lista[2].pareja1Id, null);
  assert.equal(lista[3].origen, 'Perdedor P1 vs Perdedor P2'); assert.equal(lista[3].canchaNumero, 1);
  console.log('PASS: ranking, paginación, madrugada, ocupación, fijos, RR 2/3/4, MINI, viabilidad y determinismo');
}

async function testApi(baseUrl) {
  const org = await prisma.organizador.create({ data: { nombre: 'Opciones', email: 'opciones@partido.test', passwordHash: 'test',
    cantidadCanchas: 3, viernesInicio: '09:00', viernesFin: '03:00', sabadoInicio: '09:00', sabadoFin: '03:00' } });
  const torneo = await prisma.torneo.create({ data: { nombre: 'Opciones', slug: 'opciones-partido', fecha: FECHA, organizadorId: org.id } });
  const cat = await prisma.categoria.create({ data: { nombre: '7ma Damas', torneoId: torneo.id } });
  for (const [i, slots] of [viernes('13:00', '17:00'), viernes('18:00', '23:00'), sabado('09:00', '13:00')].entries()) {
    await prisma.pareja.create({ data: { categoriaId: cat.id, orden: i + 1, jugador1: `Pareja ${i + 1}`, jugador2: 'Test',
      slotsSeleccionados: { create: slots.map((slotId) => ({ slotId })) } } });
  }
  const token = jwt.sign({ id: org.id }, JWT_SECRET);
  async function post(action, data, customToken = token, torneoId = torneo.id) {
    const res = await fetch(`${baseUrl}/torneos/${torneoId}/pre-check-inicio${action}`, {
      method: 'POST', headers: { Authorization: `Bearer ${customToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    return { status: res.status, body: await res.json() };
  }
  const antes = await prisma.pareja.findMany({ where: { categoriaId: cat.id }, include: { slotsSeleccionados: true }, orderBy: { orden: 'asc' } });
  let pre = (await post('', {})).body;
  const conflicto = pre.conflictos[0].partidosSinHorario.find((p) => p.motivo === 'ZONA_MANUAL_INCOMPLETA');
  assert.ok(conflicto); assert.equal(conflicto.partidosZona.length, 3);
  assert.ok(conflicto.partidosZona.every((p) => p.estado === 'PENDIENTE' && p.pareja1Id && p.pareja2Id));
  const body = { categoriaId: cat.id, zonaId: conflicto.zonaId, posicionEnRonda: 1, revision: pre.revision };
  const endpoint = '/partidos/opciones', llamadas = generaciones;
  assert.equal(svc.preCheckSessions.get(torneo.id).opcionesPorPartido.size, 0, 'Pre-check no genera opciones');
  const primera = await post(endpoint, body);
  assert.equal(primera.status, 200); assert.ok(primera.body.opciones.length > 6);
  assert.deepEqual(Object.keys(primera.body).sort(), ['opciones', 'revision']);
  assert.deepEqual(Object.keys(primera.body.opciones[0]).sort(), ['clave', 'diasNuevos', 'estado', 'fechaHora', 'minutosAmpliacion', 'motivo', 'parejasAAmpliar', 'parejasOcupadas', 'slotId', 'verificada']);
  assert.equal(generaciones, llamadas + 1);
  const cached = await post(endpoint, body); assert.deepEqual(cached, primera); assert.equal(generaciones, llamadas + 1);
  pre = (await post('', { isReCheck: true })).body;
  assert.equal(pre.revision, body.revision); assert.deepEqual(await post(endpoint, body), primera);
  assert.equal(generaciones, llamadas + 1, 'Re-check idéntico conserva caché');
  assert.equal((await post(endpoint, {})).status, 400);
  assert.equal((await post(endpoint, null)).status, 400);
  for (const patch of [{ posicionEnRonda: '1' }, { posicionEnRonda: 0 }, { cursor: 7 }, { cursor: '' }, { cursor: 'basura' }]) {
    assert.equal((await post(endpoint, { ...body, ...patch })).status, 400);
  }
  assert.equal((await post(endpoint, { ...body, zonaId: 'ajena' })).status, 404);
  assert.equal((await post(endpoint, { ...body, posicionEnRonda: 99 })).status, 404);
  const otro = await prisma.organizador.create({ data: { nombre: 'Otro', email: 'otro@opciones.test', passwordHash: 'test' } });
  assert.equal((await post(endpoint, body, jwt.sign({ id: otro.id }, JWT_SECRET))).status, 403);
  assert.equal((await post(endpoint, body, token, 'inexistente')).status, 404);
  assert.equal((await post(endpoint, body, 'token-invalido')).status, 401);
  const vieja = await post(endpoint, { ...body, revision: 'vieja' });
  assert.equal(vieja.status, 409); assert.equal(vieja.body.codigo, 'REVISION_PRECHECK_VIEJA'); assert.ok(vieja.body.preCheck.revision);

  // La ocupación cambia sin pasar por re-check: no se sirve un caché viejo.
  const ocupacion = await prisma.categoria.create({ data: { torneoId: torneo.id, nombre: 'Agenda' } });
  const elegida = primera.body.opciones[0];
  await prisma.partido.createMany({ data: [1, 2, 3].map((canchaNumero) => ({ categoriaId: ocupacion.id,
    posicionEnRonda: canchaNumero, fechaHora: new Date(elegida.fechaHora), canchaNumero })) });
  const cambio = await post(endpoint, body);
  assert.equal(cambio.status, 409); assert.equal(cambio.body.codigo, 'ESTADO_PRECHECK_CAMBIO');
  assert.notEqual(cambio.body.preCheck.revision, body.revision);
  const nueva = await post(endpoint, { ...body, revision: cambio.body.preCheck.revision });
  assert.equal(nueva.status, 200); assert.equal(nueva.body.opciones.find((o) => o.slotId === elegida.slotId).estado, 'NO_DISPONIBLE');
  const bloqueada = nueva.body.opciones.find((o) => o.slotId === elegida.slotId);
  assert.equal(bloqueada.motivo, 'SIN_CANCHA');
  assert.ok(!svc.preCheckSessions.get(torneo.id).opcionesCache.has(JSON.stringify([cat.id, conflicto.zonaId, 1, bloqueada.clave])),
    'Un inicio bloqueado no autoriza fijación');
  assert.equal(svc.preCheckSessions.get(torneo.id).opcionesPorPartido.size, 1, 'Se invalida todo el caché anterior');
  const sesion = svc.preCheckSessions.get(torneo.id); sesion.expiresAt = Date.now() - 1;
  const vencida = await post(endpoint, { ...body, revision: cambio.body.preCheck.revision });
  assert.equal(vencida.status, 409); assert.equal(vencida.body.codigo, 'REVISION_PRECHECK_VIEJA');
  assert.equal(vencida.body.preCheck.sesionReiniciada, false, 'TTL recupera el plan guardado');
  assert.deepEqual(await prisma.pareja.findMany({ where: { categoriaId: cat.id }, include: { slotsSeleccionados: true }, orderBy: { orden: 'asc' } }), antes, 'Pedir horarios no escribe disponibilidad');
  console.log('PASS: HTTP, formato partidosZona, caché por página/revisión, permisos, 400/404/409 y lectura sin cambios en parejas');
}

async function main() {
  await ensureTestDb(); testPuro();
  const { server, baseUrl } = await startTestServer();
  try { await testApi(baseUrl); }
  finally { await new Promise((r) => server.close(r)); await prisma.$disconnect(); }
}
main().then(() => process.exit(0)).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
