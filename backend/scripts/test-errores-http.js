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
const { Prisma } = require('@prisma/client');
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
  function unicoRegistro(desde, { unaLinea = true } = {}) {
    assert.equal(logs.length, desde + 1, 'Cada error genera una sola llamada al logger');
    assert.equal(logs[desde].length, 1);
    assert.equal(typeof logs[desde][0], 'string', 'Nunca se registra el objeto del error');
    const texto = logs[desde][0];
    if (unaLinea) assert.doesNotMatch(texto, /[\r\n]|\bat .*\.js:\d+/);
    assert.doesNotMatch(texto, /QUERY_PRIVADA|BODY_PRIVADO|HEADERS_PRIVADOS/);
    return texto;
  }
  function esperar(r, status, json) {
    assert.equal(r.status, status, r.texto);
    assert.match(r.tipo, /^application\/json\b/);
    assert.deepEqual(r.json, json);
  }
  const snapshot = () => prisma.organizador.findMany({ orderBy: { id: 'asc' } });
  const antes = await snapshot();
  try {
    for (const statusCode of [undefined, 500, 501, 502, 504, 599]) {
      const error = new Error('Fallo interno en C:\\servidor\\backend\\partido.service.js:536 con datos privados');
      error.codigo = 'NO_EXPONER';
      error.code = 'FALLO_INTERNO';
      error.detail = { campoInterno: 'BODY_PRIVADO' };
      error.body = 'BODY_PRIVADO';
      error.headers = { Authorization: 'HEADERS_PRIVADOS' };
      if (statusCode !== undefined) error.statusCode = statusCode;
      servicio.getOrganizador = async () => { throw error; };
      const desde = logs.length;
      const r = await pedir('/organizador/perfil?token=QUERY_PRIVADA', { headers: { 'X-Privado': 'HEADERS_PRIVADOS' } });
      esperar(r, 500, GENERICO);
      assert.doesNotMatch(r.texto, /stack|message|detail|Prisma|servidor|partido\.service|NO_EXPONER/);
      const registro = unicoRegistro(desde, { unaLinea: false });
      assert.match(registro, /^\[500\] GET \/api\/organizador\/perfil\nNombre: Error\nMensaje:/);
      assert.ok(registro.includes(error.message));
      assert.ok(registro.includes(error.stack), 'El 500 registra el stack, sin registrar el objeto');
      assert.match(registro, /Code: FALLO_INTERNO/);
    }
    // Un status sin statusCode tampoco habilita la exposición de mensajes internos.
    servicio.getOrganizador = async () => { throw Object.assign(new Error('detalle privado'), { status: 400 }); };
    esperar(await perfil(), 500, GENERICO);
    servicio.getOrganizador = originales.getOrganizador;
    let desde = logs.length;
    esperar(await pedir('/organizador/perfil?token=QUERY_PRIVADA', { method: 'PATCH', body: JSON.stringify({ nombre: 'a' }),
      headers: { 'X-Privado': 'HEADERS_PRIVADOS' } }), 400,
      { error: 'El nombre del club debe tener entre 2 y 80 caracteres.' });
    assert.equal(unicoRegistro(desde), '[400] PATCH /api/organizador/perfil: El nombre del club debe tener entre 2 y 80 caracteres.');
    const reintentar = 'Hay mucha gente inscribiéndose en este momento. Probá de nuevo en unos segundos.';
    servicio.getOrganizador = async () => { throw Object.assign(new Error(reintentar), { statusCode: 503, codigo: 'REINTENTAR',
      body: 'BODY_PRIVADO', headers: 'HEADERS_PRIVADOS' }); };
    desde = logs.length;
    esperar(await pedir('/organizador/perfil?token=QUERY_PRIVADA'), 503, { error: reintentar, codigo: 'REINTENTAR' });
    assert.equal(unicoRegistro(desde), `[503] GET /api/organizador/perfil: ${reintentar}`);
    for (const statusCode of [400, 401, 403, 404, 409, 422, 429]) {
      servicio.getOrganizador = async () => { throw Object.assign(new Error('Volvé a verificar antes de seguir.'), {
        statusCode, codigo: 'ESTADO_PRECHECK_CAMBIO', detail: 'no se expone',
      }); };
      desde = logs.length;
      esperar(await perfil(), statusCode, { error: 'Volvé a verificar antes de seguir.', codigo: 'ESTADO_PRECHECK_CAMBIO' });
      assert.equal(unicoRegistro(desde), `[${statusCode}] GET /api/organizador/perfil: Volvé a verificar antes de seguir.`);
    }
    servicio.getOrganizador = originales.getOrganizador;
    const password = 'CLAVE_CRUDA_NO_DEBE_REGISTRARSE';
    const email = 'parser-privado@example.com';
    desde = logs.length;
    esperar(await pedir('/auth/login?token=QUERY_PRIVADA', { method: 'POST',
      body: JSON.stringify({ email, password }).slice(0, -1), headers: { 'X-Privado': 'HEADERS_PRIVADOS' } }), 400,
      { error: 'El cuerpo del pedido no es un JSON válido.' });
    assert.equal(unicoRegistro(desde), '[400] parser entity.parse.failed');
    assert.ok(!logs.flat().join('\n').includes(password), 'La contraseña del JSON roto nunca aparece en console.error');
    assert.ok(!logs.flat().join('\n').includes(email), 'El email del JSON roto tampoco se registra');
    desde = logs.length;
    esperar(await pedir('/auth/register', { method: 'POST', body: JSON.stringify({ texto: 'a'.repeat(110 * 1024) }) }), 413,
      { error: 'El pedido es demasiado grande.' });
    assert.equal(unicoRegistro(desde), '[413] parser entity.too.large');
    for (const headers of [{ 'Content-Type': 'application/json; charset=iso-8859-1' }, { 'Content-Encoding': 'desconocido' }]) {
      desde = logs.length;
      esperar(await pedir('/auth/register', { method: 'POST', body: '{}', headers }), 415,
        { error: 'No se pudo procesar el cuerpo del pedido.' });
      assert.match(unicoRegistro(desde), /^\[415\] parser (charset|encoding)\.unsupported$/);
    }
    servicio.getOrganizador = async () => prisma.organizador.create({ data: {
      email: EMAIL, nombre: 'Duplicado', passwordHash: 'no-se-usa',
    } });
    esperar(await perfil(), 409, { error: 'Ya existe un registro con esos datos.' });
    servicio.getOrganizador = async () => prisma.organizador.update({ where: { id: 'no-existe' }, data: { nombre: 'Inexistente' } });
    esperar(await perfil(), 404, { error: 'Registro no encontrado.' });
    servicio.getOrganizador = originales.getOrganizador;

    // Errores de dominio reales: los tres servicios conservan sus mensajes y agregan solo el status.
    const torneo = await prisma.torneo.create({ data: { organizadorId: owner.id, nombre: 'Prueba de errores',
      slug: `errores-${process.env.NODE_ENV || 'desarrollo'}`, fecha: new Date('2026-11-20T15:00:00Z') } });
    const categoria = await prisma.categoria.create({ data: { torneoId: torneo.id, nombre: 'Prueba de dominio' } });
    for (let orden = 0; orden < 3; orden++) {
      await prisma.pareja.create({ data: { categoriaId: categoria.id, orden, jugador1: `Ana ${orden}`, jugador2: `Luz ${orden}` } });
    }
    const snapshotDominio = () => Promise.all(Prisma.dmmf.datamodel.models.map(async ({ name }) => {
      const filas = await prisma[name[0].toLowerCase() + name.slice(1)].findMany();
      return [name, filas.map((fila) => JSON.stringify(fila)).sort()];
    }));
    let antesDominio = await snapshotDominio();
    desde = logs.length;
    esperar(await pedir(`/categorias/${categoria.id}/reiniciar`, { method: 'POST', body: '{}' }), 400,
      { error: 'La categoría ya está en estado BORRADOR.' });
    assert.equal(unicoRegistro(desde), `[400] POST /api/categorias/${categoria.id}/reiniciar: La categoría ya está en estado BORRADOR.`);
    assert.deepEqual(await snapshotDominio(), antesDominio);

    // El armado impuesto es interno: una llamada HTTP al controlador dispara el servicio real
    // con un armado inválido de prueba, sin agregar rutas ni simular el error que este lanza.
    servicio.getOrganizador = () => require('../src/services/zona.service').iniciarCategoriaConDisponibilidad(owner.id, categoria.id, null,
      { armado: { grupos: [['pareja-ajena']], sinGrupo: [] } });
    desde = logs.length;
    esperar(await perfil(), 409, { error: 'El armado impuesto incluye una pareja que no es de la categoría.' });
    assert.equal(unicoRegistro(desde), '[409] GET /api/organizador/perfil: El armado impuesto incluye una pareja que no es de la categoría.');
    assert.deepEqual(await snapshotDominio(), antesDominio);
    servicio.getOrganizador = originales.getOrganizador;

    const precheck = await pedir(`/torneos/${torneo.id}/pre-check-inicio`, { method: 'POST', body: '{}' });
    assert.equal(precheck.status, 200, precheck.texto);
    assert.ok(precheck.json.planId, precheck.texto);
    const guardado = await prisma.precheckPlan.findUniqueOrThrow({ where: { torneoId: torneo.id } });
    const contenido = structuredClone(guardado.contenido);
    // Solo el plan de aplicación queda inconsistente; el snapshot y su firma se mantienen.
    contenido.plan.categoriasPlan[0].categoriaId = 'categoria-ausente';
    await prisma.precheckPlan.update({ where: { torneoId: torneo.id }, data: { contenido } });
    antesDominio = await snapshotDominio();
    desde = logs.length;
    esperar(await pedir(`/torneos/${torneo.id}/iniciar`, { method: 'POST', body: JSON.stringify({ planId: precheck.json.planId }) }), 409,
      { error: 'La categoría "Prueba de dominio" ya no está en estado Borrador.' });
    assert.equal(unicoRegistro(desde), `[409] POST /api/torneos/${torneo.id}/iniciar: La categoría "Prueba de dominio" ya no está en estado Borrador.`);
    assert.deepEqual(await snapshotDominio(), antesDominio, 'El inicio rechazado revierte también las escrituras de la transacción');
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
    console.log(`PASS HTTP ${process.env.NODE_ENV || 'sin NODE_ENV'}: 503 REINTENTAR, logs sin cuerpo ni query, 500 con diagnóstico, tres errores de dominio y contrato previo preservado`);
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
  await prisma.organizador.create({ data: { email: EMAIL, nombre: 'Club pruebas', passwordHash: 'no-se-usa', cantidadCanchas: 2,
    viernesInicio: '09:00', viernesFin: '23:00', sabadoInicio: '09:00', sabadoFin: '23:00', domingoInicio: '09:00', domingoFin: '23:00' } });
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
