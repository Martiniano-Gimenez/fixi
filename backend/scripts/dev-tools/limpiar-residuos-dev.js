'use strict';

/**
 * limpiar-residuos-dev.js
 * 
 * Script seguro para identificar y purgar organizadores y torneos huérfanos/residuos
 * generados por tests históricos en dev.db.
 * 
 * REGLAS DE SEGURIDAD:
 * 1. Por defecto opera en modo --dry-run (simulación y verificación sin mutar nada).
 * 2. Filtrado estricto en JavaScript mediante startsWith y regex (sin usar SQL LIKE).
 * 3. Lista blanca estricta por UUID exacto y email de los 3 organizadores reales.
 * 4. Aserción obligatoria de que exactamente 3 organizadores y el torneo "Impares Agosto"
 *    con sus 149 partidos se preservan intactos.
 * 5. Borrado ordenado de hijos a padres en transacción atómica con backup previo.
 * 
 * USO:
 *   node scripts/dev-tools/limpiar-residuos-dev.js               # Modo dry-run (por defecto)
 *   node scripts/dev-tools/limpiar-residuos-dev.js --ejecutar --confirmar-dev  # Requiere confirmación
 */

const assert = require('assert');
const prisma = require('../../src/lib/prisma');
const { requireConfirmarDev, crearBackupDevDb } = require('./devUtils');

// ─── Lista blanca inmutable de datos legítimos de desarrollo ──────────────────

const WHITELIST_ORGS = new Map([
  ['0da9308b-d221-4171-b225-a2a82822db5f', { email: 'demo@padel.com', nombre: 'Px4' }],
  ['a6f53eba-9ffe-44af-b0fb-a142ba1036bc', { email: 'admin@padel.org', nombre: 'Padel Admin' }],
  ['89d1da85-9759-4f30-a5dc-e484c2d41078', { email: 'admin@test.com', nombre: 'Admin Test' }],
]);

const WHITELIST_TORNEO_ID = '9b5c0e4b-90cf-432f-a9ec-0bdc2619b2af'; // Impares Agosto
const EXPECTED_PARTIDOS_IMPARES = 149;

// Patrones de emails residuales de pruebas (evaluados en JavaScript con regex / startsWith)
const RESIDUAL_EMAIL_REGEX = /^(test[-_]|bench[-_]|domino[-_]|debug[-_]|org[AB]-|tardio-|causa-raiz-|piloto@|test-mini-bracket@)/i;

async function main() {
  const isExecute = process.argv.includes('--ejecutar');
  const isDryRun = !isExecute;

  console.log('═'.repeat(70));
  console.log('🧹 HERRAMIENTA DE LIMPIEZA DE RESIDUOS DE DEV.DB (DEV-TOOLS)');
  console.log(`Modo: ${isDryRun ? '🔍 DRY-RUN (Solo reporte y verificación)' : '⚠️ EJECUCIÓN REAL (Modifica la DB)'}`);
  console.log('═'.repeat(70) + '\n');

  if (isExecute) {
    requireConfirmarDev('limpiar-residuos-dev.js');
  }

  // 1. Obtener todos los organizadores y torneos de la base
  const allOrgs = await prisma.organizador.findMany({
    include: {
      torneos: {
        include: {
          categorias: {
            include: {
              _count: { select: { parejas: true, partidos: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Total organizadores en DB actualmente: ${allOrgs.length}`);

  // 2. Clasificación en JavaScript
  const preservedOrgs = [];
  const candidateOrgsToDelete = [];

  for (const org of allOrgs) {
    const isWhitelisted = WHITELIST_ORGS.has(org.id);
    const matchesResidualPattern = RESIDUAL_EMAIL_REGEX.test(org.email);

    if (isWhitelisted) {
      preservedOrgs.push(org);
    } else if (matchesResidualPattern) {
      candidateOrgsToDelete.push(org);
    } else {
      // Si hay algún organizador que ni está en la lista blanca ni coincide con el patrón
      // de test, por seguridad NO lo borramos y lo reportamos como sospechoso
      console.warn(`⚠️ Organizador desconocido no coincide con patrón de test ni whitelist: ${org.email} (${org.id}). Se PRESERVA por seguridad.`);
      preservedOrgs.push(org);
    }
  }

  // 3. Aserciones de seguridad estrictas
  console.log('\n--- Verificación de Integridad de la Lista Blanca ---');

  // a. Verificar que los 3 organizadores reales existen
  for (const [expectedId, expectedData] of WHITELIST_ORGS.entries()) {
    const found = preservedOrgs.find((o) => o.id === expectedId);
    assert.ok(found, `FALLO DE SEGURIDAD: El organizador legítimo ${expectedData.email} (${expectedId}) no fue encontrado en la base.`);
    assert.strictEqual(found.email, expectedData.email, `FALLO DE SEGURIDAD: El email de ${expectedId} no coincide (${found.email} vs ${expectedData.email}).`);
    console.log(`  ✅ Verificado: Organizador legítimo "${found.nombre}" <${found.email}> preservado.`);
  }

  // b. Verificar el torneo Impares Agosto y sus 149 partidos
  const imparesOrg = preservedOrgs.find((o) => o.id === '0da9308b-d221-4171-b225-a2a82822db5f');
  const imparesTorneo = imparesOrg ? imparesOrg.torneos.find((t) => t.id === WHITELIST_TORNEO_ID) : null;
  assert.ok(imparesTorneo, 'FALLO DE SEGURIDAD: El torneo "Impares Agosto" no fue encontrado bajo demo@padel.com.');

  const partidosImparesCount = await prisma.partido.count({
    where: { categoria: { torneoId: WHITELIST_TORNEO_ID } },
  });
  assert.strictEqual(
    partidosImparesCount,
    EXPECTED_PARTIDOS_IMPARES,
    `FALLO DE SEGURIDAD: Impares Agosto debe tener exactamente ${EXPECTED_PARTIDOS_IMPARES} partidos, pero tiene ${partidosImparesCount}.`
  );
  console.log(`  ✅ Verificado: Torneo "${imparesTorneo.nombre}" preservado con sus ${partidosImparesCount} partidos intactos.`);

  // c. Verificar que exactamente los 3 organizadores de whitelist quedarán
  assert.strictEqual(
    preservedOrgs.length,
    3,
    `FALLO DE SEGURIDAD: Se esperaba preservar exactamente 3 organizadores, pero se preservan ${preservedOrgs.length}.`
  );
  console.log(`  ✅ Verificado: Tras la limpieza quedarán exactamente 3 organizadores legítimos.`);

  // 4. Estadísticas del dry-run
  let totalTorneosABorrar = 0;
  let totalCategoriasABorrar = 0;
  let totalPartidosABorrar = 0;

  for (const org of candidateOrgsToDelete) {
    totalTorneosABorrar += org.torneos.length;
    for (const t of org.torneos) {
      totalCategoriasABorrar += t.categorias.length;
      for (const c of t.categorias) {
        totalPartidosABorrar += c._count.partidos;
      }
    }
  }

  console.log('\n' + '─'.repeat(70));
  console.log('📊 RESUMEN DE CANDIDATOS A ELIMINAR:');
  console.log(`  • Organizadores a eliminar : ${candidateOrgsToDelete.length}`);
  console.log(`  • Torneos a eliminar       : ${totalTorneosABorrar}`);
  console.log(`  • Categorías asociadas     : ${totalCategoriasABorrar}`);
  console.log(`  • Partidos asociados       : ${totalPartidosABorrar}`);
  console.log('─'.repeat(70));

  console.log('\nDesglose de organizadores residuales identificados:');
  candidateOrgsToDelete.forEach((o, idx) => {
    console.log(`  ${idx + 1}. [${o.email}] ${o.nombre} (${o.torneos.length} torneo/s)`);
  });

  if (isDryRun) {
    console.log('\nℹ️ DRY-RUN FINALIZADO CON ÉXITO: 0 modificaciones realizadas.');
    console.log('Para ejecutar la limpieza real, solicite autorización y corra:');
    console.log('   node scripts/dev-tools/limpiar-residuos-dev.js --ejecutar --confirmar-dev\n');
    return;
  }

  // 5. Ejecución real (solo si se pasa --ejecutar --confirmar-dev)
  console.log('\n🚀 Iniciando eliminación transaccional...');
  crearBackupDevDb();

  const orgIdsToDelete = candidateOrgsToDelete.map((o) => o.id);

  await prisma.$transaction(async (tx) => {
    // Buscar todos los IDs hijos
    const torneos = await tx.torneo.findMany({
      where: { organizadorId: { in: orgIdsToDelete } },
      select: { id: true },
    });
    const torneoIds = torneos.map((t) => t.id);

    const categorias = await tx.categoria.findMany({
      where: { torneoId: { in: torneoIds } },
      select: { id: true },
    });
    const categoriaIds = categorias.map((c) => c.id);

    const zonas = await tx.zona.findMany({
      where: { categoriaId: { in: categoriaIds } },
      select: { id: true },
    });
    const zonaIds = zonas.map((z) => z.id);

    const parejas = await tx.pareja.findMany({
      where: { categoriaId: { in: categoriaIds } },
      select: { id: true },
    });
    const parejaIds = parejas.map((p) => p.id);

    // Borrado ordenado (hijos primero)
    await tx.setPartido.deleteMany({ where: { partido: { categoriaId: { in: categoriaIds } } } });
    await tx.partido.deleteMany({ where: { categoriaId: { in: categoriaIds } } });
    await tx.faseEliminatoria.deleteMany({ where: { categoriaId: { in: categoriaIds } } });
    await tx.zonaPareja.deleteMany({ where: { zonaId: { in: zonaIds } } });
    await tx.zona.deleteMany({ where: { id: { in: zonaIds } } });
    await tx.slotPareja.deleteMany({ where: { parejaId: { in: parejaIds } } });
    await tx.pareja.deleteMany({ where: { id: { in: parejaIds } } });
    await tx.overrideCanchasDia.deleteMany({ where: { torneoId: { in: torneoIds } } });
    await tx.categoria.deleteMany({ where: { id: { in: categoriaIds } } });
    await tx.torneo.deleteMany({ where: { id: { in: torneoIds } } });
    await tx.organizador.deleteMany({ where: { id: { in: orgIdsToDelete } } });
  });

  console.log('✅ Eliminación transaccional completada con éxito.');

  // Verificación final post-borrado
  const finalOrgsCount = await prisma.organizador.count();
  const finalTorneosCount = await prisma.torneo.count();
  console.log(`\nEstado final en dev.db:`);
  console.log(`  • Organizadores restantes: ${finalOrgsCount} (esperado: 3)`);
  console.log(`  • Torneos restantes     : ${finalTorneosCount} (esperado: 3)`);
}

main()
  .catch((e) => {
    console.error('\n❌ ERROR DURANTE LA OPERACIÓN:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
