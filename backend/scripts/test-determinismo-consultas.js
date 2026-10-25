'use strict';

/**
 * test-determinismo-consultas.js
 *
 * El scheduler no puede depender del orden en que SQLite devuelve filas sin orderBy:
 * - por índice sobre UUID (ZonaPareja por zonaId, Categoria por id IN): orden de UUID v4, distinto en cada corrida;
 * - por recorrido de tabla (SCAN): orden de inserción, que depende de cómo se cargaron los datos.
 * Criterio (sesión 81): parejas y zonaParejas por pareja.orden (id solo como último desempate), zonas por nombre,
 * partidos por posicionEnRonda, categorías por nombre, y en el modo lluvia el desempate final es natural, no el id.
 *
 * Los tests fijan los UUID (Prisma acepta id explícito) y el orden de inserción para que el resultado
 * no dependa del azar: cada uno falla siempre si la consulta que cubre no tiene orden explícito.
 *
 * d1: preCheckInicioTorneo devuelve parejaIds de cada zona en orden de pareja.orden (UUID en orden inverso).
 * d2: regenerarPartidosZona arma P1/P2 del mini-bracket según pareja.orden (UUID en orden o1, o3, o2, o4).
 * d3: el plan del pre-check es el mismo con los UUID de las parejas permutados.
 * d4: el plan del pre-check es el mismo con categorías y parejas insertadas en otro orden.
 * d5: en el modo lluvia, dos partidos empatados en todo se desempatan por categoría, no por id.
 * d7: helper utils/estadoCanonico.js: mismo estado con otros UUID da el mismo hash; otra cancha, otro hash.
 * d8: el sorteo (iniciarCategoria, sin disponibilidad) con Math.random fijo da las mismas zonas
 *     con las parejas insertadas en otro orden.
 */

const { ensureTestDb } = require('./utils/testEnvGuard');
const { resetTestDb } = require('./reset-test-db');
const prisma = require('../src/lib/prisma');
const organizadorService = require('../src/services/organizador.service');
const zonaService = require('../src/services/zona.service');
const canchasOverridesService = require('../src/services/canchasOverrides.service');
const { parseFechaLocal } = require('../src/utils/dateUtils');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** UUID con formato v4 cuyo orden de texto lo fija (prefijo, n). */
function uid(prefijo, n) {
  return `${prefijo}${String(n).padStart(6, '0')}-0000-4000-8000-000000000000`;
}

/** Slots de 15 minutos del sábado entre desde (incluido) y hasta (excluido). */
function slotsSabado(desde, hasta) {
  const aMin = (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
  const res = [];
  for (let m = aMin(desde); m < aMin(hasta); m += 15) {
    res.push(`Sabado-${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  return res;
}

async function limpiarDb() {
  organizadorService.preCheckSessions.clear();
  organizadorService.planesCache.clear();
  await prisma.setPartido.deleteMany({});
  await prisma.partido.deleteMany({});
  await prisma.faseEliminatoria.deleteMany({});
  await prisma.zonaPareja.deleteMany({});
  await prisma.zona.deleteMany({});
  await prisma.slotPareja.deleteMany({});
  await prisma.pareja.deleteMany({});
  await prisma.categoria.deleteMany({});
  await prisma.overrideCanchasDia.deleteMany({});
  await prisma.torneo.deleteMany({});
  await prisma.organizador.deleteMany({});
  await canchasOverridesService.loadFromDb();
}

async function crearTorneo(nombre, { cantidadCanchas = 1, estado = 'BORRADOR' } = {}) {
  const org = await prisma.organizador.create({
    data: {
      nombre,
      email: `${nombre}@padel.test`,
      passwordHash: 'hash',
      cantidadCanchas,
      viernesInicio: '18:00',
      viernesFin: '23:00',
      sabadoInicio: '09:00',
      sabadoFin: '14:00',
      domingoInicio: '09:00',
      domingoFin: '22:00',
    },
  });
  const torneo = await prisma.torneo.create({
    data: { nombre, slug: nombre, fecha: parseFechaLocal('2026-09-04'), estado, organizadorId: org.id },
  });
  return { org, torneo };
}

/**
 * Crea una categoría y sus parejas en el orden del arreglo spec: [{ orden, id, slots }].
 * Devuelve { cat, parejas, clavePorId } con clavePorId: id -> "<categoría>#<orden>".
 */
async function crearCategoria(torneo, nombre, spec, { estado = 'BORRADOR' } = {}) {
  const cat = await prisma.categoria.create({ data: { torneoId: torneo.id, nombre, estado } });
  const parejas = [];
  const clavePorId = new Map();
  for (const s of spec) {
    const p = await prisma.pareja.create({
      data: { id: s.id, categoriaId: cat.id, jugador1: `${nombre}_A${s.orden}`, jugador2: `${nombre}_B${s.orden}`, orden: s.orden },
    });
    for (const slotId of s.slots || []) {
      await prisma.slotPareja.create({ data: { parejaId: p.id, slotId } });
    }
    parejas.push(p);
    clavePorId.set(p.id, `${nombre}#${s.orden}`);
  }
  return { cat, parejas, clavePorId };
}

/** Plan del pre-check sin UUID: parejas como "<categoría>#<orden>", respetando el orden de cada lista. */
function planCanonico(categoriasPlan, clavePorId) {
  const clave = (id) => (id ? clavePorId.get(id) || `?${id}` : null);
  return categoriasPlan.map((c) => ({
    categoria: c.nombre,
    zonas: c.zonas.map((z) => ({
      nombre: z.nombre,
      formato: z.formato,
      manual: z.requiereArmadoManual,
      parejas: z.parejaIds.map(clave),
      partidos: z.partidos.map((p) => ({
        pos: p.posicionEnRonda,
        p1: clave(p.pareja1Id),
        p2: clave(p.pareja2Id),
        o1: p.origenPareja1,
        o2: p.origenPareja2,
        fechaHora: p.fechaHora ? new Date(p.fechaHora).toISOString() : null,
        cancha: p.canchaNumero,
        sinHorario: p.sinHorarioAsignado,
      })),
    })),
  }));
}

async function planDe(org, torneo) {
  await organizadorService.preCheckInicioTorneo(org.id, torneo.id);
  const session = organizadorService.preCheckSessions.get(torneo.id);
  assert(session && Array.isArray(session.categoriasPlan), 'El pre-check no dejó sesión con categoriasPlan');
  return session.categoriasPlan;
}

function primeraDiferencia(a, b) {
  const ja = JSON.stringify(a, null, 1).split('\n');
  const jb = JSON.stringify(b, null, 1).split('\n');
  for (let i = 0; i < Math.max(ja.length, jb.length); i++) {
    if (ja[i] !== jb[i]) return `línea ${i + 1}: "${(ja[i] || '').trim()}" vs "${(jb[i] || '').trim()}"`;
  }
  return null;
}

// ---------------------------------------------------------------------------

/** d1: parejaIds del plan siguen pareja.orden aunque los UUID estén en orden inverso. */
async function d1() {
  const { org, torneo } = await crearTorneo('d1', { cantidadCanchas: 2 });
  const slots = slotsSabado('09:00', '14:00');
  const spec = [1, 2, 3, 4, 5, 6].map((orden) => ({ orden, id: uid('d1', 10 - orden), slots }));
  const { clavePorId } = await crearCategoria(torneo, 'Cat A', spec);

  const plan = await planDe(org, torneo);
  for (const z of plan[0].zonas) {
    const ordenes = z.parejaIds.map((id) => Number(clavePorId.get(id).split('#')[1]));
    const ordenados = [...ordenes].sort((x, y) => x - y);
    assert(
      JSON.stringify(ordenes) === JSON.stringify(ordenados),
      `${z.nombre}: parejaIds en orden ${JSON.stringify(ordenes)}, se esperaba ${JSON.stringify(ordenados)} (pareja.orden)`
    );
  }
}

/** d2: P1/P2 del mini-bracket regenerado según pareja.orden, con UUID en orden o1, o3, o2, o4. */
async function d2() {
  const { torneo } = await crearTorneo('d2', { estado: 'EN_CURSO' });
  const slots = slotsSabado('09:00', '14:00');
  const nPorOrden = { 1: 1, 3: 2, 2: 3, 4: 4 }; // orden de UUID: o1 < o3 < o2 < o4
  const spec = [1, 2, 3, 4].map((orden) => ({ orden, id: uid('d2', nPorOrden[orden]), slots }));
  const { cat, parejas, clavePorId } = await crearCategoria(torneo, 'Cat A', spec, { estado: 'EN_CURSO' });
  const zona = await prisma.zona.create({ data: { categoriaId: cat.id, nombre: 'Zona A', formato: 'ROUND_ROBIN', clasifican: 2 } });
  for (const p of parejas) {
    await prisma.zonaPareja.create({ data: { zonaId: zona.id, parejaId: p.id } });
  }

  await zonaService.regenerarPartidosZona(prisma, cat.id, zona.id);

  const partidos = await prisma.partido.findMany({ where: { zonaId: zona.id }, orderBy: { posicionEnRonda: 'asc' } });
  const cruce = (pos) => {
    const p = partidos.find((x) => x.posicionEnRonda === pos);
    return p ? `${clavePorId.get(p.pareja1Id)} vs ${clavePorId.get(p.pareja2Id)}` : 'sin partido';
  };
  assert(cruce(1) === 'Cat A#1 vs Cat A#2', `P1: ${cruce(1)}, se esperaba Cat A#1 vs Cat A#2`);
  assert(cruce(2) === 'Cat A#3 vs Cat A#4', `P2: ${cruce(2)}, se esperaba Cat A#3 vs Cat A#4`);
}

/** d3: mismo plan del pre-check con los UUID de las parejas permutados. */
async function d3() {
  const slots = slotsSabado('09:00', '14:00');
  const permutacion = { 1: 3, 2: 6, 3: 1, 4: 5, 5: 2, 6: 4 };
  const planes = [];
  for (const [nombre, nDe] of [
    ['d3a', (orden) => orden],
    ['d3b', (orden) => permutacion[orden]],
  ]) {
    const { org, torneo } = await crearTorneo(nombre, { cantidadCanchas: 2 });
    const spec = [1, 2, 3, 4, 5, 6].map((orden) => ({ orden, id: uid(nombre === 'd3a' ? 'a3' : 'b3', nDe(orden)), slots }));
    const { clavePorId } = await crearCategoria(torneo, 'Cat A', spec);
    planes.push(planCanonico(await planDe(org, torneo), clavePorId));
  }
  const dif = primeraDiferencia(planes[0], planes[1]);
  assert(dif === null, `El plan cambia al permutar los UUID de las parejas (${dif})`);
}

/** d4: mismo plan del pre-check con categorías y parejas insertadas en otro orden (1 cancha, no entra todo). */
async function d4() {
  const slots = slotsSabado('09:00', '14:00');
  const planes = [];
  for (const [nombre, categorias, ordenes] of [
    ['d4a', ['Cat A', 'Cat B'], [1, 2, 3]],
    ['d4b', ['Cat B', 'Cat A'], [3, 2, 1]],
  ]) {
    const { org, torneo } = await crearTorneo(nombre, { cantidadCanchas: 1 });
    const clavePorId = new Map();
    for (const catNombre of categorias) {
      const prefijo = `${nombre === 'd4a' ? 'a' : 'b'}${catNombre === 'Cat A' ? 'a' : 'b'}`;
      const spec = ordenes.map((orden) => ({ orden, id: uid(prefijo, orden), slots }));
      const res = await crearCategoria(torneo, catNombre, spec);
      res.clavePorId.forEach((v, k) => clavePorId.set(k, v));
    }
    planes.push(planCanonico(await planDe(org, torneo), clavePorId));
  }
  const dif = primeraDiferencia(planes[0], planes[1]);
  assert(dif === null, `El plan cambia con otro orden de inserción (${dif})`);
}

/** d5: modo lluvia, dos partidos empatados en todo: el desempate es por categoría, no por UUID. */
async function d5() {
  const { org, torneo } = await crearTorneo('d5', { cantidadCanchas: 1, estado: 'EN_CURSO' });
  const partidoPorCategoria = {};
  // El partido de "Cat A" recibe el UUID mayor: si el desempate fuera por id, ganaría "Cat B"
  for (const [catNombre, prefijo, partidoId] of [
    ['Cat A', 'a5', uid('f5', 9)],
    ['Cat B', 'b5', uid('05', 1)],
  ]) {
    const spec = [1, 2].map((orden) => ({ orden, id: uid(prefijo, orden), slots: [] }));
    const { cat, parejas } = await crearCategoria(torneo, catNombre, spec, { estado: 'EN_CURSO' });
    const zona = await prisma.zona.create({ data: { categoriaId: cat.id, nombre: 'Zona A', formato: 'ROUND_ROBIN', clasifican: 2 } });
    for (const p of parejas) {
      await prisma.zonaPareja.create({ data: { zonaId: zona.id, parejaId: p.id } });
    }
    await prisma.partido.create({
      data: {
        id: partidoId,
        categoriaId: cat.id,
        zonaId: zona.id,
        posicionEnRonda: 1,
        pareja1Id: parejas[0].id,
        pareja2Id: parejas[1].id,
        estado: 'PENDIENTE',
        fechaHora: null,
        canchaNumero: null,
        sinHorarioAsignado: true,
      },
    });
    partidoPorCategoria[catNombre] = partidoId;
  }
  await prisma.overrideCanchasDia.create({
    data: {
      torneoId: torneo.id,
      diaKey: '2026-09-05',
      canchas: 1,
      isLluvia: true,
      activoDesde: new Date('2026-09-05T12:00:00.000Z'),
      partidosSinSlot: {
        [partidoPorCategoria['Cat A']]: 'Sin cancha por lluvia',
        [partidoPorCategoria['Cat B']]: 'Sin cancha por lluvia',
      },
    },
  });
  await canchasOverridesService.loadFromDb();

  await zonaService.asignarHorariosModoLluviaMCF(org.id, torneo.id, 1, null, new Date('2026-09-05T12:00:00.000Z'));

  const pA = await prisma.partido.findUnique({ where: { id: partidoPorCategoria['Cat A'] } });
  const pB = await prisma.partido.findUnique({ where: { id: partidoPorCategoria['Cat B'] } });
  const hora = (p) => (p.fechaHora ? new Date(p.fechaHora).toISOString() : 'sin horario');
  assert(pA.fechaHora, `El partido de Cat A quedó sin horario (Cat B: ${hora(pB)})`);
  assert(
    !pB.fechaHora || new Date(pA.fechaHora) < new Date(pB.fechaHora),
    `El primer turno debía ser de Cat A: Cat A ${hora(pA)}, Cat B ${hora(pB)}`
  );
}

/** d7: helper estadoCanonico.js: el hash no depende de UUID ni de orden de inserción, sí de los datos. */
async function d7() {
  const { hashEstadoTorneo, canonizarEstadoTorneo } = require('./utils/estadoCanonico');

  const torneos = [];
  for (const [nombre, prefijo, ordenes] of [
    ['d7a', 'a7', [1, 2]],
    ['d7b', 'b7', [2, 1]],
  ]) {
    const { torneo } = await crearTorneo(nombre, { estado: 'EN_CURSO' });
    const spec = ordenes.map((orden) => ({ orden, id: uid(prefijo, 3 - orden), slots: ['Sabado-09:00'] }));
    const { cat, parejas } = await crearCategoria(torneo, 'Cat A', spec, { estado: 'EN_CURSO' });
    const porOrden = (o) => parejas.find((p) => p.orden === o);
    const zona = await prisma.zona.create({ data: { categoriaId: cat.id, nombre: 'Zona A', formato: 'ROUND_ROBIN', clasifican: 2 } });
    for (const p of parejas) {
      await prisma.zonaPareja.create({ data: { zonaId: zona.id, parejaId: p.id, puntos: p.orden === 1 ? 3 : 0 } });
    }
    const partido = await prisma.partido.create({
      data: {
        categoriaId: cat.id,
        zonaId: zona.id,
        posicionEnRonda: 1,
        pareja1Id: porOrden(1).id,
        pareja2Id: porOrden(2).id,
        estado: 'PENDIENTE',
        fechaHora: new Date('2026-09-05T12:00:00.000Z'),
        canchaNumero: 1,
      },
    });
    await prisma.overrideCanchasDia.create({
      data: {
        torneoId: torneo.id,
        diaKey: '2026-09-05',
        canchas: 1,
        isLluvia: true,
        activoDesde: new Date('2026-09-05T12:00:00.000Z'),
        partidosSinSlot: { [partido.id]: 'motivo' },
      },
    });
    torneos.push({ torneo, partido, ids: [...parejas.map((p) => p.id), partido.id, zona.id, cat.id] });
  }

  const [ha, hb] = [await hashEstadoTorneo(prisma, torneos[0].torneo.id), await hashEstadoTorneo(prisma, torneos[1].torneo.id)];
  assert(ha === hb, `Mismo estado con otros UUID y otro orden de inserción dio hashes distintos (${ha} vs ${hb})`);

  const canon = JSON.stringify(await canonizarEstadoTorneo(prisma, torneos[0].torneo.id));
  for (const id of torneos[0].ids) {
    assert(!canon.includes(id), `El estado canónico contiene el UUID ${id}`);
  }

  await prisma.partido.update({ where: { id: torneos[1].partido.id }, data: { canchaNumero: 2 } });
  const hb2 = await hashEstadoTorneo(prisma, torneos[1].torneo.id);
  assert(hb2 !== ha, 'Cambiar la cancha de un partido no cambió el hash');
}

/** d8: sorteo sin disponibilidad con Math.random fijo: mismas zonas con las parejas insertadas en otro orden. */
async function d8() {
  const planes = [];
  const randomOriginal = Math.random;
  try {
    for (const [nombre, prefijo, ordenes] of [
      ['d8a', 'a8', [1, 2, 3, 4, 5, 6]],
      ['d8b', 'b8', [6, 5, 4, 3, 2, 1]],
    ]) {
      let semilla = 7;
      Math.random = () => {
        semilla = (semilla * 16807) % 2147483647;
        return semilla / 2147483647;
      };
      const { org, torneo } = await crearTorneo(nombre, { cantidadCanchas: 2 });
      const spec = ordenes.map((orden) => ({ orden, id: uid(prefijo, orden), slots: [] }));
      const { clavePorId } = await crearCategoria(torneo, 'Cat A', spec);
      planes.push(planCanonico(await planDe(org, torneo), clavePorId));
    }
  } finally {
    Math.random = randomOriginal;
  }
  const dif = primeraDiferencia(planes[0], planes[1]);
  assert(dif === null, `El sorteo cambia con otro orden de inserción de las parejas (${dif})`);
}

const TESTS = [
  ['d1', 'pre-check: parejaIds de cada zona en orden de pareja.orden', d1],
  ['d2', 'regenerarPartidosZona: P1/P2 del mini-bracket según pareja.orden', d2],
  ['d3', 'pre-check: mismo plan con los UUID de las parejas permutados', d3],
  ['d4', 'pre-check: mismo plan con categorías y parejas insertadas en otro orden', d4],
  ['d5', 'modo lluvia: desempate natural (categoría), no por UUID', d5],
  ['d7', 'estadoCanonico: hash independiente de UUID y orden de inserción', d7],
  ['d8', 'sorteo con Math.random fijo: mismas zonas con otro orden de inserción', d8],
];

async function run() {
  await ensureTestDb();
  resetTestDb();
  await canchasOverridesService.loadFromDb();

  console.log('='.repeat(80));
  console.log('🧪 SUITE: DETERMINISMO DE LAS CONSULTAS DEL SCHEDULER');
  console.log('='.repeat(80));

  const resultados = [];
  for (const [id, nombre, fn] of TESTS) {
    try {
      await limpiarDb();
      await fn();
      resultados.push({ id, estado: 'PASS' });
      console.log(`✅ (${id}) PASS: ${nombre}`);
    } catch (err) {
      resultados.push({ id, estado: 'FAIL' });
      console.log(`❌ (${id}) FAIL: ${nombre}\n   ${err.message}`);
    }
  }

  await limpiarDb();
  await prisma.$disconnect();

  const fallidos = resultados.filter((r) => r.estado === 'FAIL');
  console.log('\n' + '-'.repeat(80));
  console.log(`Resultado: ${resultados.length - fallidos.length}/${resultados.length} PASS, ${fallidos.length} FAIL`);
  return fallidos.length === 0;
}

if (require.main === module) {
  run()
    .then((ok) => process.exit(ok ? 0 : 1))
    .catch((e) => {
      console.error('Error fatal en test-determinismo-consultas.js:', e);
      process.exit(1);
    });
}

module.exports = { run };
