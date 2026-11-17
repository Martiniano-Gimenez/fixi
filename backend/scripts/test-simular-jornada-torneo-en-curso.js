'use strict';
const { ensureTestDb } = require('./utils/testEnvGuard');
const { resetTestDb } = require('./reset-test-db');
const assert = require('node:assert/strict');
const { Prisma } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const prisma = require('../src/lib/prisma');
const { JWT_SECRET } = require('../src/config/env');
const { startTestServer } = require('./utils/testServer');

const CONFIG = { nombre: 'Club jornada', cantidadCanchas: 3,
  viernesInicio: '18:00', viernesFin: '23:00', sabadoInicio: '09:00', sabadoFin: '22:00',
  domingoInicio: '09:00', domingoFin: '21:00' };
const BLOQUEO = 'Tenés un torneo en curso. Podés cambiar las canchas y los horarios del club cuando termine. Para cerrar canchas un día, usá Lluvia.';

async function snapshot() {
  return Promise.all(Prisma.dmmf.datamodel.models.map(async ({ name }) => {
    const filas = await prisma[name[0].toLowerCase() + name.slice(1)].findMany();
    return [name, filas.map(fila => JSON.stringify(fila)).sort()];
  }));
}

async function run() {
  await ensureTestDb();
  resetTestDb();
  const org = await prisma.organizador.create({ data: { ...CONFIG, email: 'simular-jornada@example.com', passwordHash: 'test' } });
  const ajeno = await prisma.organizador.create({ data: { ...CONFIG, email: 'simular-jornada-ajeno@example.com', passwordHash: 'test' } });
  const torneos = {};
  for (const estado of ['EN_CURSO', 'BORRADOR', 'FINALIZADO']) {
    const torneo = await prisma.torneo.create({ data: { organizadorId: org.id, nombre: estado, slug: `simular-jornada-${estado.toLowerCase()}`, estado, fecha: new Date('2027-01-08T15:00:00Z') } });
    torneos[estado] = torneo;
    const categoria = await prisma.categoria.create({ data: { torneoId: torneo.id, nombre: '5ta', estado } });
    for (let i = 1; i <= 2; i++) {
      await prisma.pareja.create({ data: { categoriaId: categoria.id, jugador1: `Ana ${i}`, jugador2: `Luz ${i}`, orden: i,
        slotsSeleccionados: { create: ['Viernes-18:00', 'Viernes-19:00', 'Sabado-09:00'].map(slotId => ({ slotId })) } } });
    }
  }
  await prisma.torneo.create({ data: { organizadorId: ajeno.id, nombre: 'Ajeno en curso', slug: 'simular-jornada-ajeno', estado: 'EN_CURSO', fecha: torneos.BORRADOR.fecha } });
  const { server, baseUrl } = await startTestServer();
  const token = jwt.sign({ id: org.id }, JWT_SECRET, { expiresIn: '1h' });
  const request = async (method, body) => {
    const ruta = method === 'POST' ? 'simular-jornada' : 'perfil';
    const res = await fetch(`${baseUrl}/organizador/${ruta}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    return { status: res.status, json: await res.json() };
  };
  const simularSinEscrituras = async (body, esperado) => {
    const antes = await snapshot();
    assert.deepEqual(await request('POST', body), { status: 200, json: esperado });
    assert.deepEqual(await snapshot(), antes, 'La simulación no escribe en ninguna tabla');
  };
  try {
    const cambios = [{ cantidadCanchas: 2 },
      ...Object.keys(CONFIG).filter(campo => /Inicio|Fin/.test(campo)).map(campo => ({ [campo]: '10:15' })),
      { viernesInicio: '' }, { sabadoFin: null }];
    for (const cambio of cambios) {
      const antes = await snapshot();
      const body = { ...CONFIG, nombre: 'No se guarda', ...cambio };
      const simulacion = await request('POST', body);
      assert.deepEqual(simulacion, { status: 409, json: { error: BLOQUEO } });
      assert.deepEqual(await snapshot(), antes, 'La simulación rechazada no escribe');
      const guardado = await request('PATCH', body);
      assert.deepEqual(guardado, simulacion, 'Simulación y guardado conservan el mismo status, mensaje y código');
      assert.deepEqual(await snapshot(), antes, 'El guardado rechazado no escribe');
    }
    for (const body of [{ nombre: 'Club renombrado' }, {}, CONFIG, { ...CONFIG, nombre: 'Club renombrado' }]) {
      await simularSinEscrituras(body, { slotsAfectados: 0, parejasAfectadas: 0 });
    }
    console.log('PASS en curso: canchas y seis horarios devuelven el mismo 409 que guardar; nombre, valores iguales y pedido vacío siguen permitidos, sin escrituras');

    await prisma.torneo.update({ where: { id: torneos.EN_CURSO.id }, data: { estado: 'FINALIZADO' } });
    const cambio = { ...CONFIG, viernesInicio: '19:00' };
    // Cada torneo tiene dos selecciones a las 18:00; solo cuentan las dos del borrador.
    await simularSinEscrituras(cambio, { slotsAfectados: 2, parejasAfectadas: 2 });
    await simularSinEscrituras({ cantidadCanchas: 1 }, { slotsAfectados: 0, parejasAfectadas: 0 });
    const slotsAntes = await prisma.slotPareja.count();
    const guardado = await request('PATCH', cambio);
    assert.equal(guardado.status, 200, JSON.stringify(guardado.json));
    assert.equal(slotsAntes - await prisma.slotPareja.count(), 2, 'El conteo coincide con lo que borra el guardado');
    await simularSinEscrituras(cambio, { slotsAfectados: 0, parejasAfectadas: 0 });
    console.log('PASS sin torneo propio en curso: conteo solo de BORRADOR, no bloquea el torneo ajeno y coincide con el recorte al guardar');
  } finally { await new Promise(resolve => server.close(resolve)); await prisma.$disconnect(); }
}
run().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
