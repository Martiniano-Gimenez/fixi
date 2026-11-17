'use strict';

/**
 * test-asignar-horario-manual-validaciones.js
 * Suite oficial de tests para validaciones de fin de zonas y descansos en asignarHorarioManual.
 *
 * Cobertura de 16 casos independientes:
 * 1. R32 manual antes del fin de zonas -> advertencia INICIA_ANTES_FIN_ZONAS.
 * 2. R32 manual después del fin de zonas -> sin advertencias (espera []).
 * 3. Categoría con partido de zona sin horario -> advertencia ZONA_CON_PARTIDOS_PENDIENTES.
 * 4. Cruce eliminatoria con descanso insuficiente respecto del padre (Octavos -> Cuartos, 15 min < 75 min).
 * 5. Cruce eliminatoria con descanso insuficiente respecto del hijo (Cuartos <- Semis, solapa o < 75 min).
 * 6. Cruce eliminatoria con parejas null en cuadro (valida relación estructural del árbol).
 * 7. No-regresión de validaciones actuales de colisión (cancha ocupada 409 y pareja solapada 409).
 * 8a. Trasnoche 00:15 posterior a fin de zona 23:30 (la trasnoche cae en el día siguiente y es cronológicamente posterior -> sin aviso).
 * 8b. Trasnoche 00:15 anterior a fin de zona 00:45 (madrugada del domingo 00:15 < 00:45 -> aviso INICIA_ANTES_FIN_ZONAS).
 * 9. Cruce cuyo padre es un BYE -> no debe generar advertencia de descanso insuficiente.
 * 10. Zona manual sin partidos en categoría EN_CURSO (5 parejas sinGrupo) -> advertencia ZONA_CON_PARTIDOS_PENDIENTES.
 * 11a. Final con descanso Semis -> Final menor a 30 min (15 min < 30 min) -> aviso DESCANSO_INSUFICIENTE_PADRE.
 * 11b. Final con descanso Semis -> Final de 30 min exactos (límite scheduler) -> sin aviso.
 * 12. Unit tests del helper puro bracketWarnings (calcularFinDeZonasCategoria y constantes de descanso).
 * 13a. Octavos con padre R32 y descanso menor a 75 min (30 min < 75 min) -> aviso DESCANSO_INSUFICIENTE_PADRE.
 * 13b. Octavos con padre R32 y descanso de 75 min exactos (límite 75 min) -> sin aviso.
 */

require('./utils/testEnvGuard');
const { ensureTestDb } = require('./utils/testEnvGuard');
const { resetTestDb } = require('./reset-test-db');
const assert = require('node:assert');
const prisma = require('../src/lib/prisma');
const partidoService = require('../src/services/partido.service');
const canchasOverridesService = require('../src/services/canchasOverrides.service');
const faseEliminatoriaService = require('../src/services/faseEliminatoria.service');
const publicController = require('../src/controllers/public.controller');
const { parseSlotToDate } = require('../src/services/zona.service');
const bracketWarnings = require('../src/utils/bracketWarnings');

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
// Helpers para aserciones con mensajes específicos de diagnóstico
// ---------------------------------------------------------------------------
function extraerAdvertencias(res) {
  return Array.isArray(res?.advertencias) ? res.advertencias : [];
}

function assertTieneAdvertencia(advertencias, codigoEsperado, testNombre) {
  const codigos = advertencias.map((a) => a.codigo);
  assert.ok(
    codigos.includes(codigoEsperado),
    `[${testNombre}] Esperaba advertencia con código "${codigoEsperado}", pero recibió: [${codigos.join(', ')}]`
  );
}

function assertNoTieneAdvertencia(advertencias, codigoNoDeseado, testNombre) {
  const codigos = advertencias.map((a) => a.codigo);
  assert.strictEqual(
    codigos.includes(codigoNoDeseado),
    false,
    `[${testNombre}] Esperaba sin advertencia "${codigoNoDeseado}", pero recibió: [${codigos.join(', ')}]`
  );
}

function assertSinAdvertencias(advertencias, testNombre) {
  const codigos = advertencias.map((a) => a.codigo);
  assert.strictEqual(
    codigos.length,
    0,
    `[${testNombre}] Esperaba sin avisos, pero recibió: [${codigos.join(', ')}]`
  );
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
  const advertencias = extraerAdvertencias(res);
  assertTieneAdvertencia(advertencias, 'INICIA_ANTES_FIN_ZONAS', 'Test 1');
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
  const advertencias = extraerAdvertencias(res);
  assertNoTieneAdvertencia(advertencias, 'INICIA_ANTES_FIN_ZONAS', 'Test 2');
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

  const advertencias = extraerAdvertencias(res);
  assertTieneAdvertencia(advertencias, 'ZONA_CON_PARTIDOS_PENDIENTES', 'Test 3');
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

  const advertencias = extraerAdvertencias(res);
  assertTieneAdvertencia(advertencias, 'DESCANSO_INSUFICIENTE_PADRE', 'Test 4');
}

// ---------------------------------------------------------------------------
// TEST 5a: Descanso insuficiente respecto de hijo (Cuartos <- Semis)
// ---------------------------------------------------------------------------
async function test5a_descanso_insuficiente_hijo() {
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

  const advertencias = extraerAdvertencias(res);
  assertTieneAdvertencia(advertencias, 'DESCANSO_INSUFICIENTE_HIJO', 'Test 5a');
}

// ---------------------------------------------------------------------------
// TEST 5b: Límite exacto con el hijo (Cuartos con Semis a 75 min exactos -> sin aviso)
// ---------------------------------------------------------------------------
async function test5b_descanso_hijo_limite_exacto() {
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

  // Asignar Cuartos a las 13:30hs (termina 14:45hs -> descanso = 75 min exactos hasta las 16:00hs)
  const res = await partidoService.asignarHorarioManual(org.id, pCuartos.id, {
    slotId: 'Domingo-13:30',
    canchaNumero: 2,
  });

  const advertencias = extraerAdvertencias(res);
  assertNoTieneAdvertencia(advertencias, 'DESCANSO_INSUFICIENTE_HIJO', 'Test 5b');
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

  const advertencias = extraerAdvertencias(res);
  assertTieneAdvertencia(advertencias, 'DESCANSO_INSUFICIENTE_PADRE', 'Test 6');
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
  assert.ok(errorCancha.message.includes('Ese horario se ocupó con otro partido. Elegí otro horario.'), 'Mensaje debe indicar horario ocupado');

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
// TEST 8a: Trasnoche 00:15 posterior a fin de zona 23:30 (sin aviso)
// ---------------------------------------------------------------------------
async function test8a_trasnoche_sabado() {
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
  const advertencias = extraerAdvertencias(res);
  assertNoTieneAdvertencia(advertencias, 'INICIA_ANTES_FIN_ZONAS', 'Test 8a');
}

// ---------------------------------------------------------------------------
// TEST 8b: Trasnoche 00:15 anterior a fin de zona 00:45 (aviso INICIA_ANTES_FIN_ZONAS)
// ---------------------------------------------------------------------------
async function test8b_trasnoche_sabado_positivo() {
  const { org, torneo, cat } = await setupBaseTorneo();

  const zona = await prisma.zona.create({
    data: {
      categoriaId: cat.id,
      nombre: 'Zona A',
      formato: 'ROUND_ROBIN',
      clasifican: 2,
    },
  });

  // Partido de zona arranca Sabado-23:30 -> termina a las 00:45hs de la madrugada del domingo
  const pZonaFecha = parseSlotToDate('Sabado-23:30', torneo.fecha);
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

  // Asignar en slot de trasnoche Sabado-00:15 (madrugada del domingo a las 00:15 < fin de zona a las 00:45)
  const res = await partidoService.asignarHorarioManual(org.id, pR32.id, {
    slotId: 'Sabado-00:15',
    canchaNumero: 2,
  });

  assert.ok(res.partido, 'Debe asignar el partido');
  const advertencias = extraerAdvertencias(res);
  assertTieneAdvertencia(advertencias, 'INICIA_ANTES_FIN_ZONAS', 'Test 8b');
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

  // Padre 1 en Octavos es un BYE pero con fechaHora seteada que dejaría descanso insuficiente (30 min < 75 min) si no fuera BYE
  const fechaOctavosBye = parseSlotToDate('Domingo-08:30', torneo.fecha);
  await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      faseEliminatoriaId: fase16.id,
      posicionEnRonda: 1,
      esBye: true,
      fechaHora: fechaOctavosBye,
      canchaNumero: 1,
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

  // Asignar temprano en domingo a las 09:00hs en cancha 2 (descanso 30 min < 75 min requeridos si no fuera BYE)
  const res = await partidoService.asignarHorarioManual(org.id, pCuartos.id, {
    slotId: 'Domingo-09:00',
    canchaNumero: 2,
  });

  const advertencias = extraerAdvertencias(res);
  assertNoTieneAdvertencia(advertencias, 'DESCANSO_INSUFICIENTE_PADRE', 'Test 9');
}

// ---------------------------------------------------------------------------
// TEST 10: Zona manual sin partidos en categoría EN_CURSO (5 parejas sinGrupo)
// ---------------------------------------------------------------------------
async function test10_zona_manual_sin_partidos() {
  const { org, torneo, cat } = await setupBaseTorneo();

  // Crear 5 parejas en la categoría (tamaño incompatible que forma sinGrupo de 5 parejas)
  const pList = [];
  for (let i = 1; i <= 5; i++) {
    const p = await prisma.pareja.create({
      data: { categoriaId: cat.id, jugador1: `J${i}A`, jugador2: `J${i}B`, orden: i },
    });
    pList.push(p);
  }

  // Zona manual con requiereArmadoManual: true y 5 parejas, con 0 partidos creados
  const zonaManual5 = await prisma.zona.create({
    data: {
      categoriaId: cat.id,
      nombre: 'Zona Manual de 5 Parejas',
      formato: 'ROUND_ROBIN',
      clasifican: 2,
      requiereArmadoManual: true,
    },
  });

  for (const p of pList) {
    await prisma.zonaPareja.create({
      data: { zonaId: zonaManual5.id, parejaId: p.id },
    });
  }

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

  const advertencias = extraerAdvertencias(res);
  assertTieneAdvertencia(advertencias, 'ZONA_CON_PARTIDOS_PENDIENTES', 'Test 10');
}

// ---------------------------------------------------------------------------
// TEST 11a: Final con descanso Semis -> Final menor a 30 min (aviso DESCANSO_INSUFICIENTE_PADRE)
// ---------------------------------------------------------------------------
async function test11a_final_descanso_semis() {
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

  // Final a las 18:15 (descanso = 15 min < 30 min mínimo de Semis->Final)
  const res = await partidoService.asignarHorarioManual(org.id, pFinal.id, {
    slotId: 'Domingo-18:15',
    canchaNumero: 1,
  });
  const advertencias = extraerAdvertencias(res);
  assertTieneAdvertencia(advertencias, 'DESCANSO_INSUFICIENTE_PADRE', 'Test 11a');
}

// ---------------------------------------------------------------------------
// TEST 11b: Final con descanso Semis -> Final de 30 min exactos (sin aviso)
// ---------------------------------------------------------------------------
async function test11b_final_descanso_semis() {
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

  // Final a las 18:30 (descanso = 30 min = MIN_REST_SEMIS_FINAL_MS exacto)
  const res = await partidoService.asignarHorarioManual(org.id, pFinal.id, {
    slotId: 'Domingo-18:30',
    canchaNumero: 1,
  });
  const advertencias = extraerAdvertencias(res);
  assertNoTieneAdvertencia(advertencias, 'DESCANSO_INSUFICIENTE_PADRE', 'Test 11b');
}

// ---------------------------------------------------------------------------
// TEST 12: Unit tests del helper puro bracketWarnings (casos independientes)
// ---------------------------------------------------------------------------
const baseTs = new Date('2026-10-17T20:00:00.000Z').getTime();
const duracionMs = 75 * 60 * 1000;

async function test12a_constantes_exportadas() {
  const { REST_CONSTANTS } = bracketWarnings;
  assert.strictEqual(REST_CONSTANTS.MIN_REST_R32_OCTAVOS_MS, 75 * 60 * 1000, 'Constante R32->Octavos debe ser 75m');
  assert.strictEqual(REST_CONSTANTS.MIN_REST_OCTAVOS_CUARTOS_MS, 75 * 60 * 1000, 'Constante Octavos->Cuartos debe ser 75m');
  assert.strictEqual(REST_CONSTANTS.MIN_REST_CUARTOS_SEMIS_MS, 75 * 60 * 1000, 'Constante Cuartos->Semis debe ser 75m');
  assert.strictEqual(REST_CONSTANTS.MIN_REST_SEMIS_FINAL_MS, 30 * 60 * 1000, 'Constante Semis->Final debe ser 30m');
}

async function test12b_fin_zonas_una_zona_valida() {
  const { calcularFinDeZonasCategoria } = bracketWarnings;
  const partidosNormales = [
    { zonaId: 'z1', fechaHora: new Date(baseTs), sinHorarioAsignado: false },
    { zonaId: 'z1', fechaHora: new Date(baseTs + 75 * 60 * 1000), sinHorarioAsignado: false },
  ];
  const finOk = calcularFinDeZonasCategoria({
    partidosZona: partidosNormales,
    totalZonas: 1,
    zonasIds: ['z1'],
    duracionMs,
  });
  assert.strictEqual(finOk?.tienePartidosSinHorario, false, '12b: no debe tener partidos sin horario');
  assert.strictEqual(finOk?.maxZonaEndMs, baseTs + 2 * duracionMs, '12b: maxZonaEndMs debe ser baseTs + 2 * duracionMs');
}

async function test12c_fin_zonas_partido_sin_horario() {
  const { calcularFinDeZonasCategoria } = bracketWarnings;
  const partidosConPendiente = [
    { zonaId: 'z1', fechaHora: new Date(baseTs), sinHorarioAsignado: false },
    { zonaId: 'z1', fechaHora: null, sinHorarioAsignado: true },
  ];
  const finPend = calcularFinDeZonasCategoria({
    partidosZona: partidosConPendiente,
    totalZonas: 1,
    zonasIds: ['z1'],
    duracionMs,
  });
  assert.strictEqual(finPend?.tienePartidosSinHorario, true, '12c: partido sin horario debe marcar tienePartidosSinHorario');
}

async function test12d_fin_zonas_zona_vacia() {
  const { calcularFinDeZonasCategoria } = bracketWarnings;
  const finVacio = calcularFinDeZonasCategoria({
    partidosZona: [],
    totalZonas: 1,
    zonasIds: ['z1'],
    duracionMs,
  });
  assert.strictEqual(finVacio?.tienePartidosSinHorario, true, '12d: zona vacía debe marcar tienePartidosSinHorario');
}

async function test12e_dos_zonas_incompleta_cruce_antes_fin() {
  const { calcularFinDeZonasCategoria, calcularDescansosEliminatoria } = bracketWarnings;
  const finDosZonas = calcularFinDeZonasCategoria({
    partidosZona: [
      { zonaId: 'z1', fechaHora: new Date(baseTs), sinHorarioAsignado: false },
    ],
    totalZonas: 2,
    zonasIds: ['z1', 'z2'],
    duracionMs,
  });

  const advAntes = calcularDescansosEliminatoria({
    partido: { faseEliminatoria: { ronda: 8 } },
    fechaHoraPropuesta: new Date(baseTs + 30 * 60 * 1000), // 30 min (antes del fin de z1 que es baseTs + 75m)
    padres: [],
    hijo: null,
    finZonas: finDosZonas,
    duracionMs,
  });

  const codigos = advAntes.advertencias.map((a) => a.codigo);
  assert.ok(
    codigos.includes('ZONA_CON_PARTIDOS_PENDIENTES'),
    '12e: Debe emitir ZONA_CON_PARTIDOS_PENDIENTES'
  );
  assert.ok(
    codigos.includes('INICIA_ANTES_FIN_ZONAS'),
    '12e: Debe emitir INICIA_ANTES_FIN_ZONAS cuando cruce arranca antes del fin conocido de zonas'
  );
}

async function test12f_dos_zonas_incompleta_cruce_despues_fin() {
  const { calcularFinDeZonasCategoria, calcularDescansosEliminatoria } = bracketWarnings;
  const finDosZonas = calcularFinDeZonasCategoria({
    partidosZona: [
      { zonaId: 'z1', fechaHora: new Date(baseTs), sinHorarioAsignado: false },
    ],
    totalZonas: 2,
    zonasIds: ['z1', 'z2'],
    duracionMs,
  });

  const advDespues = calcularDescansosEliminatoria({
    partido: { faseEliminatoria: { ronda: 8 } },
    fechaHoraPropuesta: new Date(baseTs + 120 * 60 * 1000), // posterior al fin conocido (baseTs + 75m)
    padres: [],
    hijo: null,
    finZonas: finDosZonas,
    duracionMs,
  });

  const codigos = advDespues.advertencias.map((a) => a.codigo);
  assert.ok(
    codigos.includes('ZONA_CON_PARTIDOS_PENDIENTES'),
    '12f: Debe emitir ZONA_CON_PARTIDOS_PENDIENTES'
  );
  assert.strictEqual(
    codigos.includes('INICIA_ANTES_FIN_ZONAS'),
    false,
    '12f: Cruce posterior al fin conocido de zonas NO debe emitir INICIA_ANTES_FIN_ZONAS'
  );
}

async function test12g_categoria_sin_zonas() {
  const { calcularFinDeZonasCategoria, calcularDescansosEliminatoria } = bracketWarnings;
  const finSinZonas = calcularFinDeZonasCategoria({
    partidosZona: [],
    totalZonas: 0,
    zonasIds: [],
    duracionMs,
  });

  assert.strictEqual(finSinZonas?.tienePartidosSinHorario, false, '12g: sin zonas no debe tener partidos pendientes');
  assert.strictEqual(finSinZonas?.maxZonaEndMs, null, '12g: sin zonas maxZonaEndMs debe ser null');

  const adv = calcularDescansosEliminatoria({
    partido: { faseEliminatoria: { ronda: 16 } },
    fechaHoraPropuesta: new Date(baseTs),
    padres: [],
    hijo: null,
    finZonas: finSinZonas,
    duracionMs,
  });

  const codigos = adv.advertencias.map((a) => a.codigo);
  assert.strictEqual(
    codigos.includes('ZONA_CON_PARTIDOS_PENDIENTES'),
    false,
    '12g: categoría sin zonas no debe emitir ZONA_CON_PARTIDOS_PENDIENTES'
  );
  assert.strictEqual(
    codigos.includes('INICIA_ANTES_FIN_ZONAS'),
    false,
    '12g: categoría sin zonas no debe emitir INICIA_ANTES_FIN_ZONAS'
  );
}

async function test12h_inicia_antes_fin_zonas_limite() {
  const { calcularFinDeZonasCategoria, calcularDescansosEliminatoria } = bracketWarnings;
  const finOk = calcularFinDeZonasCategoria({
    partidosZona: [
      { zonaId: 'z1', fechaHora: new Date(baseTs), sinHorarioAsignado: false },
      { zonaId: 'z1', fechaHora: new Date(baseTs + 75 * 60 * 1000), sinHorarioAsignado: false },
    ],
    totalZonas: 1,
    zonasIds: ['z1'],
    duracionMs,
  });

  const advAntesFinZonas = calcularDescansosEliminatoria({
    partido: { faseEliminatoria: { ronda: 8 } },
    fechaHoraPropuesta: new Date(finOk.maxZonaEndMs - 15 * 60 * 1000), // 15 min antes del fin
    padres: [],
    finZonas: finOk,
    duracionMs,
  });
  assert.ok(
    advAntesFinZonas.advertencias.some((a) => a.codigo === 'INICIA_ANTES_FIN_ZONAS'),
    '12h: Debe emitir INICIA_ANTES_FIN_ZONAS si arranca antes del fin de zonas'
  );

  const advLimiteFinZonas = calcularDescansosEliminatoria({
    partido: { faseEliminatoria: { ronda: 8 } },
    fechaHoraPropuesta: new Date(finOk.maxZonaEndMs), // Límite exacto de fin de zonas
    padres: [],
    finZonas: finOk,
    duracionMs,
  });
  assert.strictEqual(
    advLimiteFinZonas.advertencias.filter((a) => a.codigo === 'INICIA_ANTES_FIN_ZONAS').length,
    0,
    '12h: En el límite exacto de fin de zonas NO debe emitir INICIA_ANTES_FIN_ZONAS'
  );
}

async function test12i_descanso_hijo_limite() {
  const { calcularFinDeZonasCategoria, calcularDescansosEliminatoria } = bracketWarnings;
  const finOk = calcularFinDeZonasCategoria({
    partidosZona: [{ zonaId: 'z1', fechaHora: new Date(baseTs), sinHorarioAsignado: false }],
    totalZonas: 1,
    zonasIds: ['z1'],
    duracionMs,
  });

  const tCuartos = baseTs + 500 * 60 * 1000;
  const tSemisInsuficiente = tCuartos + duracionMs + 45 * 60 * 1000; // 45 min descanso < 75 min
  const advHijoInsuficiente = calcularDescansosEliminatoria({
    partido: { faseEliminatoria: { ronda: 8 } },
    fechaHoraPropuesta: new Date(tCuartos),
    hijo: { faseEliminatoria: { ronda: 4 }, fechaHora: new Date(tSemisInsuficiente), sinHorarioAsignado: false },
    finZonas: finOk,
    duracionMs,
  });
  assert.ok(
    advHijoInsuficiente.advertencias.some((a) => a.codigo === 'DESCANSO_INSUFICIENTE_HIJO'),
    '12i: Debe emitir DESCANSO_INSUFICIENTE_HIJO si descanso con el hijo es menor a 75m'
  );

  const tSemisLimite = tCuartos + duracionMs + 75 * 60 * 1000; // 75 min exactos
  const advHijoLimite = calcularDescansosEliminatoria({
    partido: { faseEliminatoria: { ronda: 8 } },
    fechaHoraPropuesta: new Date(tCuartos),
    hijo: { faseEliminatoria: { ronda: 4 }, fechaHora: new Date(tSemisLimite), sinHorarioAsignado: false },
    finZonas: finOk,
    duracionMs,
  });
  assert.strictEqual(
    advHijoLimite.advertencias.filter((a) => a.codigo === 'DESCANSO_INSUFICIENTE_HIJO').length,
    0,
    '12i: En el límite exacto de 75m con el hijo NO debe emitir DESCANSO_INSUFICIENTE_HIJO'
  );
}

async function test12j_padre_bye_con_horario() {
  const { calcularFinDeZonasCategoria, calcularDescansosEliminatoria } = bracketWarnings;
  const finOk = calcularFinDeZonasCategoria({
    partidosZona: [{ zonaId: 'z1', fechaHora: new Date(baseTs), sinHorarioAsignado: false }],
    totalZonas: 1,
    zonasIds: ['z1'],
    duracionMs,
  });

  // Padre BYE CON fechaHora seteada que dejaría descanso insuficiente (15m < 75m) si no fuera BYE
  const advPadreBye = calcularDescansosEliminatoria({
    partido: { faseEliminatoria: { ronda: 8 } },
    fechaHoraPropuesta: new Date(baseTs + 90 * 60 * 1000),
    padres: [
      {
        faseEliminatoria: { ronda: 16 },
        esBye: true,
        fechaHora: new Date(baseTs),
        sinHorarioAsignado: false,
      },
    ],
    finZonas: finOk,
    duracionMs,
  });
  assert.strictEqual(
    advPadreBye.advertencias.filter((a) => a.codigo === 'DESCANSO_INSUFICIENTE_PADRE').length,
    0,
    '12j: Padre BYE con fechaHora seteada no debe generar DESCANSO_INSUFICIENTE_PADRE'
  );
}

async function test12k_r32_octavos_limite() {
  const { calcularFinDeZonasCategoria, calcularDescansosEliminatoria } = bracketWarnings;
  const finOk = calcularFinDeZonasCategoria({
    partidosZona: [{ zonaId: 'z1', fechaHora: new Date(baseTs), sinHorarioAsignado: false }],
    totalZonas: 1,
    zonasIds: ['z1'],
    duracionMs,
  });

  const tR32 = baseTs + 100 * 60 * 1000;
  const tR32Fin = tR32 + duracionMs;
  const tOctavos30m = tR32Fin + 30 * 60 * 1000; // descanso 30 min < 75 min
  const advR32Octavos30m = calcularDescansosEliminatoria({
    partido: { faseEliminatoria: { ronda: 16 } },
    fechaHoraPropuesta: new Date(tOctavos30m),
    padres: [{ faseEliminatoria: { ronda: 32 }, fechaHora: new Date(tR32), sinHorarioAsignado: false }],
    finZonas: finOk,
    duracionMs,
  });
  assert.ok(
    advR32Octavos30m.advertencias.some((a) => a.codigo === 'DESCANSO_INSUFICIENTE_PADRE'),
    '12k: Octavos a 30m de R32 debe emitir DESCANSO_INSUFICIENTE_PADRE'
  );

  const tOctavos75m = tR32Fin + 75 * 60 * 1000; // descanso 75 min exactos
  const advR32Octavos75m = calcularDescansosEliminatoria({
    partido: { faseEliminatoria: { ronda: 16 } },
    fechaHoraPropuesta: new Date(tOctavos75m),
    padres: [{ faseEliminatoria: { ronda: 32 }, fechaHora: new Date(tR32), sinHorarioAsignado: false }],
    finZonas: finOk,
    duracionMs,
  });
  assert.strictEqual(
    advR32Octavos75m.advertencias.filter((a) => a.codigo === 'DESCANSO_INSUFICIENTE_PADRE').length,
    0,
    '12k: Octavos a 75m exactos de R32 NO debe emitir DESCANSO_INSUFICIENTE_PADRE'
  );
}

async function test12l_primera_ronda_sin_padres_ni_hijo() {
  const { calcularFinDeZonasCategoria, calcularDescansosEliminatoria } = bracketWarnings;
  const finOk = calcularFinDeZonasCategoria({
    partidosZona: [{ zonaId: 'z1', fechaHora: new Date(baseTs), sinHorarioAsignado: false }],
    totalZonas: 1,
    zonasIds: ['z1'],
    duracionMs,
  });

  const advPrimeraRondaAntesFin = calcularDescansosEliminatoria({
    partido: { faseEliminatoria: { ronda: 32 } },
    fechaHoraPropuesta: new Date(finOk.maxZonaEndMs - 30 * 60 * 1000), // antes del fin de zonas
    padres: [],
    hijo: null,
    finZonas: finOk,
    duracionMs,
  });
  assert.deepStrictEqual(
    advPrimeraRondaAntesFin.advertencias.map((a) => a.codigo),
    ['INICIA_ANTES_FIN_ZONAS'],
    '12l: Cruce sin padres ni hijo solo debe advertir fin de zonas si arranca antes'
  );

  const advPrimeraRondaOk = calcularDescansosEliminatoria({
    partido: { faseEliminatoria: { ronda: 32 } },
    fechaHoraPropuesta: new Date(finOk.maxZonaEndMs + 30 * 60 * 1000), // posterior al fin de zonas
    padres: [],
    hijo: null,
    finZonas: finOk,
    duracionMs,
  });
  assert.strictEqual(
    advPrimeraRondaOk.advertencias.length,
    0,
    '12l: Cruce sin padres ni hijo posterior a fin de zonas no debe emitir ninguna advertencia'
  );
}

async function test12m_deteccion_zonas_ids() {
  const { calcularFinDeZonasCategoria } = bracketWarnings;
  // totalZonas omitido / 0, pero se pasan zonasIds ['z1', 'z2']
  const res = calcularFinDeZonasCategoria({
    partidosZona: [
      { zonaId: 'z1', fechaHora: new Date(baseTs), sinHorarioAsignado: false },
    ],
    zonasIds: ['z1', 'z2'],
    duracionMs,
  });

  assert.strictEqual(
    res?.tienePartidosSinHorario,
    true,
    '12m: zonasIds con una zona sin partidos debe marcar tienePartidosSinHorario aun con totalZonas omitido'
  );
}

async function test12n_semis_final_limite() {
  const { calcularDescansosEliminatoria } = bracketWarnings;
  const tSemisFin = baseTs + duracionMs;

  const adv15m = calcularDescansosEliminatoria({
    partido: { faseEliminatoria: { ronda: 2 } },
    fechaHoraPropuesta: new Date(tSemisFin + 15 * 60 * 1000), // 15 min < 30 min
    padres: [{ faseEliminatoria: { ronda: 4 }, fechaHora: new Date(baseTs), sinHorarioAsignado: false }],
    duracionMs,
  });
  assert.ok(
    adv15m.advertencias.some((a) => a.codigo === 'DESCANSO_INSUFICIENTE_PADRE'),
    '12n: Final a 15m de Semis debe emitir DESCANSO_INSUFICIENTE_PADRE'
  );

  const adv30m = calcularDescansosEliminatoria({
    partido: { faseEliminatoria: { ronda: 2 } },
    fechaHoraPropuesta: new Date(tSemisFin + 30 * 60 * 1000), // 30 min exactos (límite scheduler)
    padres: [{ faseEliminatoria: { ronda: 4 }, fechaHora: new Date(baseTs), sinHorarioAsignado: false }],
    duracionMs,
  });
  assert.strictEqual(
    adv30m.advertencias.filter((a) => a.codigo === 'DESCANSO_INSUFICIENTE_PADRE').length,
    0,
    '12n: Final a 30m exactos de Semis NO debe emitir DESCANSO_INSUFICIENTE_PADRE'
  );
}

// ---------------------------------------------------------------------------
// TEST 13a: Octavos con padre R32 descanso menor a 75 min (aviso DESCANSO_INSUFICIENTE_PADRE)
// ---------------------------------------------------------------------------
async function test13a_octavos_padre_r32_descanso() {
  const { org, torneo, cat } = await setupBaseTorneo();

  const fase32 = await prisma.faseEliminatoria.create({
    data: { categoriaId: cat.id, nombre: 'Dieciseisavos', ronda: 32 },
  });
  const fase16 = await prisma.faseEliminatoria.create({
    data: { categoriaId: cat.id, nombre: 'Octavos de Final', ronda: 16 },
  });

  // R32 (posicion 1): programado para arrancar Domingo-09:00 -> fin 10:15hs
  const fechaR32 = parseSlotToDate('Domingo-09:00', torneo.fecha);
  await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      faseEliminatoriaId: fase32.id,
      posicionEnRonda: 1,
      fechaHora: fechaR32,
      canchaNumero: 1,
      sinHorarioAsignado: false,
      estado: 'PENDIENTE',
    },
  });

  const pOctavos = await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      faseEliminatoriaId: fase16.id,
      posicionEnRonda: 1,
      sinHorarioAsignado: true,
      estado: 'PENDIENTE',
    },
  });

  // Octavos a las 10:45hs (descanso = 10:45 - 10:15 = 30 min < 75 min requeridos)
  const res = await partidoService.asignarHorarioManual(org.id, pOctavos.id, {
    slotId: 'Domingo-10:45',
    canchaNumero: 1,
  });
  const advertencias = extraerAdvertencias(res);
  assertTieneAdvertencia(advertencias, 'DESCANSO_INSUFICIENTE_PADRE', 'Test 13a');
}

// ---------------------------------------------------------------------------
// TEST 13b: Octavos con padre R32 descanso de 75 min exactos (sin aviso)
// ---------------------------------------------------------------------------
async function test13b_octavos_padre_r32_descanso() {
  const { org, torneo, cat } = await setupBaseTorneo();

  const fase32 = await prisma.faseEliminatoria.create({
    data: { categoriaId: cat.id, nombre: 'Dieciseisavos', ronda: 32 },
  });
  const fase16 = await prisma.faseEliminatoria.create({
    data: { categoriaId: cat.id, nombre: 'Octavos de Final', ronda: 16 },
  });

  // R32 (posicion 1): programado para arrancar Domingo-09:00 -> fin 10:15hs
  const fechaR32 = parseSlotToDate('Domingo-09:00', torneo.fecha);
  await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      faseEliminatoriaId: fase32.id,
      posicionEnRonda: 1,
      fechaHora: fechaR32,
      canchaNumero: 1,
      sinHorarioAsignado: false,
      estado: 'PENDIENTE',
    },
  });

  const pOctavos = await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      faseEliminatoriaId: fase16.id,
      posicionEnRonda: 1,
      sinHorarioAsignado: true,
      estado: 'PENDIENTE',
    },
  });

  // Octavos a las 11:30hs (descanso = 11:30 - 10:15 = 75 min exactos)
  const res = await partidoService.asignarHorarioManual(org.id, pOctavos.id, {
    slotId: 'Domingo-11:30',
    canchaNumero: 1,
  });
  const advertencias = extraerAdvertencias(res);
  assertNoTieneAdvertencia(advertencias, 'DESCANSO_INSUFICIENTE_PADRE', 'Test 13b');
}

// ---------------------------------------------------------------------------
// TEST 12o: Helper - resolverPadresEHijoEliminatoria e indexarPartidosEliminatoria
// ---------------------------------------------------------------------------
async function test12o_helper_resolver_padres_e_hijo() {
  const { resolverPadresEHijoEliminatoria, indexarPartidosEliminatoria } = bracketWarnings;
  assert.strictEqual(typeof resolverPadresEHijoEliminatoria, 'function', '12o: resolverPadresEHijoEliminatoria debe ser función');
  assert.strictEqual(typeof indexarPartidosEliminatoria, 'function', '12o: indexarPartidosEliminatoria debe ser función');

  const pOctavos1 = { id: 'o1', faseEliminatoria: { ronda: 16 }, posicionEnRonda: 1 };
  const pOctavos2 = { id: 'o2', faseEliminatoria: { ronda: 16 }, posicionEnRonda: 2 };
  const pCuartos1 = { id: 'c1', faseEliminatoria: { ronda: 8 }, posicionEnRonda: 1 };
  const pSemis1 = { id: 's1', faseEliminatoria: { ronda: 4 }, posicionEnRonda: 1 };

  const map = indexarPartidosEliminatoria([pOctavos1, pOctavos2, pCuartos1, pSemis1]);
  const resCuartos = resolverPadresEHijoEliminatoria({ partido: pCuartos1, eliminatoriasMap: map });

  assert.strictEqual(resCuartos.padres.length, 2, 'Cuartos 1 debe tener 2 padres');
  assert.strictEqual(resCuartos.padres[0].id, 'o1');
  assert.strictEqual(resCuartos.padres[1].id, 'o2');
  assert.strictEqual(resCuartos.hijo?.id, 's1', 'Cuartos 1 debe tener de hijo a Semis 1');
}

// ---------------------------------------------------------------------------
// TEST 14: getFasesEliminatorias devuelve advertencias en cruces con horarioManual: true
// ---------------------------------------------------------------------------
async function test14_getFasesEliminatorias_advertencias_coinciden() {
  const { org, torneo, cat } = await setupBaseTorneo();

  const fase8 = await prisma.faseEliminatoria.create({
    data: { categoriaId: cat.id, nombre: 'Cuartos de Final', ronda: 8 },
  });
  const fase4 = await prisma.faseEliminatoria.create({
    data: { categoriaId: cat.id, nombre: 'Semifinal', ronda: 4 },
  });

  const fechaSemis = parseSlotToDate('Domingo-16:00', torneo.fecha);
  await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      faseEliminatoriaId: fase4.id,
      posicionEnRonda: 1,
      fechaHora: fechaSemis,
      canchaNumero: 1,
      sinHorarioAsignado: false,
      horarioManual: false,
      estado: 'PENDIENTE',
    },
  });

  const pCuartos = await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      faseEliminatoriaId: fase8.id,
      posicionEnRonda: 1,
      sinHorarioAsignado: true,
      horarioManual: false,
      estado: 'PENDIENTE',
    },
  });

  // Asignar Cuartos a las 15:00hs (solapa con Semis a las 16:00hs -> genera advertencia)
  const resAsignar = await partidoService.asignarHorarioManual(org.id, pCuartos.id, {
    slotId: 'Domingo-15:00',
    canchaNumero: 2,
  });
  const advertenciasAsignar = extraerAdvertencias(resAsignar);
  assertTieneAdvertencia(advertenciasAsignar, 'DESCANSO_INSUFICIENTE_HIJO', 'Test 14 asignar');

  // Leer mediante getFasesEliminatorias
  const fases = await faseEliminatoriaService.getFasesEliminatorias(org.id, cat.id);
  const faseCuartos = fases.find((f) => f.id === fase8.id);
  const partidoCuartosLeido = faseCuartos?.partidos?.find((p) => p.id === pCuartos.id);

  assert.ok(partidoCuartosLeido, 'Test 14: Debe existir Cuartos en fases');
  assert.strictEqual(partidoCuartosLeido.horarioManual, true, 'Test 14: Debe tener horarioManual: true');
  assert.ok(Array.isArray(partidoCuartosLeido.advertencias), 'Test 14: Debe devolver array advertencias');
  assert.deepStrictEqual(partidoCuartosLeido.advertencias, advertenciasAsignar, 'Test 14: Las advertencias leídas deben coincidir exactamente con las de asignarHorarioManual');
}

// ---------------------------------------------------------------------------
// TEST 15: getFasesEliminatorias sin advertencias en cruces sin horarioManual
// ---------------------------------------------------------------------------
async function test15_getFasesEliminatorias_sin_horarioManual_sin_advertencias() {
  const { org, torneo, cat } = await setupBaseTorneo();

  const fase8 = await prisma.faseEliminatoria.create({
    data: { categoriaId: cat.id, nombre: 'Cuartos de Final', ronda: 8 },
  });
  const fase4 = await prisma.faseEliminatoria.create({
    data: { categoriaId: cat.id, nombre: 'Semifinal', ronda: 4 },
  });

  // Ambos con horarios que solapan, pero horarioManual: false
  const fechaSemis = parseSlotToDate('Domingo-16:00', torneo.fecha);
  const fechaCuartos = parseSlotToDate('Domingo-15:00', torneo.fecha);

  await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      faseEliminatoriaId: fase4.id,
      posicionEnRonda: 1,
      fechaHora: fechaSemis,
      canchaNumero: 1,
      sinHorarioAsignado: false,
      horarioManual: false,
      estado: 'PENDIENTE',
    },
  });

  await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      faseEliminatoriaId: fase8.id,
      posicionEnRonda: 1,
      fechaHora: fechaCuartos,
      canchaNumero: 2,
      sinHorarioAsignado: false,
      horarioManual: false,
      estado: 'PENDIENTE',
    },
  });

  const fases = await faseEliminatoriaService.getFasesEliminatorias(org.id, cat.id);
  for (const fase of fases) {
    for (const p of fase.partidos) {
      assert.ok(!p.advertencias || p.advertencias.length === 0, `Test 15: Partido ${p.id} sin horarioManual no debe tener advertencias`);
    }
  }
}

// ---------------------------------------------------------------------------
// TEST 16: Endpoint público GET /api/public/:slug NO expone advertencias ni horarioManual
// ---------------------------------------------------------------------------
async function test16_endpoint_publico_no_expone_advertencias() {
  const { org, torneo, cat } = await setupBaseTorneo();

  const fase8 = await prisma.faseEliminatoria.create({
    data: { categoriaId: cat.id, nombre: 'Cuartos de Final', ronda: 8 },
  });

  const pCuartos = await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      faseEliminatoriaId: fase8.id,
      posicionEnRonda: 1,
      sinHorarioAsignado: true,
      horarioManual: false,
      estado: 'PENDIENTE',
    },
  });

  // Asignar manualmente
  await partidoService.asignarHorarioManual(org.id, pCuartos.id, {
    slotId: 'Domingo-15:00',
    canchaNumero: 2,
  });

  let responseData = null;
  const mockReq = { params: { slug: torneo.slug } };
  const mockRes = {
    status: (code) => ({
      json: (data) => { responseData = data; },
    }),
    json: (data) => { responseData = data; },
  };

  await publicController.getTorneoPublico(mockReq, mockRes, (err) => {
    if (err) throw err;
  });

  assert.ok(responseData?.torneo, 'Test 16: Debe retornar payload del torneo');
  assert.ok(Array.isArray(responseData?.categorias), 'Test 16: Debe retornar array categorias');
  for (const c of responseData.categorias) {
    if (Array.isArray(c.zonas)) {
      for (const z of c.zonas) {
        if (Array.isArray(z.partidos)) {
          for (const p of z.partidos) {
            assert.strictEqual(p.advertencias, undefined, 'Test 16: Partido de zona público no debe tener advertencias');
            assert.strictEqual(p.horarioManual, undefined, 'Test 16: Partido de zona público no debe exponer horarioManual');
          }
        }
      }
    }
    if (Array.isArray(c.eliminatoria)) {
      for (const fase of c.eliminatoria) {
        if (Array.isArray(fase.partidos)) {
          for (const p of fase.partidos) {
            assert.strictEqual(p.advertencias, undefined, 'Test 16: Partido de eliminatoria público no debe tener advertencias');
            assert.strictEqual(p.horarioManual, undefined, 'Test 16: Partido de eliminatoria público no debe exponer horarioManual');
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// TEST 17: Reprogramar partido y volver a leer getFasesEliminatorias actualiza advertencias
// ---------------------------------------------------------------------------
async function test17_reprogramar_partido_actualiza_advertencias() {
  const { org, torneo, cat } = await setupBaseTorneo();

  const fase8 = await prisma.faseEliminatoria.create({
    data: { categoriaId: cat.id, nombre: 'Cuartos de Final', ronda: 8 },
  });
  const fase4 = await prisma.faseEliminatoria.create({
    data: { categoriaId: cat.id, nombre: 'Semifinal', ronda: 4 },
  });

  const fechaSemis = parseSlotToDate('Domingo-16:00', torneo.fecha);
  await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      faseEliminatoriaId: fase4.id,
      posicionEnRonda: 1,
      fechaHora: fechaSemis,
      canchaNumero: 1,
      sinHorarioAsignado: false,
      horarioManual: false,
      estado: 'PENDIENTE',
    },
  });

  const pCuartos = await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      faseEliminatoriaId: fase8.id,
      posicionEnRonda: 1,
      sinHorarioAsignado: true,
      horarioManual: false,
      estado: 'PENDIENTE',
    },
  });

  // 1. Asignar con conflicto (15:00 -> solapa con Semis a las 16:00)
  await partidoService.asignarHorarioManual(org.id, pCuartos.id, {
    slotId: 'Domingo-15:00',
    canchaNumero: 2,
  });

  const fases1 = await faseEliminatoriaService.getFasesEliminatorias(org.id, cat.id);
  const p1 = fases1.find((f) => f.id === fase8.id)?.partidos?.find((p) => p.id === pCuartos.id);
  assert.ok(p1 && Array.isArray(p1.advertencias), 'Test 17: p1 debe tener array de advertencias');
  assertTieneAdvertencia(p1.advertencias, 'DESCANSO_INSUFICIENTE_HIJO', 'Test 17 pre-reprogramar');

  // 2. Reprogramar a las 13:30 (descanso = 75 min exactos -> conflicto resuelto)
  await partidoService.asignarHorarioManual(org.id, pCuartos.id, {
    slotId: 'Domingo-13:30',
    canchaNumero: 2,
  });

  const fases2 = await faseEliminatoriaService.getFasesEliminatorias(org.id, cat.id);
  const p2 = fases2.find((f) => f.id === fase8.id)?.partidos?.find((p) => p.id === pCuartos.id);
  assert.ok(p2 && Array.isArray(p2.advertencias), 'Test 17: p2 debe tener array de advertencias');
  assertNoTieneAdvertencia(p2.advertencias, 'DESCANSO_INSUFICIENTE_HIJO', 'Test 17 post-reprogramar');
  assert.strictEqual(p2.advertencias.length, 0, 'Test 17: p2 no debe tener advertencias');
}

// TEST 18a: getFasesEliminatorias no calcula ni devuelve advertencias en cruces FINALIZADO
async function test18a_getFasesEliminatorias_ignora_finalizados() {
  const { org, torneo, cat } = await setupBaseTorneo();

  const zona = await prisma.zona.create({
    data: { categoriaId: cat.id, nombre: 'Zona A' },
  });
  await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      zonaId: zona.id,
      fechaHora: parseSlotToDate('Domingo-18:00', torneo.fecha),
      canchaNumero: 1,
      sinHorarioAsignado: false,
    },
  });

  const fase = await prisma.faseEliminatoria.create({
    data: { categoriaId: cat.id, nombre: 'Octavos', ronda: 16 },
  });

  const pFinalizado = await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      faseEliminatoriaId: fase.id,
      posicionEnRonda: 1,
      fechaHora: parseSlotToDate('Domingo-14:00', torneo.fecha),
      horarioManual: true,
      estado: 'FINALIZADO',
    },
  });

  const pPendiente = await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      faseEliminatoriaId: fase.id,
      posicionEnRonda: 2,
      fechaHora: parseSlotToDate('Domingo-14:00', torneo.fecha),
      horarioManual: true,
      estado: 'PENDIENTE',
    },
  });

  const fases = await faseEliminatoriaService.getFasesEliminatorias(org.id, cat.id);
  const partidos = fases.find((f) => f.id === fase.id)?.partidos || [];

  const resFin = partidos.find((p) => p.id === pFinalizado.id);
  const resPen = partidos.find((p) => p.id === pPendiente.id);

  assert.ok(resFin, 'Partido finalizado debe existir en la respuesta');
  assert.strictEqual(
    resFin.advertencias,
    undefined,
    'Partido FINALIZADO no debe tener advertencias'
  );

  assert.ok(resPen, 'Partido pendiente debe existir en la respuesta');
  assert.ok(
    Array.isArray(resPen.advertencias) && resPen.advertencias.length > 0,
    'Partido PENDIENTE con conflicto debe tener advertencias'
  );
  assertTieneAdvertencia(resPen.advertencias, 'INICIA_ANTES_FIN_ZONAS', 'Test 18a pendiente');
}

// TEST 18b: getFasesEliminatorias no calcula ni devuelve advertencias en cruces EN_CURSO
async function test18b_getFasesEliminatorias_ignora_en_curso() {
  const { org, torneo, cat } = await setupBaseTorneo();

  const zona = await prisma.zona.create({
    data: { categoriaId: cat.id, nombre: 'Zona A' },
  });
  await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      zonaId: zona.id,
      fechaHora: parseSlotToDate('Domingo-18:00', torneo.fecha),
      canchaNumero: 1,
      sinHorarioAsignado: false,
    },
  });

  const fase = await prisma.faseEliminatoria.create({
    data: { categoriaId: cat.id, nombre: 'Octavos', ronda: 16 },
  });

  const pEnCurso = await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      faseEliminatoriaId: fase.id,
      posicionEnRonda: 1,
      fechaHora: parseSlotToDate('Domingo-14:00', torneo.fecha),
      horarioManual: true,
      estado: 'EN_CURSO',
    },
  });

  const pPendiente = await prisma.partido.create({
    data: {
      categoriaId: cat.id,
      faseEliminatoriaId: fase.id,
      posicionEnRonda: 2,
      fechaHora: parseSlotToDate('Domingo-14:00', torneo.fecha),
      horarioManual: true,
      estado: 'PENDIENTE',
    },
  });

  const fases = await faseEliminatoriaService.getFasesEliminatorias(org.id, cat.id);
  const partidos = fases.find((f) => f.id === fase.id)?.partidos || [];

  const resCur = partidos.find((p) => p.id === pEnCurso.id);
  const resPen = partidos.find((p) => p.id === pPendiente.id);

  assert.ok(resCur, 'Partido en curso debe existir en la respuesta');
  assert.strictEqual(
    resCur.advertencias,
    undefined,
    'Partido EN_CURSO no debe tener advertencias'
  );

  assert.ok(resPen, 'Partido pendiente debe existir en la respuesta');
  assert.ok(
    Array.isArray(resPen.advertencias) && resPen.advertencias.length > 0,
    'Partido PENDIENTE con conflicto debe tener advertencias'
  );
  assertTieneAdvertencia(resPen.advertencias, 'INICIA_ANTES_FIN_ZONAS', 'Test 18b pendiente');
}

// ---------------------------------------------------------------------------
// RUNNER CENTRAL DE LA SUITE
// ---------------------------------------------------------------------------
async function run() {
  await ensureTestDb();
  resetTestDb();
  await canchasOverridesService.loadFromDb();

  console.log('='.repeat(85));
  console.log('🧪 SUITE OFICIAL: VALIDACIONES EN ASIGNAR HORARIO MANUAL (16 CASOS)');
  console.log('='.repeat(85));

  const allTests = [
    { id: '1', nombre: 'Test 1: R32 manual antes de fin de zonas (aviso INICIA_ANTES_FIN_ZONAS)', fn: test1_r32_antes_fin_zonas },
    { id: '2', nombre: 'Test 2: R32 manual después de fin de zonas (sin aviso)', fn: test2_r32_despues_fin_zonas },
    { id: '3', nombre: 'Test 3: Zona con partido sin horario (aviso ZONA_CON_PARTIDOS_PENDIENTES)', fn: test3_zona_partido_sin_horario },
    { id: '4', nombre: 'Test 4: Descanso insuficiente respecto de padre (Octavos -> Cuartos)', fn: test4_descanso_insuficiente_padre },
    { id: '5a', nombre: 'Test 5a: Descanso insuficiente respecto de hijo (Cuartos <- Semis)', fn: test5a_descanso_insuficiente_hijo },
    { id: '5b', nombre: 'Test 5b: Límite exacto con el hijo (Cuartos con Semis a 75 min exactos: sin aviso)', fn: test5b_descanso_hijo_limite_exacto },
    { id: '6', nombre: 'Test 6: Cruce con parejas null en cuadro (estructura de árbol)', fn: test6_cruce_parejas_null },
    { id: '7', nombre: 'Test 7: No-regresión de validaciones actuales de colisión (cancha y parejas 409)', fn: test7_no_regresion_colisiones },
    { id: '8a', nombre: 'Test 8a: Trasnoche 00:15 posterior a fin de zona 23:30 (sin aviso)', fn: test8a_trasnoche_sabado },
    { id: '8b', nombre: 'Test 8b: Trasnoche 00:15 anterior a fin de zona 00:45 (aviso INICIA_ANTES_FIN_ZONAS)', fn: test8b_trasnoche_sabado_positivo },
    { id: '9', nombre: 'Test 9: Padre BYE no restringe descanso', fn: test9_padre_bye },
    { id: '10', nombre: 'Test 10: Zona manual sin partidos en categoría EN_CURSO (5 parejas)', fn: test10_zona_manual_sin_partidos },
    { id: '11a', nombre: 'Test 11a: Final con descanso Semis -> Final menor a 30 min (aviso DESCANSO_INSUFICIENTE_PADRE)', fn: test11a_final_descanso_semis },
    { id: '11b', nombre: 'Test 11b: Final con descanso Semis -> Final de 30 min exactos (sin aviso)', fn: test11b_final_descanso_semis },
    { id: '12a', nombre: 'Test 12a: Helper - Constantes exportadas', fn: test12a_constantes_exportadas },
    { id: '12b', nombre: 'Test 12b: Helper - Fin de zonas válido (1 zona)', fn: test12b_fin_zonas_una_zona_valida },
    { id: '12c', nombre: 'Test 12c: Helper - Fin de zonas con partido sin horario', fn: test12c_fin_zonas_partido_sin_horario },
    { id: '12d', nombre: 'Test 12d: Helper - Fin de zonas con zona vacía (0 partidos, 1 zona)', fn: test12d_fin_zonas_zona_vacia },
    { id: '12e', nombre: 'Test 12e: Helper - 2 zonas (una agendada, una vacía) cruce antes de fin -> ZONA_CON_PARTIDOS_PENDIENTES e INICIA_ANTES_FIN_ZONAS', fn: test12e_dos_zonas_incompleta_cruce_antes_fin },
    { id: '12f', nombre: 'Test 12f: Helper - 2 zonas (una agendada, una vacía) cruce después de fin -> solo ZONA_CON_PARTIDOS_PENDIENTES', fn: test12f_dos_zonas_incompleta_cruce_despues_fin },
    { id: '12g', nombre: 'Test 12g: Helper - Categoría sin zonas (totalZonas = 0, zonasIds = []) -> sin aviso de zona', fn: test12g_categoria_sin_zonas },
    { id: '12h', nombre: 'Test 12h: Helper - INICIA_ANTES_FIN_ZONAS emitido si es anterior y NO en límite exacto', fn: test12h_inicia_antes_fin_zonas_limite },
    { id: '12i', nombre: 'Test 12i: Helper - Descanso con hijo: emitido por debajo del mínimo y NO en límite exacto', fn: test12i_descanso_hijo_limite },
    { id: '12j', nombre: 'Test 12j: Helper - Padre BYE con fechaHora seteada y descanso insuficiente -> sin aviso DESCANSO_INSUFICIENTE_PADRE', fn: test12j_padre_bye_con_horario },
    { id: '12k', nombre: 'Test 12k: Helper - R32 -> Octavos: 30 min advierte, 75 min exactos no', fn: test12k_r32_octavos_limite },
    { id: '12l', nombre: 'Test 12l: Helper - Ronda sin padres ni hijo: solo evalúa fin de zonas', fn: test12l_primera_ronda_sin_padres_ni_hijo },
    { id: '12m', nombre: 'Test 12m: Helper - Detección por zonasIds con totalZonas omitido', fn: test12m_deteccion_zonas_ids },
    { id: '12n', nombre: 'Test 12n: Helper - Semis -> Final: 15 min advierte, 30 min exactos no', fn: test12n_semis_final_limite },
    { id: '12o', nombre: 'Test 12o: Helper - resolverPadresEHijoEliminatoria e indexarPartidosEliminatoria', fn: test12o_helper_resolver_padres_e_hijo },
    { id: '13a', nombre: 'Test 13a: Octavos con padre R32 descanso menor a 75 min (aviso DESCANSO_INSUFICIENTE_PADRE)', fn: test13a_octavos_padre_r32_descanso },
    { id: '13b', nombre: 'Test 13b: Octavos con padre R32 descanso de 75 min exactos (sin aviso)', fn: test13b_octavos_padre_r32_descanso },
    { id: '14', nombre: 'Test 14: getFasesEliminatorias devuelve advertencias en cruces con horarioManual: true', fn: test14_getFasesEliminatorias_advertencias_coinciden },
    { id: '15', nombre: 'Test 15: getFasesEliminatorias sin advertencias en cruces sin horarioManual', fn: test15_getFasesEliminatorias_sin_horarioManual_sin_advertencias },
    { id: '16', nombre: 'Test 16: Endpoint público GET /api/public/:slug NO expone advertencias ni horarioManual', fn: test16_endpoint_publico_no_expone_advertencias },
    { id: '17', nombre: 'Test 17: Reprogramar partido y volver a leer getFasesEliminatorias actualiza advertencias', fn: test17_reprogramar_partido_actualiza_advertencias },
    { id: '18a', nombre: 'Test 18a: getFasesEliminatorias no calcula ni devuelve advertencias en cruce FINALIZADO', fn: test18a_getFasesEliminatorias_ignora_finalizados },
    { id: '18b', nombre: 'Test 18b: getFasesEliminatorias no calcula ni devuelve advertencias en cruce EN_CURSO', fn: test18b_getFasesEliminatorias_ignora_en_curso },
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
