'use strict';

/**
 * renumerar-orden-parejas.js
 *
 * Deja `pareja.orden` en 1..n dentro de cada categoría de dev.db, como paso previo a la
 * restricción @@unique([categoriaId, orden]) en Pareja.
 *
 * Toca solo las categorías con un `orden` repetido o menor que 1 (datos de suites viejas).
 * El orden nuevo respeta el actual y desempata por rowid (orden de inserción en SQLite).
 * También se arreglan los ceros: la renumeración de deletePareja supone `orden >= 1`.
 *
 * USO:
 *   node scripts/dev-tools/renumerar-orden-parejas.js                            # dry-run (por defecto)
 *   node scripts/dev-tools/renumerar-orden-parejas.js --ejecutar --confirmar-dev # escribe, con backup previo
 */

const path = require('path');
const { requireConfirmarDev, crearBackupDevDb } = require('./devUtils');
const prisma = require('../../src/lib/prisma');

async function verificarQueEsDevDb() {
  const filas = await prisma.$queryRawUnsafe('PRAGMA database_list');
  const main = filas.find((f) => f.name === 'main');
  const ruta = path.normalize(main?.file || '');
  if (!ruta.endsWith(path.join('prisma', 'dev.db'))) {
    throw new Error(`La base conectada no es prisma/dev.db: "${ruta}". Abortado.`);
  }
  return ruta;
}

async function categoriasARenumerar() {
  const filas = await prisma.$queryRawUnsafe(`
    SELECT "categoriaId" AS categoriaId
    FROM "Pareja"
    GROUP BY "categoriaId"
    HAVING COUNT(*) <> COUNT(DISTINCT "orden") OR MIN("orden") < 1
  `);
  return filas.map((f) => f.categoriaId);
}

async function planDeCategoria(categoriaId) {
  const parejas = await prisma.$queryRawUnsafe(
    `SELECT id, "orden" AS orden FROM "Pareja" WHERE "categoriaId" = ? ORDER BY "orden" ASC, rowid ASC`,
    categoriaId
  );
  return parejas
    .map((p, i) => ({ id: p.id, antes: Number(p.orden), despues: i + 1 }))
    .filter((c) => c.antes !== c.despues);
}

async function main() {
  const ejecutar = process.argv.includes('--ejecutar');
  if (ejecutar) requireConfirmarDev('renumerar-orden-parejas.js');

  console.log(`Modo: ${ejecutar ? 'EJECUCIÓN (escribe en dev.db)' : 'DRY-RUN (no escribe)'}`);
  const ruta = await verificarQueEsDevDb();
  console.log(`Base: ${ruta}\n`);

  const categoriaIds = await categoriasARenumerar();
  const categorias = await prisma.categoria.findMany({
    where: { id: { in: categoriaIds } },
    include: { torneo: { select: { nombre: true } } },
    orderBy: [{ torneo: { nombre: 'asc' } }, { nombre: 'asc' }, { id: 'asc' }],
  });

  const planes = [];
  for (const c of categorias) {
    const cambios = await planDeCategoria(c.id);
    planes.push({ categoria: c, cambios });
    console.log(`- ${c.torneo.nombre} / ${c.nombre} [${c.estado}]: ${cambios.length} parejas cambian de orden`);
  }

  const totalCambios = planes.reduce((a, p) => a + p.cambios.length, 0);
  const porEstado = {};
  for (const p of planes) porEstado[p.categoria.estado] = (porEstado[p.categoria.estado] || 0) + 1;
  const torneosDistintos = [...new Set(planes.map((p) => p.categoria.torneo.nombre))];
  console.log(`\nCategorías: ${planes.length} (${JSON.stringify(porEstado)}); parejas a renumerar: ${totalCambios}`);
  console.log(`Torneos afectados (${torneosDistintos.length}): ${torneosDistintos.join(', ')}`);

  if (!ejecutar) {
    console.log('\nDry-run: no se escribió nada. Para aplicar: --ejecutar --confirmar-dev');
    return;
  }

  crearBackupDevDb();
  await prisma.$transaction(async (tx) => {
    for (const p of planes) {
      for (const c of p.cambios) {
        await tx.pareja.update({ where: { id: c.id }, data: { orden: c.despues } });
      }
    }
  }, { timeout: 60000 });

  const restantes = await categoriasARenumerar();
  if (restantes.length > 0) {
    throw new Error(`Quedaron ${restantes.length} categorías con orden repetido o menor que 1.`);
  }
  console.log('\nListo: 0 categorías con orden repetido o menor que 1.');
}

main()
  .catch((err) => {
    console.error(`\n❌ ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
