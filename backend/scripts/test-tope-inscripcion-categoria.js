'use strict';
const { ensureTestDb } = require('./utils/testEnvGuard');
const { resetTestDb } = require('./reset-test-db');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const prisma = require('../src/lib/prisma');
const { JWT_SECRET } = require('../src/config/env');
const { startTestServer } = require('./utils/testServer');
const { MAX_PAREJAS_INSCRIPCION } = require('../src/services/inscripcion.service');
process.env.INSCRIPCION_MAX_POR_VENTANA = '1000';

async function run() {
  await ensureTestDb();
  resetTestDb();
  assert.equal(MAX_PAREJAS_INSCRIPCION, 48);
  const org = await prisma.organizador.create({ data: { nombre: 'Club cupo', email: 'cupo@example.com', passwordHash: 'test', cantidadCanchas: 3,
    viernesInicio: '18:00', viernesFin: '23:00', sabadoInicio: '09:00', sabadoFin: '23:00', domingoInicio: '09:00', domingoFin: '23:00' } });
  const torneo = await prisma.torneo.create({ data: { organizadorId: org.id, nombre: 'Cupo público', slug: 'cupo-publico', inscripcionAbierta: true, fecha: new Date('2027-01-08T15:00:00Z') } });
  const categorias = [];
  for (const nombre of ['5ta', '6ta', '7ma']) categorias.push(await prisma.categoria.create({ data: { torneoId: torneo.id, nombre } }));
  for (const cat of categorias.slice(0, 2)) {
    await prisma.pareja.createMany({ data: Array.from({ length: 47 }, (_, i) => ({ categoriaId: cat.id, orden: i + 1, jugador1: `Panel ${i} A`, jugador2: `Panel ${i} B`, origen: 'ORGANIZADOR' })) });
  }
  const { server, baseUrl } = await startTestServer();
  const mensaje = 'Esta categoría ya está completa. Elegí otra o consultá con la organización.';
  const body = (cat, nombre) => ({ categoriaId: cat.id, jugador1: nombre, jugador2: 'Compañero', telefono: '3515551234', cualquierHorario: true, slotIds: [], website: '' });
  const http = async (method, ruta, data, token) => {
    const res = await fetch(`${baseUrl}${ruta}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: data && JSON.stringify(data) });
    return { status: res.status, json: await res.json() };
  };
  const alta = (cat, nombre) => http('POST', `/public/${torneo.slug}/inscripcion`, body(cat, nombre));
  const foto = () => Promise.all([prisma.pareja.findMany({ orderBy: { id: 'asc' } }), prisma.slotPareja.findMany(), prisma.torneo.findUnique({ where: { id: torneo.id } })]);
  try {
    const inicial = await http('GET', `/public/${torneo.slug}/inscripcion`);
    assert.ok(inicial.json.categorias.every(c => c.completa === false));
    assert.equal((await alta(categorias[0], 'Último lugar')).status, 201);
    assert.equal(await prisma.pareja.count({ where: { categoriaId: categorias[0].id } }), 48, 'Las 47 altas del panel cuentan');
    const antes = await foto();
    const rechazo = await alta(categorias[0], 'No entra');
    assert.deepEqual(rechazo, { status: 409, json: { error: mensaje, codigo: 'CATEGORIA_COMPLETA' } });
    assert.deepEqual(await foto(), antes, 'El rechazo no escribe parejas, disponibilidad ni torneo');

    const simultaneas = await Promise.all([alta(categorias[1], 'Simultánea A'), alta(categorias[1], 'Simultánea B')]);
    assert.deepEqual(simultaneas.map(r => r.status).sort(), [201, 409]);
    assert.equal(simultaneas.find(r => r.status === 409).json.codigo, 'CATEGORIA_COMPLETA');
    assert.equal(await prisma.pareja.count({ where: { categoriaId: categorias[1].id } }), 48);
    assert.equal((await alta(categorias[2], 'Otra categoría')).status, 201);

    const token = jwt.sign({ id: org.id }, JWT_SECRET, { expiresIn: '1h' });
    const panel = await http('POST', `/categorias/${categorias[0].id}/parejas`, { jugador1: 'Pareja cuarenta y nueve', jugador2: 'Desde el panel' }, token);
    assert.equal(panel.status, 201, JSON.stringify(panel.json));
    assert.equal(await prisma.pareja.count({ where: { categoriaId: categorias[0].id } }), 49);
    const lectura = await http('GET', `/public/${torneo.slug}/inscripcion`);
    assert.equal(lectura.status, 200);
    for (const cat of lectura.json.categorias) {
      assert.deepEqual(Object.keys(cat).sort(), ['completa', 'id', 'nombre'], 'No se publica la cantidad');
      assert.equal(cat.completa, cat.id !== categorias[2].id);
    }
    const sinCambios = await foto();
    const honeypot = await http('POST', `/public/${torneo.slug}/inscripcion`, { ...body(categorias[0], 'Bot'), website: 'spam' });
    assert.equal(honeypot.status, 201, 'El honeypot conserva su respuesta');
    assert.deepEqual(await foto(), sinCambios);
    console.log('PASS cupo público: 47→48, rechazo sin escrituras, concurrencia, GET sin cantidades, otra categoría, panel 49 y honeypot');
  } finally { await new Promise(resolve => server.close(resolve)); await prisma.$disconnect(); }
}
run().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
