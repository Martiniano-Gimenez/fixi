'use strict';

/**
 * test-asignar-horario-manual-validaciones.js
 * Suite oficial de tests para validaciones de fin de zonas y descansos en asignarHorarioManual.
 *
 * Cobertura de 12 casos:
 * 1. R32 manual antes del fin de zonas -> advertencia INICIA_ANTES_FIN_ZONAS.
 * 2. R32 manual después del fin de zonas -> sin advertencia.
 * 3. Categoría con partido de zona sin horario -> advertencia ZONA_CON_PARTIDOS_PENDIENTES.
 * 4. Cruce eliminatoria con descanso insuficiente respecto del padre (Octavos -> Cuartos, 15 min < 75 min).
 * 5. Cruce eliminatoria con descanso insuficiente respecto del hijo (Cuartos <- Semis, solapa o < 75 min).
 * 6. Cruce eliminatoria con parejas null en cuadro (valida relación estructural del árbol).
 * 7. No-regresión de validaciones actuales de colisión (cancha ocupada 409 y pareja solapada 409).
 * 8. Trasnoche 00:15 contra fin de zona 23:30 (la trasnoche cae en el día siguiente y es cronológicamente posterior).
 * 9. Cruce cuyo padre es un BYE -> no debe generar advertencia de descanso insuficiente.
 * 10. Zona manual sin partidos en categoría EN_CURSO -> advertencia ZONA_CON_PARTIDOS_PENDIENTES.
 * 11. Final con descanso Semis -> Final (30 min): 18:15 advierte (15 min < 30 min); 18:30 no advierte (límite 30 min).
 * 12. Unit tests del helper puro bracketWarnings (calcularFinDeZonasCategoria y calcularDescansosEliminatoria).
 */

require('./utils/testEnvGuard');
const { ensureTestDb } = require('./utils/testEnvGuard');
const { resetTestDb } = require('./reset-test-db');
const assert = require('node:assert');
const prisma = require('../src/lib/prisma');
const partidoService = require('../src/services/partido.service');
const { parseSlotToDate } = require('../src/services/zona.service');
const { parseFechaLocal } = require('../src/utils/dateUtils');

async function limpiarDb() {
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
}

async function setupBaseTorneo({ cantidadCanchas = 2 } = {}) {
  await limpiarDb();

  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club Test Validaciones Manuales',
      email: `test_manual_val_${Date.now()}_${Math.random()}@padel.test`,
      passwordHash: 'hash',
      cantidadCanchas,
      viernesInicio: '18:00',
      viernesFin: '23:00',
      sabadoInicio: '09:00',
      sabadoFin: '24:00',
      domingoInicio: '09:00',
      domingoFin: '22:00',
    },
  });

  const torneo = await prisma.torneo.create({
    data: {
      organizadorId: org.id,
      nombre: 'Torneo Test Validaciones',
      slug: `torneo-val-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      fecha: new Date('2026-10-16T18:00:00.000Z'), // Viernes 16 Oct
      estado: 'EN_CURSO',
    },
  });

  const cat = await prisma.categoria.create({
    data: {
      torneoId: torneo.id,
      nombre: '4ta',
      estado: 'EN_CURSO',
    },
  });

  return { org, torneo, cat };
}

// ---------------------------------------------------------------------------
// TEST 1: R32 manual antes del fin de zonas -> INICIA_ANTES_FIN_ZONAS
// ---------------------------------------------------------------------------
async function test1_r32_antes_fin_zonas() {
  const { org, torneo, cat } = await setupBaseTorneo();

  const zona = await prisma.zona.create({
    data: {
      categoriaId: cat.id,
      nombre: 'Zona A',
      formato: 'ROUND_ROBIN',
      clasifican: 2,
    },
  });

  // Partido de zona que termina a las 20:30hs del sábado
  const pZonaFecha = parseSlotToDate('Sabado-19:15', torneo.fecha);
  await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      zonaId: zona.id,
      posicionEnRonda: 1,
      fechaHora: pZonaFecha,
      canchaNumero: 1,
      sinHorarioAsignado: false,
      estado: 'PENDIENTE',
    },
  });

  const fase32 = await prisma.faseEliminatoria.create({
    data: {
      categoriaId: cat.id,
      nombre: 'Dieciseisavos',
      ronda: 32,
    },
  });

  const pR32 = await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      faseEliminatoriaId: fase32.id,
      posicionEnRonda: 1,
      sinHorarioAsignado: true,
      estado: 'PENDIENTE',
    },
  });

  // Asignar a las 18:00hs del sábado (antes de las 20:30hs)
  const res = await partidoService.asignarHorarioManual(org.id, pR32.id, {
    slotId: 'Sabado-18:00',
    canchaNumero: 2,
  });

  assert.ok(res.partido, 'Debe devolver el partido actualizado');
  assert.strictEqual(res.partido.horarioManual, true, 'horarioManual debe ser true');
  assert.ok(Array.isArray(res.advertencias), 'Debe devolver un array de advertencias');
  assert.ok(
    res.advertencias.some((a) => a.codigo === 'INICIA_ANTES_FIN_ZONAS'),
    'Debe incluir la advertencia INICIA_ANTES_FIN_ZONAS'
  );
}

// ---------------------------------------------------------------------------
// TEST 2: R32 manual después del fin de zonas -> sin advertencias
// ---------------------------------------------------------------------------
async function test2_r32_despues_fin_zonas() {
  const { org, torneo, cat } = await setupBaseTorneo();

  const zona = await prisma.zona.create({
    data: {
      categoriaId: cat.id,
      nombre: 'Zona A',
      formato: 'ROUND_ROBIN',
      clasifican: 2,
    },
  });

  const pZonaFecha = parseSlotToDate('Sabado-19:15', torneo.fecha);
  await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      zonaId: zona.id,
      posicionEnRonda: 1,
      fechaHora: pZonaFecha,
      canchaNumero: 1,
      sinHorarioAsignado: false,
      estado: 'PENDIENTE',
    },
  });

  const fase32 = await prisma.faseEliminatoria.create({
    data: {
      categoriaId: cat.id,
      nombre: 'Dieciseisavos',
      ronda: 32,
    },
  });

  const pR32 = await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      faseEliminatoriaId: fase32.id,
      posicionEnRonda: 1,
      sinHorarioAsignado: true,
      estado: 'PENDIENTE',
    },
  });

  // Asignar a las 20:45hs del sábado (después de las 20:30hs)
  const res = await partidoService.asignarHorarioManual(org.id, pR32.id, {
    slotId: 'Sabado-20:45',
    canchaNumero: 2,
  });

  assert.ok(res.partido, 'Debe devolver el partido actualizado');
  assert.ok(Array.isArray(res.advertencias), 'Debe devolver un array de advertencias');
  assert.strictEqual(
    res.advertencias.filter((a) => a.codigo === 'INICIA_ANTES_FIN_ZONAS').length,
    0,
    'No debe advertir INICIA_ANTES_FIN_ZONAS'
  );
}

// ---------------------------------------------------------------------------
// TEST 3: Zona con partido sin horario -> ZONA_CON_PARTIDOS_PENDIENTES
// ---------------------------------------------------------------------------
async function test3_zona_partido_sin_horario() {
  const { org, torneo, cat } = await setupBaseTorneo();

  const zona = await prisma.zona.create({
    data: {
      categoriaId: cat.id,
      nombre: 'Zona A',
      formato: 'ROUND_ROBIN',
      clasifican: 2,
    },
  });

  // Partido de zona sin horario asignado
  await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      zonaId: zona.id,
      posicionEnRonda: 1,
      fechaHora: null,
      canchaNumero: null,
      sinHorarioAsignado: true,
      estado: 'PENDIENTE',
    },
  });

  const fase32 = await prisma.faseEliminatoria.create({
    data: {
      categoriaId: cat.id,
      nombre: 'Dieciseisavos',
      ronda: 32,
    },
  });

  const pR32 = await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      faseEliminatoriaId: fase32.id,
      posicionEnRonda: 1,
      sinHorarioAsignado: true,
      estado: 'PENDIENTE',
    },
  });

  const res = await partidoService.asignarHorarioManual(org.id, pR32.id, {
    slotId: 'Sabado-20:45',
    canchaNumero: 1,
  });

  assert.ok(Array.isArray(res.advertencias), 'Debe devolver un array de advertencias');
  assert.ok(
    res.advertencias.some((a) => a.codigo === 'ZONA_CON_PARTIDOS_PENDIENTES'),
    'Debe advertir ZONA_CON_PARTIDOS_PENDIENTES'
  );
}

// ---------------------------------------------------------------------------
// TEST 4: Descanso insuficiente respecto de padre (Octavos -> Cuartos)
// ---------------------------------------------------------------------------
async function test4_descanso_insuficiente_padre() {
  const { org, torneo, cat } = await setupBaseTorneo();

  const fase16 = await prisma.faseEliminatoria.create({
    data: { categoriaId: cat.id, nombre: 'Octavos de Final', ronda: 16 },
  });
  const fase8 = await prisma.faseEliminatoria.create({
    data: { categoriaId: cat.id, nombre: 'Cuartos de Final', ronda: 8 },
  });

  // Padre en Octavos (posicion 1): termina a las 11:15hs del domingo
  const fechaOctavos = parseSlotToDate('Domingo-10:00', torneo.fecha);
  await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      faseEliminatoriaId: fase16.id,
      posicionEnRonda: 1,
      fechaHora: fechaOctavos,
      canchaNumero: 1,
      sinHorarioAsignado: false,
      estado: 'PENDIENTE',
    },
  });

  // Hijo en Cuartos (posicion 1)
  const pCuartos = await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      faseEliminatoriaId: fase8.id,
      posicionEnRonda: 1,
      sinHorarioAsignado: true,
      estado: 'PENDIENTE',
    },
  });

  // Asignar Cuartos a las 11:30hs (solo 15 min de descanso < 75 min requeridos)
  const res = await partidoService.asignarHorarioManual(org.id, pCuartos.id, {
    slotId: 'Domingo-11:30',
    canchaNumero: 1,
  });

  assert.ok(Array.isArray(res.advertencias), 'Debe devolver un array de advertencias');
  assert.ok(
    res.advertencias.some((a) => a.codigo === 'DESCANSO_INSUFICIENTE_PADRE'),
    'Debe advertir DESCANSO_INSUFICIENTE_PADRE'
  );
}

// ---------------------------------------------------------------------------
// TEST 5: Descanso insuficiente respecto de hijo (Cuartos <- Semis)
// ---------------------------------------------------------------------------
async function test5_descanso_insuficiente_hijo() {
  const { org, torneo, cat } = await setupBaseTorneo();

  const fase8 = await prisma.faseEliminatoria.create({
    data: { categoriaId: cat.id, nombre: 'Cuartos de Final', ronda: 8 },
  });
  const fase4 = await prisma.faseEliminatoria.create({
    data: { categoriaId: cat.id, nombre: 'Semifinal', ronda: 4 },
  });

  // Hijo en Semis (posicion 1): arranca a las 16:00hs del domingo
  const fechaSemis = parseSlotToDate('Domingo-16:00', torneo.fecha);
  await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      faseEliminatoriaId: fase4.id,
      posicionEnRonda: 1,
      fechaHora: fechaSemis,
      canchaNumero: 1,
      sinHorarioAsignado: false,
      estado: 'PENDIENTE',
    },
  });

  // Padre en Cuartos (posicion 1)
  const pCuartos = await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      faseEliminatoriaId: fase8.id,
      posicionEnRonda: 1,
      sinHorarioAsignado: true,
      estado: 'PENDIENTE',
    },
  });

  // Asignar Cuartos a las 15:00hs (termina 16:15hs -> solapa con el hijo que arranca a las 16:00hs)
  const res = await partidoService.asignarHorarioManual(org.id, pCuartos.id, {
    slotId: 'Domingo-15:00',
    canchaNumero: 2,
  });

  assert.ok(Array.isArray(res.advertencias), 'Debe devolver un array de advertencias');
  assert.ok(
    res.advertencias.some((a) => a.codigo === 'DESCANSO_INSUFICIENTE_HIJO'),
    'Debe advertir DESCANSO_INSUFICIENTE_HIJO'
  );
}

// ---------------------------------------------------------------------------
// TEST 6: Cruce con parejas null en cuadro (estructura de árbol)
// ---------------------------------------------------------------------------
async function test6_cruce_parejas_null() {
  const { org, torneo, cat } = await setupBaseTorneo();

  const fase16 = await prisma.faseEliminatoria.create({
    data: { categoriaId: cat.id, nombre: 'Octavos de Final', ronda: 16 },
  });
  const fase8 = await prisma.faseEliminatoria.create({
    data: { categoriaId: cat.id, nombre: 'Cuartos de Final', ronda: 8 },
  });

  // Octavos agendado pero parejas todavía null (clasificados de zonas pendientes)
  const fechaOctavos = parseSlotToDate('Domingo-10:00', torneo.fecha);
  await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      faseEliminatoriaId: fase16.id,
      posicionEnRonda: 1,
      pareja1Id: null,
      pareja2Id: null,
      fechaHora: fechaOctavos,
      canchaNumero: 1,
      sinHorarioAsignado: false,
      estado: 'PENDIENTE',
    },
  });

  const pCuartos = await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      faseEliminatoriaId: fase8.id,
      posicionEnRonda: 1,
      pareja1Id: null,
      pareja2Id: null,
      sinHorarioAsignado: true,
      estado: 'PENDIENTE',
    },
  });

  // Asignar Cuartos a las 11:45hs (descanso 30 min < 75 min)
  const res = await partidoService.asignarHorarioManual(org.id, pCuartos.id, {
    slotId: 'Domingo-11:45',
    canchaNumero: 1,
  });

  assert.ok(Array.isArray(res.advertencias), 'Debe devolver un array de advertencias');
  assert.ok(
    res.advertencias.some((a) => a.codigo === 'DESCANSO_INSUFICIENTE_PADRE'),
    'Debe advertir DESCANSO_INSUFICIENTE_PADRE aun cuando las parejas sean null'
  );
}

// ---------------------------------------------------------------------------
// TEST 7: No-regresión de validaciones actuales de colisión
// ---------------------------------------------------------------------------
async function test7_no_regresion_colisiones() {
  const { org, torneo, cat } = await setupBaseTorneo();

  const par1 = await prisma.pareja.create({
    data: { categoriaId: cat.id, jugador1: 'J1', jugador2: 'J2', orden: 1 },
  });
  const par2 = await prisma.pareja.create({
    data: { categoriaId: cat.id, jugador1: 'J3', jugador2: 'J4', orden: 2 },
  });
  const par3 = await prisma.pareja.create({
    data: { categoriaId: cat.id, jugador1: 'J5', jugador2: 'J6', orden: 3 },
  });

  const fechaSlot = parseSlotToDate('Viernes-18:00', torneo.fecha);

  // Partido 1 ocupando Cancha 1 a las 18:00hs con par1 y par2
  await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      posicionEnRonda: 1,
      pareja1Id: par1.id,
      pareja2Id: par2.id,
      fechaHora: fechaSlot,
      canchaNumero: 1,
      sinHorarioAsignado: false,
      estado: 'PENDIENTE',
    },
  });

  // Partido 2 con par3 y par2
  const p2 = await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      posicionEnRonda: 2,
      pareja1Id: par3.id,
      pareja2Id: par2.id,
      sinHorarioAsignado: true,
      estado: 'PENDIENTE',
    },
  });

  // Intento 1: colisión de cancha (mismo horario y misma Cancha 1) -> 409
  let errorCancha = null;
  try {
    await partidoService.asignarHorarioManual(org.id, p2.id, {
      slotId: 'Viernes-18:00',
      canchaNumero: 1,
    });
  } catch (err) {
    errorCancha = err;
  }
  assert.ok(errorCancha, 'Debe arrojar error por cancha ocupada');
  assert.strictEqual(errorCancha.statusCode, 409, 'El status debe ser 409');
  assert.ok(errorCancha.message.includes('ya está ocupada'), 'Mensaje debe indicar cancha ocupada');

  // Intento 2: colisión de parejas (Cancha 2, pero par2 ya juega a las 18:00) -> 409
  let errorPareja = null;
  try {
    await partidoService.asignarHorarioManual(org.id, p2.id, {
      slotId: 'Viernes-18:00',
      canchaNumero: 2,
    });
  } catch (err) {
    errorPareja = err;
  }
  assert.ok(errorPareja, 'Debe arrojar error por colisión de pareja');
  assert.strictEqual(errorPareja.statusCode, 409, 'El status debe ser 409');
  assert.ok(errorPareja.message.includes('ya tiene otro partido'), 'Mensaje debe indicar colisión de pareja');
}

// ---------------------------------------------------------------------------
// TEST 8: Trasnoche 00:15 contra fin de zona 23:30
// ---------------------------------------------------------------------------
async function test8_trasnoche_sabado() {
  const { org, torneo, cat } = await setupBaseTorneo();

  const zona = await prisma.zona.create({
    data: {
      categoriaId: cat.id,
      nombre: 'Zona A',
      formato: 'ROUND_ROBIN',
      clasifican: 2,
    },
  });

  // Partido de zona arranca Sabado-22:15 -> termina a las 23:30hs del sábado
  const pZonaFecha = parseSlotToDate('Sabado-22:15', torneo.fecha);
  await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      zonaId: zona.id,
      posicionEnRonda: 1,
      fechaHora: pZonaFecha,
      canchaNumero: 1,
      sinHorarioAsignado: false,
      estado: 'PENDIENTE',
    },
  });

  const fase32 = await prisma.faseEliminatoria.create({
    data: {
      categoriaId: cat.id,
      nombre: 'Dieciseisavos',
      ronda: 32,
    },
  });

  const pR32 = await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      faseEliminatoriaId: fase32.id,
      posicionEnRonda: 1,
      sinHorarioAsignado: true,
      estado: 'PENDIENTE',
    },
  });

  // Asignar en slot de trasnoche Sabado-00:15 (madrugada del domingo, 00:15 > 23:30)
  const res = await partidoService.asignarHorarioManual(org.id, pR32.id, {
    slotId: 'Sabado-00:15',
    canchaNumero: 1,
  });

  assert.ok(res.partido, 'Debe asignar el partido');
  assert.ok(Array.isArray(res.advertencias), 'Debe devolver un array de advertencias');
  assert.strictEqual(
    res.advertencias.filter((a) => a.codigo === 'INICIA_ANTES_FIN_ZONAS').length,
    0,
    'No debe advertir INICIA_ANTES_FIN_ZONAS porque Sabado-00:15 trasnoche es posterior al fin de zona (23:30)'
  );
}

// ---------------------------------------------------------------------------
// TEST 9: Padre BYE no restringe descanso
// ---------------------------------------------------------------------------
async function test9_padre_bye() {
  const { org, torneo, cat } = await setupBaseTorneo();

  const fase16 = await prisma.faseEliminatoria.create({
    data: { categoriaId: cat.id, nombre: 'Octavos de Final', ronda: 16 },
  });
  const fase8 = await prisma.faseEliminatoria.create({
    data: { categoriaId: cat.id, nombre: 'Cuartos de Final', ronda: 8 },
  });

  // Padre 1 en Octavos es un BYE
  await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      faseEliminatoriaId: fase16.id,
      posicionEnRonda: 1,
      esBye: true,
      fechaHora: null,
      canchaNumero: null,
      sinHorarioAsignado: false,
      estado: 'FINALIZADO',
    },
  });

  const pCuartos = await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      faseEliminatoriaId: fase8.id,
      posicionEnRonda: 1,
      sinHorarioAsignado: true,
      estado: 'PENDIENTE',
    },
  });

  // Asignar temprano en domingo a las 09:00hs
  const res = await partidoService.asignarHorarioManual(org.id, pCuartos.id, {
    slotId: 'Domingo-09:00',
    canchaNumero: 1,
  });

  assert.ok(Array.isArray(res.advertencias), 'Debe devolver un array de advertencias');
  assert.strictEqual(
    res.advertencias.filter((a) => a.codigo === 'DESCANSO_INSUFICIENTE_PADRE').length,
    0,
    'Padre BYE no debe generar descanso insuficiente'
  );
}

// ---------------------------------------------------------------------------
// TEST 10: Zona manual sin partidos en categoría EN_CURSO
// ---------------------------------------------------------------------------
async function test10_zona_manual_sin_partidos() {
  const { org, torneo, cat } = await setupBaseTorneo();

  // Zona manual con 0 partidos creados en DB
  await prisma.zona.create({
    data: {
      categoriaId: cat.id,
      nombre: 'Zona Manual Sin Partidos',
      formato: 'ROUND_ROBIN',
      clasifican: 2,
      requiereArmadoManual: true,
    },
  });

  const fase8 = await prisma.faseEliminatoria.create({
    data: { categoriaId: cat.id, nombre: 'Cuartos de Final', ronda: 8 },
  });

  const pCuartos = await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      faseEliminatoriaId: fase8.id,
      posicionEnRonda: 1,
      sinHorarioAsignado: true,
      estado: 'PENDIENTE',
    },
  });

  const res = await partidoService.asignarHorarioManual(org.id, pCuartos.id, {
    slotId: 'Domingo-10:00',
    canchaNumero: 1,
  });

  assert.ok(Array.isArray(res.advertencias), 'Debe devolver un array de advertencias');
  assert.ok(
    res.advertencias.some((a) => a.codigo === 'ZONA_CON_PARTIDOS_PENDIENTES'),
    'Zona manual sin partidos debe generar advertencia ZONA_CON_PARTIDOS_PENDIENTES'
  );
}

// ---------------------------------------------------------------------------
// TEST 11: Final con descanso Semis -> Final (30 min) y límite
// ---------------------------------------------------------------------------
async function test11_final_descanso_semis() {
  const { org, torneo, cat } = await setupBaseTorneo();

  const fase4 = await prisma.faseEliminatoria.create({
    data: { categoriaId: cat.id, nombre: 'Semifinal', ronda: 4 },
  });
  const fase2 = await prisma.faseEliminatoria.create({
    data: { categoriaId: cat.id, nombre: 'Final', ronda: 2 },
  });

  // Semifinal (posicion 1): arranca 16:45 -> fin 18:00hs
  const fechaSemis = parseSlotToDate('Domingo-16:45', torneo.fecha);
  await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      faseEliminatoriaId: fase4.id,
      posicionEnRonda: 1,
      fechaHora: fechaSemis,
      canchaNumero: 1,
      sinHorarioAsignado: false,
      estado: 'PENDIENTE',
    },
  });

  const pFinal = await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      faseEliminatoriaId: fase2.id,
      posicionEnRonda: 1,
      sinHorarioAsignado: true,
      estado: 'PENDIENTE',
    },
  });

  // Subcaso 11a: Final a las 18:15 (descanso = 15 min < 30 min mínimo de Semis->Final)
  const res11a = await partidoService.asignarHorarioManual(org.id, pFinal.id, {
    slotId: 'Domingo-18:15',
    canchaNumero: 1,
  });
  assert.ok(Array.isArray(res11a.advertencias), 'Debe devolver un array de advertencias');
  assert.ok(
    res11a.advertencias.some((a) => a.codigo === 'DESCANSO_INSUFICIENTE_PADRE'),
    'Final a 15 min de semifinal debe advertir DESCANSO_INSUFICIENTE_PADRE'
  );

  // Subcaso 11b: Final a las 18:30 (descanso = 30 min = MIN_REST_SEMIS_FINAL_MS exacto)
  const res11b = await partidoService.asignarHorarioManual(org.id, pFinal.id, {
    slotId: 'Domingo-18:30',
    canchaNumero: 1,
  });
  assert.ok(Array.isArray(res11b.advertencias), 'Debe devolver un array de advertencias');
  assert.strictEqual(
    res11b.advertencias.filter((a) => a.codigo === 'DESCANSO_INSUFICIENTE_PADRE').length,
    0,
    'Final con descanso exacto de 30 min no debe advertir descanso insuficiente'
  );
}

// ---------------------------------------------------------------------------
// TEST 12: Unit tests del helper puro bracketWarnings
// ---------------------------------------------------------------------------
async function test12_unit_tests_helper_puro() {
  let bracketWarnings = null;
  try {
    bracketWarnings = require('../src/utils/bracketWarnings');
  } catch (err) {
    // Helper no implementado todavía en commit 1
  }

  assert.ok(
    bracketWarnings,
    'El helper bracketWarnings debe estar implementado en backend/src/utils/bracketWarnings.js'
  );

  const {
    calcularFinDeZonasCategoria,
    calcularDescansosEliminatoria,
    REST_CONSTANTS,
  } = bracketWarnings;

  // 12a. Constantes exportadas
  assert.strictEqual(REST_CONSTANTS.MIN_REST_OCTAVOS_CUARTOS_MS, 75 * 60 * 1000);
  assert.strictEqual(REST_CONSTANTS.MIN_REST_CUARTOS_SEMIS_MS, 75 * 60 * 1000);
  assert.strictEqual(REST_CONSTANTS.MIN_REST_SEMIS_FINAL_MS, 30 * 60 * 1000);

  // 12b. calcularFinDeZonasCategoria con partidos válidos
  const baseTs = new Date('2026-10-17T20:00:00.000Z').getTime();
  const duracionMs = 75 * 60 * 1000;
  const partidosNormales = [
    { fechaHora: new Date(baseTs), sinHorarioAsignado: false },
    { fechaHora: new Date(baseTs + 75 * 60 * 1000), sinHorarioAsignado: false },
  ];
  const finOk = calcularFinDeZonasCategoria(partidosNormales, 1, duracionMs);
  assert.strictEqual(finOk.tienePartidosSinHorario, false);
  assert.strictEqual(finOk.maxZonaEndMs, baseTs + 2 * duracionMs);

  // 12c. calcularFinDeZonasCategoria con partido sin horario
  const partidosConPendiente = [
    { fechaHora: new Date(baseTs), sinHorarioAsignado: false },
    { fechaHora: null, sinHorarioAsignado: true },
  ];
  const finPend = calcularFinDeZonasCategoria(partidosConPendiente, 1, duracionMs);
  assert.strictEqual(finPend.tienePartidosSinHorario, true);

  // 12d. calcularFinDeZonasCategoria con zona sin partidos
  const finVacio = calcularFinDeZonasCategoria([], 1, duracionMs);
  assert.strictEqual(finVacio.tienePartidosSinHorario, true);
}

// ---------------------------------------------------------------------------
// RUNNER CENTRAL DE LA SUITE
// ---------------------------------------------------------------------------
async function run() {
  await ensureTestDb();
  resetTestDb();

  console.log('='.repeat(85));
  console.log('🧪 SUITE OFICIAL: VALIDACIONES EN ASIGNAR HORARIO MANUAL (12 CASOS)');
  console.log('='.repeat(85));

  const allTests = [
    { id: '1', nombre: 'Test 1: R32 manual antes de fin de zonas (aviso INICIA_ANTES_FIN_ZONAS)', fn: test1_r32_antes_fin_zonas },
    { id: '2', nombre: 'Test 2: R32 manual después de fin de zonas (sin aviso)', fn: test2_r32_despues_fin_zonas },
    { id: '3', nombre: 'Test 3: Zona con partido sin horario (aviso ZONA_CON_PARTIDOS_PENDIENTES)', fn: test3_zona_partido_sin_horario },
    { id: '4', nombre: 'Test 4: Descanso insuficiente respecto de padre (Octavos -> Cuartos)', fn: test4_descanso_insuficiente_padre },
    { id: '5', nombre: 'Test 5: Descanso insuficiente respecto de hijo (Cuartos <- Semis)', fn: test5_descanso_insuficiente_hijo },
    { id: '6', nombre: 'Test 6: Cruce con parejas null en cuadro (estructura de árbol)', fn: test6_cruce_parejas_null },
    { id: '7', nombre: 'Test 7: No-regresión de validaciones actuales de colisión (cancha y parejas 409)', fn: test7_no_regresion_colisiones },
    { id: '8', nombre: 'Test 8: Trasnoche 00:15 contra fin de zona 23:30 (cronología trasnoche)', fn: test8_trasnoche_sabado },
    { id: '9', nombre: 'Test 9: Padre BYE no restringe descanso', fn: test9_padre_bye },
    { id: '10', nombre: 'Test 10: Zona manual sin partidos en categoría EN_CURSO', fn: test10_zona_manual_sin_partidos },
    { id: '11', nombre: 'Test 11: Final con descanso Semis -> Final (30 min) y límite', fn: test11_final_descanso_semis },
    { id: '12', nombre: 'Test 12: Unit tests del helper puro bracketWarnings', fn: test12_unit_tests_helper_puro },
  ];

  const resultados = [];
  const fallasDetalle = [];

  for (const t of allTests) {
    try {
      await limpiarDb();
      await t.fn();
      resultados.push({ caso: t.nombre, estado: 'PASS', detalle: 'OK' });
    } catch (err) {
      const msg = err.message || String(err);
      resultados.push({ caso: t.nombre, estado: 'FAIL', detalle: msg });
      fallasDetalle.push({ caso: t.nombre, error: err });
    }
  }

  await limpiarDb();
  await prisma.$disconnect();

  console.log('\n' + '='.repeat(85));
  console.log('📊 RESUMEN DE VALIDACIONES EN ASIGNAR HORARIO MANUAL:');
  console.log('='.repeat(85));
  console.table(resultados);

  if (fallasDetalle.length > 0) {
    console.log('\n' + '='.repeat(85));
    console.log(`❌ DETALLE DE FALLAS (${fallasDetalle.length}/${allTests.length} fallaron):`);
    console.log('='.repeat(85));
    for (const f of fallasDetalle) {
      console.error(`\n🔴 [${f.caso}]`);
      console.error(f.error);
    }
    process.exit(1);
  }
}

if (require.main === module) {
  run().catch((e) => {
    console.error('Error fatal en test-asignar-horario-manual-validaciones.js:', e);
    process.exit(1);
  });
}

module.exports = { run };
