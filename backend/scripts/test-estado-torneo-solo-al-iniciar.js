'use strict';

require('./utils/testEnvGuard');
const { ensureTestDb } = require('./utils/testEnvGuard');
const { resetTestDb } = require('./reset-test-db');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const prisma = require('../src/lib/prisma');
const { JWT_SECRET } = require('../src/config/env');
const { startTestServer } = require('./utils/testServer');

const MSG_INICIO = 'Para iniciar el torneo usá Iniciar torneo.';
const MSG_ESTADO = 'El estado del torneo se actualiza automáticamente con los resultados.';

async function run() {
  await ensureTestDb();
  resetTestDb();
  const org = await prisma.organizador.create({ data: { nombre: 'Club inicio', email: 'estado-inicio@example.com', passwordHash: 'test', cantidadCanchas: 3,
    viernesInicio: '18:00', viernesFin: '23:00', sabadoInicio: '09:00', sabadoFin: '23:00', domingoInicio: '09:00', domingoFin: '23:00' } });
  const torneo = await prisma.torneo.create({ data: { organizadorId: org.id, nombre: 'Torneo en borrador', slug: 'estado-solo-al-iniciar',
    fecha: new Date('2027-01-08T12:00:00-03:00'), inscripcionAbierta: true } });
  const cat = await prisma.categoria.create({ data: { torneoId: torneo.id, nombre: '5ta', parejas: {
    create: Array.from({ length: 6 }, (_, i) => ({ orden: i + 1, jugador1: `Jugador ${i + 1}`, jugador2: 'Pareja' })),
  } } });
  const foto = async () => ({
    torneo: await prisma.torneo.findUnique({ where: { id: torneo.id } }),
    categorias: await prisma.categoria.findMany({ where: { torneoId: torneo.id }, orderBy: { id: 'asc' } }),
    zonas: await prisma.zona.findMany({ where: { categoria: { torneoId: torneo.id } }, orderBy: { id: 'asc' } }),
    partidos: await prisma.partido.findMany({ where: { categoria: { torneoId: torneo.id } }, orderBy: { id: 'asc' } }),
    planes: await prisma.precheckPlan.findMany({ where: { torneoId: torneo.id } }),
  });
  const { server, baseUrl } = await startTestServer();
  const http = async (method, cuerpo, accion = '') => {
    const r = await fetch(`${baseUrl}/torneos/${torneo.id}${accion}`, { method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ id: org.id }, JWT_SECRET, { expiresIn: '1h' })}` },
      body: JSON.stringify(cuerpo) });
    return { status: r.status, json: await r.json() };
  };
  const rechazar = async (method, cuerpo, mensaje) => {
    const antes = await foto();
    const r = await http(method, cuerpo);
    assert.equal(r.status, 400, JSON.stringify(r.json));
    assert.equal(r.json.error, mensaje);
    assert.deepEqual(await foto(), antes, 'El rechazo no modifica estado, inscripción, categorías, zonas, partidos ni planes');
  };
  try {
    for (const method of ['PUT', 'PATCH']) {
      await rechazar(method, { estado: 'EN_CURSO' }, MSG_INICIO);
      await rechazar(method, { estado: 'EN_CURSO', nombre: 'Nombre rechazado', fecha: '2027-01-15' }, MSG_INICIO);
      for (const estado of ['FINALIZADO', 'INVENTADO', null, 123, {}]) await rechazar(method, { estado, nombre: 'Tampoco cambia' }, MSG_ESTADO);
      const r = await http(method, { estado: 'BORRADOR', nombre: `Nombre ${method}` });
      assert.equal(r.status, 200);
      const guardado = await foto();
      assert.equal(guardado.torneo.nombre, `Nombre ${method}`);
      assert.equal(guardado.torneo.estado, 'BORRADOR');
      assert.equal(guardado.torneo.inscripcionAbierta, true);
      assert.ok(guardado.categorias.every(c => c.estado === 'BORRADOR'));
      assert.equal(guardado.zonas.length, 0);
      assert.equal(guardado.partidos.length, 0);
    }
    const fecha = await http('PATCH', { estado: 'BORRADOR', fecha: '2027-01-15' });
    assert.equal(fecha.status, 200);
    assert.equal(fecha.json.fecha.slice(0, 10), '2027-01-15');
    assert.equal((await foto()).torneo.inscripcionAbierta, true);
    console.log('PASS PUT y PATCH: rechazos sin escrituras, mismo estado ignorado y nombre/fecha editables en borrador');

    const precheck = await http('POST', {}, '/pre-check-inicio');
    assert.equal(precheck.status, 200, JSON.stringify(precheck.json));
    assert.ok(precheck.json.planId);
    const inicio = await http('POST', { planId: precheck.json.planId }, '/iniciar');
    assert.equal(inicio.status, 200, JSON.stringify(inicio.json));
    const iniciado = await foto();
    assert.equal(iniciado.torneo.estado, 'EN_CURSO');
    assert.equal(iniciado.torneo.inscripcionAbierta, false);
    assert.equal(iniciado.categorias.find(c => c.id === cat.id).estado, 'EN_CURSO');
    assert.ok(iniciado.zonas.length > 0 && iniciado.partidos.length > 0, 'El inicio real arma las categorías y programa partidos');
    for (const method of ['PUT', 'PATCH']) {
      await rechazar(method, { estado: 'FINALIZADO', nombre: 'No cerrar' }, MSG_ESTADO);
      await rechazar(method, { estado: 'BORRADOR' }, MSG_ESTADO);
    }
    // Estado histórico artificial: editar el mismo estado tampoco puede cerrar la inscripción.
    await prisma.torneo.update({ where: { id: torneo.id }, data: { inscripcionAbierta: true } });
    const antes = await foto();
    for (const method of ['PUT', 'PATCH']) {
      const r = await http(method, { estado: 'EN_CURSO', nombre: `Iniciado ${method}` });
      assert.equal(r.status, 200);
      const despues = await foto();
      assert.equal(despues.torneo.nombre, `Iniciado ${method}`);
      assert.equal(despues.torneo.estado, 'EN_CURSO');
      assert.equal(despues.torneo.inscripcionAbierta, true);
      for (const campo of ['categorias', 'zonas', 'partidos', 'planes']) assert.deepEqual(despues[campo], antes[campo]);
    }
    console.log('PASS inicio real por pre-check y POST /iniciar: estado, cierre de inscripción y armado; la edición no altera estados ni inscripción');
  } finally { await new Promise(resolve => server.close(resolve)); await prisma.$disconnect(); }
}
run().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
