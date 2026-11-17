'use strict';

require('./utils/testEnvGuard');
const { ensureTestDb } = require('./utils/testEnvGuard');
const { resetTestDb } = require('./reset-test-db');
const assert = require('node:assert/strict');
const { Prisma } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const prisma = require('../src/lib/prisma');
const { JWT_SECRET } = require('../src/config/env');
const { startTestServer } = require('./utils/testServer');
const { reiniciarTorneo } = require('../src/services/torneo.service');
const { getSlotsValidosSet } = require('../src/services/slots.service');

const BLOQUEO = 'Tenés un torneo en curso. Podés cambiar las canchas y los horarios del club cuando termine. Para cerrar canchas un día, usá Lluvia.';
const CONFIG = { nombre: 'Club Norte', cantidadCanchas: 3,
  viernesInicio: '18:00', viernesFin: '23:00', sabadoInicio: '09:00', sabadoFin: '22:00',
  domingoInicio: '09:00', domingoFin: '21:00' };
const HORARIOS = Object.keys(CONFIG).filter((k) => /Inicio|Fin/.test(k));
let baseUrl, token;

async function request(body, metodo = 'PATCH') {
  const ruta = metodo === 'PATCH' ? 'perfil' : 'simular-jornada';
  const r = await fetch(`${baseUrl}/organizador/${ruta}`, { method: metodo,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
}

// Incluye partidos, resultados, estados y disponibilidad, no solo el perfil.
async function snapshot() {
  return Promise.all(Prisma.dmmf.datamodel.models.map(async ({ name }) => {
    const filas = await prisma[name[0].toLowerCase() + name.slice(1)].findMany();
    return [name, filas.map((fila) => JSON.stringify(fila)).sort()];
  }));
}

async function rechaza(body, status, metodo = 'PATCH') {
  const antes = await snapshot();
  const r = await request(body, metodo);
  assert.equal(r.status, status, JSON.stringify(r.json));
  assert.equal(typeof r.json.error, 'string');
  if (status === 409) assert.equal(r.json.error, BLOQUEO);
  assert.deepEqual(await snapshot(), antes, 'El rechazo no debe cambiar ninguna tabla');
}

async function crearTorneo(organizadorId, estado, slug) {
  const torneo = await prisma.torneo.create({ data: { organizadorId, nombre: slug, slug, estado, fecha: new Date('2026-11-20T15:00:00Z') } });
  const categoria = await prisma.categoria.create({ data: { torneoId: torneo.id, nombre: 'Cuarta', estado } });
  const parejas = [];
  for (let orden = 0; orden < 2; orden++) {
    parejas.push(await prisma.pareja.create({ data: { categoriaId: categoria.id, orden,
      jugador1: `Ana ${orden}`, jugador2: `Luz ${orden}`,
      slotsSeleccionados: { create: ['Viernes-18:00', 'Viernes-19:00', 'Sabado-09:00'].map((slotId) => ({ slotId })) } } }));
  }
  await prisma.partido.create({ data: { categoriaId: categoria.id, pareja1Id: parejas[0].id, pareja2Id: parejas[1].id,
    estado: estado === 'FINALIZADO' ? 'FINALIZADO' : estado === 'EN_CURSO' ? 'EN_JUEGO' : 'PENDIENTE',
    ganadorId: estado === 'FINALIZADO' ? parejas[0].id : null,
    fechaHora: new Date('2026-11-20T21:00:00Z'), canchaNumero: 3 } });
  return { torneo, categoria, parejas };
}

async function validarEntradas() {
  for (const nombre of [null, 12, {}, [], true, '', ' ', 'a', ' n ', 'n'.repeat(81)]) {
    await rechaza({ nombre }, 400);
  }
  // El tope existente en ConfiguracionClub es 30: 21 es válido y 31 no.
  for (const cantidadCanchas of [null, '3', {}, [], true, 0, -1, 31, 2.5]) {
    await rechaza({ cantidadCanchas }, 400);
  }
  for (const campo of HORARIOS) {
    for (const valor of ['25:99', 'hola', '24:00', '23:60', '9:00', '09:0', ' 09:00 ', '09:00\n', 900, {}, [], false]) {
      await rechaza({ [campo]: valor }, 400);
    }
  }
  await rechaza([], 400);
  await rechaza({ viernesInicio: '25:99' }, 400, 'POST');
  await rechaza({ cantidadCanchas: 2.5 }, 400, 'POST');
}

async function run() {
  await ensureTestDb();
  resetTestDb();
  const owner = await prisma.organizador.create({ data: { ...CONFIG, email: 'club@example.com', passwordHash: 'no-se-usa' } });
  const otro = await prisma.organizador.create({ data: { ...CONFIG, email: 'otro@example.com', passwordHash: 'no-se-usa' } });
  const borrador = await crearTorneo(owner.id, 'BORRADOR', 'club-borrador');
  const finalizado = await crearTorneo(owner.id, 'FINALIZADO', 'club-finalizado');
  const enCurso = await crearTorneo(owner.id, 'EN_CURSO', 'club-en-curso');
  const ajeno = await crearTorneo(otro.id, 'EN_CURSO', 'club-ajeno');
  token = jwt.sign({ id: owner.id }, JWT_SECRET);
  const iniciado = await startTestServer();
  baseUrl = iniciado.baseUrl;
  try {
    for (const cambio of [{ cantidadCanchas: 1 }, ...HORARIOS.map((campo) => ({ [campo]: '10:15' })),
      { viernesInicio: '' }, { sabadoFin: null }]) {
      await rechaza({ ...CONFIG, nombre: 'No debe guardarse', ...cambio }, 409);
    }
    await validarEntradas();
    const iguales = await request({ ...CONFIG, nombre: '  Club renovado  ' });
    assert.equal(iguales.status, 200, JSON.stringify(iguales.json));
    assert.equal(iguales.json.nombre, 'Club renovado');
    assert.deepEqual(Object.keys(iguales.json).sort(), ['id', 'email', ...Object.keys(CONFIG)].sort());
    assert.equal((await prisma.slotPareja.count()), 24, 'El cambio de nombre conserva la disponibilidad');
    console.log('PASS torneo en curso: cada campo protegido, valores iguales y validaciones 400 antes del bloqueo; rechazos sin escrituras');

    await prisma.torneo.update({ where: { id: enCurso.torneo.id }, data: { estado: 'FINALIZADO' } });
    await validarEntradas();
    const slotsOtros = await prisma.slotPareja.findMany({ where: { pareja: { categoria: { torneoId: { in: [finalizado.torneo.id, enCurso.torneo.id, ajeno.torneo.id] } } } }, orderBy: { id: 'asc' } });
    const partidosAntes = await prisma.partido.findMany({ orderBy: { id: 'asc' } });
    const nuevo = { ...CONFIG, nombre: '  Club nuevo  ', cantidadCanchas: 21, viernesInicio: '19:00' };
    const antes = await snapshot();
    const simulacion = await request(nuevo, 'POST');
    assert.equal(simulacion.status, 200);
    assert.deepEqual(simulacion.json, { slotsAfectados: 2, parejasAfectadas: 2 });
    assert.deepEqual(await snapshot(), antes, 'La vista previa no escribe');
    const totalAntes = await prisma.slotPareja.count();
    const cambio = await request(nuevo);
    assert.equal(cambio.status, 200, JSON.stringify(cambio.json));
    assert.equal(cambio.json.cantidadCanchas, 21);
    assert.equal(cambio.json.nombre, 'Club nuevo');
    assert.equal(totalAntes - await prisma.slotPareja.count(), simulacion.json.slotsAfectados);
    assert.deepEqual(await prisma.slotPareja.findMany({ where: { pareja: { categoria: { torneoId: { in: [finalizado.torneo.id, enCurso.torneo.id, ajeno.torneo.id] } } } }, orderBy: { id: 'asc' } }), slotsOtros);
    assert.equal(await prisma.slotPareja.count({ where: { parejaId: { in: borrador.parejas.map((p) => p.id) }, slotId: 'Viernes-18:00' } }), 0);
    assert.deepEqual(await prisma.partido.findMany({ orderBy: { id: 'asc' } }), partidosAntes, 'Nunca reprograma partidos');
    console.log('PASS sin torneo en curso: BORRADOR y FINALIZADO no bloquean; el ajeno tampoco; recorte solo del borrador y vista previa coincidente');

    // La trasnoche sigue permitida. Los extremos horarios son HH:MM válidos.
    for (const body of [{ cantidadCanchas: 30, nombre: 'n'.repeat(80), viernesInicio: '19:00', viernesFin: '02:00' },
      { cantidadCanchas: 1, nombre: ' Ab ', sabadoInicio: '00:00', sabadoFin: '23:59' },
      { domingoInicio: '', domingoFin: null }]) {
      const r = await request(body);
      assert.equal(r.status, 200, JSON.stringify(r.json));
    }
    const sinDomingo = await request({ domingoInicio: null, domingoFin: '' });
    assert.equal(sinDomingo.status, 200);
    assert.equal(sinDomingo.json.domingoInicio, null);
    assert.equal(sinDomingo.json.domingoFin, null);
    const nuevaPrevia = await request({ domingoInicio: '10:00', domingoFin: '20:00' }, 'POST');
    assert.deepEqual(nuevaPrevia.json, { slotsAfectados: 0, parejasAfectadas: 0 });
    console.log('PASS límites de canchas y nombre, horarios extremos, trasnoche y vacíos normalizados a null');

    // El reinicio existente conserva también los slots que ya no están en la grilla nueva.
    const preservados = await prisma.slotPareja.findMany({ where: { parejaId: { in: finalizado.parejas.map((p) => p.id) } }, orderBy: { id: 'asc' } });
    const grillaActual = getSlotsValidosSet(await prisma.organizador.findUnique({ where: { id: owner.id } }));
    assert.ok(preservados.some((s) => !grillaActual.has(s.slotId)), 'Debe haber disponibilidad histórica fuera de la grilla nueva');
    await reiniciarTorneo(owner.id, finalizado.torneo.id);
    assert.deepEqual(await prisma.slotPareja.findMany({ where: { parejaId: { in: finalizado.parejas.map((p) => p.id) } }, orderBy: { id: 'asc' } }), preservados);
    assert.equal((await prisma.torneo.findUnique({ where: { id: finalizado.torneo.id } })).estado, 'BORRADOR');
    assert.deepEqual((await request({ nombre: 'Club reiniciado' }, 'POST')).json, { slotsAfectados: 0, parejasAfectadas: 0 });
    const trasReinicio = await request({ nombre: 'Club reiniciado' });
    assert.equal(trasReinicio.status, 200);
    assert.deepEqual(await prisma.slotPareja.findMany({ where: { parejaId: { in: finalizado.parejas.map((p) => p.id) } }, orderBy: { id: 'asc' } }), preservados, 'Cambiar el nombre no recorta slots antiguos');
    console.log('PASS reinicio: conserva disponibilidad histórica y los cambios sin horarios no la borran');
  } finally {
    await new Promise((resolve) => iniciado.server.close(resolve));
    await prisma.$disconnect();
  }
}

run().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
