'use strict';

const { ensureTestDb } = require('./utils/testEnvGuard');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const opcionesUtil = require('../src/utils/opcionesPartidoZona');
const listar = opcionesUtil.obtenerOpcionesPartidoZona, recalcular = opcionesUtil.recalcularOpcionPartidoZona;
let presupuestoLista = null, presupuestoFijar = null;
opcionesUtil.obtenerOpcionesPartidoZona = (e, ...args) => listar({ ...e,
  ...(presupuestoLista === null ? {} : { maxNodosOpcion: presupuestoLista }) }, ...args);
opcionesUtil.recalcularOpcionPartidoZona = (e, ...args) => recalcular({ ...e,
  ...(presupuestoFijar === null ? {} : { maxNodosOpcion: presupuestoFijar }) }, ...args);
const prisma = require('../src/lib/prisma');
const svc = require('../src/services/organizador.service');
const { startTestServer } = require('./utils/testServer');
const { JWT_SECRET } = require('../src/config/env');
const { generarSlotsDia } = require('../src/services/slots.service');
const { slotIdToMsWindow } = require('../src/services/zona.service');
const FECHA = new Date('2026-11-06T15:00:00Z');
const viernes = (a, b) => generarSlotsDia('Viernes', a, b);
const sabado = (a, b) => generarSlotsDia('Sabado', a, b);
const ms = (slotId) => slotIdToMsWindow(slotId, FECHA).startMs;
let baseUrl;

async function crearCaso(nombre, slots = [viernes('13:00', '17:00'), viernes('18:00', '23:00'), sabado('09:00', '13:00')], extra = {}) {
  const org = await prisma.organizador.create({ data: { nombre, email: `${nombre}@fijar.test`, passwordHash: 'test', cantidadCanchas: 2,
    viernesInicio: '09:00', viernesFin: '03:00', sabadoInicio: '09:00', sabadoFin: '03:00', ...extra.club } });
  const torneo = await prisma.torneo.create({ data: { nombre, slug: nombre, fecha: FECHA, organizadorId: org.id } });
  const cat = await prisma.categoria.create({ data: { nombre: '7ma Damas', torneoId: torneo.id } });
  const parejas = [];
  for (const [i, ids] of slots.entries()) parejas.push(await prisma.pareja.create({ data: { categoriaId: cat.id,
    orden: i + 1, jugador1: `Pareja ${i + 1}`, jugador2: 'Test', slotsSeleccionados: { create: ids.map((slotId) => ({ slotId })) } } }));
  if (extra.pendientes) {
    const catPendiente = await prisma.categoria.create({ data: { nombre: 'Pendientes', torneoId: torneo.id } });
    for (let i = 1; i <= 3; i++) await prisma.pareja.create({ data: { categoriaId: catPendiente.id,
      orden: i, jugador1: `Pendiente ${i}`, jugador2: 'Test', slotsSeleccionados: { create: [{ slotId: 'Viernes-23:00' }] } } });
  }
  return { org, torneo, cat, parejas };
}
async function post(c, action, body = {}, token = jwt.sign({ id: c.org.id }, JWT_SECRET), torneoId = c.torneo.id) {
  const res = await fetch(`${baseUrl}/torneos/${torneoId}/pre-check-inicio${action}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
async function precheck(c) {
  const r = await post(c, '', { isReCheck: true }); assert.equal(r.status, 200); return r.body;
}
function sesion(c) { return svc.preCheckSessions.get(c.torneo.id); }
function zona(c) { return sesion(c).categoriasPlan.find((cat) => cat.categoriaId === c.cat.id).zonas[0]; }
function partido(c, posicion) { return zona(c).partidos.find((p) => p.posicionEnRonda === posicion); }
function query(c, pre, posicion) { return { categoriaId: c.cat.id, zonaId: zona(c).id, posicionEnRonda: posicion, revision: pre.revision }; }
async function elegir(c, pre, posicion, slotId) {
  const body = query(c, pre, posicion);
  const r = await post(c, '/partidos/opciones', body); assert.equal(r.status, 200);
  const opcion = r.body.opciones.find((o) => o.estado !== 'NO_DISPONIBLE' && (!slotId || o.slotId === slotId));
  if (opcion) return { body: { ...body, clave: opcion.clave }, opcion };
  assert.fail(`No se encontró ${slotId || 'ninguna opción'} para P${posicion}`);
}
async function fijar(c, seleccion) {
  const r = await post(c, '/partidos/fijar', seleccion.body); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body;
}
async function disponibilidad(c) {
  return prisma.pareja.findMany({ where: { categoriaId: c.cat.id }, orderBy: { orden: 'asc' }, select: {
    id: true, resolucionManual: true, slotsSeleccionados: { orderBy: { slotId: 'asc' }, select: { slotId: true } },
  } });
}
function horario(p) { return { fechaHora: p.fechaHora && +new Date(p.fechaHora), canchaNumero: p.canchaNumero, sinHorarioAsignado: p.sinHorarioAsignado }; }
function hayConflicto(c, pre) { return Boolean(pre.conflictos?.some((cat) => cat.categoriaId === c.cat.id)); }

async function testFijacion() {
  const c = await crearCaso('fijacion-ampliacion');
  const pre = await precheck(c), seleccion = await elegir(c, pre, 1, 'Viernes-15:45'), antes = await disponibilidad(c);
  assert.equal((await precheck(c)).revision, pre.revision);
  const planesViejos = [...svc.planesCache].filter(([, p]) => p.torneoId === c.torneo.id).map(([id]) => id);
  assert.ok(planesViejos.length);
  // El contenido derivado de la página no es una autorización para ampliar otras parejas.
  for (const pagina of sesion(c).opcionesPorPartido.values()) for (const o of pagina.opciones) {
    if (o.clave === seleccion.opcion.clave) { o.parejasAAmpliar = [c.parejas[2].id]; o.fechaHora = '2000-01-01T00:00:00Z'; }
  }
  const despues = await fijar(c, seleccion), p = partido(c, 1);
  assert.equal(+p.fechaHora, ms('Viernes-15:45')); assert.equal(p.canchaNumero, 1); assert.equal(p.fijadoManual, true);
  assert.equal(p.sinHorarioAsignado, false); assert.notEqual(despues.revision, pre.revision);
  assert.equal(sesion(c).opcionesCache.size, 0); assert.equal(sesion(c).opcionesPorPartido.size, 0);
  assert.ok(planesViejos.every((id) => !svc.planesCache.has(id)));
  const datos = await disponibilidad(c);
  assert.deepEqual(datos[0], antes[0]); assert.deepEqual(datos[2], antes[2], 'No modifica parejas que no necesitan ampliación');
  assert.equal(datos[1].resolucionManual, true);
  assert.deepEqual(datos[1].slotsSeleccionados.map((s) => s.slotId), [...antes[1].slotsSeleccionados.map((s) => s.slotId), 'Viernes-15:45'].sort());
  const manual = despues.conflictos.find((x) => x.categoriaId === c.cat.id).partidosSinHorario.find((x) => x.motivo === 'ZONA_MANUAL_INCOMPLETA');
  assert.equal(manual.partidosZona.find((x) => x.posicionEnRonda === 1).estado, 'FIJO');
  assert.ok(hayConflicto(c, despues), 'Una fijación parcial no oculta los pendientes');
  const reservado = horario(p);
  for (let i = 0; i < 2; i++) { await precheck(c); assert.deepEqual(horario(p), reservado, 'Re-check no borra el fijo aunque la zona siga incompatible'); }
  assert.ok(sesion(c).courtTimelines.get(1).some((o) => o.startMs === reservado.fechaHora), 'Ocupación reconstruida');
  const restante = await post(c, '/partidos/opciones', query(c, despues, 2));
  assert.equal(restante.status, 200);
  assert.ok(restante.body.opciones.filter((o) => o.estado !== 'NO_DISPONIBLE').every((o) => +new Date(o.fechaHora) + 75 * 60_000 <= reservado.fechaHora || +new Date(o.fechaHora) >= reservado.fechaHora + 75 * 60_000));

  const sin = await crearCaso('fijacion-sin-ampliacion', [viernes('18:00', '23:00'), viernes('18:00', '23:00'), sabado('09:00', '13:00')]);
  const sinPre = await precheck(sin), sinAntes = await disponibilidad(sin), sinSel = await elegir(sin, sinPre, 1, 'Viernes-18:00');
  assert.deepEqual(sinSel.opcion.parejasAAmpliar, []);
  const txOriginal = prisma.$transaction;
  sesion(sin).expiresAt = Date.now() + 5_000;
  prisma.$transaction = (fn, opts) => txOriginal.call(prisma, async (tx) => {
    const res = await fn(tx);
    assert.ok(sesion(sin).expiresAt - Date.now() > 59 * 60_000, 'TTL renovado antes de esperar el commit, incluso sin ampliación');
    return res;
  }, opts);
  let sinDespues;
  try { sinDespues = await fijar(sin, sinSel); } finally { prisma.$transaction = txOriginal; }
  assert.deepEqual(await disponibilidad(sin), sinAntes, 'Sin ampliación no escribe slots ni resolucionManual');
  assert.notEqual(sinDespues.revision, sinPre.revision, 'También cambia la revisión al fijar sin altas');
  assert.equal(partido(sin, 1).fijadoManual, true);

  const canchaDos = await crearCaso('fijacion-cancha-libre');
  const agenda = await prisma.categoria.create({ data: { nombre: 'Agenda', torneoId: canchaDos.torneo.id, estado: 'EN_CURSO' } });
  await prisma.partido.create({ data: { categoriaId: agenda.id, posicionEnRonda: 1, fechaHora: new Date(ms('Viernes-15:45')), canchaNumero: 1 } });
  const canchaPre = await precheck(canchaDos);
  await fijar(canchaDos, await elegir(canchaDos, canchaPre, 1, 'Viernes-15:45'));
  assert.equal(partido(canchaDos, 1).canchaNumero, 2, 'Elige la primera cancha libre compatible, no siempre la 1');

  const noche = await crearCaso('fijacion-madrugada');
  const nochePre = await precheck(noche), selNoche = await elegir(noche, nochePre, 1, 'Viernes-00:00');
  await fijar(noche, selNoche);
  assert.equal(new Date(partido(noche, 1).fechaHora).toISOString(), '2026-11-07T03:00:00.000Z');
  for (const p of (await disponibilidad(noche)).slice(0, 2)) assert.ok(p.slotsSeleccionados.some((s) => s.slotId === 'Viernes-00:00'), 'Madrugada civil del sábado, jornada lógica del viernes');
  console.log('PASS: ampliación recalculada/aditiva, sin ampliación, madrugada, revisión/ocupación y fijos conservados');
}

async function testConflictos() {
  const c = await crearCaso('fijacion-errores');
  const pre = await precheck(c), seleccion = await elegir(c, pre, 1), antes = await disponibilidad(c);
  assert.equal((await post(c, '/partidos/fijar', {})).status, 400);
  assert.equal((await post(c, '/partidos/fijar', { ...seleccion.body, posicionEnRonda: '1' })).status, 400);
  assert.equal((await post(c, '/partidos/fijar', { ...seleccion.body, zonaId: 'ajena' })).status, 404);
  assert.equal((await post(c, '/partidos/fijar', { ...seleccion.body, posicionEnRonda: 99 })).status, 404);
  const otra = await crearCaso('fijacion-otro-club');
  assert.equal((await post(c, '/partidos/fijar', seleccion.body, jwt.sign({ id: otra.org.id }, JWT_SECRET))).status, 403);
  assert.equal((await post(c, '/partidos/fijar', seleccion.body, undefined, 'inexistente')).status, 404);
  const vencida = await post(c, '/partidos/fijar', { ...seleccion.body, clave: 'no-pedida' });
  assert.equal(vencida.status, 409); assert.equal(vencida.body.codigo, 'OPCION_VENCIDA'); assert.ok(vencida.body.preCheck.revision);
  const otroPartido = await post(c, '/partidos/fijar', { ...seleccion.body, posicionEnRonda: 2 });
  assert.equal(otroPartido.status, 409); assert.equal(otroPartido.body.codigo, 'OPCION_VENCIDA', 'La clave está ligada al partido pedido');
  assert.deepEqual(await disponibilidad(c), antes);

  // La ocupación se agrega DESPUÉS de pedir opciones y antes de fijar.
  for (const tipo of ['cancha', 'pareja']) {
    const caso = await crearCaso(`fijacion-carrera-${tipo}`), preCaso = await precheck(caso);
    const sel = await elegir(caso, preCaso, 1, 'Viernes-15:45'), original = await disponibilidad(caso);
    const agenda = await prisma.categoria.create({ data: { nombre: 'Agenda', torneoId: caso.torneo.id, estado: 'EN_CURSO' } });
    await prisma.partido.create({ data: { categoriaId: agenda.id, posicionEnRonda: 1, fechaHora: new Date(sel.opcion.fechaHora),
      canchaNumero: tipo === 'cancha' ? 1 : 2, pareja1Id: tipo === 'pareja' ? partido(caso, 1).pareja1Id : null } });
    const r = await post(caso, '/partidos/fijar', sel.body);
    assert.equal(r.status, 409); assert.equal(r.body.codigo, 'ESTADO_PRECHECK_CAMBIO'); assert.ok(r.body.preCheck.revision);
    assert.deepEqual(await disponibilidad(caso), original); assert.equal(partido(caso, 1).fijadoManual, undefined);
    assert.equal(partido(caso, 1).fechaHora, null, 'No adopta el horario si cambió el estado');
  }

  // Cambio detectado DENTRO de la transacción (el no-op no pisa datos actuales).
  const carrera = await crearCaso('fijacion-carrera-interna'), preCarrera = await precheck(carrera);
  const selCarrera = await elegir(carrera, preCarrera, 1), originalCarrera = await disponibilidad(carrera);
  const txOriginal = prisma.$transaction;
  prisma.$transaction = (fn, opts) => txOriginal.call(prisma, async (tx) => {
    await tx.torneo.update({ where: { id: carrera.torneo.id }, data: { inscripcionAbierta: true } });
    return fn(tx);
  }, opts);
  let fallo;
  try { fallo = await post(carrera, '/partidos/fijar', selCarrera.body); } finally { prisma.$transaction = txOriginal; }
  assert.equal(fallo.status, 409); assert.equal(fallo.body.codigo, 'ESTADO_PRECHECK_CAMBIO');
  assert.equal((await prisma.torneo.findUnique({ where: { id: carrera.torneo.id } })).inscripcionAbierta, false, 'Rollback de la transacción completa');
  assert.deepEqual(await disponibilidad(carrera), originalCarrera); assert.equal(partido(carrera, 1).fijadoManual, undefined);

  const rollback = await crearCaso('fijacion-rollback'), preRollback = await precheck(rollback);
  const selRollback = await elegir(rollback, preRollback, 1, 'Viernes-09:00'), originalRollback = await disponibilidad(rollback);
  assert.equal(selRollback.opcion.parejasAAmpliar.length, 2);
  let altas = 0;
  prisma.$transaction = (fn, opts) => txOriginal.call(prisma, async (tx) => {
    const crear = tx.slotPareja.createMany.bind(tx.slotPareja);
    tx.slotPareja.createMany = async (args) => { const res = await crear(args); altas += res.count; return res; };
    tx.pareja.updateMany = async () => { throw Object.assign(new Error('Estado cambiado durante la escritura.'), { statusCode: 409, codigo: 'ESTADO_PRECHECK_CAMBIO' }); };
    return fn(tx);
  }, opts);
  try { fallo = await post(rollback, '/partidos/fijar', selRollback.body); } finally { prisma.$transaction = txOriginal; }
  assert.equal(altas, 2, 'Se intentó guardar los slots de ambas parejas'); assert.equal(fallo.status, 409);
  assert.deepEqual(await disponibilidad(rollback), originalRollback, 'Ambas altas se revierten');
  assert.equal(partido(rollback, 1).fijadoManual, undefined); assert.equal(partido(rollback, 1).fechaHora, null);
  const exito = await fijar(rollback, selRollback);
  const repetida = await post(rollback, '/partidos/fijar', selRollback.body);
  assert.equal(repetida.status, 409); assert.equal(repetida.body.codigo, 'REVISION_PRECHECK_VIEJA'); assert.equal(repetida.body.preCheck.revision, exito.revision);
  const claveAnterior = await post(rollback, '/partidos/fijar', { ...selRollback.body, revision: exito.revision });
  assert.equal(claveAnterior.status, 409); assert.equal(claveAnterior.body.codigo, 'OPCION_VENCIDA');
  const expirada = await crearCaso('fijacion-sesion-expirada'), preExpirada = await precheck(expirada);
  const selExpirada = await elegir(expirada, preExpirada, 1), antesExpirada = await disponibilidad(expirada);
  sesion(expirada).expiresAt = Date.now() - 1;
  const resExpirada = await post(expirada, '/partidos/fijar', selExpirada.body);
  assert.equal(resExpirada.status, 409); assert.equal(resExpirada.body.codigo, 'REVISION_PRECHECK_VIEJA');
  assert.equal(resExpirada.body.preCheck.sesionReiniciada, true); assert.deepEqual(await disponibilidad(expirada), antesExpirada);
  console.log('PASS: claves/revisiones, permisos, ocupación cambiada, verificación dentro de transacción y rollback real');
}

async function testMini() {
  const c = await crearCaso('fijacion-mini', [['Viernes-13:00'], ['Viernes-14:30'], ['Sabado-09:00'], ['Sabado-10:30']]);
  let pre = await precheck(c);
  assert.equal(zona(c).formato, 'MINI_BRACKET');
  for (const pos of [3, 4]) assert.ok((await post(c, '/partidos/opciones', query(c, pre, pos))).body.opciones.every((o) => o.motivo === 'ESPERA_BASES'));
  pre = await fijar(c, await elegir(c, pre, 1, 'Viernes-09:00'));
  assert.ok((await post(c, '/partidos/opciones', query(c, pre, 3))).body.opciones.every((o) => o.motivo === 'ESPERA_BASES'));
  pre = await fijar(c, await elegir(c, pre, 2, 'Viernes-10:15'));
  assert.ok(partido(c, 1).fijadoManual); assert.ok(partido(c, 2).fijadoManual);
  const sel = await elegir(c, pre, 3, 'Viernes-11:30');
  assert.equal(sel.opcion.parejasAAmpliar.length, 4);
  const antes = await disponibilidad(c);
  const p1 = horario(partido(c, 1)), p2 = horario(partido(c, 2));
  pre = await fijar(c, sel);
  const despues = await disponibilidad(c);
  for (let i = 0; i < 4; i++) {
    assert.equal(despues[i].resolucionManual, true);
    assert.deepEqual(despues[i].slotsSeleccionados.map((s) => s.slotId), [...antes[i].slotsSeleccionados.map((s) => s.slotId), 'Viernes-11:30'].sort());
  }
  assert.deepEqual(horario(partido(c, 1)), p1); assert.deepEqual(horario(partido(c, 2)), p2);
  assert.equal(partido(c, 3).fijadoManual, true); assert.equal(+partido(c, 3).fechaHora, ms('Viernes-11:30'));
  assert.ok(zona(c).partidos.every((p) => !p.sinHorarioAsignado && p.fechaHora && p.canchaNumero));
  assert.equal(zona(c).requiereArmadoManual, false); assert.equal(hayConflicto(c, pre), false, 'Zona completa sin conflicto residual');
  assert.equal(+partido(c, 4).fechaHora, ms('Viernes-11:30'), 'P3/P4 pueden coincidir');
  assert.notEqual(partido(c, 4).canchaNumero, partido(c, 3).canchaNumero);
  console.log('PASS: MINI espera ambos bases, pide ampliación a cuatro, preserva P1/P2 y retira el conflicto');
}

async function testIncompleta() {
  const c = await crearCaso('fijacion-incompleta');
  const pre = await precheck(c);
  presupuestoLista = 0; presupuestoFijar = 0;
  try {
    const sel = await elegir(c, pre, 1); assert.equal(sel.opcion.verificada, false);
    await fijar(c, sel); assert.equal(partido(c, 1).fijadoManual, true, 'Acepta BUSQUEDA_INCOMPLETA estructural');
  } finally { presupuestoLista = null; presupuestoFijar = null; }
  const imposible = await crearCaso('fijacion-no-factible', [['Viernes-09:00'], ['Sabado-09:00'], ['Viernes-12:00']], {
    club: { viernesInicio: '09:00', viernesFin: '10:15', sabadoInicio: '09:00', sabadoFin: '10:15', cantidadCanchas: 2 },
  });
  const preImposible = await precheck(imposible), antes = await disponibilidad(imposible);
  presupuestoLista = 0;
  let sel;
  try { sel = await elegir(imposible, preImposible, 1, 'Viernes-09:00'); }
  finally { presupuestoLista = null; }
  const r = await post(imposible, '/partidos/fijar', sel.body);
  assert.equal(r.status, 409); assert.equal(r.body.codigo, 'OPCION_NO_FACTIBLE');
  assert.deepEqual(await disponibilidad(imposible), antes); assert.equal(partido(imposible, 1).fijadoManual, undefined);
  console.log('PASS: incompleta aceptada, NO_FACTIBLE al recalcular rechazada sin altas');
}

async function testPropuestaEInicio() {
  const c = await crearCaso('fijacion-propuesta-inicio', undefined, { pendientes: true });
  let pre = await precheck(c);
  pre = await fijar(c, await elegir(c, pre, 1, 'Viernes-15:45'));
  const pin = horario(partido(c, 1));
  const propuestas = await post(c, '/propuestas', { categoriaId: c.cat.id, zonaId: zona(c).id, revision: pre.revision });
  assert.equal(propuestas.status, 200); assert.ok(propuestas.body.propuestasZona.length);
  const propuesta = propuestas.body.propuestasZona[0];
  for (const p of propuestas.body.propuestasZona) assert.deepEqual(horario({ ...p.partidosPropuestos.find((p) => p.posicionEnRonda === 1), sinHorarioAsignado: false }), pin, 'El generador respeta el fijo');
  const antes = await disponibilidad(c), guardada = sesion(c).propuestasCache.get(propuesta.clave);
  const testigo = guardada.propuesta.partidosPropuestos.find((p) => p.posicionEnRonda === 1), cancha = testigo.canchaNumero;
  testigo.canchaNumero = cancha === 1 ? 2 : 1;
  const incompatible = await post(c, '/propuestas/aplicar', { clave: propuesta.clave, revision: pre.revision });
  assert.equal(incompatible.status, 409); assert.equal(incompatible.body.codigo, 'PROPUESTA_NO_FACTIBLE');
  assert.deepEqual(await disponibilidad(c), antes); assert.deepEqual(horario(partido(c, 1)), pin);
  testigo.canchaNumero = cancha;
  const aplicada = await post(c, '/propuestas/aplicar', { clave: propuesta.clave, revision: pre.revision });
  assert.equal(aplicada.status, 200); pre = aplicada.body;
  assert.deepEqual(horario(partido(c, 1)), pin); assert.equal(partido(c, 1).fijadoManual, true);
  assert.equal(hayConflicto(c, pre), false); assert.ok(pre.planEmergenciaId);
  const plan = structuredClone(sesion(c).categoriasPlan), txOriginal = prisma.$transaction;
  const creados = new Map(), actualizados = [];
  prisma.$transaction = (fn, opts) => txOriginal.call(prisma, async (tx) => {
    const create = tx.partido.create.bind(tx.partido), update = tx.partido.update.bind(tx.partido);
    tx.partido.create = async (args) => { const p = await create(args); if (p.zonaId) creados.set(p.id, p.sinHorarioAsignado); return p; };
    tx.partido.update = async (args) => {
      if (creados.has(args.where.id)) { assert.equal(creados.get(args.where.id), true, 'El greedy no debe tocar un partido ya agendado'); actualizados.push(args.where.id); }
      return update(args);
    };
    return fn(tx);
  }, opts);
  try { await svc.iniciarTorneoMultiCategoria(c.org.id, c.torneo.id, pre.planEmergenciaId); }
  finally { prisma.$transaction = txOriginal; }
  assert.ok(actualizados.length, 'El greedy procesó pendientes de la otra categoría');
  const db = await prisma.partido.findMany({ where: { categoria: { torneoId: c.torneo.id }, zonaId: { not: null } }, include: { zona: true } });
  for (const cat of plan) for (const z of cat.zonas) for (const p of z.partidos.filter((p) => !p.sinHorarioAsignado)) {
    const guardado = db.find((q) => q.categoriaId === cat.categoriaId && q.zona.nombre === z.nombre && q.posicionEnRonda === p.posicionEnRonda);
    assert.ok(guardado); assert.deepEqual(horario(guardado), horario(p), 'Inicio conserva exactamente fecha y cancha del plan');
  }
  const fijoDB = db.find((p) => p.categoriaId === c.cat.id && p.posicionEnRonda === 1);
  assert.deepEqual(horario(fijoDB), pin);
  console.log('PASS: propuesta posterior conserva el fijo, conflicto al moverlo e inicio con greedy verificado en test.db');
}

async function testDeterminismo() {
  const a = await crearCaso('fijacion-determinista-a'), b = await crearCaso('fijacion-determinista-b');
  const preA = await precheck(a), preB = await precheck(b);
  // Perturbar UUID y orden de entrada sin cambiar el orden natural de parejas/partidos.
  zona(b).partidos.reverse(); zona(b).parejaIds.reverse();
  const actualB = await precheck(b);
  const selA = await elegir(a, preA, 1, 'Viernes-15:45'), selB = await elegir(b, actualB, 1, 'Viernes-15:45');
  assert.equal(selA.opcion.clave, selB.opcion.clave);
  const resA = await fijar(a, selA), resB = await fijar(b, selB);
  assert.deepEqual(horario(partido(a, 1)), horario(partido(b, 1)));
  const pA = await post(a, '/partidos/opciones', query(a, resA, 2)), pB = await post(b, '/partidos/opciones', query(b, resB, 2));
  const normalizar = (r, c) => r.body.opciones.map((o) => ({ ...o,
    parejasAAmpliar: o.parejasAAmpliar.map((id) => c.parejas.findIndex((p) => p.id === id)),
    parejasOcupadas: o.parejasOcupadas.map((id) => c.parejas.findIndex((p) => p.id === id)) }));
  assert.equal(pA.status, 200); assert.equal(pB.status, 200); assert.deepEqual(normalizar(pA, a), normalizar(pB, b));
  assert.ok(preB.revision);
  console.log('PASS: fijación y opciones posteriores deterministas con UUID y entradas permutados');
}

async function testInicioConPlanInvalidadoDuranteEspera() {
  const c = await crearCaso('fijacion-inicio-concurrente', [viernes('18:00', '23:00'), viernes('18:00', '23:00')]);
  const pre = await precheck(c), planId = pre.planId || pre.planEmergenciaId;
  assert.ok(planId); const estadoAntes = await prisma.torneo.findUnique({ where: { id: c.torneo.id } });
  const txOriginal = prisma.$transaction;
  prisma.$transaction = (fn, opts) => txOriginal.call(prisma, async (tx) => {
    // El inicio ya leyó el caché fuera de la transacción. Una fijación confirmada
    // lo invalida mientras el inicio espera el bloqueo, aun sin cambiar disponibilidad.
    svc.planesCache.delete(planId);
    return fn(tx);
  }, opts);
  try { await assert.rejects(svc.iniciarTorneoMultiCategoria(c.org.id, c.torneo.id, planId), (e) => e.statusCode === 409); }
  finally { prisma.$transaction = txOriginal; }
  assert.equal(await prisma.partido.count({ where: { categoriaId: c.cat.id } }), 0);
  assert.deepEqual(await prisma.torneo.findUnique({ where: { id: c.torneo.id } }), estadoAntes, 'El inicio revierte incluso el cierre de inscripción');
  console.log('PASS: inicio rechaza un plan invalidado mientras esperaba el bloqueo');
}

async function testZonaNoManual() {
  const c = await crearCaso('fijacion-zona-no-manual', [
    ['Viernes-18:00', 'Viernes-19:15'], ['Viernes-18:00'], ['Viernes-18:00', 'Viernes-19:15'],
  ]);
  const pre = await precheck(c);
  assert.equal(zona(c).requiereArmadoManual, false); assert.equal(zona(c).esZonaManualOriginal, false);
  const pendientes = pre.conflictos.find((cat) => cat.categoriaId === c.cat.id).partidosSinHorario;
  assert.equal(pendientes.length, 1); assert.equal(pendientes[0].motivo, 'SIN_CANCHA_DISPONIBLE');
  const conflicto = pendientes[0]; assert.ok(Number.isInteger(conflicto.posicionEnRonda));
  const previos = zona(c).partidos.filter((p) => !p.sinHorarioAsignado);
  assert.equal(previos.length, 2);
  const horariosPrevios = previos.map((p) => [p.posicionEnRonda, horario(p)]);
  const body = { categoriaId: c.cat.id, zonaId: conflicto.zonaId, posicionEnRonda: conflicto.posicionEnRonda, revision: pre.revision };
  const opciones = await post(c, '/partidos/opciones', body); assert.equal(opciones.status, 200);
  assert.ok(opciones.body.opciones.length);
  for (const o of opciones.body.opciones.filter((o) => o.estado !== 'NO_DISPONIBLE')) {
    const inicio = +new Date(o.fechaHora), fin = inicio + 75 * 60_000;
    for (const p of previos) assert.ok(fin <= +p.fechaHora || inicio >= +p.fechaHora + 75 * 60_000,
      'En RR de tres, los otros dos partidos se conservan fijos y no se superponen');
  }
  const despues = await fijar(c, { body: { ...body, clave: opciones.body.opciones.find((o) => o.estado !== 'NO_DISPONIBLE').clave } });
  assert.equal(hayConflicto(c, despues), false);
  assert.deepEqual(previos.map((p) => [p.posicionEnRonda, horario(p)]), horariosPrevios);
  const fijado = partido(c, conflicto.posicionEnRonda), guardado = horario(fijado);
  assert.equal(fijado.fijadoManual, true);
  assert.equal(guardado.fechaHora, +new Date(opciones.body.opciones.find((o) => o.estado !== 'NO_DISPONIBLE').fechaHora));
  const recheck = await precheck(c);
  assert.equal(hayConflicto(c, recheck), false); assert.deepEqual(horario(fijado), guardado);
  assert.deepEqual(previos.map((p) => [p.posicionEnRonda, horario(p)]), horariosPrevios);

  const mini = await crearCaso('fijacion-mini-no-manual', Array.from({ length: 4 }, () => ['Viernes-18:00']));
  const miniPre = await precheck(mini);
  assert.equal(zona(mini).requiereArmadoManual, false); assert.equal(zona(mini).esZonaManualOriginal, false);
  const definiciones = miniPre.conflictos.find((cat) => cat.categoriaId === mini.cat.id).partidosSinHorario;
  assert.deepEqual(definiciones.map((p) => [p.motivo, p.posicionEnRonda]), [['PARTIDO_SIN_HORARIO', 3], ['PARTIDO_SIN_HORARIO', 4]]);
  const bases = zona(mini).partidos.filter((p) => p.posicionEnRonda <= 2).map((p) => [p.posicionEnRonda, horario(p)]);
  const miniDespues = await fijar(mini, await elegir(mini, miniPre, definiciones[0].posicionEnRonda));
  assert.equal(hayConflicto(mini, miniDespues), false);
  const miniRecheck = await precheck(mini); assert.equal(hayConflicto(mini, miniRecheck), false);
  assert.deepEqual(zona(mini).partidos.filter((p) => p.posicionEnRonda <= 2).map((p) => [p.posicionEnRonda, horario(p)]), bases);
  assert.equal(partido(mini, 3).fijadoManual, true);
  console.log('PASS: RR y MINI no manuales exponen posición, fijan por HTTP sin mover agendados y retiran el conflicto tras re-check');
}

async function main() {
  await ensureTestDb();
  const { server, baseUrl: url } = await startTestServer(); baseUrl = url;
  try { await testFijacion(); await testConflictos(); await testMini(); await testIncompleta(); await testPropuestaEInicio(); await testDeterminismo(); await testInicioConPlanInvalidadoDuranteEspera(); await testZonaNoManual(); }
  finally { await new Promise((r) => server.close(r)); await prisma.$disconnect(); }
}
main().then(() => process.exit(0)).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
