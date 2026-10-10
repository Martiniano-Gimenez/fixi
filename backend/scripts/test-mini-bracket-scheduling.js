'use strict';

const { ensureTestDb } = require('./utils/testEnvGuard');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

const organizadorService = require('../src/services/organizador.service');
const zonaService = require('../src/services/zona.service');
const torneoService = require('../src/services/torneo.service');
const partidoService = require('../src/services/partido.service');
const canchasOverridesService = require('../src/services/canchasOverrides.service');

async function main() {
  await ensureTestDb();
  console.log('🧪 Iniciando suite de tests para Zonas de 4 (MINI_BRACKET)...');
  await canchasOverridesService.loadFromDb();

  // Helper limpieza
  async function limpiar(email) {
    const org = await prisma.organizador.findUnique({ where: { email } });
    if (org) {
      const torneos = await prisma.torneo.findMany({ where: { organizadorId: org.id } });
      const tIds = torneos.map((t) => t.id);
      const categorias = await prisma.categoria.findMany({ where: { torneoId: { in: tIds } } });
      const cIds = categorias.map((c) => c.id);

      await prisma.setPartido.deleteMany({ where: { partido: { categoriaId: { in: cIds } } } });
      await prisma.partido.deleteMany({ where: { categoriaId: { in: cIds } } });
      await prisma.faseEliminatoria.deleteMany({ where: { categoriaId: { in: cIds } } });
      await prisma.zonaPareja.deleteMany({ where: { zona: { categoriaId: { in: cIds } } } });
      await prisma.zona.deleteMany({ where: { categoriaId: { in: cIds } } });
      await prisma.slotPareja.deleteMany({ where: { pareja: { categoriaId: { in: cIds } } } });
      await prisma.pareja.deleteMany({ where: { categoriaId: { in: cIds } } });
      await prisma.categoria.deleteMany({ where: { id: { in: cIds } } });
      await prisma.torneo.deleteMany({ where: { id: { in: tIds } } });
      await prisma.organizador.delete({ where: { id: org.id } });
    }
  }

  const email = 'test-mini-bracket@padel.com';
  await limpiar(email);

  // Crear Organizador con 4 canchas
  const passwordHash = await bcrypt.hash('123456', 10);
  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club Mini Bracket Test',
      email,
      passwordHash,
      cantidadCanchas: 4,
      viernesInicio: '18:00',
      viernesFin: '02:00',
      sabadoInicio: '09:00',
      sabadoFin: '23:00',
    },
  });

  const now = new Date();
  let offsetToFriday = 5 - now.getDay();
  if (offsetToFriday < 0) offsetToFriday += 7;
  const fechaTorneo = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetToFriday, 12, 0, 0);

  const torneo = await torneoService.createTorneo(org.id, {
    nombre: 'Torneo Mini Bracket Test',
    fecha: fechaTorneo.toISOString(),
  });

  const cat = await prisma.categoria.create({
    data: {
      torneoId: torneo.id,
      nombre: '5ta Test',
      estado: 'BORRADOR',
    },
  });

  // CASO 1: 4 parejas compatibles
  const slotsViernesTemprano = ['Viernes-18:00', 'Viernes-18:15', 'Viernes-18:30', 'Viernes-18:45', 'Viernes-19:00', 'Viernes-19:15', 'Viernes-19:30', 'Viernes-19:45', 'Viernes-20:00', 'Viernes-20:15', 'Viernes-20:30', 'Viernes-20:45', 'Viernes-21:00'];

  const p1 = await prisma.pareja.create({
    data: { categoriaId: cat.id, jugador1: 'P1 A', jugador2: 'P1 B', orden: 1, slotsSeleccionados: { create: slotsViernesTemprano.map((s) => ({ slotId: s })) } },
  });
  const p2 = await prisma.pareja.create({
    data: { categoriaId: cat.id, jugador1: 'P2 A', jugador2: 'P2 B', orden: 2, slotsSeleccionados: { create: slotsViernesTemprano.map((s) => ({ slotId: s })) } },
  });
  const p3 = await prisma.pareja.create({
    data: { categoriaId: cat.id, jugador1: 'P3 A', jugador2: 'P3 B', orden: 3, slotsSeleccionados: { create: slotsViernesTemprano.map((s) => ({ slotId: s })) } },
  });
  const p4 = await prisma.pareja.create({
    data: { categoriaId: cat.id, jugador1: 'P4 A', jugador2: 'P4 B', orden: 4, slotsSeleccionados: { create: slotsViernesTemprano.map((s) => ({ slotId: s })) } },
  });

  console.log('▶️ TEST 1: Pre-check en zona de 4 parejas compatibles...');
  const preCheck1 = await organizadorService.preCheckInicioTorneo(org.id, torneo.id);
  console.log(`   Bloqueado: ${preCheck1.bloqueado}, Conflictos: ${preCheck1.conflictos?.length || 0}`);
  if (preCheck1.bloqueado) {
    throw new Error(`Error en Test 1: pre-check bloqueado: ${JSON.stringify(preCheck1.conflictos)}`);
  }
  console.log('✅ TEST 1 PASÓ: Zona de 4 compatible pasa el pre-check.');

  console.log('▶️ TEST 2: Iniciar categoría y verificar orden de horarios (P1/P2 antes de P3/P4)...');
  await zonaService.iniciarCategoriaConDisponibilidad(org.id, cat.id);
  await zonaService.asignarHorariosAutomatico(org.id, [cat.id]);

  const partidosAsignados = await prisma.partido.findMany({
    where: { categoriaId: cat.id },
    orderBy: { posicionEnRonda: 'asc' },
  });

  const match1 = partidosAsignados.find((p) => p.posicionEnRonda === 1);
  const match2 = partidosAsignados.find((p) => p.posicionEnRonda === 2);
  const match3 = partidosAsignados.find((p) => p.posicionEnRonda === 3);
  const match4 = partidosAsignados.find((p) => p.posicionEnRonda === 4);

  console.log(`   P1: ${match1.fechaHora?.toISOString()} (C${match1.canchaNumero})`);
  console.log(`   P2: ${match2.fechaHora?.toISOString()} (C${match2.canchaNumero})`);
  console.log(`   P3 (Ganador vs Ganador): ${match3.fechaHora?.toISOString()} (C${match3.canchaNumero})`);
  console.log(`   P4 (Perdedor vs Perdedor): ${match4.fechaHora?.toISOString()} (C${match4.canchaNumero})`);

  const DURACION_MS = 75 * 60 * 1000;
  const maxFinRonda1 = Math.max(new Date(match1.fechaHora).getTime(), new Date(match2.fechaHora).getTime()) + DURACION_MS;
  const inicioP3 = new Date(match3.fechaHora).getTime();
  const inicioP4 = new Date(match4.fechaHora).getTime();

  if (inicioP3 < maxFinRonda1) throw new Error('P3 arranca antes de fin de Ronda 1');
  if (inicioP4 < maxFinRonda1) throw new Error('P4 arranca antes de fin de Ronda 1');
  console.log('✅ TEST 2 PASÓ: Dependencia temporal respetada estrictamente.');

  // Limpiar para Test 3
  await limpiar(email);

  // CASO 2: Incompatibilidad cuádruple y resolución incremental vía snapshot
  console.log('\n▶️ TEST 3: Incompatibilidad cuádruple -> ZONA_MANUAL_INCOMPLETA -> Resolución incremental...');
  const org2 = await prisma.organizador.create({
    data: {
      nombre: 'Club Mini Bracket Test 2',
      email,
      passwordHash,
      cantidadCanchas: 2,
      viernesInicio: '18:00',
      viernesFin: '02:00',
      sabadoInicio: '09:00',
      sabadoFin: '23:00',
    },
  });

  const torneo2 = await torneoService.createTorneo(org2.id, {
    nombre: 'Torneo Mini Bracket Incompatible',
    fecha: fechaTorneo.toISOString(),
  });

  const cat2 = await prisma.categoria.create({
    data: { torneoId: torneo2.id, nombre: '6ta Test', estado: 'BORRADOR' },
  });

  // P1 y P2 solo disponibles Viernes, P3 y P4 solo disponibles Sábado
  const parA = await prisma.pareja.create({
    data: { categoriaId: cat2.id, jugador1: 'A1', jugador2: 'A2', orden: 1, slotsSeleccionados: { create: [{ slotId: 'Viernes-18:00' }, { slotId: 'Viernes-19:15' }] } },
  });
  const parB = await prisma.pareja.create({
    data: { categoriaId: cat2.id, jugador1: 'B1', jugador2: 'B2', orden: 2, slotsSeleccionados: { create: [{ slotId: 'Viernes-18:00' }, { slotId: 'Viernes-19:15' }] } },
  });
  const parC = await prisma.pareja.create({
    data: { categoriaId: cat2.id, jugador1: 'C1', jugador2: 'C2', orden: 3, slotsSeleccionados: { create: [{ slotId: 'Sabado-09:00' }, { slotId: 'Sabado-10:15' }] } },
  });
  const parD = await prisma.pareja.create({
    data: { categoriaId: cat2.id, jugador1: 'D1', jugador2: 'D2', orden: 4, slotsSeleccionados: { create: [{ slotId: 'Sabado-09:00' }, { slotId: 'Sabado-10:15' }] } },
  });

  const preCheckIncompat = await organizadorService.preCheckInicioTorneo(org2.id, torneo2.id, { forceReset: true });
  console.log(`   Pre-check inicial con incompatibilidad: Bloqueado = ${preCheckIncompat.bloqueado}`);
  if (!preCheckIncompat.bloqueado) {
    throw new Error('El pre-check debió bloquearse por incompatibilidad en la zona de 4');
  }
  const tieneConflictoManual = preCheckIncompat.conflictos.some((c) =>
    c.partidosSinHorario.some((p) => p.motivo === 'ZONA_MANUAL_INCOMPLETA')
  );
  if (!tieneConflictoManual) {
    throw new Error('Se esperaba motivo ZONA_MANUAL_INCOMPLETA en el reporte de conflictos');
  }
  console.log('   ✓ Reportado correctamente como ZONA_MANUAL_INCOMPLETA con opciones de destrabe.');

  // Ahora simulamos que el organizador destraba agregando slots comunes a C y D para el Viernes
  console.log('   Destrabando agregando disponibilidad de Viernes a C y D...');
  await prisma.slotPareja.createMany({
    data: [
      { parejaId: parC.id, slotId: 'Viernes-18:00' },
      { parejaId: parC.id, slotId: 'Viernes-19:15' },
      { parejaId: parC.id, slotId: 'Viernes-20:30' },
      { parejaId: parC.id, slotId: 'Viernes-21:45' },
      { parejaId: parD.id, slotId: 'Viernes-18:00' },
      { parejaId: parD.id, slotId: 'Viernes-19:15' },
      { parejaId: parD.id, slotId: 'Viernes-20:30' },
      { parejaId: parD.id, slotId: 'Viernes-21:45' },
      { parejaId: parA.id, slotId: 'Viernes-20:30' },
      { parejaId: parA.id, slotId: 'Viernes-21:45' },
      { parejaId: parB.id, slotId: 'Viernes-20:30' },
      { parejaId: parB.id, slotId: 'Viernes-21:45' },
    ],
  });

  const recheckRes = await organizadorService.preCheckInicioTorneo(org2.id, torneo2.id, { isReCheck: true });
  console.log(`   Re-check incremental tras destrabar: Bloqueado = ${recheckRes.bloqueado}, Conflictos = ${recheckRes.conflictos?.length || 0}`);
  if (recheckRes.bloqueado) {
    throw new Error(`Error: re-check incremental debería haber quedado desbloqueado: ${JSON.stringify(recheckRes.conflictos)}`);
  }
  console.log('✅ TEST 3 PASÓ: Re-check incremental destrabó la zona de 4 con 4-pair intersection.');

  await limpiar(email);

  // CASO 3: Parejas sin ventana común cuádruple en torneo en curso -> Auto-asignar a la siguiente cancha libre y permitir asignación manual antes de jugarse
  console.log('\n▶️ TEST 4: Parejas sin ventana cuádruple común -> Auto-asignar a la siguiente cancha libre y permitir asignación manual previa...');
  const org3 = await prisma.organizador.create({
    data: {
      nombre: 'Club Mini Bracket Test 3',
      email,
      passwordHash,
      cantidadCanchas: 2,
      viernesInicio: '18:00',
      viernesFin: '22:00',
      sabadoInicio: '09:00',
      sabadoFin: '21:00',
    },
  });

  const torneo3 = await torneoService.createTorneo(org3.id, {
    nombre: 'Torneo Mini Bracket Auto C1',
    fecha: fechaTorneo.toISOString(),
  });

  const cat3 = await prisma.categoria.create({
    data: { torneoId: torneo3.id, nombre: '4ta Test', estado: 'BORRADOR' },
  });

  // P1 y P2 solo disponibles Viernes; P3 y P4 solo disponibles Sábado (sin intersección entre ambas duplas)
  await prisma.pareja.create({
    data: { categoriaId: cat3.id, jugador1: 'J1', jugador2: 'J2', orden: 1, slotsSeleccionados: { create: [{ slotId: 'Viernes-18:00' }, { slotId: 'Viernes-19:15' }] } },
  });
  await prisma.pareja.create({
    data: { categoriaId: cat3.id, jugador1: 'J3', jugador2: 'J4', orden: 2, slotsSeleccionados: { create: [{ slotId: 'Viernes-18:00' }, { slotId: 'Viernes-19:15' }] } },
  });
  await prisma.pareja.create({
    data: { categoriaId: cat3.id, jugador1: 'J5', jugador2: 'J6', orden: 3, slotsSeleccionados: { create: [{ slotId: 'Sabado-09:00' }, { slotId: 'Sabado-10:15' }] } },
  });
  await prisma.pareja.create({
    data: { categoriaId: cat3.id, jugador1: 'J7', jugador2: 'J8', orden: 4, slotsSeleccionados: { create: [{ slotId: 'Sabado-09:00' }, { slotId: 'Sabado-10:15' }] } },
  });

  await zonaService.iniciarCategoria(org3.id, cat3.id);
  await prisma.torneo.update({ where: { id: torneo3.id }, data: { estado: 'EN_CURSO' } });
  // Asignar en modo live (isPreCheck false por defecto)
  await zonaService.asignarHorariosAutomatico(org3.id, [cat3.id]);

  const partidosCat3 = await prisma.partido.findMany({
    where: { categoriaId: cat3.id },
    orderBy: { posicionEnRonda: 'asc' },
  });

  const p3_match = partidosCat3.find((p) => p.posicionEnRonda === 3);
  const p4_match = partidosCat3.find((p) => p.posicionEnRonda === 4);

  if (p3_match.sinHorarioAsignado || !p3_match.fechaHora || !p3_match.canchaNumero) {
    throw new Error(`Error en Test 4: P3 debió ser asignado a la siguiente cancha libre. Estado: ${JSON.stringify(p3_match)}`);
  }
  if (p4_match.sinHorarioAsignado || !p4_match.fechaHora || !p4_match.canchaNumero) {
    throw new Error(`Error en Test 4: P4 debió ser asignado a la siguiente cancha libre. Estado: ${JSON.stringify(p4_match)}`);
  }

  console.log(`   ✓ P3 asignado automáticamente a la siguiente cancha libre: ${p3_match.fechaHora.toISOString()} (Cancha ${p3_match.canchaNumero})`);
  console.log(`   ✓ P4 asignado automáticamente a la siguiente cancha libre: ${p4_match.fechaHora.toISOString()} (Cancha ${p4_match.canchaNumero})`);

  // Verificar que el organizador puede asignar/reprogramar manualmente el horario ANTES de jugar Match 1 y 2
  console.log('   Verificando reprogramación manual previa sin parejas definidas...');
  const resReprog = await partidoService.asignarHorarioManual(org3.id, p3_match.id, {
    slotId: 'Sabado-18:00',
    canchaNumero: 1,
  });

  if (resReprog.partido.canchaNumero !== 1 || resReprog.partido.sinHorarioAsignado) {
    throw new Error('Error en Test 4: Falló la reprogramación manual de P3 antes de definirse las parejas');
  }
  console.log('   ✓ P3 reprogramado manualmente con éxito antes de definirse los cruces.');

  console.log('✅ TEST 4 PASÓ: Auto-asignación a la siguiente cancha libre y reprogramación manual previa operativas.');

  await limpiar(email);
  console.log('\n🎉 =============================================================');
  console.log('🎉 TODOS LOS TESTS DE INTEGRACIÓN MINI_BRACKET PASARON EXITOSAMENTE!');
  console.log('🎉 =============================================================');

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error('❌ Error fatal:', e);
  await prisma.$disconnect();
  process.exit(1);
});
