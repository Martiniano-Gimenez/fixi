const prisma = require('../src/lib/prisma');
const assert = require('assert');

const canchasOverridesService = require('../src/services/canchasOverrides.service');
const torneoService = require('../src/services/torneo.service');

async function testPersistenciaOverrides() {
  console.log('🧪 Iniciando test: Persistencia de Overrides, Transaccionalidad y Ciclo de Vida de Caché...\n');

  // Preparar organizador y torneo de prueba
  const timestamp = Date.now();
  const organizador = await prisma.organizador.create({
    data: {
      nombre: 'Club Test Persistencia',
      email: `test_persistencia_${timestamp}@padel.com`,
      passwordHash: 'dummy_hash',
      cantidadCanchas: 6,
    },
  });

  const torneo = await prisma.torneo.create({
    data: {
      organizadorId: organizador.id,
      nombre: 'Torneo Test Persistencia DB',
      slug: `test-persistencia-${timestamp}`,
      estado: 'BORRADOR',
    },
  });

  console.log(`✅ Creado escenario de prueba: Organizador ${organizador.id}, Torneo ${torneo.id}`);

  // =========================================================================
  // TEST 1: Getters sin caché hidratada deben lanzar error explícito
  // =========================================================================
  console.log('\n--- Test 1: Getters sin caché hidratada lanzan error explícito ---');
  canchasOverridesService.clearMemoryCache();

  assert.throws(
    () => {
      canchasOverridesService.getCanchasDia(torneo.id, '2026-11-20', 6);
    },
    (err) => {
      assert.match(err.message, /La caché en memoria no ha sido inicializada/);
      return true;
    },
    'FALLÓ: getCanchasDia debe lanzar error si la caché está en null'
  );

  assert.throws(
    () => {
      canchasOverridesService.getOverridesTorneo(torneo.id);
    },
    (err) => {
      assert.match(err.message, /La caché en memoria no ha sido inicializada/);
      return true;
    },
    'FALLÓ: getOverridesTorneo debe lanzar error si la caché está en null'
  );

  assert.throws(
    () => {
      canchasOverridesService.applyCacheMutation('SET', { torneoId: torneo.id, diaKey: '2026-11-20', canchas: 4 });
    },
    (err) => {
      assert.match(err.message, /La caché en memoria no ha sido inicializada/);
      return true;
    },
    'FALLÓ: applyCacheMutation debe lanzar error si la caché está en null'
  );

  // Verificar que reiniciarTorneo NO silencia el error si la caché está en null
  await assert.rejects(
    async () => {
      await torneoService.reiniciarTorneo(organizador.id, torneo.id);
    },
    (err) => {
      assert.match(err.message, /La caché en memoria no ha sido inicializada/);
      return true;
    },
    'FALLÓ: reiniciarTorneo debe propagar el error de caché no inicializada'
  );

  console.log('✅ Verificado: Getters, applyCacheMutation y reiniciarTorneo lanzan error explícito si la caché no está cargada');

  // Hidratar caché
  await canchasOverridesService.loadFromDb();
  const checkInitial = canchasOverridesService.getCanchasDia(torneo.id, '2026-11-20', 6);
  assert.strictEqual(checkInitial.canchas, 6);
  assert.strictEqual(checkInitial.isLluvia, false);
  console.log('✅ Verificado: Tras loadFromDb(), los getters funcionan con normalidad');

  // =========================================================================
  // TEST 2: Rollback en prisma.$transaction no contamina DB ni caché
  // =========================================================================
  console.log('\n--- Test 2: Rollback en transacción atómica (DB y caché intactas) ---');
  const diaRollback = '2026-11-20';
  let txErrorCaught = false;

  try {
    await prisma.$transaction(async (tx) => {
      // Escribir override en DB dentro de tx (no debe mutar caché)
      await canchasOverridesService.setOverrideDia(
        torneo.id,
        diaRollback,
        2,
        new Date(),
        { 'partido-test-1': 'Sin cancha' },
        tx
      );

      // Forzar fallo
      throw new Error('SIMULATED_TRANSACTION_ROLLBACK');
    });
  } catch (err) {
    if (err.message === 'SIMULATED_TRANSACTION_ROLLBACK') {
      txErrorCaught = true;
    } else {
      throw err;
    }
  }

  assert.strictEqual(txErrorCaught, true, 'La transacción debió arrojar error');

  // Verificar que en DB NO existe el registro
  const overrideEnDb = await prisma.overrideCanchasDia.findUnique({
    where: {
      torneoId_diaKey: {
        torneoId: torneo.id,
        diaKey: diaRollback,
      },
    },
  });
  assert.strictEqual(overrideEnDb, null, 'FALLÓ: Registro no debió persistir en DB tras rollback');

  // Verificar que la caché en memoria sigue igual que antes
  const overrideEnCache = canchasOverridesService.getCanchasDia(torneo.id, diaRollback, 6);
  assert.strictEqual(overrideEnCache.canchas, 6, 'FALLÓ: Caché no debió mutar durante tx fallida');
  assert.strictEqual(overrideEnCache.isLluvia, false);
  assert.deepStrictEqual(overrideEnCache.partidosSinSlot, {});
  console.log('✅ Verificado: Fallo en tx revierte DB y la caché en memoria permanece inalterada');

  // =========================================================================
  // TEST 2b: Fallo en DB sin transacción no contamina caché en memoria
  // =========================================================================
  console.log('\n--- Test 2b: Fallo en DB fuera de tx no altera la caché en memoria ---');
  const diaFalloDb = '2026-11-20';
  const originalUpsert = prisma.overrideCanchasDia.upsert;
  const originalDeleteMany = prisma.overrideCanchasDia.deleteMany;

  // 1. Simular fallo en upsert
  prisma.overrideCanchasDia.upsert = async () => {
    throw new Error('SIMULATED_UPSERT_DB_ERROR');
  };

  await assert.rejects(
    async () => {
      await canchasOverridesService.setOverrideDia(
        torneo.id,
        diaFalloDb,
        2,
        new Date(),
        { 'partido-fail': 'motivo' }
      );
    },
    (err) => err.message === 'SIMULATED_UPSERT_DB_ERROR',
    'FALLÓ: setOverrideDia debe propagar el error de DB'
  );

  // La caché debe seguir limpia tras el fallo
  const cachePostFalloUpsert = canchasOverridesService.getCanchasDia(torneo.id, diaFalloDb, 6);
  assert.strictEqual(cachePostFalloUpsert.canchas, 6, 'FALLÓ: La caché mutó a pesar del fallo en DB upsert');
  assert.strictEqual(cachePostFalloUpsert.isLluvia, false);
  prisma.overrideCanchasDia.upsert = originalUpsert; // Restaurar método

  // 2. Establecer un override real para probar fallo en deleteMany
  await canchasOverridesService.setOverrideDia(torneo.id, diaFalloDb, 3, new Date(), {});
  assert.strictEqual(canchasOverridesService.getCanchasDia(torneo.id, diaFalloDb, 6).canchas, 3);

  // Simular fallo en deleteMany
  prisma.overrideCanchasDia.deleteMany = async () => {
    throw new Error('SIMULATED_DELETEMANY_DB_ERROR');
  };

  await assert.rejects(
    async () => {
      await canchasOverridesService.removeOverrideDia(torneo.id, diaFalloDb);
    },
    (err) => err.message === 'SIMULATED_DELETEMANY_DB_ERROR',
    'FALLÓ: removeOverrideDia debe propagar el error de DB'
  );

  // La caché debe mantener el valor 3 porque la eliminación en DB falló
  const cachePostFalloDelete = canchasOverridesService.getCanchasDia(torneo.id, diaFalloDb, 6);
  assert.strictEqual(cachePostFalloDelete.canchas, 3, 'FALLÓ: La caché mutó a pesar del fallo en DB deleteMany');
  prisma.overrideCanchasDia.deleteMany = originalDeleteMany; // Restaurar método

  // Limpiar el override de prueba normalmente
  await canchasOverridesService.removeOverrideDia(torneo.id, diaFalloDb);
  assert.strictEqual(canchasOverridesService.getCanchasDia(torneo.id, diaFalloDb, 6).canchas, 6);
  console.log('✅ Verificado: Fallo en operaciones DB sin tx no muta la caché en memoria');

  // =========================================================================
  // TEST 3: Persistencia en DB y recuperación tras reinicio simulado
  // =========================================================================
  console.log('\n--- Test 3: Persistencia y recuperación tras reinicio simulado ---');
  const diaPersistente = '2026-11-21';
  const motivoTest = 'Sin cancha activa libre disponible en ese horario';

  // Guardar override exitoso (fuera de tx para probar mutación centralizada)
  await canchasOverridesService.setOverrideDia(
    torneo.id,
    diaPersistente,
    3,
    new Date(),
    { 'partido-persistente-1': motivoTest }
  );

  // Verificar en caché antes del reinicio
  const antesReinicio = canchasOverridesService.getCanchasDia(torneo.id, diaPersistente, 6);
  assert.strictEqual(antesReinicio.canchas, 3);
  assert.strictEqual(antesReinicio.isLluvia, true);
  assert.strictEqual(antesReinicio.partidosSinSlot['partido-persistente-1'], motivoTest);

  // SIMULAR REINICIO DEL PROCESO
  canchasOverridesService.clearMemoryCache();
  console.log('🔄 Reinicio simulado del proceso (clearMemoryCache)...');

  // Hidratar nuevamente desde DB
  await canchasOverridesService.loadFromDb();

  // Verificar recuperación completa desde DB
  const despuesReinicio = canchasOverridesService.getCanchasDia(torneo.id, diaPersistente, 6);
  assert.strictEqual(despuesReinicio.canchas, 3);
  assert.strictEqual(despuesReinicio.isLluvia, true);
  assert.strictEqual(despuesReinicio.partidosSinSlot['partido-persistente-1'], motivoTest);
  console.log('✅ Verificado: Estado recuperado con éxito desde la tabla OverrideCanchasDia tras reinicio');

  // =========================================================================
  // TEST 4: Restauración de día y limpieza en reiniciarTorneo
  // =========================================================================
  console.log('\n--- Test 4: removeOverrideDia y limpieza en reiniciarTorneo ---');
  
  // 4.1 Restaurar el día específico
  await canchasOverridesService.removeOverrideDia(torneo.id, diaPersistente);
  const postRestaurar = canchasOverridesService.getCanchasDia(torneo.id, diaPersistente, 6);
  assert.strictEqual(postRestaurar.canchas, 6);
  assert.strictEqual(postRestaurar.isLluvia, false);
  assert.deepStrictEqual(postRestaurar.partidosSinSlot, {});

  const postRestaurarDb = await prisma.overrideCanchasDia.findUnique({
    where: {
      torneoId_diaKey: {
        torneoId: torneo.id,
        diaKey: diaPersistente,
      },
    },
  });
  assert.strictEqual(postRestaurarDb, null);
  console.log('✅ Verificado: removeOverrideDia limpia DB y actualiza caché correctamente');

  // 4.2 Crear nuevo override y reiniciarTorneo
  await canchasOverridesService.setOverrideDia(torneo.id, '2026-11-22', 4, new Date(), {});
  await torneoService.reiniciarTorneo(organizador.id, torneo.id);

  const overridesRestantesDb = await prisma.overrideCanchasDia.findMany({
    where: { torneoId: torneo.id },
  });
  assert.strictEqual(overridesRestantesDb.length, 0, 'FALLÓ: reiniciarTorneo debe limpiar overrides en DB');

  const overridesRestantesCache = canchasOverridesService.getOverridesTorneo(torneo.id);
  assert.deepStrictEqual(overridesRestantesCache, {}, 'FALLÓ: reiniciarTorneo debe limpiar caché del torneo');
  console.log('✅ Verificado: reiniciarTorneo limpia OverrideCanchasDia en DB y en caché');

  // Limpieza final de datos de prueba
  await prisma.torneo.delete({ where: { id: torneo.id } });
  await prisma.organizador.delete({ where: { id: organizador.id } });

  console.log('\n============================================================');
  console.log('🎉 TODOS LOS TESTS DE PERSISTENCIA Y ROLLBACK PASARON CON ÉXITO!');
  console.log('============================================================\n');
}

testPersistenciaOverrides()
  .catch((err) => {
    console.error('❌ FALLÓ EL TEST DE PERSISTENCIA:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
