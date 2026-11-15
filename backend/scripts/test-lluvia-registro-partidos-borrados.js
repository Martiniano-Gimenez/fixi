'use strict';

require('./utils/testEnvGuard');
const { ensureTestDb } = require('./utils/testEnvGuard');
const { resetTestDb } = require('./reset-test-db');
const assert = require('node:assert/strict');
const prisma = require('../src/lib/prisma');
const categorias = require('../src/services/categoria.service');
const fases = require('../src/services/faseEliminatoria.service');
const zonas = require('../src/services/zona.service');
const overrides = require('../src/services/canchasOverrides.service');
const organizadores = require('../src/services/organizador.service');
const { getSlotsValidosSet } = require('../src/services/slots.service');
const { getDiaCalendarioConTrasnoche } = require('../src/utils/dateUtils');

const VIE = '2027-01-08', SAB = '2027-01-09', DOM = '2027-01-10';
const D = 75 * 60_000;
const fecha = (dia, hora) => new Date(`${dia}T${hora}:00-03:00`);
const leer = (valor) => typeof valor === 'string' ? JSON.parse(valor) : valor;
const filtrar = (valor, ids) => {
  const limpio = Object.fromEntries(Object.entries(leer(valor)).filter(([id]) => !ids.has(id)));
  return typeof valor === 'string' ? JSON.stringify(limpio) : limpio;
};
const conHorario = (p) => p.fechaHora && p.canchaNumero && !p.sinHorarioAsignado;
let numero = 0;

async function crearBase() {
  const org = await prisma.organizador.create({ data: { email: `registro-borrados-${++numero}@example.com`,
    nombre: 'Club registros', passwordHash: 'test', cantidadCanchas: 3,
    viernesInicio: '18:00', viernesFin: '23:00', sabadoInicio: '09:00', sabadoFin: '18:00', domingoInicio: '09:00', domingoFin: '23:00' } });
  const torneo = await prisma.torneo.create({ data: { organizadorId: org.id, nombre: 'Registro de lluvia',
    slug: `registro-borrados-${numero}`, fecha: fecha(VIE, '12:00'), estado: 'EN_CURSO' } });
  const cat = await prisma.categoria.create({ data: { torneoId: torneo.id, nombre: '5ta', estado: 'EN_CURSO' } });
  const otra = await prisma.categoria.create({ data: { torneoId: torneo.id, nombre: '7ma', estado: 'EN_CURSO' } });
  const slots = [...getSlotsValidosSet(org)];
  let orden = 0;
  async function zona(categoriaId, nombre, cantidad, disponibilidad = slots) {
    const z = await prisma.zona.create({ data: { categoriaId, nombre, formato: 'ROUND_ROBIN', clasifican: 2 } });
    const parejas = [];
    for (let i = 0; i < cantidad; i++) {
      const p = await prisma.pareja.create({ data: { categoriaId, orden: ++orden, jugador1: `${nombre} ${i}`, jugador2: 'Pareja',
        slotsSeleccionados: { create: disponibilidad.map((slotId) => ({ slotId })) } } });
      parejas.push(p);
      await prisma.zonaPareja.create({ data: { zonaId: z.id, parejaId: p.id } });
    }
    await zonas.generarPartidosZonaHelper(prisma, categoriaId, z.id, 'ROUND_ROBIN', cantidad, parejas);
    const partidos = await prisma.partido.findMany({ where: { zonaId: z.id }, orderBy: { posicionEnRonda: 'asc' } });
    return { ...z, parejas, partidos };
  }
  const origen = await zona(cat.id, 'Zona A', 3);
  const destino = await zona(cat.id, 'Zona B', 2);
  return { org, torneo, cat, otra, zona, origen, destino, slots };
}

const partidos = (ctx, db = prisma) => db.partido.findMany({ where: { categoria: { torneoId: ctx.torneo.id } },
  include: { sets: { orderBy: { numero: 'asc' } } }, orderBy: { id: 'asc' } });
const registros = (ctx, db = prisma) => db.overrideCanchasDia.findMany({ where: { torneoId: ctx.torneo.id }, orderBy: { diaKey: 'asc' } });
const cache = (ctx) => structuredClone(overrides.getOverridesTorneo(ctx.torneo.id));
async function foto(ctx) {
  return {
    partidos: await partidos(ctx), registros: await registros(ctx),
    categorias: await prisma.categoria.findMany({ where: { torneoId: ctx.torneo.id }, orderBy: { id: 'asc' } }),
    zonas: await prisma.zona.findMany({ where: { categoria: { torneoId: ctx.torneo.id } }, orderBy: { id: 'asc' } }),
    zonaParejas: await prisma.zonaPareja.findMany({ where: { zona: { categoria: { torneoId: ctx.torneo.id } } }, orderBy: { id: 'asc' } }),
    parejas: await prisma.pareja.findMany({ where: { categoria: { torneoId: ctx.torneo.id } }, include: { slotsSeleccionados: { orderBy: { slotId: 'asc' } } }, orderBy: { id: 'asc' } }),
  };
}

async function escenarioRegistros() {
  const ctx = await crearBase();
  await ctx.zona(ctx.otra.id, 'Zona testigo', 2);
  await fases.generarEliminatoria(ctx.org.id, ctx.cat.id);
  await fases.generarEliminatoria(ctx.org.id, ctx.otra.id);
  const ps = await partidos(ctx);
  for (const [i, p] of ps.entries()) {
    await prisma.partido.update({ where: { id: p.id }, data: {
      fechaHora: new Date(+fecha(i % 2 ? SAB : VIE, i % 2 ? '09:00' : '18:00') + Math.floor(i / 2) * D),
      canchaNumero: 3, sinHorarioAsignado: false,
    } });
  }
  for (const dia of [VIE, SAB]) {
    const delDia = (await partidos(ctx)).filter((p) => getDiaCalendarioConTrasnoche(p.fechaHora, ctx.org).key === dia);
    const horarios = Object.fromEntries(delDia.map((p) => [p.id, { fechaHora: p.fechaHora.toISOString(), canchaNumero: p.canchaNumero,
      horarioManual: p.horarioManual, sinHorarioAsignado: false, testigo: `Conservar ${p.id}` }]));
    const sinSlot = Object.fromEntries(delDia.map((p) => [p.id, `Motivo ${p.id}`]));
    // Ambos formatos persistidos son válidos: la limpieza debe conservar el formato y el resto del registro.
    await overrides.setOverrideDia(ctx.torneo.id, dia, 1, fecha(dia, dia === VIE ? '18:00' : '09:00'),
      dia === SAB ? JSON.stringify(sinSlot) : sinSlot, null, dia === SAB ? JSON.stringify(horarios) : horarios);
  }
  await overrides.loadFromDb();
  return ctx;
}

async function comprobarOperacion(nombre, operar, seleccionar) {
  const ctx = await escenarioRegistros();
  const antes = await foto(ctx);
  const cacheAntes = cache(ctx);
  const ids = new Set(antes.partidos.filter((p) => seleccionar(p, ctx)).map((p) => p.id));
  assert.ok(ids.size > 0);
  const transaccion = prisma.$transaction;
  let alcanzoCommit = false;
  // El fallo ocurre después de todos los borrados y de la limpieza, antes del commit real.
  prisma.$transaction = (fn, opciones) => transaccion.call(prisma, async (tx) => {
    await fn(tx);
    assert.deepEqual(cache(ctx), cacheAntes, 'La caché no se publica dentro de la transacción');
    const internos = await registros(ctx, tx);
    for (const ov of internos) for (const campo of ['horariosAntesLluvia', 'partidosSinSlot']) {
      assert.ok(Object.keys(leer(ov[campo])).every((id) => !ids.has(id)), 'La base se limpia dentro de la transacción');
    }
    alcanzoCommit = true;
    throw new Error('Rollback de limpieza de lluvia');
  }, opciones);
  try { await assert.rejects(() => operar(ctx), /Rollback de limpieza de lluvia/); }
  finally { prisma.$transaction = transaccion; }
  assert.ok(alcanzoCommit, 'El rollback realmente llegó a ejecutar la operación completa');
  assert.deepEqual(await foto(ctx), antes, `${nombre}: rollback completo de la base`);
  assert.deepEqual(cache(ctx), cacheAntes, `${nombre}: rollback sin mutar la caché`);

  // También en el camino exitoso se observa la caché justo antes del commit.
  prisma.$transaction = (fn, opciones) => transaccion.call(prisma, async (tx) => {
    const resultado = await fn(tx);
    assert.deepEqual(cache(ctx), cacheAntes);
    return resultado;
  }, opciones);
  try { await operar(ctx); }
  finally { prisma.$transaction = transaccion; }
  const despues = await foto(ctx);
  const existentes = new Set(despues.partidos.map((p) => p.id));
  for (const p of antes.partidos) assert.equal(!existentes.has(p.id), ids.has(p.id), 'Solo se borraron los partidos de la operación');
  for (const [i, ov] of antes.registros.entries()) {
    const esperado = { ...ov, horariosAntesLluvia: filtrar(ov.horariosAntesLluvia, ids), partidosSinSlot: filtrar(ov.partidosSinSlot, ids) };
    assert.deepEqual(despues.registros[i], esperado, `${nombre}: las entradas ajenas y los metadatos siguen intactos`);
    for (const campo of ['horariosAntesLluvia', 'partidosSinSlot']) {
      assert.ok(Object.keys(leer(despues.registros[i][campo])).every((id) => existentes.has(id)), 'No quedan ids de partidos borrados');
    }
    const cacheEsperada = { ...cacheAntes[ov.diaKey], partidosSinSlot: leer(filtrar(ov.partidosSinSlot, ids)) };
    assert.deepEqual(cache(ctx)[ov.diaKey], cacheEsperada, 'La caché coincide con la limpieza confirmada');
  }
  console.log(`PASS ${nombre}: viernes y sábado, entradas ajenas intactas, caché post-commit y rollback completo`);
}

async function restaurarTrasMover() {
  const ctx = await crearBase();
  const viernes = ctx.slots.filter((s) => s.startsWith('Viernes-'));
  // Los nuevos solo pueden jugar el viernes: la lluvia deja ocupada su única cancha abierta.
  await prisma.slotPareja.deleteMany({ where: { pareja: { categoriaId: ctx.cat.id } } });
  await prisma.slotPareja.createMany({ data: [...ctx.origen.parejas, ...ctx.destino.parejas].flatMap((p) => viernes.map((slotId) => ({ parejaId: p.id, slotId }))) });
  const fija = await ctx.zona(ctx.otra.id, 'Fija A', 3);
  const fija2 = await ctx.zona(ctx.otra.id, 'Fija B', 2);
  const bloqueadores = [...fija.partidos, ...fija2.partidos];
  for (const [i, p] of bloqueadores.entries()) await prisma.partido.update({ where: { id: p.id }, data: {
    estado: 'FINALIZADO', ganadorId: p.pareja1Id, fechaHora: new Date(+fecha(VIE, '18:00') + i * D), canchaNumero: 1,
  } });
  for (const [i, p] of ctx.origen.partidos.entries()) await prisma.partido.update({ where: { id: p.id }, data: {
    fechaHora: new Date(+fecha(VIE, '18:00') + i * D), canchaNumero: 2,
  } });
  await prisma.partido.update({ where: { id: ctx.destino.partidos[0].id }, data: { fechaHora: fecha(VIE, '19:15'), canchaNumero: 3 } });
  const registrada = await ctx.zona(ctx.otra.id, 'Registrada', 2);
  const regSabado = await ctx.zona(ctx.otra.id, 'Registrada sábado', 2);
  await prisma.partido.update({ where: { id: registrada.partidos[0].id }, data: { fechaHora: fecha(VIE, '18:00'), canchaNumero: 3 } });
  await prisma.partido.update({ where: { id: regSabado.partidos[0].id }, data: { fechaHora: fecha(SAB, '14:00'), canchaNumero: 3 } });
  const fase = await prisma.faseEliminatoria.create({ data: { categoriaId: ctx.otra.id, ronda: 2, nombre: 'Final' } });
  const cuadro = await prisma.partido.create({ data: { categoriaId: ctx.otra.id, faseEliminatoriaId: fase.id,
    fechaHora: fecha(DOM, '19:00'), canchaNumero: 1, horarioManual: true } });
  const originales = new Map((await partidos(ctx)).filter(conHorario).map((p) => [p.id, p]));
  for (const dia of [VIE, SAB]) await organizadores.reprogramarPorReduccionCanchas(ctx.org.id, ctx.torneo.id, 1, null, dia);
  // La jornada del caso sigue sin empezar; los testigos conservan sus horarios y no se mueven.
  await prisma.partido.updateMany({ where: { id: { in: bloqueadores.map((p) => p.id) } }, data: { estado: 'PENDIENTE', ganadorId: null } });
  const antes = await foto(ctx);
  await zonas.moverParejaDeZona(ctx.org.id, ctx.cat.id, { parejaId: ctx.origen.parejas[0].id,
    zonaOrigenId: ctx.origen.id, zonaDestinoId: ctx.destino.id });
  const idsAntes = new Set(antes.partidos.map((p) => p.id));
  const nuevos = (await partidos(ctx)).filter((p) => !idsAntes.has(p.id));
  assert.equal(nuevos.length, 4);
  assert.ok(nuevos.every((p) => !conHorario(p) && p.sinHorarioAsignado));
  const todosIds = new Set((await partidos(ctx)).map((p) => p.id));
  for (const ov of await registros(ctx)) for (const campo of ['horariosAntesLluvia', 'partidosSinSlot']) {
    assert.ok(Object.keys(leer(ov[campo])).every((id) => todosIds.has(id)));
  }
  const respuesta = await organizadores.reprogramarPorReduccionCanchas(ctx.org.id, ctx.torneo.id, 3, null, VIE);
  assert.equal(respuesta.reprogramacion.partidosNuevosProgramados, 4);
  assert.equal(respuesta.reprogramacion.partidosNuevosSinHorario, 0);
  const despuesViernes = await partidos(ctx);
  const reg = despuesViernes.find((p) => p.id === registrada.partidos[0].id);
  assert.equal(+reg.fechaHora, +originales.get(reg.id).fechaHora);
  assert.equal(reg.canchaNumero, originales.get(reg.id).canchaNumero);
  assert.ok(nuevos.every((p) => conHorario(despuesViernes.find((q) => q.id === p.id))));
  assert.deepEqual(despuesViernes.find((p) => p.id === cuadro.id), { ...cuadro, sets: [] }, 'El cuadro no cambia');
  assert.equal(overrides.getCanchasDia(ctx.torneo.id, SAB, 3).canchas, 1, 'La lluvia del sábado sigue vigente');
  await organizadores.reprogramarPorReduccionCanchas(ctx.org.id, ctx.torneo.id, 3, null, SAB);
  const despues = await partidos(ctx);
  const regSab = despues.find((p) => p.id === regSabado.partidos[0].id);
  assert.equal(+regSab.fechaHora, +originales.get(regSab.id).fechaHora);
  assert.equal(regSab.canchaNumero, originales.get(regSab.id).canchaNumero);
  assert.equal((await registros(ctx)).length, 0);
  assert.deepEqual(new Set(despues.map((p) => p.id)), todosIds, 'No se pierden partidos al restaurar');
  for (const p of despues.filter(conHorario)) {
    if (originales.has(p.id)) assert.ok(+p.fechaHora >= +originales.get(p.id).fechaHora, 'No se adelantan los registrados');
    for (const q of despues.filter((q) => conHorario(q) && q.id !== p.id)) if (+p.fechaHora < +q.fechaHora + D && +q.fechaHora < +p.fechaHora + D) {
      assert.notEqual(p.canchaNumero, q.canchaNumero, 'No hay canchas superpuestas');
      for (const id of [p.pareja1Id, p.pareja2Id].filter(Boolean)) assert.ok(id !== q.pareja1Id && id !== q.pareja2Id, 'No hay parejas superpuestas');
    }
  }
  console.log('PASS restaurar tras mover: registros sin ids borrados, horario previo recuperado, cuatro nuevos programados y sin solapes');
}

async function run() {
  await ensureTestDb();
  resetTestDb();
  await overrides.loadFromDb();
  const deCategoria = (p, ctx) => p.categoriaId === ctx.cat.id;
  const delCuadro = (p, ctx) => deCategoria(p, ctx) && Boolean(p.faseEliminatoriaId);
  await comprobarOperacion('Eliminar categoría', (ctx) => categorias.deleteCategoria(ctx.org.id, ctx.cat.id), deCategoria);
  await comprobarOperacion('Borrar eliminatoria', (ctx) => fases.borrarEliminatoria(ctx.org.id, ctx.cat.id), delCuadro);
  await comprobarOperacion('Limpiar resultados de zonas', (ctx) => zonas.limpiarResultadosZonas(ctx.org.id, ctx.cat.id), delCuadro);
  await comprobarOperacion('Mover pareja', (ctx) => zonas.moverParejaDeZona(ctx.org.id, ctx.cat.id, {
    parejaId: ctx.origen.parejas[0].id, zonaOrigenId: ctx.origen.id, zonaDestinoId: ctx.destino.id,
  }), (p, ctx) => p.zonaId === ctx.origen.id || p.zonaId === ctx.destino.id);
  await comprobarOperacion('Agregar pareja', (ctx) => zonas.agregarParejaAZona(ctx.org.id, ctx.cat.id, {
    zonaDestinoId: ctx.destino.id, jugador1: 'Nueva', jugador2: 'Pareja', slotIds: ctx.slots,
  }), (p, ctx) => p.zonaId === ctx.destino.id);
  await comprobarOperacion('Reiniciar categoría', (ctx) => categorias.reiniciarCategoria(ctx.org.id, ctx.cat.id), deCategoria);
  await comprobarOperacion('Sincronizar cuadro con transacción externa', (ctx) => fases.sincronizarCuadro(ctx.org.id, ctx.cat.id), delCuadro);
  await restaurarTrasMover();
}
run().then(async () => { await prisma.$disconnect(); process.exit(0); }).catch(async (error) => {
  console.error(error); await prisma.$disconnect(); process.exit(1);
});
