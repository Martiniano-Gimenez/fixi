'use strict';

/**
 * test-zona-manual-sin-partidos.js
 * Suite oficial determinista para el ciclo de vida de zonas manuales (requiereArmadoManual / sinGrupo)
 * en el pre-check y al confirmar el inicio del torneo.
 *
 * Cobertura de 7 casos:
 * 1. Zona manual de 3 parejas, destrabe total agendable -> 3 partidos en DB, ninguno con nulls.
 * 2. Zona manual de 3 parejas, destrabe total pero sin capacidad -> conflicto normal de partido, no zona manual.
 * 3. Destrabe parcial (zona de 3) -> sigue bloqueado, crucesIncompatibles señala el par correcto.
 * 4. Zona manual de 4 parejas -> pairwise sin cuadruple sigue bloqueado; con cuadruple crea 4 partidos (P3/P4 con origen).
 * 5. Ciclo destrabe -> quitar slot -> re-destrabe -> idempotencia estricta sin duplicados.
 * 6. Zonas sinGrupo de 1 y 5+ parejas -> permanecen bloqueadas como ZONA_MANUAL_INCOMPLETA.
 * 7. Zona manual de 2 parejas -> destrabe genera 1 partido en DB.
 */

const { ensureTestDb } = require('./utils/testEnvGuard');
const { resetTestDb } = require('./reset-test-db');
const assert = require('node:assert');
const prisma = require('../src/lib/prisma');
const organizadorService = require('../src/services/organizador.service');
const disponibilidadService = require('../src/services/disponibilidad.service');
const canchasOverridesService = require('../src/services/canchasOverrides.service');
const { parseFechaLocal } = require('../src/utils/dateUtils');

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

async function setupBaseClub({ cantidadCanchas = 1, viernesInicio = '18:00', viernesFin = '22:00', sabadoInicio = '09:00', sabadoFin = '22:00' } = {}) {
  await limpiarDb();

  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club Test Zona Manual',
      email: `test_manual_${Date.now()}@padel.test`,
      passwordHash: 'hash',
      cantidadCanchas,
      viernesInicio,
      viernesFin,
      sabadoInicio,
      sabadoFin,
      domingoInicio: '09:00',
      domingoFin: '22:00',
    },
  });

  const torneo = await prisma.torneo.create({
    data: {
      nombre: 'Torneo Test Zona Manual',
      slug: `torneo-manual-${Date.now()}`,
      fecha: parseFechaLocal('2026-09-04'),
      estado: 'BORRADOR',
      organizadorId: org.id,
    },
  });

  const cat = await prisma.categoria.create({
    data: { torneoId: torneo.id, nombre: '6ta', estado: 'BORRADOR' },
  });

  return { org, torneo, cat };
}

// ---------------------------------------------------------------------------
// TEST 1: Zona manual de 3, destrabe total agendable
// ---------------------------------------------------------------------------
async function test1_zona3_destrabeTotalAgendable() {
  console.log('\n▶️ TEST 1: Zona manual de 3 parejas, destrabe total agendable...');
  const { org, torneo, cat } = await setupBaseClub({ cantidadCanchas: 1, viernesFin: '22:00' });

  const p1 = await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: 'A1', jugador2: 'A2', orden: 1 } });
  const p2 = await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: 'B1', jugador2: 'B2', orden: 2 } });
  const p3 = await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: 'C1', jugador2: 'C2', orden: 3 } });

  // Nace con incompatibilidad real: P1 y P2 en 18:00; P3 en 20:30 (P3 no comparte con P1 ni P2)
  await prisma.slotPareja.createMany({
    data: [
      { parejaId: p1.id, slotId: 'Viernes-18:00' },
      { parejaId: p2.id, slotId: 'Viernes-18:00' },
      { parejaId: p3.id, slotId: 'Viernes-20:30' },
    ],
  });

  const pre1 = await organizadorService.preCheckInicioTorneo(org.id, torneo.id);
  assert.strictEqual(pre1.bloqueado, true, 'Pre-check 1 debe estar bloqueado');
  const conf1 = pre1.conflictos[0]?.partidosSinHorario?.find((c) => c.motivo === 'ZONA_MANUAL_INCOMPLETA');
  assert.ok(conf1, 'Debe haber un conflicto ZONA_MANUAL_INCOMPLETA');
  assert.strictEqual(pre1.permiteInicioEmergencia, false, 'No debe permitir inicio de emergencia');

  // Destrabe total: las 3 parejas cubren las 3 franjas requeridas (18:00, 19:15, 20:30)
  const fullSlots = ['Viernes-18:00', 'Viernes-19:15', 'Viernes-20:30'];
  await disponibilidadService.setDisponibilidadDoble(org.id, p1.id, fullSlots, p2.id, fullSlots);
  await disponibilidadService.setDisponibilidad(org.id, p3.id, fullSlots);

  const pre2 = await organizadorService.preCheckInicioTorneo(org.id, torneo.id, { isReCheck: true });
  assert.strictEqual(pre2.bloqueado, false, 'Pre-check 2 debe estar desbloqueado tras destrabe total');
  assert.ok(pre2.planId, 'Debe retornar un planId');

  // Iniciar torneo
  await organizadorService.iniciarTorneoMultiCategoria(org.id, torneo.id, pre2.planId);

  // Verificaciones estrictas en Base de Datos
  const zonaDb = await prisma.zona.findFirst({
    where: { categoriaId: cat.id },
    include: { partidos: true, zonaParejas: true },
  });
  assert.ok(zonaDb, 'La zona debe existir en la base de datos');
  assert.strictEqual(zonaDb.requiereArmadoManual, false, 'requiereArmadoManual debe ser false en la base');
  assert.strictEqual(zonaDb.partidos.length, 3, `Se esperaban 3 partidos en DB pero hay ${zonaDb.partidos.length}`);

  for (const partido of zonaDb.partidos) {
    assert.ok(partido.pareja1Id !== null, `Partido ${partido.id} tiene pareja1Id null`);
    assert.ok(partido.pareja2Id !== null, `Partido ${partido.id} tiene pareja2Id null`);
    assert.ok(
      partido.sinHorarioAsignado === false || partido.estado === 'PENDIENTE',
      `Partido ${partido.id} en estado inconsistente`
    );
  }
  console.log('   ✓ Test 1 superado.');
}

// ---------------------------------------------------------------------------
// TEST 2: Zona manual de 3, destrabe total pero sin capacidad (conflicto normal)
// ---------------------------------------------------------------------------
async function test2_zona3_destrabeSinCapacidad() {
  console.log('\n▶️ TEST 2: Zona manual de 3 parejas, destrabe pero sin capacidad de cancha...');
  // Club con solo 2 turnos: 18:00 a 20:30 (entran solo 2 partidos de 75m: 18:00-19:15 y 19:15-20:30)
  const { org, torneo, cat } = await setupBaseClub({ cantidadCanchas: 1, viernesFin: '20:30' });

  const p1 = await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: 'A1', jugador2: 'A2', orden: 1 } });
  const p2 = await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: 'B1', jugador2: 'B2', orden: 2 } });
  const p3 = await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: 'C1', jugador2: 'C2', orden: 3 } });

  // Nace incompatible: P1 y P2 en 18:00, P3 en 19:15
  await prisma.slotPareja.createMany({
    data: [
      { parejaId: p1.id, slotId: 'Viernes-18:00' },
      { parejaId: p2.id, slotId: 'Viernes-18:00' },
      { parejaId: p3.id, slotId: 'Viernes-19:15' },
    ],
  });

  const pre1 = await organizadorService.preCheckInicioTorneo(org.id, torneo.id);
  assert.strictEqual(pre1.bloqueado, true, 'Pre-check 1 debe estar bloqueado');
  const conf1 = pre1.conflictos[0]?.partidosSinHorario?.find((c) => c.motivo === 'ZONA_MANUAL_INCOMPLETA');
  assert.ok(conf1, 'Debe nacer con conflicto ZONA_MANUAL_INCOMPLETA');
  assert.strictEqual(pre1.permiteInicioEmergencia, false, 'No debe permitir inicio de emergencia');

  // Destrabe a nivel disponibilidad entre parejas (todas cubren 18:00 y 19:15)
  const slotsCompat = ['Viernes-18:00', 'Viernes-19:15'];
  await disponibilidadService.setDisponibilidadDoble(org.id, p1.id, slotsCompat, p2.id, slotsCompat);
  await disponibilidadService.setDisponibilidad(org.id, p3.id, slotsCompat);

  const pre2 = await organizadorService.preCheckInicioTorneo(org.id, torneo.id, { isReCheck: true });
  assert.strictEqual(pre2.bloqueado, true, 'Pre-check 2 debe estar bloqueado por falta de capacidad');

  const confManual = pre2.conflictos[0]?.partidosSinHorario?.find((c) => c.motivo === 'ZONA_MANUAL_INCOMPLETA');
  assert.strictEqual(confManual, undefined, 'NO debe haber conflicto ZONA_MANUAL_INCOMPLETA');

  const confCancha = pre2.conflictos[0]?.partidosSinHorario?.find((c) => c.motivo === 'SIN_CANCHA_DISPONIBLE');
  assert.ok(confCancha, 'Debe haber un conflicto de tipo SIN_CANCHA_DISPONIBLE');

  assert.strictEqual(pre2.permiteInicioEmergencia, true, 'Debe permitir inicio de emergencia porque no hay zonas manuales');
  assert.ok(pre2.planEmergenciaId, 'Debe proveer planEmergenciaId');

  // Iniciar en modo emergencia
  await organizadorService.iniciarTorneoMultiCategoria(org.id, torneo.id, pre2.planEmergenciaId);

  const zonaDb = await prisma.zona.findFirst({
    where: { categoriaId: cat.id },
    include: { partidos: true },
  });
  assert.ok(zonaDb, 'La zona debe existir en DB');
  assert.strictEqual(zonaDb.partidos.length, 3, 'Deben existir los 3 partidos en DB');
  const sinCancha = zonaDb.partidos.filter((p) => p.sinHorarioAsignado);
  assert.strictEqual(sinCancha.length, 1, 'Exactamente 1 partido debe haber quedado en pendientes (sin horario)');
  assert.ok(sinCancha[0].pareja1Id !== null, 'Partido sin cancha no debe tener pareja1Id null');
  assert.ok(sinCancha[0].pareja2Id !== null, 'Partido sin cancha no debe tener pareja2Id null');
  console.log('   ✓ Test 2 superado.');
}

// ---------------------------------------------------------------------------
// TEST 3: Destrabe parcial (zona de 3)
// ---------------------------------------------------------------------------
async function test3_zona3_destrabeParcial() {
  console.log('\n▶️ TEST 3: Destrabe parcial en zona de 3...');
  const { org, torneo, cat } = await setupBaseClub({ cantidadCanchas: 1, viernesFin: '22:00' });

  const p1 = await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: 'A1', jugador2: 'A2', orden: 1 } });
  const p2 = await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: 'B1', jugador2: 'B2', orden: 2 } });
  const p3 = await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: 'C1', jugador2: 'C2', orden: 3 } });

  // Nace incompatible: P1 y P2 en 18:00; P3 en 20:30
  await prisma.slotPareja.createMany({
    data: [
      { parejaId: p1.id, slotId: 'Viernes-18:00' },
      { parejaId: p2.id, slotId: 'Viernes-18:00' },
      { parejaId: p3.id, slotId: 'Viernes-20:30' },
    ],
  });

  const pre1 = await organizadorService.preCheckInicioTorneo(org.id, torneo.id);
  assert.strictEqual(pre1.bloqueado, true);
  const conf1 = pre1.conflictos[0]?.partidosSinHorario?.find((c) => c.motivo === 'ZONA_MANUAL_INCOMPLETA');
  assert.ok(conf1, 'Debe nacer con conflicto ZONA_MANUAL_INCOMPLETA');
  assert.strictEqual(pre1.permiteInicioEmergencia, false);

  // Destrabe parcial: solo P1 comparte slot con P3. P2 sigue sin compartir con P3
  await disponibilidadService.setDisponibilidad(org.id, p1.id, ['Viernes-18:00', 'Viernes-20:30']);

  const pre2 = await organizadorService.preCheckInicioTorneo(org.id, torneo.id, { isReCheck: true });
  assert.strictEqual(pre2.bloqueado, true, 'Debe seguir bloqueado');
  assert.strictEqual(pre2.permiteInicioEmergencia, false, 'permiteInicioEmergencia debe ser false');

  const confManual = pre2.conflictos[0]?.partidosSinHorario?.find((c) => c.motivo === 'ZONA_MANUAL_INCOMPLETA');
  assert.ok(confManual, 'Debe existir ZONA_MANUAL_INCOMPLETA');
  const crucesIncomp = confManual.crucesIncompatibles || [];
  const cruceP2P3 = crucesIncomp.find(
    (c) => (c.p1Id === p2.id && c.p2Id === p3.id) || (c.p1Id === p3.id && c.p2Id === p2.id)
  );
  assert.ok(cruceP2P3, 'crucesIncompatibles debe señalar específicamente a P2 y P3');

  // Intentar iniciar sin plan válido debe fallar y la DB debe quedar sin partidos
  await assert.rejects(
    async () => {
      await organizadorService.iniciarTorneoMultiCategoria(org.id, torneo.id, pre2.planId || 'invalido');
    },
    /plan|bloqueado|invalido/i,
    'iniciarTorneoMultiCategoria debe fallar si está bloqueado por zona manual'
  );

  const partidosCount = await prisma.partido.count({ where: { categoriaId: cat.id } });
  assert.strictEqual(partidosCount, 0, 'No deben haberse creado partidos en la base');
  console.log('   ✓ Test 3 superado.');
}

// ---------------------------------------------------------------------------
// TEST 4: Zona manual de 4 parejas (pairwise sin cuádruple vs con cuádruple)
// ---------------------------------------------------------------------------
async function test4_zona4_miniBracketDestrabe() {
  console.log('\n▶️ TEST 4: Zona manual de 4 parejas (pairwise sin cuádruple vs con cuádruple)...');
  const { org, torneo, cat } = await setupBaseClub({
    cantidadCanchas: 1,
    viernesInicio: '19:15',
    viernesFin: '21:45',
    sabadoInicio: null,
    sabadoFin: null,
  });

  const p1 = await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: 'A1', jugador2: 'A2', orden: 1 } });
  const p2 = await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: 'B1', jugador2: 'B2', orden: 2 } });
  const p3 = await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: 'C1', jugador2: 'C2', orden: 3 } });
  const p4 = await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: 'D1', jugador2: 'D2', orden: 4 } });

  // Nace incompatible: P1 y P2 en 19:15; P3 y P4 en 20:30 (disjuntos)
  await prisma.slotPareja.createMany({
    data: [
      { parejaId: p1.id, slotId: 'Viernes-19:15' },
      { parejaId: p2.id, slotId: 'Viernes-19:15' },
      { parejaId: p3.id, slotId: 'Viernes-20:30' },
      { parejaId: p4.id, slotId: 'Viernes-20:30' },
    ],
  });

  const pre1 = await organizadorService.preCheckInicioTorneo(org.id, torneo.id);
  assert.strictEqual(pre1.bloqueado, true);
  const conf1 = pre1.conflictos[0]?.partidosSinHorario?.find((c) => c.motivo === 'ZONA_MANUAL_INCOMPLETA');
  assert.ok(conf1, 'Debe nacer con conflicto ZONA_MANUAL_INCOMPLETA');

  // Paso intermedio: Destrabe pairwise sin ventana cuádruple disponible (ambos turnos ocupados por P1 y P2)
  const slotsPairwise = ['Viernes-19:15', 'Viernes-20:30'];
  await disponibilidadService.setDisponibilidad(org.id, p1.id, slotsPairwise);
  await disponibilidadService.setDisponibilidad(org.id, p2.id, slotsPairwise);
  await disponibilidadService.setDisponibilidad(org.id, p3.id, slotsPairwise);
  await disponibilidadService.setDisponibilidad(org.id, p4.id, slotsPairwise);

  const prePairwise = await organizadorService.preCheckInicioTorneo(org.id, torneo.id, { isReCheck: true });
  assert.strictEqual(prePairwise.bloqueado, true, 'Pairwise sin ventana cuádruple debe seguir bloqueado');
  assert.strictEqual(prePairwise.permiteInicioEmergencia, true, 'Debe permitir inicio de emergencia');
  const confP3P4 = prePairwise.conflictos[0]?.partidosSinHorario?.filter((c) => c.motivo === 'PARTIDO_SIN_HORARIO');
  assert.strictEqual(confP3P4?.length, 2, 'P3 y P4 deben reportarse como PARTIDO_SIN_HORARIO');
  const confManual = prePairwise.conflictos[0]?.partidosSinHorario?.find((c) => c.motivo === 'ZONA_MANUAL_INCOMPLETA');
  assert.strictEqual(confManual, undefined, 'NO debe haber conflicto ZONA_MANUAL_INCOMPLETA');

  // Inicio de emergencia con pairwise destrabado (P3/P4 sin horario en base)
  await organizadorService.iniciarTorneoMultiCategoria(org.id, torneo.id, prePairwise.planEmergenciaId);

  const zonaDb = await prisma.zona.findFirst({
    where: { categoriaId: cat.id },
    include: { partidos: true },
  });
  assert.ok(zonaDb, 'La zona debe existir en DB');
  assert.strictEqual(zonaDb.partidos.length, 4, 'Deben existir 4 partidos en la zona MINI_BRACKET');

  const r1 = zonaDb.partidos.filter((p) => p.posicionEnRonda <= 2);
  const r2 = zonaDb.partidos.filter((p) => p.posicionEnRonda >= 3);
  assert.strictEqual(r1.length, 2, 'Ronda 1 debe tener 2 partidos');
  assert.strictEqual(r2.length, 2, 'Ronda 2 debe tener 2 partidos');

  for (const p of r1) {
    assert.ok(p.pareja1Id !== null && p.pareja2Id !== null, `P${p.posicionEnRonda} no debe tener parejas null`);
    assert.ok(!p.sinHorarioAsignado && p.fechaHora && p.canchaNumero, `P${p.posicionEnRonda} debe tener horario asignado`);
  }
  for (const p of r2) {
    assert.strictEqual(p.pareja1Id, null, `P${p.posicionEnRonda} debe tener pareja1Id null`);
    assert.strictEqual(p.pareja2Id, null, `P${p.posicionEnRonda} debe tener pareja2Id null`);
    assert.ok(p.origenPareja1, `P${p.posicionEnRonda} debe tener origenPareja1 definido`);
    assert.ok(p.origenPareja2, `P${p.posicionEnRonda} debe tener origenPareja2 definido`);
    assert.strictEqual(p.sinHorarioAsignado, true, `P${p.posicionEnRonda} debe quedar con sinHorarioAsignado=true en inicio emergencia`);
    assert.strictEqual(p.fechaHora, null, `P${p.posicionEnRonda} fechaHora debe ser null`);
    assert.strictEqual(p.canchaNumero, null, `P${p.posicionEnRonda} canchaNumero debe ser null`);
  }

  // Segunda parte: Destrabe completo con ventana cuádruple en un torneo limpio
  const setupQuad = await setupBaseClub({ cantidadCanchas: 2, viernesFin: '23:30' });
  const qTorneo = setupQuad.torneo;
  const qCat = setupQuad.cat;
  const qP1 = await prisma.pareja.create({ data: { categoriaId: qCat.id, jugador1: 'QA1', jugador2: 'QA2', orden: 1 } });
  const qP2 = await prisma.pareja.create({ data: { categoriaId: qCat.id, jugador1: 'QB1', jugador2: 'QB2', orden: 2 } });
  const qP3 = await prisma.pareja.create({ data: { categoriaId: qCat.id, jugador1: 'QC1', jugador2: 'QC2', orden: 3 } });
  const qP4 = await prisma.pareja.create({ data: { categoriaId: qCat.id, jugador1: 'QD1', jugador2: 'QD2', orden: 4 } });

  // Nace manual
  await prisma.slotPareja.createMany({
    data: [
      { parejaId: qP1.id, slotId: 'Viernes-18:00' },
      { parejaId: qP2.id, slotId: 'Viernes-18:00' },
      { parejaId: qP3.id, slotId: 'Viernes-19:15' },
      { parejaId: qP4.id, slotId: 'Viernes-19:15' },
    ],
  });
  await organizadorService.preCheckInicioTorneo(setupQuad.org.id, qTorneo.id);

  // Destrabe con ventana cuádruple
  const fullSlots4 = ['Viernes-18:00', 'Viernes-19:15', 'Viernes-20:30', 'Viernes-21:45'];
  await disponibilidadService.setDisponibilidadDoble(setupQuad.org.id, qP1.id, fullSlots4, qP2.id, fullSlots4);
  await disponibilidadService.setDisponibilidadDoble(setupQuad.org.id, qP3.id, fullSlots4, qP4.id, fullSlots4);

  const preQuad = await organizadorService.preCheckInicioTorneo(setupQuad.org.id, qTorneo.id, { isReCheck: true });
  assert.strictEqual(preQuad.bloqueado, false, 'Con ventana cuádruple debe estar 100% desbloqueado');
  await organizadorService.iniciarTorneoMultiCategoria(setupQuad.org.id, qTorneo.id, preQuad.planId);

  const zonaQuadDb = await prisma.zona.findFirst({
    where: { categoriaId: qCat.id },
    include: { partidos: true },
  });
  assert.strictEqual(zonaQuadDb.partidos.length, 4);
  for (const p of zonaQuadDb.partidos) {
    assert.strictEqual(p.sinHorarioAsignado, false, `Partido P${p.posicionEnRonda} debe tener horario asignado`);
    assert.ok(p.fechaHora !== null, `Partido P${p.posicionEnRonda} debe tener fechaHora`);
    assert.ok(p.canchaNumero !== null, `Partido P${p.posicionEnRonda} debe tener canchaNumero`);
  }

  const qP1Match = zonaQuadDb.partidos.find((p) => p.posicionEnRonda === 1);
  const qP2Match = zonaQuadDb.partidos.find((p) => p.posicionEnRonda === 2);
  const qP3Match = zonaQuadDb.partidos.find((p) => p.posicionEnRonda === 3);
  const qP4Match = zonaQuadDb.partidos.find((p) => p.posicionEnRonda === 4);
  const maxR1End = Math.max(new Date(qP1Match.fechaHora).getTime(), new Date(qP2Match.fechaHora).getTime()) + (75 * 60 * 1000);
  assert.ok(new Date(qP3Match.fechaHora).getTime() >= maxR1End, 'P3 debe respetar descanso mínimo de 75 min post R1');
  assert.ok(new Date(qP4Match.fechaHora).getTime() >= maxR1End, 'P4 debe respetar descanso mínimo de 75 min post R1');

  console.log('   ✓ Test 4 superado.');
}

// ---------------------------------------------------------------------------
// TEST 5: Ciclo destrabar, quitar slot, re-destrabar (idempotencia y reversibilidad)
// ---------------------------------------------------------------------------
async function test5_cicloDestrabeReaperturaIdempotencia() {
  console.log('\n▶️ TEST 5: Ciclo destrabar -> reapertura -> re-destrabar...');
  const { org, torneo, cat } = await setupBaseClub({ cantidadCanchas: 1, viernesFin: '22:00' });

  const p1 = await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: 'A1', jugador2: 'A2', orden: 1 } });
  const p2 = await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: 'B1', jugador2: 'B2', orden: 2 } });
  const p3 = await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: 'C1', jugador2: 'C2', orden: 3 } });

  // Nace incompatible: P1 y P2 en 18:00, P3 en 20:30
  await prisma.slotPareja.createMany({
    data: [
      { parejaId: p1.id, slotId: 'Viernes-18:00' },
      { parejaId: p2.id, slotId: 'Viernes-18:00' },
      { parejaId: p3.id, slotId: 'Viernes-20:30' },
    ],
  });

  // 1. Inicial
  const pre1 = await organizadorService.preCheckInicioTorneo(org.id, torneo.id);
  assert.strictEqual(pre1.bloqueado, true);
  const conf1 = pre1.conflictos[0]?.partidosSinHorario?.find((c) => c.motivo === 'ZONA_MANUAL_INCOMPLETA');
  assert.ok(conf1, 'Debe nacer con conflicto ZONA_MANUAL_INCOMPLETA');

  // 2. Destrabe
  const fullSlots = ['Viernes-18:00', 'Viernes-19:15', 'Viernes-20:30'];
  await disponibilidadService.setDisponibilidadDoble(org.id, p1.id, fullSlots, p2.id, fullSlots);
  await disponibilidadService.setDisponibilidad(org.id, p3.id, fullSlots);
  const pre2 = await organizadorService.preCheckInicioTorneo(org.id, torneo.id, { isReCheck: true });
  assert.strictEqual(pre2.bloqueado, false, 'Pre-check 2 debe estar desbloqueado');

  // 3. Reapertura: dejar un inicio válido y disjunto. Viernes-21:45 no entra antes
  // del cierre de las 22 y se filtraba: dejaba a P3 libre, no incompatible.
  await disponibilidadService.setDisponibilidad(org.id, p3.id, ['Sabado-09:00']);
  const pre3 = await organizadorService.preCheckInicioTorneo(org.id, torneo.id, { isReCheck: true });
  assert.strictEqual(pre3.bloqueado, true, 'Pre-check 3 debe volver a bloquearse');
  assert.strictEqual(pre3.permiteInicioEmergencia, false);
  const conf3 = pre3.conflictos[0]?.partidosSinHorario?.find((c) => c.motivo === 'ZONA_MANUAL_INCOMPLETA');
  assert.ok(conf3, 'Debe volver a mostrar ZONA_MANUAL_INCOMPLETA');

  // 4. Re-destrabe
  await disponibilidadService.setDisponibilidad(org.id, p3.id, fullSlots);
  const pre4 = await organizadorService.preCheckInicioTorneo(org.id, torneo.id, { isReCheck: true });
  assert.strictEqual(pre4.bloqueado, false, 'Pre-check 4 debe volver a desbloquearse');

  // 5. Iniciar y validar que no haya duplicados
  await organizadorService.iniciarTorneoMultiCategoria(org.id, torneo.id, pre4.planId);

  const zonaDb = await prisma.zona.findFirst({
    where: { categoriaId: cat.id },
    include: { partidos: true, zonaParejas: true },
  });
  assert.strictEqual(zonaDb.zonaParejas.length, 3, 'Debe haber exactamente 3 zonaParejas sin duplicar');
  assert.strictEqual(zonaDb.partidos.length, 3, 'Debe haber exactamente 3 partidos sin duplicar');
  console.log('   ✓ Test 5 superado.');
}

// ---------------------------------------------------------------------------
// TEST 6A: Zona sinGrupo de 1 pareja (permanece bloqueada)
// ---------------------------------------------------------------------------
async function test6a_zonaManual1ParejaBloqueada() {
  console.log('\n▶️ TEST 6A: Zona sinGrupo de 1 pareja (permanece bloqueada)...');
  const { org, torneo, cat } = await setupBaseClub({ cantidadCanchas: 2, viernesFin: '22:00' });

  // 4 parejas: 3 compatibles forman Zona A; la 4ta aislada cae en sinGrupo como zona manual de 1 pareja
  const p1 = await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: 'A1', jugador2: 'A2', orden: 1 } });
  const p2 = await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: 'B1', jugador2: 'B2', orden: 2 } });
  const p3 = await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: 'C1', jugador2: 'C2', orden: 3 } });
  const p4 = await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: 'D1', jugador2: 'D2', orden: 4 } });

  await prisma.slotPareja.createMany({
    data: [
      { parejaId: p1.id, slotId: 'Viernes-18:00' },
      { parejaId: p2.id, slotId: 'Viernes-18:00' },
      { parejaId: p3.id, slotId: 'Viernes-18:00' },
      { parejaId: p4.id, slotId: 'Viernes-20:30' },
    ],
  });

  // Zona A con 3 parejas y Zona Manual con 1 pareja aislada
  const zA = await prisma.zona.create({
    data: { categoriaId: cat.id, nombre: 'Zona A', clasifican: 2, formato: 'ROUND_ROBIN' },
  });
  await prisma.zonaPareja.createMany({
    data: [
      { zonaId: zA.id, parejaId: p1.id },
      { zonaId: zA.id, parejaId: p2.id },
      { zonaId: zA.id, parejaId: p3.id },
    ],
  });
  const zManual = await prisma.zona.create({
    data: { categoriaId: cat.id, nombre: 'Zona Manual', clasifican: 2, formato: 'ROUND_ROBIN', requiereArmadoManual: true },
  });
  await prisma.zonaPareja.create({
    data: { zonaId: zManual.id, parejaId: p4.id },
  });

  const pre1 = await organizadorService.preCheckInicioTorneo(org.id, torneo.id, { forceReset: true });
  assert.strictEqual(pre1.bloqueado, true, 'Pre-check debe estar bloqueado por zona manual de 1 pareja');
  assert.strictEqual(pre1.permiteInicioEmergencia, false, 'permiteInicioEmergencia debe ser false');
  const conf1 = pre1.conflictos[0]?.partidosSinHorario?.find((c) => c.motivo === 'ZONA_MANUAL_INCOMPLETA');
  assert.ok(conf1, 'Debe reportar motivo ZONA_MANUAL_INCOMPLETA');

  // Destrabe simulado para P4 (le damos la misma franja de todos)
  await disponibilidadService.setDisponibilidad(org.id, p4.id, ['Viernes-18:00', 'Viernes-19:15', 'Viernes-20:30']);

  const pre2 = await organizadorService.preCheckInicioTorneo(org.id, torneo.id, { isReCheck: true });
  // Comportamiento esperado: Una zona de 1 pareja en sinGrupo NO puede destrabarse automáticamente.
  // Debe permanecer bloqueada como ZONA_MANUAL_INCOMPLETA.
  assert.strictEqual(pre2.bloqueado, true, 'Zona manual de 1 pareja debe permanecer bloqueada');
  assert.strictEqual(pre2.permiteInicioEmergencia, false, 'permiteInicioEmergencia debe seguir en false');
  const conf2 = pre2.conflictos[0]?.partidosSinHorario?.find((c) => c.motivo === 'ZONA_MANUAL_INCOMPLETA');
  assert.ok(conf2, 'Debe seguir reportando ZONA_MANUAL_INCOMPLETA para zona de 1 pareja');

  console.log('   ✓ Test 6A superado.');
}

// ---------------------------------------------------------------------------
// TEST 6B: Zona sinGrupo de 5+ parejas (permanece bloqueada)
// ---------------------------------------------------------------------------
async function test6b_zonasManuales5MasParejasBloqueadas() {
  console.log('\n▶️ TEST 6B: Zona sinGrupo de 5+ parejas (permanecen bloqueadas)...');
  const { org, torneo, cat } = await setupBaseClub({ cantidadCanchas: 2, viernesFin: '22:00' });

  const pList = [];
  const slotsDisjuntos = ['Viernes-18:00', 'Viernes-19:15', 'Viernes-20:30', 'Sabado-09:00', 'Sabado-10:15'];
  for (let i = 1; i <= 5; i++) {
    const p = await prisma.pareja.create({
      data: { categoriaId: cat.id, jugador1: `J${i}A`, jugador2: `J${i}B`, orden: i },
    });
    pList.push(p);
    await prisma.slotPareja.create({ data: { parejaId: p.id, slotId: slotsDisjuntos[i - 1] } });
  }

  const pre1 = await organizadorService.preCheckInicioTorneo(org.id, torneo.id);
  assert.strictEqual(pre1.bloqueado, true, 'Pre-check inicial de 5 parejas incompatibles debe estar bloqueado');
  assert.strictEqual(pre1.permiteInicioEmergencia, false, 'permiteInicioEmergencia debe ser false');
  const conf1 = pre1.conflictos[0]?.partidosSinHorario?.find((c) => c.motivo === 'ZONA_MANUAL_INCOMPLETA');
  assert.ok(conf1, 'Debe nacer como ZONA_MANUAL_INCOMPLETA');

  // Destrabe total simulado: todas las 5 parejas comparten las mismas franjas
  const fullSlots = ['Viernes-18:00', 'Viernes-19:15', 'Viernes-20:30'];
  for (const p of pList) {
    await disponibilidadService.setDisponibilidad(org.id, p.id, fullSlots);
  }

  const pre2 = await organizadorService.preCheckInicioTorneo(org.id, torneo.id, { isReCheck: true });
  // Comportamiento esperado: Zonas de 5+ NO pueden destrabarse por este mecanismo automático.
  // Debe permanecer bloqueada como ZONA_MANUAL_INCOMPLETA.
  assert.strictEqual(pre2.bloqueado, true, 'Zona manual de 5 parejas debe permanecer bloqueada');
  assert.strictEqual(pre2.permiteInicioEmergencia, false, 'No debe permitir inicio de emergencia con 5 parejas manuales');
  const conf2 = pre2.conflictos[0]?.partidosSinHorario?.find((c) => c.motivo === 'ZONA_MANUAL_INCOMPLETA');
  assert.ok(conf2, 'Debe seguir reportando ZONA_MANUAL_INCOMPLETA para zona de 5 parejas');

  const partidosCount = await prisma.partido.count({ where: { categoriaId: cat.id } });
  assert.strictEqual(partidosCount, 0, 'No deben haberse creado partidos en la base para 5 parejas manuales');
  console.log('   ✓ Test 6B superado.');
}

// ---------------------------------------------------------------------------
// TEST 6C: Zona de 5 bloqueada => ampliar disponibilidad => pre-check con forceReset => re-particiona en zonas válidas => iniciarTorneoMultiCategoria funciona
// ---------------------------------------------------------------------------
async function test6c_zona5_reparticionConForceReset() {
  console.log('\n▶️ TEST 6C: Zona de 5 bloqueada -> forceReset -> re-particiona -> iniciarTorneoMultiCategoria...');
  const { org, torneo, cat } = await setupBaseClub({ cantidadCanchas: 2, viernesFin: '23:30' });

  // 5 parejas que nacen con disponibilidad disjunta
  const slotsDisjuntos = [
    'Viernes-18:00',
    'Viernes-19:15',
    'Viernes-20:30',
    'Viernes-21:45',
    'Sabado-09:00',
  ];

  const pList = [];
  for (let i = 1; i <= 5; i++) {
    const p = await prisma.pareja.create({
      data: { categoriaId: cat.id, jugador1: `J${i}A`, jugador2: `J${i}B`, orden: i },
    });
    pList.push(p);
    await prisma.slotPareja.create({ data: { parejaId: p.id, slotId: slotsDisjuntos[i - 1] } });
  }

  // Pre-check inicial: todos caen en sinGrupo (5 parejas manuales) -> Bloqueado ZONA_MANUAL_INCOMPLETA
  const pre1 = await organizadorService.preCheckInicioTorneo(org.id, torneo.id);
  assert.strictEqual(pre1.bloqueado, true, 'Pre-check inicial debe estar bloqueado');
  assert.strictEqual(pre1.permiteInicioEmergencia, false, 'No debe permitir emergencia con zona de 5');
  const conf1 = pre1.conflictos[0]?.partidosSinHorario?.find((c) => c.motivo === 'ZONA_MANUAL_INCOMPLETA');
  assert.ok(conf1, 'Debe nacer como ZONA_MANUAL_INCOMPLETA');

  // Ampliar disponibilidad de las 5 parejas a franjas amplias comunes
  const ampliosSlots = [
    'Viernes-18:00',
    'Viernes-19:15',
    'Viernes-20:30',
    'Viernes-21:45',
    'Sabado-09:00',
    'Sabado-10:15',
  ];
  for (const p of pList) {
    await disponibilidadService.setDisponibilidad(org.id, p.id, ampliosSlots);
  }

  // Pre-check con forceReset: true -> re-ejecuta iniciarCategoriaConDisponibilidad desde cero
  const preReset = await organizadorService.preCheckInicioTorneo(org.id, torneo.id, { forceReset: true });
  assert.strictEqual(preReset.bloqueado, false, 'Pre-check con forceReset debe desbloquearse');
  assert.ok(preReset.planId, 'Debe devolver un planId válido');

  // Iniciar torneo con el plan generado por el forceReset
  await organizadorService.iniciarTorneoMultiCategoria(org.id, torneo.id, preReset.planId);

  // Verificaciones en la base de datos
  const catDb = await prisma.categoria.findUnique({
    where: { id: cat.id },
    include: {
      zonas: {
        include: { partidos: true, zonaParejas: true },
      },
    },
  });
  assert.strictEqual(catDb.estado, 'EN_CURSO', 'Categoría debe estar EN_CURSO');
  assert.strictEqual(catDb.zonas.length, 2, '5 parejas deben haberse re-particionado en 2 zonas válidas (3 y 2)');

  for (const z of catDb.zonas) {
    assert.strictEqual(z.requiereArmadoManual, false, `Zona ${z.nombre} debe tener requiereArmadoManual: false`);
    assert.ok(z.partidos.length > 0, `Zona ${z.nombre} debe tener partidos generados`);
    for (const p of z.partidos) {
      assert.ok(p.pareja1Id !== null, `Partido ${p.id} debe tener pareja1Id`);
      assert.ok(p.pareja2Id !== null, `Partido ${p.id} debe tener pareja2Id`);
    }
  }

  console.log('   ✓ Test 6C superado.');
}

// ---------------------------------------------------------------------------
// TEST 7: Zona manual de 2 parejas
// ---------------------------------------------------------------------------
async function test7_zona2_destrabeGenera1Partido() {
  console.log('\n▶️ TEST 7: Zona manual de 2 parejas...');
  const { org, torneo, cat } = await setupBaseClub({ cantidadCanchas: 1, viernesFin: '22:00' });

  const p1 = await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: 'A1', jugador2: 'A2', orden: 1 } });
  const p2 = await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: 'B1', jugador2: 'B2', orden: 2 } });

  // Incompatibles al inicio
  await prisma.slotPareja.createMany({
    data: [
      { parejaId: p1.id, slotId: 'Viernes-18:00' },
      { parejaId: p2.id, slotId: 'Viernes-20:30' },
    ],
  });

  const pre1 = await organizadorService.preCheckInicioTorneo(org.id, torneo.id);
  assert.strictEqual(pre1.bloqueado, true);
  const conf1 = pre1.conflictos[0]?.partidosSinHorario?.find((c) => c.motivo === 'ZONA_MANUAL_INCOMPLETA');
  assert.ok(conf1, 'Debe nacer como ZONA_MANUAL_INCOMPLETA');

  // Destrabe total
  await disponibilidadService.setDisponibilidadDoble(org.id, p1.id, ['Viernes-18:00'], p2.id, ['Viernes-18:00']);

  const pre2 = await organizadorService.preCheckInicioTorneo(org.id, torneo.id, { isReCheck: true });
  assert.strictEqual(pre2.bloqueado, false, 'Pre-check 2 debe desbloquearse');

  await organizadorService.iniciarTorneoMultiCategoria(org.id, torneo.id, pre2.planId);

  const zonaDb = await prisma.zona.findFirst({
    where: { categoriaId: cat.id },
    include: { partidos: true },
  });
  assert.ok(zonaDb, 'La zona debe existir en DB');
  assert.strictEqual(zonaDb.requiereArmadoManual, false, 'requiereArmadoManual debe ser false');
  assert.strictEqual(zonaDb.partidos.length, 1, 'Zona de 2 debe tener exactamente 1 partido en DB');
  console.log('   ✓ Test 7 superado.');
}

// ---------------------------------------------------------------------------
// TEST 8: iniciarCategoriaConDisponibilidad real (sin pre-check) con zona manual
// ---------------------------------------------------------------------------
async function test8_inicioRealDirectoZonaManual() {
  console.log('\n▶️ TEST 8: iniciarCategoriaConDisponibilidad real con zona manual...');
  const { org, torneo, cat } = await setupBaseClub({ cantidadCanchas: 1, viernesFin: '22:00' });

  const p1 = await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: 'A1', jugador2: 'A2', orden: 1 } });
  const p2 = await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: 'B1', jugador2: 'B2', orden: 2 } });
  const p3 = await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: 'C1', jugador2: 'C2', orden: 3 } });

  // Incompatibles: caen en sinGrupo (zona manual)
  await prisma.slotPareja.createMany({
    data: [
      { parejaId: p1.id, slotId: 'Viernes-18:00' },
      { parejaId: p2.id, slotId: 'Viernes-18:00' },
      { parejaId: p3.id, slotId: 'Viernes-20:30' },
    ],
  });

  // Ejecución directa del endpoint real (sin pre-check)
  const zonaService = require('../src/services/zona.service');
  await zonaService.iniciarCategoriaConDisponibilidad(org.id, cat.id);

  // 1. Los partidos existen en la base con sinHorarioAsignado true y requiereArmadoManual true
  const zonaDb = await prisma.zona.findFirst({
    where: { categoriaId: cat.id },
    include: { partidos: true, zonaParejas: true },
  });
  assert.ok(zonaDb, 'La zona debe existir en la base de datos');
  assert.strictEqual(zonaDb.requiereArmadoManual, true, 'requiereArmadoManual debe ser true');
  assert.strictEqual(zonaDb.partidos.length, 3, `Deben existir 3 partidos en DB pero hay ${zonaDb.partidos.length}`);
  for (const p of zonaDb.partidos) {
    assert.strictEqual(p.sinHorarioAsignado, true, `Partido ${p.id} debe tener sinHorarioAsignado true`);
    assert.strictEqual(p.fechaHora, null, `Partido ${p.id} no debe tener fechaHora asignada`);
    assert.strictEqual(p.canchaNumero, null, `Partido ${p.id} no debe tener canchaNumero asignada`);
    assert.ok(p.pareja1Id !== null && p.pareja2Id !== null, `Partido ${p.id} no debe tener parejas null`);
  }

  // 2. asignarHorariosAutomatico NO los agenda
  await zonaService.asignarHorariosAutomatico(org.id, cat.id);
  const zonaDbPostAsignar = await prisma.zona.findUnique({
    where: { id: zonaDb.id },
    include: { partidos: true },
  });
  for (const p of zonaDbPostAsignar.partidos) {
    assert.strictEqual(p.sinHorarioAsignado, true, 'asignarHorariosAutomatico no debe agendar partidos de zona manual');
    assert.strictEqual(p.fechaHora, null, 'fechaHora debe seguir siendo null');
    assert.strictEqual(p.canchaNumero, null, 'canchaNumero debe seguir siendo null');
  }

  // 3. agregarParejaAZona / regenerarPartidosZona los reemplazan sin duplicar
  // Para agregarParejaAZona, el torneo debe estar EN_CURSO
  await prisma.torneo.update({ where: { id: torneo.id }, data: { estado: 'EN_CURSO' } });
  await zonaService.agregarParejaAZona(org.id, cat.id, {
    zonaDestinoId: zonaDb.id,
    jugador1: 'D1',
    jugador2: 'D2',
    slotIds: ['Viernes-18:00'],
  });

  const zonaDbPostAgregar = await prisma.zona.findUnique({
    where: { id: zonaDb.id },
    include: { partidos: true, zonaParejas: true },
  });
  // Al pasar a 4 parejas (MINI_BRACKET), regenerarPartidosZona debe crear exactamente 4 partidos (no 3 + 4 = 7)
  assert.strictEqual(zonaDbPostAgregar.zonaParejas.length, 4, 'La zona debe tener 4 parejas');
  assert.strictEqual(zonaDbPostAgregar.partidos.length, 4, `regenerarPartidosZona debe reemplazar los partidos: esperados 4, encontrados ${zonaDbPostAgregar.partidos.length}`);
  console.log('   ✓ Test 8 superado.');
}

// ---------------------------------------------------------------------------
// TEST 9: Aislamiento de snapshots en planesCache (Fix A) e idempotencia
// ---------------------------------------------------------------------------
async function test9_planesCacheAislamientoEIdempotencia() {
  console.log('\n▶️ TEST 9: Aislamiento de planesCache y re-check idempotente...');
  // Club con 1 cancha y 2 slots (18:00 a 20:30)
  const { org, torneo, cat } = await setupBaseClub({ cantidadCanchas: 1, viernesFin: '20:30' });

  const p1 = await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: 'A1', jugador2: 'A2', orden: 1 } });
  const p2 = await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: 'B1', jugador2: 'B2', orden: 2 } });
  const p3 = await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: 'C1', jugador2: 'C2', orden: 3 } });

  // Incompatibles: P1 y P2 en 18:00, P3 en 20:30
  await prisma.slotPareja.createMany({
    data: [
      { parejaId: p1.id, slotId: 'Viernes-18:00' },
      { parejaId: p2.id, slotId: 'Viernes-18:00' },
      { parejaId: p3.id, slotId: 'Viernes-20:30' },
    ],
  });

  const pre1 = await organizadorService.preCheckInicioTorneo(org.id, torneo.id);
  assert.strictEqual(pre1.bloqueado, true);

  // Destrabe: todos cubren 18:00 y 19:15
  const slotsCompat = ['Viernes-18:00', 'Viernes-19:15'];
  await disponibilidadService.setDisponibilidadDoble(org.id, p1.id, slotsCompat, p2.id, slotsCompat);
  await disponibilidadService.setDisponibilidad(org.id, p3.id, slotsCompat);

  const pre2 = await organizadorService.preCheckInicioTorneo(org.id, torneo.id, { isReCheck: true });
  assert.ok(pre2.planEmergenciaId, 'Debe emitir planEmergenciaId');

  const planViejoId = pre2.planEmergenciaId;
  const planViejoAntes = organizadorService.planesCache.get(planViejoId);
  assert.ok(planViejoAntes, 'El plan de emergencia debe estar en planesCache');
  const zonaViejaAntes = planViejoAntes.categoriasPlan[0].zonas[0];
  const agendadosAntes = zonaViejaAntes.partidos.filter((p) => !p.sinHorarioAsignado && p.fechaHora !== null);
  assert.strictEqual(agendadosAntes.length, 2, 'Deben existir 2 partidos con cancha/fecha asignados en el plan de emergencia');

  // Ahora el organizador quita una franja y vuelve incompatible la zona
  await disponibilidadService.setDisponibilidad(org.id, p3.id, ['Viernes-20:30']);

  // PreCheck 3 revierte la zona
  const pre3 = await organizadorService.preCheckInicioTorneo(org.id, torneo.id, { isReCheck: true });
  assert.strictEqual(pre3.bloqueado, true, 'Pre-check 3 debe estar bloqueado');

  // Comprobar si el plan de emergencia viejo conservó sus fechas/canchas o si fue mutado
  const planViejoDespues = organizadorService.planesCache.get(planViejoId);
  assert.ok(planViejoDespues, 'El plan viejo debe seguir existiendo en planesCache');
  const zonaViejaDespues = planViejoDespues.categoriasPlan[0].zonas[0];
  const agendadosDespues = zonaViejaDespues.partidos.filter((p) => !p.sinHorarioAsignado && p.fechaHora !== null);
  assert.strictEqual(
    agendadosDespues.length,
    2,
    `El plan viejo en planesCache debe conservar 2 partidos agendados (encontrados: ${agendadosDespues.length}). Si da 0, fue mutado por el re-check posterior.`
  );

  // Comprobar qué pasa al iniciar con ese plan viejo:
  // Se bloquea con 409 Conflict porque las disponibilidades cambiaron y el fingerprint no coincide
  let errorInicio = null;
  try {
    await organizadorService.iniciarTorneoMultiCategoria(org.id, torneo.id, planViejoId);
  } catch (err) {
    errorInicio = err;
  }
  assert.ok(errorInicio, 'Debe bloquear el inicio con un plan viejo tras cambios de disponibilidad');
  assert.strictEqual(errorInicio.statusCode, 409, 'Debe fallar con código 409 Conflict');
  assert.ok(
    errorInicio.message.includes('cambiaron desde la última verificación'),
    'El mensaje debe indicar que los datos cambiaron'
  );

  // Idempotencia: en una nueva sesión, dos re-checks seguidos sin cambios producen el mismo plan
  const clubIdemp = await setupBaseClub({ cantidadCanchas: 2, viernesFin: '22:00' });
  const ip1 = await prisma.pareja.create({ data: { categoriaId: clubIdemp.cat.id, jugador1: 'IA1', jugador2: 'IA2', orden: 1 } });
  const ip2 = await prisma.pareja.create({ data: { categoriaId: clubIdemp.cat.id, jugador1: 'IB1', jugador2: 'IB2', orden: 2 } });
  await prisma.slotPareja.createMany({
    data: [
      { parejaId: ip1.id, slotId: 'Viernes-18:00' },
      { parejaId: ip2.id, slotId: 'Viernes-18:00' },
    ],
  });
  await organizadorService.preCheckInicioTorneo(clubIdemp.org.id, clubIdemp.torneo.id);

  const recheckA = await organizadorService.preCheckInicioTorneo(clubIdemp.org.id, clubIdemp.torneo.id, { isReCheck: true });
  const sessionA = organizadorService.preCheckSessions.get(clubIdemp.torneo.id);
  const snapshotA = JSON.stringify(sessionA.categoriasPlan);

  const recheckB = await organizadorService.preCheckInicioTorneo(clubIdemp.org.id, clubIdemp.torneo.id, { isReCheck: true });
  const sessionB = organizadorService.preCheckSessions.get(clubIdemp.torneo.id);
  const snapshotB = JSON.stringify(sessionB.categoriasPlan);

  assert.strictEqual(recheckA.bloqueado, recheckB.bloqueado, 'El estado de bloqueo debe ser idéntico');
  assert.strictEqual(recheckA.conflictos?.length || 0, recheckB.conflictos?.length || 0, 'La cantidad de conflictos debe ser idéntica');
  assert.strictEqual(snapshotA, snapshotB, 'El plan (fechaHora y canchas por partido) debe ser idéntico entre dos re-checks sin cambios');

  console.log('   ✓ Test 9 superado.');
}

// ---------------------------------------------------------------------------
// TEST 10: Zona manual de 5 parejas con slotsQueDestraban vacío (Fix B)
// ---------------------------------------------------------------------------
async function test10_zona5_slotsQueDestrabanVacio() {
  console.log('\n▶️ TEST 10: Zona manual de 5 parejas -> slotsQueDestraban debe ser vacío (Fix B)...');
  const { org, torneo, cat } = await setupBaseClub({ cantidadCanchas: 2, viernesFin: '22:00' });

  const parejas = [];
  const slotsDisjuntos = ['Viernes-18:00', 'Viernes-19:15', 'Viernes-20:30', 'Sabado-09:00', 'Sabado-10:15'];
  for (let i = 1; i <= 5; i++) {
    const p = await prisma.pareja.create({
      data: { categoriaId: cat.id, jugador1: `A${i}`, jugador2: `B${i}`, orden: i },
    });
    parejas.push(p);
    await prisma.slotPareja.create({ data: { parejaId: p.id, slotId: slotsDisjuntos[i - 1] } });
  }

  // PreCheck 1: las 5 parejas quedan juntas en sinGrupo (tamanoZona: 5)
  const pre1 = await organizadorService.preCheckInicioTorneo(org.id, torneo.id);
  assert.strictEqual(pre1.bloqueado, true);

  // Destrabe aparente: P1..P4 comparten 18:00, P5 en 19:15.
  // P5 podría agregar 18:00 y hacer a las 5 compatibles pairwise.
  // Sin el guard, P5 vería 18:00 como slotQueDestraba aunque la zona de 5 es antirreglamentaria.
  await disponibilidadService.setDisponibilidad(org.id, parejas[0].id, ['Viernes-18:00']);
  await disponibilidadService.setDisponibilidad(org.id, parejas[1].id, ['Viernes-18:00']);
  await disponibilidadService.setDisponibilidad(org.id, parejas[2].id, ['Viernes-18:00']);
  await disponibilidadService.setDisponibilidad(org.id, parejas[3].id, ['Viernes-18:00']);
  await disponibilidadService.setDisponibilidad(org.id, parejas[4].id, ['Viernes-19:15']);

  const pre2 = await organizadorService.preCheckInicioTorneo(org.id, torneo.id, { isReCheck: true });
  assert.strictEqual(pre2.bloqueado, true);

  const conf = pre2.conflictos[0]?.partidosSinHorario?.find((c) => c.motivo === 'ZONA_MANUAL_INCOMPLETA');
  assert.ok(conf, 'Debe haber un conflicto ZONA_MANUAL_INCOMPLETA');
  assert.strictEqual(conf.tamanoZona, 5, 'El tamaño de zona debe ser 5');
  assert.ok(Array.isArray(conf.parejasManuales), 'Debe tener parejasManuales');

  for (const pm of conf.parejasManuales) {
    assert.deepStrictEqual(
      pm.slotsQueDestraban,
      [],
      `En zona de 5 parejas, pareja ${pm.nombre} debe tener slotsQueDestraban=[] (encontrados: ${JSON.stringify(pm.slotsQueDestraban)})`
    );
  }

  console.log('   ✓ Test 10 superado.');
}

// ---------------------------------------------------------------------------
// TEST 11: Zona de 3 con 2 partidos sin cancha no duplica reportes (fca62f4 / Punto 6)
// ---------------------------------------------------------------------------
async function test11_destrabeZona3Con2PartidosSinCanchaNoDuplica() {
  console.log('\n▶️ TEST 11: Zona de 3 destrabada con 2 partidos sin cancha (no duplicados)...');
  // Club con 1 cancha y viernesFin '19:15' (solo 1 slot: 18:00 a 19:15)
  const { org, torneo, cat } = await setupBaseClub({ cantidadCanchas: 1, viernesFin: '19:15' });

  const p1 = await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: 'P1A', jugador2: 'P1B', orden: 1 } });
  const p2 = await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: 'P2A', jugador2: 'P2B', orden: 2 } });
  const p3 = await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: 'P3A', jugador2: 'P3B', orden: 3 } });

  // Incompatibles de inicio
  await prisma.slotPareja.createMany({
    data: [
      { parejaId: p1.id, slotId: 'Viernes-18:00' },
      { parejaId: p2.id, slotId: 'Viernes-18:00' },
      { parejaId: p3.id, slotId: 'Viernes-19:15' },
    ],
  });

  const pre1 = await organizadorService.preCheckInicioTorneo(org.id, torneo.id);
  assert.strictEqual(pre1.bloqueado, true);

  // Destrabe mutuo
  const slotsCompat = ['Viernes-18:00', 'Viernes-19:15'];
  await disponibilidadService.setDisponibilidadDoble(org.id, p1.id, slotsCompat, p2.id, slotsCompat);
  await disponibilidadService.setDisponibilidad(org.id, p3.id, slotsCompat);

  const pre2 = await organizadorService.preCheckInicioTorneo(org.id, torneo.id, { isReCheck: true });
  assert.strictEqual(pre2.bloqueado, true, 'Debe estar bloqueado por capacidad');

  const confs = pre2.conflictos[0]?.partidosSinHorario || [];
  const confsManual = confs.filter((c) => c.motivo === 'ZONA_MANUAL_INCOMPLETA');
  assert.strictEqual(confsManual.length, 0, 'No debe haber conflicto de zona manual');

  const confsSinCancha = confs.filter((c) => c.motivo === 'SIN_CANCHA_DISPONIBLE');
  assert.strictEqual(confsSinCancha.length, 2, 'Deben reportarse exactamente 2 partidos sin cancha');

  const ids = confsSinCancha.map((c) => c.partidoId);
  const idsUnicos = new Set(ids);
  assert.strictEqual(idsUnicos.size, 2, 'Cada partido sin cancha debe aparecer EXACTAMENTE UNA VEZ (sin duplicados)');

  console.log(`   ✓ Test 11 superado: 2 partidos sin cancha reportados, IDs únicos: ${JSON.stringify(ids)}.`);
}

async function runSuite() {
  await ensureTestDb();
  resetTestDb();

  const specificTest = process.argv[2];

  console.log('='.repeat(85));
  console.log('🧪 SUITE OFICIAL: ZONAS MANUALES EN PRE-CHECK E INICIO (13 CASOS)');
  console.log('='.repeat(85));

  const allTests = [
    { id: '1', nombre: 'Test 1: Zona de 3, destrabe total agendable', fn: test1_zona3_destrabeTotalAgendable },
    { id: '2', nombre: 'Test 2: Zona de 3, destrabe sin capacidad (conflicto normal)', fn: test2_zona3_destrabeSinCapacidad },
    { id: '3', nombre: 'Test 3: Destrabe parcial (zona de 3)', fn: test3_zona3_destrabeParcial },
    { id: '4', nombre: 'Test 4: Zona de 4 (pairwise sin cuádruple vs con cuádruple)', fn: test4_zona4_miniBracketDestrabe },
    { id: '5', nombre: 'Test 5: Ciclo destrabar -> reapertura -> re-destrabar', fn: test5_cicloDestrabeReaperturaIdempotencia },
    { id: '6a', nombre: 'Test 6A: Zona sinGrupo de 1 pareja (bloqueada)', fn: test6a_zonaManual1ParejaBloqueada },
    { id: '6b', nombre: 'Test 6B: Zona sinGrupo de 5+ parejas (bloqueada)', fn: test6b_zonasManuales5MasParejasBloqueadas },
    { id: '6c', nombre: 'Test 6C: Zona de 5 bloqueada -> forceReset -> re-particiona -> iniciarTorneo', fn: test6c_zona5_reparticionConForceReset },
    { id: '7', nombre: 'Test 7: Zona de 2 parejas (1 partido en DB)', fn: test7_zona2_destrabeGenera1Partido },
    { id: '8', nombre: 'Test 8: Inicio real directo sin pre-check (3 partidos, no agendados, regenerar reemplaza)', fn: test8_inicioRealDirectoZonaManual },
    { id: '9', nombre: 'Test 9: Aislamiento planesCache (Fix A) e idempotencia', fn: test9_planesCacheAislamientoEIdempotencia },
    { id: '10', nombre: 'Test 10: Zona 5 parejas con slotsQueDestraban vacío (Fix B)', fn: test10_zona5_slotsQueDestrabanVacio },
    { id: '11', nombre: 'Test 11: Zona de 3 con 2 partidos sin cancha no duplica (Punto 6)', fn: test11_destrabeZona3Con2PartidosSinCanchaNoDuplica },
  ];

  const testsToRun = specificTest
    ? allTests.filter((t) => t.id === specificTest.toLowerCase())
    : allTests;

  if (testsToRun.length === 0) {
    console.error(`❌ Test no encontrado: "${specificTest}". Opciones: 1, 2, 3, 4, 5, 6a, 6b, 6c, 7, 8`);
    process.exit(1);
  }

  const resultados = [];
  const fallasDetalle = [];

  for (const t of testsToRun) {
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
  console.log('📊 RESUMEN DE EJECUCIÓN DE ZONAS MANUALES:');
  console.log('='.repeat(85));
  console.table(resultados);

  if (fallasDetalle.length > 0) {
    console.log('\n' + '='.repeat(85));
    console.log(`❌ DETALLE DE FALLAS (${fallasDetalle.length}/${testsToRun.length} fallaron):`);
    console.log('='.repeat(85));
    for (const f of fallasDetalle) {
      console.error(`\n🔴 [${f.caso}]`);
      console.error(f.error);
    }
    process.exit(1);
  }

  console.log('\n' + '='.repeat(85));
  console.log('🎉 TODOS LOS TESTS DE ZONAS MANUALES PASARON EXITOSAMENTE!');
  console.log('='.repeat(85));
  process.exit(0);
}

if (require.main === module) {
  runSuite();
}

module.exports = {
  runSuite,
  test1_zona3_destrabeTotalAgendable,
  test2_zona3_destrabeSinCapacidad,
  test3_zona3_destrabeParcial,
  test4_zona4_miniBracketDestrabe,
  test5_cicloDestrabeReaperturaIdempotencia,
  test6a_zonaManual1ParejaBloqueada,
  test6b_zonasManuales5MasParejasBloqueadas,
  test6c_zona5_reparticionConForceReset,
  test7_zona2_destrabeGenera1Partido,
};
