'use strict';

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const crypto = require('crypto');

const PRISMA_DIR = path.resolve(__dirname, '../prisma');
const TEMPLATE_DB = path.join(PRISMA_DIR, 'test.template.db');
const TARGET_DB = path.join(PRISMA_DIR, 'test.db');

// Guardas de test (triggers) que se agregan a la plantilla después de las migraciones.
// El marcador guarda el SHA256 del SQL aplicado: si falta o no coincide, se regenera la plantilla.
const GUARDS_SQL = path.join(__dirname, 'utils', 'test-db-guards.sql');
const GUARDS_MARKER = path.join(PRISMA_DIR, 'test.template.guards');

function hashGuards() {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(GUARDS_SQL));
  for (const dir of fs.readdirSync(path.join(PRISMA_DIR, 'migrations')).sort()) {
    const sql = path.join(PRISMA_DIR, 'migrations', dir, 'migration.sql');
    if (fs.existsSync(sql)) hash.update(fs.readFileSync(sql));
  }
  return hash.digest('hex');
}

// Sin contar comentarios de línea (--) ni espacios
function guardasTienenSentencias() {
  const sql = fs.readFileSync(GUARDS_SQL, 'utf8').replace(/--.*$/gm, '').trim();
  return sql.length > 0;
}

function plantillaTieneGuardasVigentes() {
  if (!fs.existsSync(GUARDS_MARKER)) return false;
  return fs.readFileSync(GUARDS_MARKER, 'utf8').trim() === hashGuards();
}

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
  // En Windows el motor puede fallar al abrir una base inexistente.
  fs.writeFileSync(tempDb, '');
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

  if (guardasTienenSentencias()) {
    console.log('⚙️ [reset-test-db] Aplicando guardas de test (scripts/utils/test-db-guards.sql)...');
    execSync(`npx prisma db execute --file "${GUARDS_SQL}" --schema="${schemaPath}"`, {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        DATABASE_URL: `file:./${tempDbName}`,
      },
      stdio: 'inherit',
    });
  } else {
    console.log('⚙️ [reset-test-db] test-db-guards.sql no tiene sentencias: no se aplica nada.');
  }

  fs.copyFileSync(tempDb, TEMPLATE_DB);
  fs.writeFileSync(GUARDS_MARKER, hashGuards());

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

  if (!fs.existsSync(TEMPLATE_DB) || forceRebuild || !plantillaTieneGuardasVigentes()) {
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
