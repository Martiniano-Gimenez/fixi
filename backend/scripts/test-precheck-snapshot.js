const { ensureTestDb } = require('./utils/testEnvGuard');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const organizadorService = require('../src/services/organizador.service');
const disponibilidadService = require('../src/services/disponibilidad.service');
const canchasOverridesService = require('../src/services/canchasOverrides.service');
const { parseFechaLocal } = require('../src/utils/dateUtils');

async function runTests() {
  await ensureTestDb();
  await canchasOverridesService.loadFromDb();
  console.log('🧪 =============================================================');
  console.log('🧪 TEST SUITE: PRE-CHECK SNAPSHOT CONGELADO Y RESOLUCIÓN INCREMENTAL');
  console.log('🧪 =============================================================\n');

  // Setup: 1 Club, 1 Cancha (4 turnos: 14:00, 15:15, 16:30, 17:45), 6 Parejas (2 Zonas de 3)
  const organizador = await prisma.organizador.create({
    data: {
      nombre: 'Club Test Snapshot Suite',
      email: `suite-${Date.now()}@padel.com`,
      passwordHash: 'hash',
      cantidadCanchas: 1,
      viernesInicio: '14:00',
      viernesFin: '22:00',
      sabadoInicio: '09:00',
      sabadoFin: '22:00',
    },
  });

  const refFechaStr = '2026-09-04';
  const torneo = await prisma.torneo.create({
    data: {
      nombre: 'Torneo Snapshot Suite',
      slug: `suite-${Date.now()}`,
      fecha: parseFechaLocal(refFechaStr),
      estado: 'BORRADOR',
      organizadorId: organizador.id,
    },
  });

  const cat = await prisma.categoria.create({
    data: { torneoId: torneo.id, nombre: '5ta', estado: 'BORRADOR' },
  });

  // 6 Parejas (2 Zonas de 3 = 6 partidos en total compitiendo por 4 slots de 1 cancha)
  // Horarios de jornada: 14:00, 15:15, 16:30, 17:45, 19:00 (5 slots)
  // Zona A: P1, P2, P3 (14:00 a 16:30) -> 3 partidos (2 asignados a 14:00 y 15:15, 1 en conflicto)
  // Zona B: P4, P5, P6 (16:30 a 19:00) -> 3 partidos (2 asignados a 16:30 y 17:45, 1 en conflicto)
  const configParejas = [
    { id: 1, slots: ['Viernes-14:00', 'Viernes-15:15'] },
    { id: 2, slots: ['Viernes-14:00', 'Viernes-15:15'] },
    { id: 3, slots: ['Viernes-15:15'] }, // P2 vs P3 y P1 vs P3 compiten por 15:15 -> 1 queda sin horario
    { id: 4, slots: ['Viernes-16:30', 'Viernes-17:45'] },
    { id: 5, slots: ['Viernes-16:30', 'Viernes-17:45'] },
    { id: 6, slots: ['Viernes-17:45'] }, // P4 vs P6 y P5 vs P6 compiten por 17:45 -> 1 queda sin horario
  ];

  const dbParejas = [];
  for (const cp of configParejas) {
    const p = await prisma.pareja.create({
      data: {
        categoriaId: cat.id,
        jugador1: `P${cp.id}_J1`,
        jugador2: `P${cp.id}_J2`,
        orden: cp.id,
      },
    });
    dbParejas.push(p);

    for (const slotId of cp.slots) {
      await prisma.slotPareja.create({
        data: { parejaId: p.id, slotId },
      });
    }
  }

  try {
    // =========================================================================
    // TEST 1: Primer Pre-Check genera Snapshot y detecta conflicto
    // =========================================================================
    console.log('▶️ TEST 1: Primer Pre-Check genera sesión de Snapshot...');
    const preCheck1 = await organizadorService.preCheckInicioTorneo(organizador.id, torneo.id);
    if (!preCheck1.bloqueado) throw new Error('TEST 1 FALLÓ: Debería haber estado bloqueado por cruce sin horario');
    if (!organizadorService.preCheckSessions.has(torneo.id)) throw new Error('TEST 1 FALLÓ: preCheckSessions no guardó la sesión');
    
    const session1 = organizadorService.preCheckSessions.get(torneo.id);
    const zonasIniciales = session1.categoriasPlan[0].zonas.map(z => ({
      nombre: z.nombre,
      parejas: z.parejaIds.map(id => dbParejas.find(p => p.id === id)?.orden).sort().join(','),
    }));

    const partidosIniciales = session1.categoriasPlan[0].zonas.flatMap(z => z.partidos);
    const asignadosIniciales = partidosIniciales.filter(p => !p.sinHorarioAsignado);
    const conflictosIniciales = partidosIniciales.filter(p => p.sinHorarioAsignado);

    console.log(`   ✓ Total Partidos: ${partidosIniciales.length}, Asignados: ${asignadosIniciales.length}, Conflictos: ${conflictosIniciales.length}`);
    console.log(`   ✓ Zonas Generadas: ${JSON.stringify(zonasIniciales)}`);
    console.log('✅ TEST 1 PASÓ: Snapshot generado correctamente en memoria.\n');

    // =========================================================================
    // TEST 2: Resolución de Cruce y Preservación de Inmutabilidad (No-Regresión)
    // =========================================================================
    console.log('▶️ TEST 2: Resolución de Cruces sucesivos preserva zonas congeladas y asignaciones...');
    
    // 2.1 Resolver primer conflicto
    const target1 = conflictosIniciales[0];
    const p1Target1 = dbParejas.find(p => p.id === target1.pareja1Id);
    const p2Target1 = dbParejas.find(p => p.id === target1.pareja2Id);

    console.log(`   Acción 1: Resolviendo primer cruce P${p1Target1.orden} vs P${p2Target1.orden} con slot 'Viernes-19:00'...`);
    await disponibilidadService.setDisponibilidadDoble(
      organizador.id,
      p1Target1.id,
      ['Viernes-19:00'],
      p2Target1.id,
      ['Viernes-19:00']
    );

    const preCheck2 = await organizadorService.preCheckInicioTorneo(organizador.id, torneo.id, { isReCheck: true });
    const session2 = organizadorService.preCheckSessions.get(torneo.id);
    const partidosIntermedios = session2.categoriasPlan[0].zonas.flatMap(z => z.partidos);
    const conflictosIntermedios = partidosIntermedios.filter(p => p.sinHorarioAsignado);

    if (conflictosIntermedios.length !== conflictosIniciales.length - 1) {
      throw new Error(`TEST 2.1 FALLÓ: Conflictos deberían haber bajado exactamente en 1! Antes: ${conflictosIniciales.length}, Después: ${conflictosIntermedios.length}`);
    }
    console.log(`   ✓ Verificado 1: Conflictos bajaron estrictamente de ${conflictosIniciales.length} a ${conflictosIntermedios.length}.`);

    // 2.2 Resolver segundo conflicto
    const target2 = conflictosIntermedios[0];
    const p1Target2 = dbParejas.find(p => p.id === target2.pareja1Id);
    const p2Target2 = dbParejas.find(p => p.id === target2.pareja2Id);

    console.log(`   Acción 2: Resolviendo segundo cruce P${p1Target2.orden} vs P${p2Target2.orden} con slot 'Viernes-20:15'...`);
    await disponibilidadService.setDisponibilidadDoble(
      organizador.id,
      p1Target2.id,
      ['Viernes-20:15'],
      p2Target2.id,
      ['Viernes-20:15']
    );

    const preCheck3 = await organizadorService.preCheckInicioTorneo(organizador.id, torneo.id, { isReCheck: true });
    const session3 = organizadorService.preCheckSessions.get(torneo.id);
    const zonasFinales = session3.categoriasPlan[0].zonas.map(z => ({
      nombre: z.nombre,
      parejas: z.parejaIds.map(id => dbParejas.find(p => p.id === id)?.orden).sort().join(','),
    }));

    // Verificar Zonas Congeladas
    if (JSON.stringify(zonasIniciales) !== JSON.stringify(zonasFinales)) {
      throw new Error(`TEST 2 FALLÓ: Las zonas cambiaron tras resolver los cruces! Antes: ${JSON.stringify(zonasIniciales)}, Después: ${JSON.stringify(zonasFinales)}`);
    }
    console.log('   ✓ Verificado: Las zonas se mantuvieron 100% congeladas en todo el proceso.');

    // Verificar Invariante de Inmutabilidad de Partidos Asignados
    const partidosFinales = session3.categoriasPlan[0].zonas.flatMap(z => z.partidos);
    for (const inicial of asignadosIniciales) {
      const final = partidosFinales.find(p => p.id === inicial.id);
      if (!final || final.sinHorarioAsignado) {
        throw new Error(`TEST 2 FALLÓ: Partido previamente asignado perdió su horario!`);
      }
      if (new Date(final.fechaHora).getTime() !== new Date(inicial.fechaHora).getTime() || final.canchaNumero !== inicial.canchaNumero) {
        throw new Error(`TEST 2 FALLÓ: Partido previamente asignado cambió de horario o cancha!`);
      }
    }
    console.log('   ✓ Verificado: Todos los partidos previamente asignados mantuvieron exactamente su horario y cancha.');

    // Verificar Monotonía Decreciente Final
    const conflictosFinales = partidosFinales.filter(p => p.sinHorarioAsignado);
    if (conflictosFinales.length !== 0) {
      throw new Error(`TEST 2 FALLÓ: Todos los conflictos deberían haber sido resueltos (0), quedaron: ${conflictosFinales.length}`);
    }
    console.log(`   ✓ Verificado: Conflictos finales = 0. Estado Bloqueado = ${preCheck3.bloqueado}. PlanId = ${preCheck3.planId}`);
    console.log('✅ TEST 2 PASÓ: Invariante de inmutabilidad, zonas congeladas y resolución monótona confirmados.\n');

    // =========================================================================
    // TEST 3: Preservación de Progreso al Reabrir Modal (Sin forceReset)
    // =========================================================================
    console.log('▶️ TEST 3: Reabrir preCheck sin forceReset preserva todo el progreso...');
    const preCheckReabierto = await organizadorService.preCheckInicioTorneo(organizador.id, torneo.id, { forceReset: false });
    if (preCheckReabierto.bloqueado) {
      throw new Error('TEST 3 FALLÓ: Debería mantenerse desbloqueado si ya se resolvieron todos los cruces');
    }
    if (!preCheckReabierto.planId) {
      throw new Error('TEST 3 FALLÓ: Debe retornar un planId listo para iniciar');
    }
    console.log('✅ TEST 3 PASÓ: Reabrir el modal preserva el progreso de resolución.\n');

    // =========================================================================
    // TEST 4: Sliding TTL renueva expiración en cada acceso
    // =========================================================================
    console.log('▶️ TEST 4: Sliding TTL touch-on-access...');
    const sessionBeforeTouch = organizadorService.preCheckSessions.get(torneo.id);
    const oldExpiresAt = sessionBeforeTouch.expiresAt;
    
    // Simular paso de 1 segundo
    await new Promise(r => setTimeout(r, 50));
    await organizadorService.preCheckInicioTorneo(organizador.id, torneo.id, { forceReset: false });
    const sessionAfterTouch = organizadorService.preCheckSessions.get(torneo.id);
    
    if (sessionAfterTouch.expiresAt <= oldExpiresAt) {
      throw new Error('TEST 4 FALLÓ: expiresAt no se extendió con sliding TTL');
    }
    console.log('✅ TEST 4 PASÓ: Sliding TTL extiende el tiempo con cada interacción.\n');

    // =========================================================================
    // TEST 5: Re-sorteo Explícito (forceReset: true)
    // =========================================================================
    console.log('▶️ TEST 5: forceReset: true descarta snapshot y re-sortea...');
    const preCheckReset = await organizadorService.preCheckInicioTorneo(organizador.id, torneo.id, { forceReset: true });
    if (!organizadorService.preCheckSessions.has(torneo.id)) {
      throw new Error('TEST 5 FALLÓ: preCheckSessions debería haber generado una nueva sesión');
    }
    console.log('✅ TEST 5 PASÓ: forceReset: true regeneró limpiamente el pre-check.\n');

    // =========================================================================
    // TEST 6: Iniciar Torneo consume y limpia el snapshot
    // =========================================================================
    console.log('▶️ TEST 6: Iniciar Torneo persiste y limpia la sesión...');
    const planFinalId = preCheckReset.planId || preCheckReset.planEmergenciaId;
    if (!planFinalId) throw new Error('No se obtuvo planId para iniciar');

    await organizadorService.iniciarTorneoMultiCategoria(organizador.id, torneo.id, planFinalId);
    if (organizadorService.preCheckSessions.has(torneo.id)) {
      throw new Error('TEST 6 FALLÓ: La sesión de pre-check debería haber sido eliminada tras iniciar el torneo');
    }
    console.log('✅ TEST 6 PASÓ: Sesión eliminada correctamente al iniciar el torneo.\n');

    console.log('🎉 =============================================================');
    console.log('🎉 TODOS LOS TESTS DE SNAPSHOT Y RESOLUCIÓN INCREMENTAL PASARON EXITOSAMENTE!');
    console.log('🎉 =============================================================\n');

  } finally {
    // Cleanup
    await prisma.partido.deleteMany({ where: { categoria: { torneo: { organizadorId: organizador.id } } } });
    await prisma.zonaPareja.deleteMany({ where: { zona: { categoria: { torneo: { organizadorId: organizador.id } } } } });
    await prisma.zona.deleteMany({ where: { categoria: { torneo: { organizadorId: organizador.id } } } });
    await prisma.slotPareja.deleteMany({ where: { pareja: { categoria: { torneo: { organizadorId: organizador.id } } } } });
    await prisma.pareja.deleteMany({ where: { categoria: { torneo: { organizadorId: organizador.id } } } });
    await prisma.categoria.deleteMany({ where: { torneo: { organizadorId: organizador.id } } });
    await prisma.torneo.deleteMany({ where: { organizadorId: organizador.id } });
    await prisma.organizador.deleteMany({ where: { id: organizador.id } });
  }
}

runTests().catch(async (err) => {
  console.error('❌ ERROR EN TEST SUITE:', err);
  await prisma.$disconnect();
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
  process.exit(0);
});
