'use strict';

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const PRISMA_DIR = path.resolve(__dirname, '../prisma');
const TEMPLATE_DB = path.join(PRISMA_DIR, 'test.template.db');
const TARGET_DB = path.join(PRISMA_DIR, 'test.db');

/**
 * Regenera test.template.db ejecutando 'prisma migrate deploy'
 * sobre un archivo SQLite temporal y copiándolo luego atómicamente a la plantilla.
 */
function regenerarPlantilla() {
  const tempDbName = 'test.template.tmp.db';
  const tempDb = path.join(PRISMA_DIR, tempDbName);
  const tempFiles = [tempDb, `${tempDb}-wal`, `${tempDb}-shm`, `${tempDb}-journal`];

  for (const f of tempFiles) {
    if (fs.existsSync(f)) {
      try { fs.unlinkSync(f); } catch (_) {}
    }
  }

  console.log('⚙️ [reset-test-db] Generando test.template.db con prisma migrate deploy sobre base temporal...');
  const schemaPath = path.join(PRISMA_DIR, 'schema.prisma');
  execSync(`npx prisma migrate deploy --schema="${schemaPath}"`, {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      DATABASE_URL: `file:./${tempDbName}`,
    },
    stdio: 'inherit',
  });

  if (!fs.existsSync(tempDb)) {
    throw new Error(`[reset-test-db] ERROR: No se generó ${tempDb} tras prisma migrate deploy.`);
  }

  fs.copyFileSync(tempDb, TEMPLATE_DB);

  for (const f of tempFiles) {
    if (fs.existsSync(f)) {
      try { fs.unlinkSync(f); } catch (_) {}
    }
  }

  console.log('✅ [reset-test-db] test.template.db generada y actualizada con éxito.');
  return TEMPLATE_DB;
}

function resetTestDb(options = {}) {
  const forceRebuild = options.rebuildTemplate || process.argv.includes('--rebuild-template');

  // Verificación estricta de seguridad: ruta fija en código
  const normalizedTarget = path.normalize(TARGET_DB);
  if (!normalizedTarget.endsWith(path.join('prisma', 'test.db'))) {
    throw new Error(`[reset-test-db] SEGURIDAD: La ruta destino no coincide con prisma/test.db: ${normalizedTarget}`);
  }

  if (!fs.existsSync(TEMPLATE_DB) || forceRebuild) {
    regenerarPlantilla();
  }

  // Eliminar archivos asociados a test.db si existen (wal, shm, journal)
  const filesToDelete = [
    TARGET_DB,
    `${TARGET_DB}-wal`,
    `${TARGET_DB}-shm`,
    `${TARGET_DB}-journal`,
  ];

  for (const file of filesToDelete) {
    if (!path.normalize(file).includes(path.join('prisma', 'test.db'))) {
      throw new Error(`[reset-test-db] SEGURIDAD: Intento de borrar archivo no autorizado: ${file}`);
    }
    if (fs.existsSync(file)) {
      try {
        fs.unlinkSync(file);
      } catch (err) {
        console.warn(`[reset-test-db] Advertencia al eliminar ${path.basename(file)}: ${err.message}`);
      }
    }
  }

  // Copia atómica de la plantilla
  fs.copyFileSync(TEMPLATE_DB, TARGET_DB);
  return TARGET_DB;
}

if (require.main === module) {
  try {
    const target = resetTestDb();
    console.log(`✅ [reset-test-db] test.db reseteada con éxito desde test.template.db (${target})`);
  } catch (err) {
    console.error(`❌ [reset-test-db] Error: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { resetTestDb, regenerarPlantilla, TARGET_DB, TEMPLATE_DB };
