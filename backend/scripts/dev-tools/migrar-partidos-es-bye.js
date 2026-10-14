'use strict';

require('../../src/config/timezone');
const prisma = require('../../src/lib/prisma');
const { requireConfirmarDev, crearBackupDevDb } = require('./devUtils');

async function migrarPartidosEsBye() {
  const isConfirmado = process.argv.includes('--confirmar-dev');
  const isDryRun = !isConfirmado || process.argv.includes('--dry-run');

  console.log(`\n======================================================`);
  console.log(`📦 SCRIPT DE MIGRACIÓN: MARCAR esBye EN PARTIDOS EXISTENTES`);
  console.log(`Modo: ${isDryRun ? 'DRY-RUN (Simulación, no escribe en base)' : 'EJECUCIÓN REAL (Escribe en DB)'}`);
  console.log(`======================================================\n`);

  if (!isDryRun) {
    requireConfirmarDev('migrar-partidos-es-bye.js');
    crearBackupDevDb();
  } else {
    console.log('ℹ️ Para aplicar los cambios en dev.db ejecuta:');
    console.log('   node scripts/dev-tools/migrar-partidos-es-bye.js --confirmar-dev\n');
  }

  // 1. Obtener todas las categorías con fases eliminatorias
  const categorias = await prisma.categoria.findMany({
    include: {
      torneo: { select: { id: true, nombre: true } },
      fasesEliminatorias: {
        include: {
          partidos: {
            orderBy: { posicionEnRonda: 'asc' },
          },
        },
      },
    },
  });

  let totalCategoriasConCuadro = 0;
  let totalPartidosPrimeraRonda = 0;
  let totalByesDetectados = 0;
  let totalActualizados = 0;
  const detallePorCategoria = [];

  for (const cat of categorias) {
    if (!cat.fasesEliminatorias || cat.fasesEliminatorias.length === 0) continue;

    totalCategoriasConCuadro++;
    const maxRonda = Math.max(...cat.fasesEliminatorias.map((f) => f.ronda));
    const fasePrimera = cat.fasesEliminatorias.find((f) => f.ronda === maxRonda);

    if (!fasePrimera || !Array.isArray(fasePrimera.partidos)) continue;

    const byesCat = [];

    for (const p of fasePrimera.partidos) {
      totalPartidosPrimeraRonda++;

      const tieneLado1 = Boolean(p.pareja1Id || p.origenPareja1);
      const tieneLado2 = Boolean(p.pareja2Id || p.origenPareja2);
      const cumpleHeuristica = (tieneLado1 && !tieneLado2) || (!tieneLado1 && tieneLado2);

      if (cumpleHeuristica) {
        totalByesDetectados++;
        byesCat.push(p);

        if (!p.esBye) {
          if (!isDryRun) {
            await prisma.partido.update({
              where: { id: p.id },
              data: {
                esBye: true,
                sinHorarioAsignado: false,
              },
            });
          }
          totalActualizados++;
        }
      }
    }

    detallePorCategoria.push({
      torneo: cat.torneo?.nombre || cat.torneoId,
      categoria: cat.nombre,
      primeraRonda: maxRonda,
      totalPartidosRonda: fasePrimera.partidos.length,
      byesEncontrados: byesCat.length,
      partidos: byesCat.map((p) => ({
        id: p.id,
        posicion: p.posicionEnRonda,
        origen1: p.origenPareja1,
        origen2: p.origenPareja2,
        yaTeniaEsBye: p.esBye,
      })),
    });
  }

  console.log('--- Resumen por Categoría ---');
  for (const d of detallePorCategoria) {
    console.log(`• Torneo: "${d.torneo}" | Cat: "${d.categoria}" | Ronda: ${d.primeraRonda}`);
    console.log(`  Partidos primera ronda: ${d.totalPartidosRonda} | BYEs detectados: ${d.byesEncontrados}`);
    for (const p of d.partidos) {
      console.log(`    - Partido #${p.posicion} (ID: ${p.id}): [${p.origen1 || 'vacio'} vs ${p.origen2 || 'vacio'}] | yaTeniaEsBye: ${p.yaTeniaEsBye}`);
    }
  }

  console.log(`\n======================================================`);
  console.log(`TOTALES:`);
  console.log(`Categorías con cuadro: ${totalCategoriasConCuadro}`);
  console.log(`Partidos primera ronda evaluados: ${totalPartidosPrimeraRonda}`);
  console.log(`Partidos que cumplen heurística BYE: ${totalByesDetectados}`);
  console.log(`Partidos ${isDryRun ? 'a actualizar' : 'actualizados a esBye=true'}: ${totalActualizados}`);
  console.log(`======================================================\n`);

  await prisma.$disconnect();
}

if (require.main === module) {
  migrarPartidosEsBye()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Error en script de migración:', err);
      process.exit(1);
    });
}

module.exports = { migrarPartidosEsBye };
