'use strict';

require('../../src/config/timezone');

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// 1. Carga explícita e inmediata de .env.test con override para garantizar
// que cualquier require posterior que instancie Prisma Client tome el env de test.
const ENV_TEST_PATH = path.resolve(__dirname, '../../.env.test');
if (!fs.existsSync(ENV_TEST_PATH)) {
  console.error(`🚨 SEGURIDAD: No se encontró el archivo de entorno de test en ${ENV_TEST_PATH}`);
  process.exit(1);
}

const envResult = dotenv.config({ path: ENV_TEST_PATH, override: true });
if (envResult.error) {
  console.error(`🚨 SEGURIDAD: Error al cargar ${ENV_TEST_PATH}:`, envResult.error.message);
  process.exit(1);
}

// 2. Pre-chequeo sincrónico estricto de DATABASE_URL en process.env
const dbUrl = process.env.DATABASE_URL || '';
if (!dbUrl.includes('test.db') || dbUrl.includes('dev.db')) {
  console.error(`🚨 SEGURIDAD: DATABASE_URL insegura detectada en test suite: "${dbUrl}". Debe ser file:./test.db`);
  process.exit(1);
}

/**
 * Verifica la base de datos físicamente conectada consultando PRAGMA database_list
 * mediante una instancia aislada de PrismaClient.
 * Aborta la ejecución si la ruta física resuelta no termina en prisma/test.db.
 */
async function ensureTestDb() {
  const { PrismaClient } = require('@prisma/client');
  const tempClient = new PrismaClient();

  try {
    const list = await tempClient.$queryRawUnsafe('PRAGMA database_list;');
    const mainRow = Array.isArray(list) ? list.find((r) => r.name === 'main') : null;
    const connectedFile = (mainRow && mainRow.file) ? String(mainRow.file) : '';

    const normalizedConnected = path.normalize(connectedFile).toLowerCase().replace(/\\/g, '/');
    const expectedSuffix = 'prisma/test.db';

    if (!normalizedConnected.endsWith(expectedSuffix)) {
      console.error(`\n🚨 ALERTA DE SEGURIDAD MÁXIMA 🚨`);
      console.error(`Se intentó ejecutar una prueba contra una base de datos NO AUTORIZADA:`);
      console.error(`  Ruta detectada : "${connectedFile}"`);
      console.error(`  Ruta requerida : ".../${expectedSuffix}"`);
      console.error(`Operación abortada de inmediato para proteger los datos.\n`);
      throw new Error(`SEGURIDAD: La base física conectada no es prisma/test.db: "${connectedFile}"`);
    }

    return { connectedFile, verified: true };
  } finally {
    await tempClient.$disconnect();
  }
}

module.exports = {
  ensureTestDb,
  ENV_TEST_PATH,
};
