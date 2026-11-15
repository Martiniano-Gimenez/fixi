'use strict';

require('./utils/testEnvGuard');
const { ensureTestDb } = require('./utils/testEnvGuard');
const { resetTestDb } = require('./reset-test-db');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const jwt = require('jsonwebtoken');
const prisma = require('../src/lib/prisma');
const { JWT_SECRET } = require('../src/config/env');

const GENERICO = { error: 'Ocurrió un error inesperado. Probá de nuevo.' };
const EMAIL = 'errores-http@example.com';

async function probarHttp() {
  await ensureTestDb();
  const owner = await prisma.organizador.findUniqueOrThrow({ where: { email: EMAIL } });
  const token = jwt.sign({ id: owner.id }, JWT_SECRET);
  const servicio = require('../src/services/organizador.service');
  const { app } = require('../src/index');
  const { startTestServer } = require('./utils/testServer');
  const originales = { getOrganizador: servicio.getOrganizador, sendFile: app.response.sendFile, error: console.error };
  const logs = [];
  console.error = (...args) => logs.push(args);
  let temporal, enviosIndex = 0;
  const html = '<!doctype html><html lang="es"><body>Frontend de prueba</body></html>';
  // El comodín real sigue llamando a sendFile con frontend/dist/index.html. Se sirve un archivo
  // temporal para probarlo también sin dist, sin generar ni modificar archivos del frontend.
  if (process.env.NODE_ENV === 'production') {
    temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'fixi-errores-http-'));
    fs.writeFileSync(path.join(temporal, 'index.html'), html);
    app.response.sendFile = function (archivo, ...args) {
      assert.equal(archivo, path.resolve(__dirname, '../../frontend/dist/index.html'));
      enviosIndex++;
      return originales.sendFile.call(this, path.join(temporal, 'index.html'), ...args);
    };
  }
  const { server, baseUrl } = await startTestServer();
  async function pedir(ruta, { method = 'GET', body, headers } = {}) {
    const res = await fetch(`${baseUrl}${ruta}`, { method, headers: {
      Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers,
    }, body });
    const texto = await res.text();
    const tipo = res.headers.get('content-type') || '';
    return { status: res.status, tipo, texto, json: tipo.includes('application/json') ? JSON.parse(texto) : null };
  }
  const perfil = () => pedir('/organizador/perfil');
  function esperar(r, status, json) {
    assert.equal(r.status, status, r.texto);
    assert.match(r.tipo, /^application\/json\b/);
    assert.deepEqual(r.json, json);
  }
  const snapshot = () => prisma.organizador.findMany({ orderBy: { id: 'asc' } });
  const antes = await snapshot();
  try {
    for (const statusCode of [undefined, 500, 503, 599]) {
      const error = new Error('Fallo interno en C:\\servidor\\backend\\partido.service.js:536 con datos privados');
      error.codigo = 'NO_EXPONER';
      error.detail = { campoInterno: 'privado' };
      if (statusCode !== undefined) error.statusCode = statusCode;
      servicio.getOrganizador = async () => { throw error; };
      const r = await perfil();
      esperar(r, 500, GENERICO);
      assert.doesNotMatch(r.texto, /stack|message|detail|Prisma|servidor|partido\.service|NO_EXPONER/);
      assert.ok(logs.some((args) => args.includes(error) && args.some((arg) => arg?.stack?.includes('partido.service.js:536'))),
        'console.error recibe el error completo, con su stack');
    }
    // Un status sin statusCode tampoco habilita la exposición de mensajes internos.
    servicio.getOrganizador = async () => { throw Object.assign(new Error('detalle privado'), { status: 400 }); };
    esperar(await perfil(), 500, GENERICO);
    servicio.getOrganizador = originales.getOrganizador;
    esperar(await pedir('/organizador/perfil', { method: 'PATCH', body: JSON.stringify({ nombre: 'a' }) }), 400,
      { error: 'El nombre del club debe tener entre 2 y 80 caracteres.' });
    for (const statusCode of [400, 401, 403, 404, 409, 422, 429]) {
      servicio.getOrganizador = async () => { throw Object.assign(new Error('Volvé a verificar antes de seguir.'), {
        statusCode, codigo: 'ESTADO_PRECHECK_CAMBIO', detail: 'no se expone',
      }); };
      esperar(await perfil(), statusCode, { error: 'Volvé a verificar antes de seguir.', codigo: 'ESTADO_PRECHECK_CAMBIO' });
    }
    servicio.getOrganizador = originales.getOrganizador;
    esperar(await pedir('/auth/register', { method: 'POST', body: '{"email":' }), 400,
      { error: 'El cuerpo del pedido no es un JSON válido.' });
    esperar(await pedir('/auth/register', { method: 'POST', body: JSON.stringify({ texto: 'a'.repeat(110 * 1024) }) }), 413,
      { error: 'El pedido es demasiado grande.' });
    for (const headers of [{ 'Content-Type': 'application/json; charset=iso-8859-1' }, { 'Content-Encoding': 'desconocido' }]) {
      esperar(await pedir('/auth/register', { method: 'POST', body: '{}', headers }), 415,
        { error: 'No se pudo procesar el cuerpo del pedido.' });
    }
    servicio.getOrganizador = async () => prisma.organizador.create({ data: {
      email: EMAIL, nombre: 'Duplicado', passwordHash: 'no-se-usa',
    } });
    esperar(await perfil(), 409, { error: 'Ya existe un registro con esos datos.' });
    servicio.getOrganizador = async () => prisma.organizador.update({ where: { id: 'no-existe' }, data: { nombre: 'Inexistente' } });
    esperar(await perfil(), 404, { error: 'Registro no encontrado.' });
    servicio.getOrganizador = originales.getOrganizador;
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      esperar(await pedir('/inexistente', { method }), 404, { error: 'Ruta no encontrada.' });
    }
    for (const ruta of ['', '/public/inexistente/otra', '/partidos/no-existe/fecha-hora']) {
      esperar(await pedir(ruta), 404, { error: 'Ruta no encontrada.' });
    }
    if (process.env.NODE_ENV === 'production') {
      // /apiary no está bajo /api: la frontera del prefijo también queda cubierta.
      for (const ruta of ['/panel/categorias/prueba', '/apiary']) {
        const res = await fetch(`${baseUrl.replace(/\/api$/, '')}${ruta}`);
        assert.equal(res.status, 200);
        assert.match(res.headers.get('content-type'), /^text\/html\b/);
        assert.equal(await res.text(), html);
      }
      const indexDist = path.resolve(__dirname, '../../frontend/dist/index.html');
      const existeDist = fs.existsSync(indexDist);
      const inicio = await fetch(`${baseUrl.replace(/\/api$/, '')}/`);
      assert.equal(inicio.status, 200);
      assert.match(inicio.headers.get('content-type'), /^text\/html\b/);
      assert.equal(await inicio.text(), existeDist ? fs.readFileSync(indexDist, 'utf8') : html);
      assert.equal(enviosIndex, existeDist ? 2 : 3, 'Las rutas de API no llegan al comodín del frontend');
    }
    assert.deepEqual(await snapshot(), antes, 'Las pruebas de error no escriben en la base');
    console.log(`PASS HTTP ${process.env.NODE_ENV || 'sin NODE_ENV'}: 500 sin detalles y con log completo; 4xx, parser, Prisma y 404 JSON; frontend preservado`);
  } finally {
    servicio.getOrganizador = originales.getOrganizador;
    app.response.sendFile = originales.sendFile;
    console.error = originales.error;
    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
    if (temporal) {
      fs.unlinkSync(path.join(temporal, 'index.html'));
      fs.rmdirSync(temporal);
    }
  }
}

async function run() {
  if (process.argv.includes('--http')) return probarHttp();
  await ensureTestDb();
  resetTestDb();
  await prisma.organizador.create({ data: { email: EMAIL, nombre: 'Club pruebas', passwordHash: 'no-se-usa' } });
  await prisma.$disconnect();
  // Procesos separados: NODE_ENV se fija antes de cargar la app, sin reutilizar su caché de módulos.
  for (const modo of ['', 'production']) {
    const env = { ...process.env };
    if (modo) env.NODE_ENV = modo;
    else delete env.NODE_ENV;
    const resultado = spawnSync(process.execPath, [__filename, '--http'], { env, encoding: 'utf8', timeout: 60000 });
    process.stdout.write(resultado.stdout || '');
    assert.equal(resultado.status, 0, resultado.stderr || resultado.error?.message || `Falló HTTP ${modo}`);
  }
}

run().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
