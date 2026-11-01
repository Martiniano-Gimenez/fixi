'use strict';

const { ensureTestDb } = require('./utils/testEnvGuard');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const prisma = require('../src/lib/prisma');
const { verificarProgramacionZona, MAX_NODOS_ZONA } = require('../src/utils/programacionZona');
const { fusionarSlotsEnVentanas, parseSlotToDate } = require('../src/services/zona.service');
const { generarSlotsDia } = require('../src/services/slots.service');
const organizadorService = require('../src/services/organizador.service');
const disponibilidadService = require('../src/services/disponibilidad.service');
const canchasOverridesService = require('../src/services/canchasOverrides.service');

const FECHA = new Date('2026-11-06T15:00:00Z');
const DURACION = 75 * 60_000;
const viernes = (a, b) => generarSlotsDia('Viernes', a, b);
const sabado = (a, b) => generarSlotsDia('Sabado', a, b);
const ms = (slot) => parseSlotToDate(slot, FECHA).getTime();

function entrada(slotsPorPareja, { formato = 'ROUND_ROBIN', cantidadCanchas = 2,
  slotsClub = [...viernes('09:00', '03:00'), ...sabado('08:00', '03:00')] } = {}) {
  const parejas = slotsPorPareja.map((slots, i) => ({
    id: `pareja-${i + 1}`, orden: i + 1, ventanas: fusionarSlotsEnVentanas(slots, FECHA),
  }));
  const cruces = [];
  if (formato === 'MINI_BRACKET') cruces.push([0, 1], [2, 3], [null, null], [null, null]);
  else for (let i = 0; i < parejas.length; i++) for (let j = i + 1; j < parejas.length; j++) cruces.push([i, j]);
  return {
    formato, parejas, cantidadCanchas,
    ventanasClub: fusionarSlotsEnVentanas(slotsClub, FECHA),
    partidos: cruces.map(([a, b], i) => ({
      posicionEnRonda: i + 1, pareja1Id: parejas[a]?.id, pareja2Id: parejas[b]?.id,
      sinHorarioAsignado: true,
    })),
  };
}

// Comprueba el testigo también para cada uno de los cuatro resultados posibles de P1/P2.
function comprobarTestigo(input, result) {
  assert.equal(result.estado, 'FACTIBLE');
  assert.equal(result.programacion.length, input.partidos.length);
  const escenarios = input.formato === 'MINI_BRACKET' ? [[0, 0], [0, 1], [1, 0], [1, 1]] : [null];
  for (const resultado of escenarios) {
    const juegos = result.programacion.map((p, i) => {
      const original = input.partidos[i];
      let ids = [original.pareja1Id, original.pareja2Id];
      if (resultado && i >= 2) {
        ids = [0, 1].map((r) => {
          const base = input.partidos[r];
          const opciones = [base.pareja1Id, base.pareja2Id];
          return opciones[i === 2 ? resultado[r] : 1 - resultado[r]];
        });
        const piso = Math.max(...result.programacion.slice(0, 2).map((q) => +new Date(q.fechaHora) + DURACION));
        assert.ok(+new Date(p.fechaHora) >= piso);
      }
      const startMs = +new Date(p.fechaHora), endMs = startMs + DURACION;
      assert.ok(p.canchaNumero >= 1 && p.canchaNumero <= input.cantidadCanchas);
      assert.ok(input.ventanasClub.some((w) => ['Viernes', 'Sabado'].includes(w.dia) && startMs >= w.startMs && endMs <= w.endMs));
      const posibles = resultado && i >= 2 ? input.parejas : input.parejas.filter((q) => ids.includes(q.id));
      for (const pareja of posibles) {
        assert.ok(!pareja.ventanas.length || pareja.ventanas.some((w) => startMs >= w.startMs && endMs <= w.endMs));
        assert.ok((input.parejaAssignments?.get(pareja.id) || []).every((w) => startMs >= w.endMs || endMs <= w.startMs));
      }
      assert.ok((input.courtTimelines?.get(p.canchaNumero) || []).every((w) => startMs >= w.endMs || endMs <= w.startMs));
      return { ...p, startMs, endMs, ids };
    });
    for (let i = 0; i < juegos.length; i++) for (let j = i + 1; j < juegos.length; j++) {
      const a = juegos[i], b = juegos[j];
      if (a.startMs >= b.endMs || b.startMs >= a.endMs) continue;
      assert.notEqual(a.canchaNumero, b.canchaNumero);
      assert.ok(!a.ids.some((id) => b.ids.includes(id)), 'Una pareja no puede jugar dos partidos a la vez');
    }
  }
}

function testPuros() {
  const dos = entrada([['Viernes-18:00'], ['Viernes-18:00']]);
  comprobarTestigo(dos, verificarProgramacionZona(dos));
  assert.equal(verificarProgramacionZona({ ...dos, courtTimelines: new Map([[1, [{ startMs: ms('Viernes-18:00'), endMs: ms('Viernes-19:15') }]],
    [2, [{ startMs: ms('Viernes-18:00'), endMs: ms('Viernes-19:15') }]]]) }).estado, 'NO_FACTIBLE');
  assert.equal(verificarProgramacionZona({ ...dos, parejaAssignments: new Map([['pareja-1', [{ startMs: ms('Viernes-17:30'), endMs: ms('Viernes-18:45') }]]]) }).estado, 'NO_FACTIBLE');

  const seguidos = entrada(Array.from({ length: 3 }, () => ['Viernes-18:00', 'Viernes-19:15', 'Viernes-20:30']), { cantidadCanchas: 1 });
  const seguidosResult = verificarProgramacionZona(seguidos);
  comprobarTestigo(seguidos, seguidosResult);
  assert.deepEqual(seguidosResult.programacion.map((p) => p.fechaHora).sort(),
    ['Viernes-18:00', 'Viernes-19:15', 'Viernes-20:30'].map((s) => new Date(ms(s)).toISOString()));

  const cuatro = entrada(Array.from({ length: 4 }, () => viernes('18:00', '23:00')), { formato: 'MINI_BRACKET' });
  const mini = verificarProgramacionZona(cuatro);
  comprobarTestigo(cuatro, mini);
  assert.equal(mini.programacion[2].fechaHora, mini.programacion[3].fechaHora, 'P3/P4 pueden ser simultáneos');
  assert.notEqual(mini.programacion[2].canchaNumero, mini.programacion[3].canchaNumero);
  const miniUnaCancha = { ...cuatro, cantidadCanchas: 1 };
  comprobarTestigo(miniUnaCancha, verificarProgramacionZona(miniUnaCancha));
  const miniOcupado = { ...cuatro, parejaAssignments: new Map([['pareja-1', [{
    startMs: ms('Viernes-19:15'), endMs: ms('Viernes-23:00'),
  }]]]) };
  assert.equal(verificarProgramacionZona(miniOcupado).estado, 'NO_FACTIBLE', 'P3/P4 deben servir también para la pareja ocupada afuera');

  const sinCuadruple = entrada([
    ['Viernes-18:00', 'Viernes-20:30'], ['Viernes-18:00', 'Viernes-23:00'],
    ['Viernes-19:15', 'Viernes-20:30'], ['Viernes-19:15', 'Viernes-23:00'],
  ], { formato: 'MINI_BRACKET' });
  assert.equal(verificarProgramacionZona(sinCuadruple).estado, 'NO_FACTIBLE');

  // Una intersección cuádruple antes de terminar P1/P2 tampoco alcanza.
  const sinDefinicion = entrada(Array.from({ length: 4 }, () => ['Viernes-18:00']), { formato: 'MINI_BRACKET' });
  assert.equal(verificarProgramacionZona(sinDefinicion).estado, 'NO_FACTIBLE');

  const rr4 = entrada(Array.from({ length: 4 }, () => viernes('18:00', '23:00')));
  comprobarTestigo(rr4, verificarProgramacionZona(rr4));
  assert.equal(verificarProgramacionZona(rr4).programacion.length, 6);

  const trasnoche = entrada([['Sabado-00:00'], ['Sabado-00:00']]);
  comprobarTestigo(trasnoche, verificarProgramacionZona(trasnoche));
  assert.equal(verificarProgramacionZona(trasnoche).programacion[0].fechaHora, '2026-11-08T03:00:00.000Z');
  const domingo = entrada([['Domingo-18:00'], ['Domingo-18:00']], { slotsClub: generarSlotsDia('Domingo', '09:00', '23:00') });
  assert.equal(verificarProgramacionZona(domingo).estado, 'NO_FACTIBLE');
  const fueraClub = entrada([['Viernes-08:00'], ['Viernes-08:00']]);
  assert.equal(verificarProgramacionZona(fueraClub).estado, 'NO_FACTIBLE');
  const libres = entrada([[], []]);
  comprobarTestigo(libres, verificarProgramacionZona(libres));

  // Los slots no contiguos también forman ventanas solapadas, como en el scheduler.
  const ventanas = entrada([['Viernes-18:00', 'Viernes-18:30'], ['Viernes-18:15']]);
  comprobarTestigo(ventanas, verificarProgramacionZona(ventanas));
  assert.equal(verificarProgramacionZona(ventanas).programacion[0].fechaHora, new Date(ms('Viernes-18:15')).toISOString());

  const fijo = structuredClone(cuatro);
  fijo.partidos[0] = { ...fijo.partidos[0], fechaHora: new Date(ms('Viernes-19:15')), canchaNumero: 2, sinHorarioAsignado: false };
  const fijoResult = verificarProgramacionZona(fijo);
  comprobarTestigo(fijo, fijoResult);
  assert.equal(fijoResult.programacion[0].fechaHora, new Date(ms('Viernes-19:15')).toISOString());
  assert.equal(fijoResult.programacion[0].canchaNumero, 2);

  const copia = structuredClone(rr4);
  const primero = verificarProgramacionZona(rr4);
  assert.deepEqual(verificarProgramacionZona(rr4), primero, 'Dos corridas idénticas');
  assert.deepEqual(rr4, copia, 'Sin mutaciones de entrada');
  const permutado = structuredClone(rr4);
  const remap = new Map(permutado.parejas.map((p, i) => [p.id, `uuid-inverso-${4 - i}`]));
  permutado.parejas = permutado.parejas.reverse().map((p) => ({ ...p, id: remap.get(p.id), ventanas: p.ventanas.reverse() }));
  permutado.partidos = permutado.partidos.reverse().map((p) => ({ ...p, pareja1Id: remap.get(p.pareja1Id), pareja2Id: remap.get(p.pareja2Id) }));
  permutado.ventanasClub.reverse();
  assert.deepEqual(verificarProgramacionZona(permutado), primero, 'Independiente de UUID e inserción');
  const limitado = verificarProgramacionZona({ ...rr4, maxNodos: 1 });
  assert.equal(limitado.estado, 'BUSQUEDA_INCOMPLETA');
  assert.equal(limitado.nodos, 1);
  assert.deepEqual(limitado.programacion, []);
  assert.equal(verificarProgramacionZona({ ...dos, maxNodos: 0 }).estado, 'BUSQUEDA_INCOMPLETA');
  console.log('PASS: zonas 2/3/4, RR/mini, ocupación, descanso cero, club, trasnoche, domingo, ventanas, fijados, determinismo y límite');
}

async function crearCaso(nombre, slotsPorPareja) {
  const org = await prisma.organizador.create({ data: {
    nombre, email: `${nombre}@programacion.test`, passwordHash: 'test', cantidadCanchas: 2,
    viernesInicio: '09:00', viernesFin: '03:00', sabadoInicio: '08:00', sabadoFin: '03:00',
  } });
  const torneo = await prisma.torneo.create({ data: { nombre, slug: nombre, fecha: FECHA, organizadorId: org.id } });
  const cat = await prisma.categoria.create({ data: { nombre: '7ma Damas', torneoId: torneo.id } });
  const parejas = [];
  for (let i = 0; i < slotsPorPareja.length; i++) {
    parejas.push(await prisma.pareja.create({ data: {
      categoriaId: cat.id, orden: i + 1, jugador1: `Pareja ${i + 1}`, jugador2: nombre,
      slotsSeleccionados: { create: slotsPorPareja[i].map((slotId) => ({ slotId })) },
    } }));
  }
  return { org, torneo, parejas };
}

async function testIntegracion() {
  await canchasOverridesService.loadFromDb();
  // Caruso, Dávila, Medrano: las disponibilidades reales de la zona E aislada.
  const real = await crearCaso('zona-e-aislada', [
    [...viernes('18:00', '03:00'), ...sabado('15:00', '03:00')],
    viernes('13:00', '17:00'),
    [...viernes('19:00', '22:00'), ...sabado('15:00', '20:00')],
  ]);
  const pre = await organizadorService.preCheckInicioTorneo(real.org.id, real.torneo.id);
  const conflicto = pre.conflictos[0].partidosSinHorario.find((p) => p.motivo === 'ZONA_MANUAL_INCOMPLETA');
  assert.ok(conflicto);
  const davila = conflicto.parejasManuales.find((p) => p.id === real.parejas[1].id);
  assert.ok(davila.slotsViables.includes('Viernes-20:15'));
  assert.ok(!davila.slotsQueDestraban.includes('Viernes-20:15'), 'El falso positivo ya no se sugiere');
  assert.deepEqual(davila.slotsQueDestraban, [], 'Un único inicio no permite sus dos partidos');

  const positivo = await crearCaso('sugerido-aplicable', [
    ['Viernes-18:00'], ['Viernes-18:00', 'Viernes-19:15'], ['Viernes-19:15', 'Viernes-20:30'],
  ]);
  const antes = await organizadorService.preCheckInicioTorneo(positivo.org.id, positivo.torneo.id);
  const zona = antes.conflictos[0].partidosSinHorario.find((p) => p.motivo === 'ZONA_MANUAL_INCOMPLETA');
  const sugeridos = zona.parejasManuales.find((p) => p.id === positivo.parejas[0].id);
  assert.ok(sugeridos.slotsQueDestraban.includes('Viernes-20:30'));
  const testigoTres = verificarProgramacionZona(entrada([
    ['Viernes-18:00', 'Viernes-20:30'], ['Viernes-18:00', 'Viernes-19:15'], ['Viernes-19:15', 'Viernes-20:30'],
  ]));
  await disponibilidadService.setDisponibilidad(positivo.org.id, positivo.parejas[0].id, ['Viernes-18:00', 'Viernes-20:30']);
  const despues = await organizadorService.preCheckInicioTorneo(positivo.org.id, positivo.torneo.id, { isReCheck: true });
  assert.equal(despues.bloqueado, false, 'El re-check resuelve los tres partidos');
  const plan = organizadorService.preCheckSessions.get(positivo.torneo.id).categoriasPlan[0].zonas[0];
  assert.ok(plan.partidos.every((p) => p.fechaHora && p.canchaNumero && !p.sinHorarioAsignado));
  assert.equal(plan.requiereArmadoManual, false);
  assert.deepEqual(horarios(plan), testigoTres.programacion, 'La zona manual de tres queda igual al testigo');

  const miniCaso = await crearCaso('mini-sugerido', [
    ['Viernes-18:00'], ['Viernes-18:00', 'Viernes-20:30'],
    ['Viernes-18:00', 'Viernes-20:30'], ['Viernes-18:00', 'Viernes-20:30'],
  ]);
  const miniAntes = await organizadorService.preCheckInicioTorneo(miniCaso.org.id, miniCaso.torneo.id);
  const definiciones = miniAntes.conflictos[0].partidosSinHorario.filter((p) => p.parejasManuales);
  assert.equal(definiciones.length, 2, 'Ambos definitorios están pendientes');
  for (const p of definiciones) {
    assert.ok(p.parejasManuales.find((p) => p.id === miniCaso.parejas[0].id).slotsQueDestraban.includes('Viernes-20:30'),
      'Los sugeridos de P3/P4 también verifican la zona completa conservando P1/P2');
  }
  await disponibilidadService.setDisponibilidad(miniCaso.org.id, miniCaso.parejas[0].id, ['Viernes-18:00', 'Viernes-20:30']);
  const miniDespues = await organizadorService.preCheckInicioTorneo(miniCaso.org.id, miniCaso.torneo.id, { isReCheck: true });
  assert.equal(miniDespues.bloqueado, false);
  console.log('PASS: contraejemplo de zona E y sugerido real aplicado mediante servicio + re-check');
}

async function testDesacopleIncremental() {
  // El intento greedy elige cancha 1 para P1; el fallback debe adoptar el testigo.
  const caso = await crearCaso('desacople-incremental', [
    ['Viernes-19:00'], ['Viernes-19:00', 'Viernes-20:30'],
    ['Viernes-18:00', 'Viernes-20:30'], ['Viernes-18:00', 'Viernes-20:30'],
  ]);
  const externa = await prisma.categoria.create({ data: { nombre: 'Ocupación fija', torneoId: caso.torneo.id } });
  for (let orden = 1; orden <= 2; orden++) {
    await prisma.pareja.create({ data: {
      categoriaId: externa.id, orden, jugador1: `Externa ${orden}`, jugador2: 'Test',
      slotsSeleccionados: { create: [{ slotId: 'Viernes-17:45' }] },
    } });
  }
  const pendiente = await prisma.categoria.create({ data: { nombre: 'Pendientes', torneoId: caso.torneo.id } });
  for (let orden = 1; orden <= 3; orden++) {
    await prisma.pareja.create({ data: {
      categoriaId: pendiente.id, orden, jugador1: `Pendiente ${orden}`, jugador2: 'Test',
      slotsSeleccionados: { create: [{ slotId: 'Viernes-23:00' }] },
    } });
  }
  await organizadorService.preCheckInicioTorneo(caso.org.id, caso.torneo.id);
  const sesion = organizadorService.preCheckSessions.get(caso.torneo.id);
  const ajena = sesion.categoriasPlan.find((c) => c.categoriaId === externa.id).zonas[0].partidos[0];
  // Fixture de snapshot: cancha 2 ocupada 17:45–19:00; no cambia el scheduler ni la base.
  ajena.canchaNumero = 2;
  const antes = await organizadorService.preCheckInicioTorneo(caso.org.id, caso.torneo.id, { isReCheck: true });
  const conflicto = antes.conflictos.find((c) => c.nombreCategoria === '7ma Damas').partidosSinHorario
    .find((p) => p.motivo === 'ZONA_MANUAL_INCOMPLETA');
  assert.ok(conflicto.parejasManuales.find((p) => p.id === caso.parejas[0].id).slotsQueDestraban.includes('Viernes-20:30'));

  const testigoInput = entrada([
    ['Viernes-19:00', 'Viernes-20:30'], ['Viernes-19:00', 'Viernes-20:30'],
    ['Viernes-18:00', 'Viernes-20:30'], ['Viernes-18:00', 'Viernes-20:30'],
  ], { formato: 'MINI_BRACKET' });
  testigoInput.courtTimelines = new Map([[2, [{ startMs: ms('Viernes-17:45'), endMs: ms('Viernes-19:00') }]]]);
  const testigo = verificarProgramacionZona(testigoInput);
  comprobarTestigo(testigoInput, testigo);
  assert.equal(testigo.programacion[0].canchaNumero, 2, 'La solución necesita P1 en cancha 2');
  await disponibilidadService.setDisponibilidad(caso.org.id, caso.parejas[0].id, ['Viernes-19:00', 'Viernes-20:30']);
  const despues = await organizadorService.preCheckInicioTorneo(caso.org.id, caso.torneo.id, { isReCheck: true });
  assert.ok(!despues.conflictos.some((c) => c.nombreCategoria === '7ma Damas'));
  const zonaResuelta = sesion.categoriasPlan.find((c) => c.nombre === '7ma Damas').zonas[0];
  assert.equal(zonaResuelta.requiereArmadoManual, false);
  assert.deepEqual(horarios(zonaResuelta), testigo.programacion);
  assert.equal(zonaResuelta.partidos[0].canchaNumero, 2);
  assert.ok(zonaResuelta.partidos.every((p) => !p.sinHorarioAsignado));
  assert.equal(despues.permiteInicioEmergencia, true);
  assert.ok(despues.conflictos.some((c) => c.nombreCategoria === 'Pendientes'));
  await comprobarInicioConPendientes(caso, despues.planEmergenciaId, sesion.categoriasPlan);
  console.log('PASS: fallback mini adopta el testigo y el inicio con greedy conserva todos los partidos fijados');
}

function horarios(zona) {
  return [...zona.partidos].sort((a, b) => a.posicionEnRonda - b.posicionEnRonda).map((p) => ({
    posicionEnRonda: p.posicionEnRonda, fechaHora: new Date(p.fechaHora).toISOString(), canchaNumero: p.canchaNumero,
  }));
}

async function comprobarInicioConPendientes(caso, planId, categoriasPlan) {
  const plan = structuredClone(categoriasPlan);
  const transaction = prisma.$transaction.bind(prisma);
  const creados = new Map();
  const actualizados = [];
  // Observa las escrituras reales del greedy dentro de la transacción de inicio.
  prisma.$transaction = (callback, opciones) => transaction(async (tx) => {
    const create = tx.partido.create.bind(tx.partido), update = tx.partido.update.bind(tx.partido);
    tx.partido.create = async (q) => {
      const p = await create(q);
      if (p.zonaId) creados.set(p.id, p.sinHorarioAsignado);
      return p;
    };
    tx.partido.update = async (q) => {
      if (creados.has(q.where.id)) {
        assert.equal(creados.get(q.where.id), true, 'FRENAR: el greedy intentó modificar un partido del plan ya agendado');
        actualizados.push(q.where.id);
      }
      return update(q);
    };
    return callback(tx);
  }, opciones);
  try {
    await organizadorService.iniciarTorneoMultiCategoria(caso.org.id, caso.torneo.id, planId);
  } finally { prisma.$transaction = transaction; }
  assert.ok(actualizados.length > 0, 'El greedy realmente procesó pendientes al iniciar');
  const db = await prisma.partido.findMany({
    where: { categoria: { torneoId: caso.torneo.id }, zonaId: { not: null } },
    include: { zona: true },
  });
  let comparados = 0;
  for (const c of plan) for (const z of c.zonas) for (const p of z.partidos) {
    if (p.sinHorarioAsignado) continue;
    const persistido = db.find((q) => q.categoriaId === c.categoriaId && q.zona.nombre === z.nombre && q.posicionEnRonda === p.posicionEnRonda);
    assert.ok(persistido);
    assert.equal(+persistido.fechaHora, +new Date(p.fechaHora), 'FRENAR: el inicio cambió la fecha del testigo/fijado');
    assert.equal(persistido.canchaNumero, p.canchaNumero, 'FRENAR: el inicio cambió la cancha del testigo/fijado');
    assert.equal(persistido.sinHorarioAsignado, false);
    comparados++;
  }
  assert.ok(comparados >= 4);
}

async function testZonasCompiten() {
  const slots = [['Viernes-19:00'], ['Viernes-19:00', 'Viernes-20:30'],
    ['Viernes-18:00', 'Viernes-20:30'], ['Viernes-18:00', 'Viernes-20:30']];
  const caso = await crearCaso('zonas-compiten', slots);
  const primera = await prisma.categoria.create({ data: { nombre: '5ta', torneoId: caso.torneo.id } });
  const primeraParejas = [];
  for (let i = 0; i < 4; i++) {
    primeraParejas.push(await prisma.pareja.create({ data: {
      categoriaId: primera.id, orden: i + 1, jugador1: `Primera ${i}`, jugador2: 'Test',
      slotsSeleccionados: { create: slots[i].map((slotId) => ({ slotId })) },
    } }));
  }
  const externa = await prisma.categoria.create({ data: { nombre: 'Ocupación fija', torneoId: caso.torneo.id } });
  for (let orden = 1; orden <= 2; orden++) await prisma.pareja.create({ data: {
    categoriaId: externa.id, orden, jugador1: `Fija ${orden}`, jugador2: 'Test',
    slotsSeleccionados: { create: [{ slotId: 'Viernes-17:45' }] },
  } });
  await organizadorService.preCheckInicioTorneo(caso.org.id, caso.torneo.id);
  const sesion = organizadorService.preCheckSessions.get(caso.torneo.id);
  const fija = sesion.categoriasPlan.find((c) => c.categoriaId === externa.id).zonas[0].partidos[0];
  fija.canchaNumero = 2;
  const primeraZona = sesion.categoriasPlan.find((c) => c.nombre === '5ta').zonas[0];
  const segundaZona = sesion.categoriasPlan.find((c) => c.nombre === '7ma Damas').zonas[0];
  primeraZona.nombre = 'Zona B'; segundaZona.nombre = 'Zona A';
  // Ni la inserción de categorías ni el nombre de la zona antes que la categoría definen prioridad.
  sesion.categoriasPlan.reverse();
  await disponibilidadService.setDisponibilidadDoble(caso.org.id,
    primeraParejas[0].id, ['Viernes-20:30'], caso.parejas[0].id, ['Viernes-20:30']);
  const pre = await organizadorService.preCheckInicioTorneo(caso.org.id, caso.torneo.id, { isReCheck: true });
  assert.equal(primeraZona.requiereArmadoManual, false);
  assert.equal(primeraZona.partidos[0].canchaNumero, 2);
  assert.ok(primeraZona.partidos.every((p) => !p.sinHorarioAsignado));
  assert.ok(segundaZona.partidos.some((p) => p.sinHorarioAsignado), 'La segunda no puede usar las canchas reservadas por la primera');
  assert.ok(!pre.conflictos.some((c) => c.nombreCategoria === '5ta'));
  assert.ok(pre.conflictos.some((c) => c.nombreCategoria === '7ma Damas'));
  assert.equal(fija.canchaNumero, 2);
  const asignados = sesion.categoriasPlan.flatMap((c) => c.zonas.flatMap((z) => z.partidos.filter((p) => !p.sinHorarioAsignado)));
  for (let i = 0; i < asignados.length; i++) for (let j = i + 1; j < asignados.length; j++) {
    const a = asignados[i], b = asignados[j];
    if (a.canchaNumero === b.canchaNumero) assert.ok(
      +new Date(a.fechaHora) + DURACION <= +new Date(b.fechaHora) || +new Date(b.fechaHora) + DURACION <= +new Date(a.fechaHora),
      'Sin solapamientos entre zonas tras adoptar el testigo',
    );
  }
  const horariosPrimera = horarios(primeraZona);
  await organizadorService.preCheckInicioTorneo(caso.org.id, caso.torneo.id, { isReCheck: true });
  assert.deepEqual(horarios(primeraZona), horariosPrimera, 'Un re-check posterior conserva el testigo');
  console.log('PASS: zonas compiten en orden natural, ocupación actualizada y testigo conservado');
}

function medir() {
  for (const [nombre, n, formato, canchas, fin] of [
    ['zona 3 RR', 3, 'ROUND_ROBIN', 2, '23:00'],
    ['zona 4 RR', 4, 'ROUND_ROBIN', 2, '23:00'],
    ['zona 4 mini', 4, 'MINI_BRACKET', 2, '23:00'],
    ['zona 4 RR saturada', 4, 'ROUND_ROBIN', 1, '22:00'],
    ['zona 4 RR al límite', 4, 'ROUND_ROBIN', 1, '01:00'],
  ]) {
    const input = entrada(Array.from({ length: n }, () => viernes('18:00', fin)), { formato, cantidadCanchas: canchas });
    const tiempos = [];
    let result;
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      result = verificarProgramacionZona(input);
      tiempos.push(performance.now() - start);
    }
    console.log(`BENCH ${nombre}: ${result.estado}, ${result.nodos}/${MAX_NODOS_ZONA} nodos; mediana ${tiempos.sort((a, b) => a - b)[10].toFixed(2)} ms, máximo ${Math.max(...tiempos).toFixed(2)} ms`);
  }
}

async function main() {
  await ensureTestDb();
  testPuros();
  await testIntegracion();
  await testDesacopleIncremental();
  await testZonasCompiten();
  medir();
}

main().then(async () => { await prisma.$disconnect(); process.exit(0); })
  .catch(async (err) => { console.error(err); await prisma.$disconnect(); process.exit(1); });
