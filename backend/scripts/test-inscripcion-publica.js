const { ensureTestDb } = require('./utils/testEnvGuard');

/**
 * Suite 44: inscripción pública de parejas por link (sesión 88).
 *
 * Cada caso corre aislado y registra PASS/FAIL; la suite sale con 1 si alguno falla.
 * Usa el cliente compartido de src/lib/prisma para poder interceptar la transacción de inicio
 * (I19) en el mismo proceso que el servidor de test.
 */

// Límite por IP alto para todos los casos salvo el que lo prueba (se lee en cada pedido)
process.env.INSCRIPCION_MAX_POR_VENTANA = '1000';

const jwt = require('jsonwebtoken');
const prisma = require('../src/lib/prisma');
const { JWT_SECRET } = require('../src/config/env');
const { startTestServer } = require('./utils/testServer');
const { parseFechaLocal } = require('../src/utils/dateUtils');
const { generarGrillaOrganizador } = require('../src/services/slots.service');

const VIERNES = '2026-11-06';
const TELEFONO = '+54 9 (351) 777-8899';
const TELEFONO_DIGITOS = '5493517778899';
const TELEFONO_NUCLEO = '3517778899'; // se busca en las respuestas públicas

const resultados = [];
let BASE_URL;
let ts;

async function caso(nombre, fn) {
  try {
    await fn();
    resultados.push({ nombre, ok: true });
    console.log(`  ✅ ${nombre}`);
  } catch (err) {
    resultados.push({ nombre, ok: false, error: err.message });
    console.log(`  ❌ ${nombre}\n     → ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function http(method, ruta, { body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${ruta}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const texto = await res.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch (_) { json = null; }
  return { status: res.status, json, texto };
}

function esperar(r, status, codigo) {
  assert(r.status === status, `esperado HTTP ${status}, recibido ${r.status}: ${r.texto.slice(0, 200)}`);
  if (codigo) assert(r.json?.codigo === codigo, `esperado codigo ${codigo}, recibido ${r.json?.codigo} (${r.json?.error})`);
}

const inscribir = (slug, body) => http('POST', `/public/${slug}/inscripcion`, { body });
const abrir = (torneoId, abierta, token) => http('PATCH', `/torneos/${torneoId}/inscripcion`, { body: { abierta }, token });

function cuerpo(categoriaId, extra = {}) {
  return {
    categoriaId,
    jugador1: `Uno ${Math.random().toString(36).slice(2, 8)}`,
    jugador2: `Dos ${Math.random().toString(36).slice(2, 8)}`,
    telefono: '351 555 1234',
    slotIds: ['Viernes-18:00', 'Viernes-18:15'],
    cualquierHorario: false,
    website: '',
    ...extra,
  };
}

async function crearTorneo(org, nombre, { estado = 'BORRADOR', inscripcionAbierta } = {}) {
  const data = {
    organizadorId: org.id,
    nombre,
    slug: `insc-${nombre.toLowerCase().replace(/\W+/g, '-')}-${ts}`,
    fecha: parseFechaLocal(VIERNES),
    estado,
  };
  const torneo = await prisma.torneo.create({ data });
  if (inscripcionAbierta !== undefined) {
    // Estado que la app no produce (abierta fuera de BORRADOR): solo para probar las guardas
    await prisma.$executeRawUnsafe('UPDATE "Torneo" SET "inscripcionAbierta" = ? WHERE id = ?', inscripcionAbierta ? 1 : 0, torneo.id);
  }
  return torneo;
}

async function crearCategoria(torneoId, nombre, estado = 'BORRADOR') {
  return prisma.categoria.create({ data: { torneoId, nombre, estado } });
}

async function crearParejasConSlots(categoriaId, n, slots, desde = 1) {
  const ids = [];
  for (let i = 0; i < n; i++) {
    const p = await prisma.pareja.create({
      data: { categoriaId, jugador1: `Base ${desde + i}A`, jugador2: `Base ${desde + i}B`, orden: desde + i },
    });
    await prisma.slotPareja.createMany({ data: slots.map((slotId) => ({ parejaId: p.id, slotId })) });
    ids.push(p.id);
  }
  return ids;
}

async function main() {
  await ensureTestDb();
  const { server, baseUrl } = await startTestServer();
  BASE_URL = baseUrl;
  ts = Date.now();

  console.log('🧪 SUITE 44: INSCRIPCIÓN PÚBLICA DE PAREJAS POR LINK\n');

  const club = {
    cantidadCanchas: 2,
    viernesInicio: '18:00',
    viernesFin: '23:00',
    sabadoInicio: '09:00',
    sabadoFin: '20:00',
    domingoInicio: '08:00',
    domingoFin: '21:00',
  };
  const orgA = await prisma.organizador.create({ data: { nombre: 'Club Insc A', email: `insc-a-${ts}@test.com`, passwordHash: 'x', ...club } });
  const orgB = await prisma.organizador.create({ data: { nombre: 'Club Insc B', email: `insc-b-${ts}@test.com`, passwordHash: 'x', ...club } });
  const tokenA = jwt.sign({ id: orgA.id, email: orgA.email }, JWT_SECRET, { expiresIn: '1h' });
  const tokenB = jwt.sign({ id: orgB.id, email: orgB.email }, JWT_SECRET, { expiresIn: '1h' });

  // T1: torneo principal en BORRADOR con dos categorías en BORRADOR y una en curso
  const t1 = await crearTorneo(orgA, 'Principal');
  const cat4 = await crearCategoria(t1.id, '4ta');
  const cat6 = await crearCategoria(t1.id, '6ta');
  const cat8 = await crearCategoria(t1.id, '8va', 'EN_CURSO');
  // T2: otro torneo del mismo organizador (categoría ajena a T1)
  const t2 = await crearTorneo(orgA, 'Otro');
  const catOtro = await crearCategoria(t2.id, '4ta');
  // T3: torneo en curso con la inscripción abierta (estado artificial) para la guarda de estado
  const t3 = await crearTorneo(orgA, 'En Curso', { estado: 'EN_CURSO', inscripcionAbierta: true });
  const cat3 = await crearCategoria(t3.id, '5ta');

  const contar = (categoriaId) => prisma.pareja.count({ where: { categoriaId } });

  console.log('▶ Panel: abrir y cerrar la inscripción');
  await caso('I1 abrir/cerrar: 401 sin token, 403 a otro organizador, 400 sin booleano', async () => {
    const sinToken = await abrir(t1.id, true);
    esperar(sinToken, 401);
    const ajeno = await abrir(t1.id, true, tokenB);
    esperar(ajeno, 403);
    const malo = await http('PATCH', `/torneos/${t1.id}/inscripcion`, { body: { abierta: 'si' }, token: tokenA });
    esperar(malo, 400);
    const t = await prisma.torneo.findUnique({ where: { id: t1.id } });
    assert(t.inscripcionAbierta === false, 'la inscripción quedó abierta tras pedidos rechazados');
  });

  await caso('I2 inscripción cerrada → 409 INSCRIPCION_CERRADA sin crear nada', async () => {
    const antes = await contar(cat4.id);
    const r = await inscribir(t1.slug, cuerpo(cat4.id));
    esperar(r, 409, 'INSCRIPCION_CERRADA');
    assert((await contar(cat4.id)) === antes, 'se creó una pareja con la inscripción cerrada');
  });

  await caso('I3 abrir en BORRADOR → 200 y queda abierta; cerrar fuera de BORRADOR → 409', async () => {
    const r = await abrir(t1.id, true, tokenA);
    esperar(r, 200);
    assert(r.json?.inscripcionAbierta === true, `respuesta sin inscripcionAbierta: ${r.texto}`);
    const t = await prisma.torneo.findUnique({ where: { id: t1.id } });
    assert(t.inscripcionAbierta === true, 'no quedó abierta en la base');
    const enCurso = await abrir(t3.id, false, tokenA);
    esperar(enCurso, 409, 'TORNEO_INICIADO');
  });

  console.log('\n▶ GET público');
  await caso('I4 GET: torneo, solo categorías en BORRADOR, grilla sin domingo', async () => {
    const r = await http('GET', `/public/${t1.slug}/inscripcion`);
    esperar(r, 200);
    const { torneo, categorias, grilla } = r.json || {};
    assert(torneo?.nombre === 'Principal', `nombre: ${torneo?.nombre}`);
    assert(torneo?.estado === 'BORRADOR' && torneo?.inscripcionAbierta === true, `torneo: ${JSON.stringify(torneo)}`);
    assert(new Date(torneo.fecha).getTime() === parseFechaLocal(VIERNES).getTime(), `fecha: ${torneo.fecha}`);
    const nombres = (categorias || []).map((c) => c.nombre).sort();
    assert(JSON.stringify(nombres) === JSON.stringify(['4ta', '6ta']), `categorías: ${JSON.stringify(categorias)}`);
    assert(categorias.every((c) => Object.keys(c).sort().join(',') === 'id,nombre'), `campos de categoría: ${JSON.stringify(categorias)}`);
    const esperada = generarGrillaOrganizador(orgA);
    assert(!('domingo' in grilla), 'la grilla trae domingo');
    assert(JSON.stringify(grilla.viernes) === JSON.stringify(esperada.viernes), 'grilla de viernes distinta a la del club');
    assert(JSON.stringify(grilla.sabado) === JSON.stringify(esperada.sabado), 'grilla de sábado distinta a la del club');
  });

  await caso('I5 GET y POST de slug inexistente → 404 TORNEO_NO_ENCONTRADO', async () => {
    esperar(await http('GET', `/public/no-existe-${ts}/inscripcion`), 404, 'TORNEO_NO_ENCONTRADO');
    esperar(await inscribir(`no-existe-${ts}`, cuerpo(cat4.id)), 404, 'TORNEO_NO_ENCONTRADO');
  });

  console.log('\n▶ POST público: alta');
  let parejaSlots;
  await caso('I6 alta con horarios: 201, origen INSCRIPCION, orden max+1, teléfono normalizado y fuera de la respuesta', async () => {
    const admin = await http('POST', `/categorias/${cat4.id}/parejas`, { body: { jugador1: 'José Pérez', jugador2: 'Ana Leone' }, token: tokenA });
    esperar(admin, 201);
    const r = await inscribir(t1.slug, cuerpo(cat4.id, { jugador1: '  Lucía   Ríos ', jugador2: 'Marta Tapia', telefono: TELEFONO }));
    esperar(r, 201);
    assert(!r.texto.includes(TELEFONO_NUCLEO), `la respuesta trae el teléfono: ${r.texto}`);
    const p = await prisma.pareja.findFirst({ where: { categoriaId: cat4.id, jugador1: 'Lucía Ríos' }, include: { slotsSeleccionados: true } });
    assert(p, 'no se creó la pareja (o no se normalizaron los espacios del nombre)');
    assert(p.origen === 'INSCRIPCION', `origen ${p.origen}`);
    assert(p.telefono === TELEFONO_DIGITOS, `teléfono ${p.telefono}`);
    assert(p.orden === admin.json.orden + 1, `orden ${p.orden}, esperado ${admin.json.orden + 1}`);
    const slots = p.slotsSeleccionados.map((s) => s.slotId).sort();
    assert(JSON.stringify(slots) === JSON.stringify(['Viernes-18:00', 'Viernes-18:15']), `slots ${JSON.stringify(slots)}`);
    const delAdmin = await prisma.pareja.findUnique({ where: { id: admin.json.id } });
    assert(delAdmin.origen === 'ORGANIZADOR' && delAdmin.telefono === null, `pareja del organizador: ${JSON.stringify(delAdmin)}`);
    parejaSlots = p;
  });

  await caso('I7 alta con "Puedo en cualquier horario": 201 y 0 slots', async () => {
    const r = await inscribir(t1.slug, cuerpo(cat6.id, { jugador1: 'Libre Uno', jugador2: 'Libre Dos', slotIds: [], cualquierHorario: true }));
    esperar(r, 201);
    const p = await prisma.pareja.findFirst({ where: { categoriaId: cat6.id, jugador1: 'Libre Uno' }, include: { slotsSeleccionados: true } });
    assert(p && p.slotsSeleccionados.length === 0, `pareja ${JSON.stringify(p)}`);
  });

  console.log('\n▶ POST público: validaciones');
  await caso('I8 disponibilidad obligatoria: sin horarios ni check → 400; las dos cosas → 400', async () => {
    const antes = await contar(cat6.id);
    esperar(await inscribir(t1.slug, cuerpo(cat6.id, { slotIds: [], cualquierHorario: false })), 400, 'DATOS_INVALIDOS');
    esperar(await inscribir(t1.slug, cuerpo(cat6.id, { slotIds: undefined, cualquierHorario: undefined })), 400, 'DATOS_INVALIDOS');
    esperar(await inscribir(t1.slug, cuerpo(cat6.id, { cualquierHorario: true })), 400, 'DATOS_INVALIDOS');
    esperar(await inscribir(t1.slug, cuerpo(cat6.id, { slotIds: 'Viernes-18:00' })), 400, 'DATOS_INVALIDOS');
    assert((await contar(cat6.id)) === antes, 'se creó una pareja sin disponibilidad válida');
  });

  await caso('I9 slots inválidos: domingo, fuera del horario del club, fuera de la grilla de 15 min → 400', async () => {
    const antes = await contar(cat6.id);
    for (const slot of ['Domingo-10:00', 'Viernes-12:00', 'Viernes-18:05', 'Viernes-22:00', 'Lunes-18:00', 42]) {
      const r = await inscribir(t1.slug, cuerpo(cat6.id, { slotIds: ['Viernes-18:00', slot] }));
      esperar(r, 400, 'DATOS_INVALIDOS');
    }
    assert((await contar(cat6.id)) === antes, 'se creó una pareja con slots inválidos');
  });

  await caso('I10 nombres vacíos o de más de 60 caracteres → 400; 60 caracteres → 201', async () => {
    esperar(await inscribir(t1.slug, cuerpo(cat6.id, { jugador1: '   ' })), 400, 'DATOS_INVALIDOS');
    esperar(await inscribir(t1.slug, cuerpo(cat6.id, { jugador2: undefined })), 400, 'DATOS_INVALIDOS');
    esperar(await inscribir(t1.slug, cuerpo(cat6.id, { jugador1: 'x'.repeat(61) })), 400, 'DATOS_INVALIDOS');
    esperar(await inscribir(t1.slug, cuerpo(cat6.id, { jugador1: 'y'.repeat(60) })), 201);
  });

  await caso('I11 teléfono inválido → 400 (letras, menos de 8 o más de 15 dígitos, vacío)', async () => {
    for (const telefono of ['abc12345678', '1234567', '1234567890123456', '', undefined, '351-555-12x4']) {
      esperar(await inscribir(t1.slug, cuerpo(cat6.id, { telefono })), 400, 'DATOS_INVALIDOS');
    }
  });

  await caso('I12 duplicado con acentos, mayúsculas, espacios y jugadores invertidos → 409 DUPLICADO; en otra categoría → 201', async () => {
    const antes = await contar(cat4.id);
    const r = await inscribir(t1.slug, cuerpo(cat4.id, { jugador1: 'ana  LEONE', jugador2: 'jose perez' }));
    esperar(r, 409, 'DUPLICADO');
    const r2 = await inscribir(t1.slug, cuerpo(cat4.id, { jugador1: 'MARTA TAPIA', jugador2: 'lucia rios' }));
    esperar(r2, 409, 'DUPLICADO');
    assert((await contar(cat4.id)) === antes, 'se creó el duplicado');
    esperar(await inscribir(t1.slug, cuerpo(cat6.id, { jugador1: 'Ana Leone', jugador2: 'José Pérez' })), 201);
  });

  await caso('I13 categoría: de otro torneo o inexistente → 404; fuera de BORRADOR → 409 (CATEGORIA_NO_DISPONIBLE)', async () => {
    esperar(await inscribir(t1.slug, cuerpo(catOtro.id)), 404, 'CATEGORIA_NO_DISPONIBLE');
    esperar(await inscribir(t1.slug, cuerpo('no-existe')), 404, 'CATEGORIA_NO_DISPONIBLE');
    esperar(await inscribir(t1.slug, cuerpo(undefined)), 404, 'CATEGORIA_NO_DISPONIBLE');
    const antes = await contar(cat8.id);
    esperar(await inscribir(t1.slug, cuerpo(cat8.id)), 409, 'CATEGORIA_NO_DISPONIBLE');
    assert((await contar(cat8.id)) === antes, 'se creó una pareja en una categoría en curso');
    assert((await contar(catOtro.id)) === 0, 'se creó una pareja en la categoría de otro torneo');
  });

  await caso('I14 torneo fuera de BORRADOR (aunque figure abierta) → 409 TORNEO_INICIADO', async () => {
    const r = await inscribir(t3.slug, cuerpo(cat3.id));
    esperar(r, 409, 'TORNEO_INICIADO');
    assert((await contar(cat3.id)) === 0, 'se creó una pareja en un torneo en curso');
  });

  await caso('I15 honeypot lleno → 201 sin guardar nada (aunque el resto sea inválido)', async () => {
    const antes = await contar(cat4.id);
    esperar(await inscribir(t1.slug, cuerpo(cat4.id, { website: 'http://spam.example' })), 201);
    esperar(await inscribir(t1.slug, { website: 'x' }), 201);
    assert((await contar(cat4.id)) === antes, 'el honeypot guardó una pareja');
  });

  console.log('\n▶ Teléfono fuera de lo público');
  await caso('I16 el teléfono no sale por /api/public/* y sí por el endpoint admin de parejas', async () => {
    assert(parejaSlots, 'depende de I6');
    const vista = await http('GET', `/public/${t1.slug}`);
    esperar(vista, 200);
    assert(vista.texto.includes('Lucía Ríos'), 'la vista pública no lista la pareja inscripta');
    assert(!vista.texto.includes(TELEFONO_NUCLEO), 'GET /public/:slug expone el teléfono');
    assert(!/telefono/i.test(vista.texto), 'GET /public/:slug trae un campo telefono');
    const insc = await http('GET', `/public/${t1.slug}/inscripcion`);
    assert(!insc.texto.includes(TELEFONO_NUCLEO) && !/telefono/i.test(insc.texto), 'GET /public/:slug/inscripcion expone el teléfono');
    const admin = await http('GET', `/categorias/${cat4.id}/parejas`, { token: tokenA });
    esperar(admin, 200);
    const p = admin.json.find((x) => x.id === parejaSlots.id);
    assert(p?.telefono === TELEFONO_DIGITOS && p?.origen === 'INSCRIPCION', `admin: ${JSON.stringify(p)}`);
  });

  console.log('\n▶ Límite por IP');
  await caso('I17 límite por IP: con tope 3 el cuarto pedido → 429 LIMITE sin guardar', async () => {
    const { limiteInscripcion } = require('../src/middleware/limitePorIp');
    limiteInscripcion.reset();
    process.env.INSCRIPCION_MAX_POR_VENTANA = '3';
    try {
      for (let i = 0; i < 3; i++) esperar(await inscribir(t1.slug, { website: 'bot' }), 201);
      const antes = await contar(cat6.id);
      const r = await inscribir(t1.slug, cuerpo(cat6.id));
      esperar(r, 429, 'LIMITE');
      assert((await contar(cat6.id)) === antes, 'se guardó una pareja por encima del límite');
      esperar(await http('GET', `/public/${t1.slug}/inscripcion`), 200);
    } finally {
      process.env.INSCRIPCION_MAX_POR_VENTANA = '1000';
      limiteInscripcion.reset();
    }
  });

  await caso('I18 límite: IPv6 por /64, IPv4 mapeada, y limpieza de entradas vencidas', async () => {
    const { claveIp, crearLimitePorIp } = require('../src/middleware/limitePorIp');
    assert(claveIp('2001:db8:1:2:aaaa::1') === claveIp('2001:0db8:0001:0002:bbbb:cccc:dddd:2'), 'mismo /64 da claves distintas');
    assert(claveIp('2001:db8:1:2::1') !== claveIp('2001:db8:1:3::1'), 'distinto /64 da la misma clave');
    assert(claveIp('::ffff:10.0.0.7') === '10.0.0.7', `IPv4 mapeada: ${claveIp('::ffff:10.0.0.7')}`);
    assert(claveIp('10.0.0.7') === '10.0.0.7', 'IPv4');
    let ahora = 0;
    const lim = crearLimitePorIp({ ventanaMs: 1000, max: 100, ahora: () => ahora });
    const pasar = (ip) => new Promise((resolve) => {
      const res = { status() { return this; }, json() { resolve('bloqueado'); } };
      lim({ ip }, res, () => resolve('ok'));
    });
    for (let i = 0; i < 50; i++) await pasar(`10.0.${i}.1`);
    assert(lim.tamano() === 50, `tamaño ${lim.tamano()}`);
    ahora = 1001;
    await pasar('10.9.9.9');
    assert(lim.tamano() === 1, `tras la ventana deberían quedar 1 entrada, quedan ${lim.tamano()}`);
    const lim2 = crearLimitePorIp({ ventanaMs: 1000, max: 2, ahora: () => ahora });
    const pasar2 = (ip) => new Promise((resolve) => {
      const res = { status(c) { this.c = c; return this; }, json() { resolve(this.c); } };
      lim2({ ip }, res, () => resolve('ok'));
    });
    await pasar2('2001:db8:1:2::1');
    await pasar2('2001:db8:1:2::2');
    assert((await pasar2('2001:db8:1:2:ffff::3')) === 429, 'el mismo /64 no comparte el contador');
    assert((await pasar2('2001:db8:1:3::1')) === 'ok', 'otro /64 quedó bloqueado');
  });

  console.log('\n▶ Unicidad de orden');
  await caso('I19 10 inscripciones y 5 altas del panel en paralelo → 15 parejas con orden 1..15', async () => {
    const t6 = await crearTorneo(orgA, 'Paralelo');
    const cat = await crearCategoria(t6.id, '7ma');
    esperar(await abrir(t6.id, true, tokenA), 200);
    const pedidos = [];
    for (let i = 0; i < 10; i++) pedidos.push(inscribir(t6.slug, cuerpo(cat.id, { jugador1: `Par ${i}A`, jugador2: `Par ${i}B` })));
    for (let i = 0; i < 5; i++) pedidos.push(http('POST', `/categorias/${cat.id}/parejas`, { body: { jugador1: `Adm ${i}A`, jugador2: `Adm ${i}B` }, token: tokenA }));
    const t0 = Date.now();
    const rs = await Promise.all(pedidos);
    const ms = Date.now() - t0;
    const malos = rs.filter((r) => r.status !== 201).map((r) => `${r.status} ${r.texto.slice(0, 160)}`);
    assert(malos.length === 0, `pedidos fallidos (${malos.length}/15, ${ms} ms): ${JSON.stringify(malos)}`);
    const ordenes = (await prisma.pareja.findMany({ where: { categoriaId: cat.id }, select: { orden: true } })).map((p) => p.orden).sort((a, b) => a - b);
    assert(JSON.stringify(ordenes) === JSON.stringify(Array.from({ length: 15 }, (_, i) => i + 1)), `órdenes ${JSON.stringify(ordenes)}`);
    console.log(`     (15 altas en paralelo en ${ms} ms)`);
  });

  await caso('I20 conReintentoOrden: target arreglo o nombre de índice, tope de intentos, otros errores sin reintento', async () => {
    const { conReintentoOrden, INTENTOS_ORDEN } = require('../src/utils/reintentoOrden');
    const choque = (target) => Object.assign(new Error('Unique'), { code: 'P2002', meta: { target } });
    for (const target of [['categoriaId', 'orden'], 'Pareja_categoriaId_orden_key']) {
      let n = 0;
      const r = await conReintentoOrden(async () => { n++; if (n < 3) throw choque(target); return 'ok'; });
      assert(r === 'ok' && n === 3, `target ${JSON.stringify(target)}: resultado ${r}, ${n} llamadas`);
      n = 0;
      let err = null;
      try { await conReintentoOrden(async () => { n++; throw choque(target); }); } catch (e) { err = e; }
      assert(n === INTENTOS_ORDEN && err?.statusCode === 409, `tope con ${JSON.stringify(target)}: ${n} llamadas, ${err?.statusCode}`);
    }
    for (const otro of [choque(['parejaId', 'slotId']), choque('SlotPareja_parejaId_slotId_key'), new Error('otro')]) {
      let n = 0;
      let err = null;
      try { await conReintentoOrden(async () => { n++; throw otro; }); } catch (e) { err = e; }
      assert(n === 1 && err === otro, `error ajeno reintentado (${n} llamadas) o cambiado`);
    }
  });

  console.log('\n▶ Pre-check, inicio y reinicio');
  // T5: 6 parejas compatibles en BORRADOR, para pre-check e inicio
  const t5 = await crearTorneo(orgA, 'Inicio');
  const cat5 = await crearCategoria(t5.id, '5ta');
  const slotsBase = ['Viernes-18:00', 'Viernes-18:15', 'Viernes-19:15', 'Viernes-20:30', 'Viernes-21:45', 'Sabado-09:00', 'Sabado-10:15', 'Sabado-11:30'];
  await crearParejasConSlots(cat5.id, 6, slotsBase);

  await caso('I21 una inscripción con una sesión de pre-check activa la invalida (parejaIdsHash)', async () => {
    const { preCheckSessions } = require('../src/services/organizador.service');
    esperar(await abrir(t5.id, true, tokenA), 200);
    const pc1 = await http('POST', `/torneos/${t5.id}/pre-check-inicio`, { body: {}, token: tokenA });
    esperar(pc1, 200);
    const hash1 = preCheckSessions.get(t5.id)?.parejaIdsHash;
    assert(hash1, 'no quedó sesión de pre-check');
    const r = await inscribir(t5.slug, cuerpo(cat5.id, { jugador1: 'Tarde Uno', jugador2: 'Tarde Dos', slotIds: slotsBase }));
    esperar(r, 201);
    const nueva = await prisma.pareja.findFirst({ where: { categoriaId: cat5.id, jugador1: 'Tarde Uno' } });
    const pc2 = await http('POST', `/torneos/${t5.id}/pre-check-inicio`, { body: { isReCheck: true }, token: tokenA });
    esperar(pc2, 200);
    const hash2 = preCheckSessions.get(t5.id)?.parejaIdsHash;
    assert(hash2 && hash2 !== hash1 && hash2.includes(nueva.id), 'la sesión no se regeneró con la pareja nueva');
    // La respuesta sin bloqueo no lista parejas: se mira el plan que quedó en caché
    const { planesCache } = require('../src/services/organizador.service');
    const plan = pc2.json.planId ? planesCache.get(pc2.json.planId) : null;
    assert(plan || pc2.json.bloqueado, `pre-check sin planId ni bloqueo: ${pc2.texto.slice(0, 200)}`);
    const contenido = plan ? JSON.stringify(plan.categoriasPlan) : pc2.texto;
    assert(contenido.includes(nueva.id), 'el plan nuevo no incluye a la pareja inscripta');
  });

  await caso('I22 una inscripción que entra entre el pre-check y la transacción de inicio → 409 y nada se inicia', async () => {
    const { preCheckSessions } = require('../src/services/organizador.service');
    preCheckSessions.delete(t5.id);
    const pc = await http('POST', `/torneos/${t5.id}/pre-check-inicio`, { body: {}, token: tokenA });
    esperar(pc, 200);
    assert(pc.json?.planId, `pre-check sin planId: ${pc.texto.slice(0, 300)}`);
    // Simula una inscripción concurrente: entra justo después de la verificación de fuera de la transacción
    const original = prisma.$transaction;
    let colada = null;
    prisma.$transaction = async function (...args) {
      prisma.$transaction = original;
      const { _max } = await prisma.pareja.aggregate({ where: { categoriaId: cat5.id }, _max: { orden: true } });
      colada = await prisma.pareja.create({ data: { categoriaId: cat5.id, jugador1: 'Colada A', jugador2: 'Colada B', orden: _max.orden + 1, origen: 'INSCRIPCION' } });
      return original.apply(prisma, args);
    };
    let r;
    try {
      r = await http('POST', `/torneos/${t5.id}/iniciar`, { body: { planId: pc.json.planId }, token: tokenA });
    } finally {
      prisma.$transaction = original;
    }
    assert(colada, 'no se interceptó la transacción de inicio');
    esperar(r, 409);
    const t = await prisma.torneo.findUnique({ where: { id: t5.id } });
    const c = await prisma.categoria.findUnique({ where: { id: cat5.id } });
    assert(t.estado === 'BORRADOR' && c.estado === 'BORRADOR', `se inició igual: torneo ${t.estado}, categoría ${c.estado}`);
    assert(t.inscripcionAbierta === true, 'el rollback debió dejar la inscripción como estaba');
    await prisma.pareja.delete({ where: { id: colada.id } });
  });

  await caso('I23 iniciar el torneo cierra la inscripción en su transacción; después el POST → 409', async () => {
    preCheckSessions().delete(t5.id);
    const t = await prisma.torneo.findUnique({ where: { id: t5.id } });
    assert(t.inscripcionAbierta === true, 'precondición: abierta');
    const r = await http('POST', `/torneos/${t5.id}/iniciar`, { body: {}, token: tokenA });
    esperar(r, 200);
    const t2b = await prisma.torneo.findUnique({ where: { id: t5.id } });
    assert(t2b.estado === 'EN_CURSO', `estado ${t2b.estado}`);
    assert(t2b.inscripcionAbierta === false, 'iniciar no cerró la inscripción');
    esperar(await inscribir(t5.slug, cuerpo(cat5.id)), 409, 'TORNEO_INICIADO');
    const vista = await http('GET', `/public/${t5.slug}`);
    // 'Tarde Uno' se inscribió con el teléfono por defecto de cuerpo(): 351 555 1234
    assert(vista.texto.includes('Tarde Uno'), 'la vista pública en curso no lista a la pareja inscripta');
    assert(!vista.texto.includes('3515551234') && !/telefono/i.test(vista.texto), 'la vista pública en curso expone teléfonos');
  });

  await caso('I24 reiniciar deja la inscripción cerrada', async () => {
    await prisma.$executeRawUnsafe('UPDATE "Torneo" SET "inscripcionAbierta" = 1 WHERE id = ?', t5.id);
    const r = await http('POST', `/torneos/${t5.id}/reiniciar`, { body: {}, token: tokenA });
    esperar(r, 200);
    const t = await prisma.torneo.findUnique({ where: { id: t5.id } });
    assert(t.estado === 'BORRADOR' && t.inscripcionAbierta === false, `tras reiniciar: ${t.estado}, abierta ${t.inscripcionAbierta}`);
    esperar(await inscribir(t5.slug, cuerpo(cat5.id)), 409, 'INSCRIPCION_CERRADA');
  });

  await caso('I25 PUT /torneos/:id con estado fuera de BORRADOR cierra la inscripción', async () => {
    const t7 = await crearTorneo(orgA, 'Put Estado');
    esperar(await abrir(t7.id, true, tokenA), 200);
    esperar(await http('PUT', `/torneos/${t7.id}`, { body: { estado: 'EN_CURSO' }, token: tokenA }), 200);
    const t = await prisma.torneo.findUnique({ where: { id: t7.id } });
    assert(t.inscripcionAbierta === false, 'quedó abierta con el torneo en curso');
  });

  console.log('\n▶ Cola serial y esperas');
  await caso('I26 un alta que falla adentro de la cola (duplicado) no traba las siguientes', async () => {
    const { crearColaSerial } = require('../src/utils/colaSerial');
    const cola = crearColaSerial();
    const r = await Promise.allSettled([
      cola(async () => { throw new Error('falla'); }),
      cola(async () => 'ok'),
    ]);
    assert(r[0].status === 'rejected' && r[1].status === 'fulfilled' && r[1].value === 'ok', `cola: ${JSON.stringify(r.map((x) => x.status))}`);

    const t9 = await crearTorneo(orgA, 'Cola');
    const cat = await crearCategoria(t9.id, '3ra');
    esperar(await abrir(t9.id, true, tokenA), 200);
    esperar(await inscribir(t9.slug, cuerpo(cat.id, { jugador1: 'Repe Uno', jugador2: 'Repe Dos' })), 201);
    // Los pedidos entran a la cola en orden; los duplicados fallan adentro (409) y los válidos tienen que pasar igual
    const rs = await Promise.all([
      inscribir(t9.slug, cuerpo(cat.id, { jugador1: 'repe dos', jugador2: 'REPE UNO' })),
      inscribir(t9.slug, cuerpo(cat.id, { jugador1: 'Sigue Uno', jugador2: 'Sigue Dos' })),
      inscribir(t9.slug, cuerpo(cat.id, { jugador1: 'Repe Uno', jugador2: 'Repe Dos' })),
      inscribir(t9.slug, cuerpo(cat.id, { jugador1: 'Sigue Tres', jugador2: 'Sigue Cuatro' })),
    ]);
    const estados = rs.map((x) => `${x.status}${x.json?.codigo ? ' ' + x.json.codigo : ''}`);
    assert(JSON.stringify(estados) === JSON.stringify(['409 DUPLICADO', '201', '409 DUPLICADO', '201']), `estados: ${JSON.stringify(estados)}`);
    assert((await contar(cat.id)) === 3, `parejas: ${await contar(cat.id)}`);
  });

  await caso('I27 inscripción mientras corre el inicio (transacción que tarda más que el busy_timeout) → 409 o 503 REINTENTAR, nunca 500', async () => {
    const t8 = await crearTorneo(orgA, 'Durante Inicio');
    const cat = await crearCategoria(t8.id, '2da');
    await crearParejasConSlots(cat.id, 6, slotsBase);
    esperar(await abrir(t8.id, true, tokenA), 200);
    const pc = await http('POST', `/torneos/${t8.id}/pre-check-inicio`, { body: {}, token: tokenA });
    assert(pc.json?.planId, `pre-check sin planId: ${pc.texto.slice(0, 200)}`);

    // La transacción de inicio se queda abierta 6,5 s después de su trabajo (más que los 5 s de busy_timeout de SQLite)
    const RETENCION_MS = 6500;
    const original = prisma.$transaction;
    let avisarDentro;
    const dentro = new Promise((resolve) => { avisarDentro = resolve; });
    prisma.$transaction = function (fn, opts) {
      prisma.$transaction = original;
      return original.call(prisma, async (tx) => {
        const r = await fn(tx);
        avisarDentro();
        await new Promise((resolve) => setTimeout(resolve, RETENCION_MS));
        return r;
      }, opts);
    };
    let inicio;
    try {
      const pedidoInicio = http('POST', `/torneos/${t8.id}/iniciar`, { body: { planId: pc.json.planId }, token: tokenA });
      await dentro;
      const rs = await Promise.all([1, 2, 3].map((i) => inscribir(t8.slug, cuerpo(cat.id, { jugador1: `Tarde ${i}A`, jugador2: `Tarde ${i}B` }))));
      inicio = await pedidoInicio;
      const estados = rs.map((x) => `${x.status} ${x.json?.codigo}`);
      console.log(`     (estados: ${JSON.stringify(estados)})`);
      assert(rs.every((x) => (x.status === 409 && x.json?.codigo === 'TORNEO_INICIADO') || (x.status === 503 && x.json?.codigo === 'REINTENTAR')), `estados: ${JSON.stringify(estados)} ${rs.map((x) => x.texto.slice(0, 120)).join(' | ')}`);
      assert(rs.some((x) => x.status === 503), 'ninguna llegó al tiempo de espera: el caso no probó el 503');
    } finally {
      prisma.$transaction = original;
    }
    esperar(inicio, 200);
    const t = await prisma.torneo.findUnique({ where: { id: t8.id } });
    assert(t.estado === 'EN_CURSO' && t.inscripcionAbierta === false, `torneo: ${t.estado}, abierta ${t.inscripcionAbierta}`);
    assert((await contar(cat.id)) === 6, `se coló una inscripción: ${await contar(cat.id)} parejas`);
  });

  server.close();
  const fallidos = resultados.filter((r) => !r.ok);
  console.log(`\n${resultados.length - fallidos.length}/${resultados.length} casos OK`);
  if (fallidos.length > 0) {
    console.log(`FALLARON: ${fallidos.map((f) => f.nombre.split(' ')[0]).join(', ')}`);
    return false;
  }
  return true;
}

function preCheckSessions() {
  return require('../src/services/organizador.service').preCheckSessions;
}

main()
  .then((ok) => prisma.$disconnect().then(() => process.exit(ok ? 0 : 1)))
  .catch((err) => {
    console.error('\n❌ ERROR FUERA DE LOS CASOS:', err);
    process.exit(1);
  });
