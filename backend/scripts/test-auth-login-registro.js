'use strict';

require('./utils/testEnvGuard');
const { ensureTestDb } = require('./utils/testEnvGuard');
const { resetTestDb } = require('./reset-test-db');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../src/lib/prisma');
const auth = require('../src/services/auth.service');
const { crearLimitesAuth } = require('../src/middlewares/limitesAuth');
const { JWT_SECRET } = require('../src/config/env');
const { app } = require('../src/index');
const { startTestServer } = require('./utils/testServer');

const MENSAJE = 'Demasiados intentos. Probá de nuevo en unos minutos.';
const VALIDO = { email: 'cuenta@example.com', password: 'Clave de prueba 123', nombre: 'Club Norte' };
let baseUrl, indiceIp = 1, reloj = Date.now();
const ipNueva = () => `192.0.2.${indiceIp++}`;
const comparaciones = [];
let consultas = 0;

async function post(ruta, body, ip = ipNueva()) {
  const r = await fetch(`${baseUrl}/auth/${ruta}`, { method: 'POST', headers: {
    'Content-Type': 'application/json', 'X-Forwarded-For': ip,
  }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json(), retry: r.headers.get('retry-after') };
}
const login = (email, password, ip) => post('login', { email, password }, ip);
const filas = () => prisma.organizador.findMany({ orderBy: { id: 'asc' } });

async function rechazaRegistro(body, esperado = 400) {
  const antes = await filas();
  const r = await post('register', body);
  assert.equal(r.status, esperado, JSON.stringify(r.json));
  assert.equal(typeof r.json.error, 'string');
  assert.deepEqual(await filas(), antes, 'Un registro rechazado no cambia datos');
}

async function registroValidado() {
  const email254 = `${'l'.repeat(64)}@${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(61)}`;
  assert.equal(email254.length, 254);
  for (const email of [undefined, null, 12, {}, [], '', 'texto', 'a@localhost', 'a@@x.com', 'a b@x.com',
    'a@b..com', '.a@b.com', 'a.@b.com', 'a..b@x.com', 'a@-x.com', 'a@x-.com', `${email254}x`, `${'l'.repeat(65)}@x.com`]) {
    await rechazaRegistro({ ...VALIDO, email });
  }
  for (const password of [undefined, null, 12, {}, [], '', '1234567', 'x'.repeat(73), 'é'.repeat(37), '😀'.repeat(7)]) {
    await rechazaRegistro({ ...VALIDO, password });
  }
  for (const nombre of [undefined, null, 12, {}, [], '', '   ', 'a', 'n'.repeat(81), ` ${'n'.repeat(81)} `]) {
    await rechazaRegistro({ ...VALIDO, nombre });
  }
  const r = await post('register', { ...VALIDO, email: '  Cuenta@Example.COM  ', nombre: '  Club Norte  ' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.deepEqual(Object.keys(r.json).sort(), ['organizador', 'token']);
  assert.deepEqual(Object.keys(r.json.organizador).sort(), ['email', 'id', 'nombre']);
  assert.equal(r.json.organizador.email, VALIDO.email);
  assert.equal(r.json.organizador.nombre, VALIDO.nombre);
  const claims = jwt.verify(r.json.token, JWT_SECRET);
  assert.equal(claims.id, r.json.organizador.id);
  assert.equal(claims.exp - claims.iat, 7 * 24 * 60 * 60);
  const guardado = await prisma.organizador.findUnique({ where: { id: claims.id } });
  assert.equal(await bcrypt.compare(VALIDO.password, guardado.passwordHash), true);
  assert.equal(bcrypt.getRounds(guardado.passwordHash), 10);
  await rechazaRegistro({ ...VALIDO, email: 'CUENTA@EXAMPLE.COM' }, 409);
  const limite = await post('register', { email: email254, password: 'a'.repeat(72), nombre: 'n'.repeat(80) });
  assert.equal(limite.status, 201, JSON.stringify(limite.json));
  assert.equal((await post('register', { email: 'minimo@example.com', password: '12345678', nombre: 'Ab' })).status, 201);
  assert.equal((await post('register', { email: 'utf8@example.com', password: 'é'.repeat(36), nombre: 'Ál' })).status, 201);
  console.log('PASS registro: tipos, formato, largos, UTF-8, normalización, duplicados y contrato exitoso');
}

async function loginCompatible() {
  for (const data of [{ email: {}, password: 'x' }, { email: 12, password: 'x' }, { email: null, password: 'x' },
    { email: VALIDO.email, password: {} }, { email: VALIDO.email, password: 12 }, { email: VALIDO.email, password: null }, {},
    { email: '   ', password: 'x' }, { email: VALIDO.email, password: '' }]) {
    const n = comparaciones.length;
    const r = await post('login', data);
    assert.equal(r.status, 400, JSON.stringify(r.json));
    assert.equal(comparaciones.length, n, 'Los tipos inválidos se rechazan antes de bcrypt');
  }
  const r = await login('  CUENTA@EXAMPLE.COM  ', VALIDO.password);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const cuenta = await prisma.organizador.findUnique({ where: { email: VALIDO.email } });
  assert.equal(r.json.organizador.id, cuenta.id);
  assert.equal(r.json.organizador.email, VALIDO.email);
  const hashViejo = await bcrypt.hash('vieja', 10);
  const vieja = await prisma.organizador.create({ data: { nombre: 'Club viejo', email: 'Vieja@Example.COM', passwordHash: hashViejo } });
  const entraVieja = await login('  Vieja@Example.COM  ', 'vieja');
  assert.equal(entraVieja.status, 200);
  assert.equal(entraVieja.json.organizador.id, vieja.id);
  assert.equal(entraVieja.json.organizador.email, vieja.email);
  assert.deepEqual(await prisma.organizador.findUnique({ where: { id: vieja.id } }), vieja, 'La compatibilidad no modifica la cuenta vieja');
  await rechazaRegistro({ ...VALIDO, email: 'vieja@example.com' }, 409);
  const antes = comparaciones.length;
  const inexistente = await login('nadie@example.com', 'incorrecta');
  const hashFicticio = comparaciones.at(-1).hash;
  assert.equal(bcrypt.getRounds(hashFicticio), 10, 'La cuenta inexistente usa un hash bcrypt válido del mismo costo');
  assert.notEqual(hashFicticio, cuenta.passwordHash);
  const erronea = await login(VALIDO.email, 'incorrecta');
  assert.equal(comparaciones.length, antes + 2);
  assert.equal(inexistente.status, 401); assert.equal(erronea.status, 401);
  assert.deepEqual(inexistente.json, { error: 'Credenciales inválidas.' });
  assert.deepEqual(erronea.json, inexistente.json);
  console.log('PASS login: tipos, normalización, cuenta antigua intacta, hash ficticio y mensajes iguales');
}

async function limitesLogin() {
  const ip = ipNueva();
  for (let i = 0; i < 5; i++) assert.equal((await login(i % 2 ? ' CUENTA@EXAMPLE.COM ' : VALIDO.email, 'mal', ip)).status, 401);
  const n = comparaciones.length, q = consultas;
  const sexto = await login(VALIDO.email, 'mal', ip);
  assert.equal(sexto.status, 429); assert.deepEqual(sexto.json, { error: MENSAJE }); assert.equal(sexto.retry, '900');
  assert.equal(comparaciones.length, n, 'El sexto pedido no consulta bcrypt');
  assert.equal(consultas, q, 'El sexto pedido tampoco busca la cuenta');
  assert.equal((await login(VALIDO.email, 'mal', ipNueva())).status, 401, 'Otra IP tiene su propio contador');
  assert.equal((await login('otra@example.com', 'mal', ip)).status, 401, 'Otro email no comparte el límite de cinco');
  const limpia = ipNueva();
  for (let i = 0; i < 4; i++) assert.equal((await login(VALIDO.email, 'mal', limpia)).status, 401);
  assert.equal((await login(' CUENTA@EXAMPLE.COM ', VALIDO.password, limpia)).status, 200);
  for (let i = 0; i < 5; i++) assert.equal((await login(VALIDO.email, 'mal', limpia)).status, 401, 'El acierto limpió el contador del email e IP');
  assert.equal((await login(VALIDO.email, 'mal', limpia)).status, 429);

  const global = ipNueva();
  for (let i = 0; i < 29; i++) assert.equal((await login(`sin-cuenta-${i}@example.com`, 'mal', global)).status, 401);
  assert.equal((await login(VALIDO.email, VALIDO.password, global)).status, 200);
  assert.equal((await login('ultimo@example.com', 'mal', global)).status, 401);
  const comparadas = comparaciones.length;
  const corteIp = await login('cambia-email@example.com', 'mal', global);
  assert.equal(corteIp.status, 429); assert.equal(corteIp.retry, '900');
  assert.equal(comparaciones.length, comparadas, 'El tope global corta aunque se cambie de email');
  assert.equal((await login(VALIDO.email, VALIDO.password, global)).status, 429, 'Un acierto no sirve para reiniciar el tope global');
  reloj += 15 * 60 * 1000 - 1;
  assert.equal((await login(VALIDO.email, 'mal', ip)).retry, '1');
  reloj += 1;
  assert.equal((await login(VALIDO.email, 'mal', ip)).status, 401, 'A los quince minutos se liberan los fallos');
  console.log('PASS límites de login: sexto pedido, email normalizado e IP, éxito, treinta por IP y vencimiento sin esperar');
}

async function limiteRegistro() {
  const ip = ipNueva();
  assert.equal((await post('register', { ...VALIDO, email: 'tope-registro@example.com' }, ip)).status, 201);
  for (let i = 0; i < 9; i++) assert.equal((await post('register', { ...VALIDO, password: 'x' }, ip)).status, 400);
  const antes = await filas();
  const r = await post('register', { ...VALIDO, email: 'bloqueada@example.com' }, ip);
  assert.equal(r.status, 429); assert.equal(r.retry, '3600'); assert.deepEqual(r.json, { error: MENSAJE });
  assert.deepEqual(await filas(), antes);
  assert.equal((await post('register', { ...VALIDO, email: 'otra-ip@example.com' })).status, 201);
  reloj += 60 * 60 * 1000;
  assert.equal((await post('register', { ...VALIDO, email: 'vencida@example.com' }, ip)).status, 201);
  console.log('PASS registro: diez intentos por IP, incluido éxito, Retry-After y liberación tras una hora');
}

function respuesta() {
  const res = new EventEmitter();
  res.statusCode = 200; res.headers = {};
  res.set = (key, value) => { res.headers[key] = value; return res; };
  res.status = status => { res.statusCode = status; return res; };
  res.json = body => { res.body = body; return res; };
  return res;
}

function memoriaYParalelos() {
  let t = 0;
  const limites = crearLimitesAuth({ ahora: () => t });
  const pendientes = [];
  for (let i = 0; i < 5; i++) {
    const res = respuesta(); pendientes.push(res);
    limites.limitarLogin({ ip: 'ip-paralela', body: { email: 'x@example.com' } }, res, () => {});
  }
  const sexto = respuesta();
  limites.limitarLogin({ ip: 'ip-paralela', body: { email: 'X@EXAMPLE.COM' } }, sexto, () => assert.fail('No debe admitir el sexto pedido en curso'));
  assert.equal(sexto.statusCode, 429); assert.equal(sexto.headers['Retry-After'], '1');
  for (const res of pendientes) { res.statusCode = 401; res.emit('finish'); res.emit('close'); }
  const bloqueado = respuesta();
  limites.limitarLogin({ ip: 'ip-paralela', body: { email: 'x@example.com' } }, bloqueado, () => assert.fail('Los fallos se cuentan una sola vez'));
  assert.equal(bloqueado.statusCode, 429);
  limites.limitarRegistro({ ip: 'registro-viejo' }, respuesta(), () => {});
  assert.deepEqual(limites.tamano(), { emailIp: 1, ip: 1, registro: 1 });
  t += 60 * 60 * 1000;
  const invalido = respuesta();
  limites.limitarLogin({ ip: 'ip-nueva', body: {} }, invalido, () => { invalido.statusCode = 400; invalido.emit('finish'); });
  assert.deepEqual(limites.tamano(), { emailIp: 0, ip: 0, registro: 0 }, 'También se borran las claves vencidas que no vuelven a consultar');
  const abandonado = respuesta();
  limites.limitarLogin({ ip: 'abortada', body: { email: 'x@example.com' } }, abandonado, () => abandonado.emit('close'));
  assert.deepEqual(limites.tamano(), { emailIp: 1, ip: 1, registro: 0 }, 'Abandonar el pedido no evita contabilizarlo');
  console.log('PASS memoria y concurrencia: reservas, finish/close sin duplicar, abandono y limpieza de todas las entradas vencidas');
}

async function run() {
  await ensureTestDb(); resetTestDb();
  const trustAnterior = app.get('trust proxy'); app.set('trust proxy', 1);
  const { server, baseUrl: url } = await startTestServer(); baseUrl = url;
  const compareOriginal = bcrypt.compare, buscarOriginal = prisma.organizador.findUnique, fechaOriginal = Date.now;
  bcrypt.compare = async (...args) => { comparaciones.push({ hash: args[1] }); return compareOriginal.apply(bcrypt, args); };
  prisma.organizador.findUnique = async (...args) => { consultas++; return buscarOriginal.apply(prisma.organizador, args); };
  Date.now = () => reloj;
  try {
    await registroValidado(); await loginCompatible(); await limitesLogin(); await limiteRegistro(); memoriaYParalelos();
  } finally {
    Date.now = fechaOriginal; bcrypt.compare = compareOriginal; prisma.organizador.findUnique = buscarOriginal;
    app.set('trust proxy', trustAnterior);
    await new Promise(resolve => server.close(resolve)); await prisma.$disconnect();
  }
}
run().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
