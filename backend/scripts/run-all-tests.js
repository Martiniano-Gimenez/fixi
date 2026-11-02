'use strict';

/**
 * run-all-tests.js
 * Runner centralizado y secuencial de todas las suites de prueba de backend.
 *
 * Reglas de seguridad:
 * 1. Lista explícita de suites test-*.js (no glob, sin dev-tools).
 * 2. Verificación estática antes de ejecutar: cada suite DEBE importar
 *    la guarda testEnvGuard como su primer 'require'. Si no, se aborta inmediatamente.
 * 3. Base limpia para cada suite: restablece test.db a partir de test.template.db
 *    antes de ejecutar cada suite.
 * 4. Ejecución en procesos hijos aislados con reporte de tiempos y resumen final.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { resetTestDb } = require('./reset-test-db');

const SCRIPTS_DIR = __dirname;

// Lista explícita de las suites oficiales
const TEST_SUITES = [
  'test-alta-tardia-flujo.js',
  'test-asignar-horario-manual-validaciones.js',
  'test-asignar-horario-manual-bloqueos.js',
  'test-auditoria-fixes.js',
  'test-authz-disponibilidad.js',
  'test-auto-asignar-eliminatoria.js',
  'test-date-parsing.js',
  'test-disponibilidad-guard.js',
  'test-disponibilidad-rangos.js',
  'test-eliminatoria-scheduler-completo.js',
  'test-eliminatoria-inmutabilidad-manual.js',
  'test-lluvia-cruce-otra-jornada.js',
  'test-mini-bracket-scheduling.js',
  'test-modo-dia-torneo.js',
  'test-modo-lluvia-eliminatorias.js',
  'test-modo-lluvia-independiente.js',
  'test-modo-lluvia-mcf.js',
  'test-operaciones-zonas.js',
  'test-orden-cronologico-slots.js',
  'test-parejas-categoria-zona.js',
  'test-persistencia-overrides.js',
  'test-precheck-snapshot.js',
  'test-programacion-zona.js',
  'test-propuestas-zona.js',
  'test-opciones-partido-zona.js',
  'test-repro-lluvia-sabado.js',
  'test-restauracion-partido-otra-jornada.js',
  'test-r32-inmutabilidad.js',
  'test-scheduler-backfill-regression.js',
  'test-scheduler-invariantes-repro.js',
  'test-scheduler-r32-fin-zonas.js',
  'test-scheduling-domingo.js',
  'test-sincronizar-cuadro.js',
  'test-torneo-fecha-guard.js',
  'test-zona-horaria.js',
  'test-zona-horaria-frontend-parity.js',
  'test-zona-manual-sin-partidos.js',
  'test-r32-lluvia-fin-zonas.js',
  'test-horario-club-cierre.js',
  'test-precheck-monotonia.js',
  'test-determinismo-consultas.js',
  'test-campo-legacy-canchas.js',
  'test-r32-marca-sin-horario.js',
  'test-solape-finales-extension.js',
  'test-padres-hijo-fijo.js',
  'test-armado-zonas-reparacion.js',
  'test-inscripcion-publica.js',
];

/**
 * Valida estáticamente que la suite importe testEnvGuard como primer require.
 */
function validarGuardaFailSafe(suiteFilename) {
  if (suiteFilename.includes('dev-tools')) {
    throw new Error(`[SEGURIDAD] Suite no autorizada (dev-tools no es suite de tests): ${suiteFilename}`);
  }

  const fullPath = path.join(SCRIPTS_DIR, suiteFilename);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`[ERROR] Archivo de suite no encontrado: ${fullPath}`);
  }

  const content = fs.readFileSync(fullPath, 'utf8');
  // Eliminar comentarios de bloque y de línea para buscar el primer require real
  const clean = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '');

  const match = clean.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/);
  if (!match) {
    throw new Error(`[FAIL-SAFE] La suite ${suiteFilename} no tiene ningún require.`);
  }

  const targetModule = match[1];
  if (!targetModule.includes('testEnvGuard')) {
    throw new Error(
      `[FAIL-SAFE ABORT] La suite ${suiteFilename} NO tiene 'testEnvGuard' como su primer require (encontrado: "${targetModule}").\n` +
      `Abortando inmediatamente para evitar cualquier acceso accidental a dev.db.`
    );
  }
}

/**
 * Ejecuta una suite en un proceso hijo aislado.
 */
function ejecutarSuite(suiteFilename) {
  return new Promise((resolve, reject) => {
    const fullPath = path.join(SCRIPTS_DIR, suiteFilename);
    const child = spawn('node', [fullPath], {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'test' },
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`La suite ${suiteFilename} falló con código de salida ${code}`));
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

async function runAllTests() {
  console.log('='.repeat(75));
  console.log('🧪 RUN-ALL-TESTS: EJECUCIÓN SECUENCIAL CON FAIL-SAFE Y BASE AISLADA');
  console.log(`📁 Total de suites a ejecutar: ${TEST_SUITES.length}`);
  console.log('='.repeat(75));

  // Paso 1: Validación previa estática de TODAS las suites antes de correr la primera
  console.log('\n🔍 Verificando guardas de entorno en todas las suites...');
  for (const suite of TEST_SUITES) {
    try {
      validarGuardaFailSafe(suite);
    } catch (err) {
      console.error(`\n❌ Error de validación en "${suite}":\n${err.message}`);
      process.exit(1);
    }
  }
  console.log('✅ 100% de las suites tienen la guarda testEnvGuard importada en primer lugar.\n');

  const startTimeTotal = Date.now();
  const resultados = [];

  // Paso 2: Ejecución secuencial con reset de DB antes de cada suite
  for (let i = 0; i < TEST_SUITES.length; i++) {
    const suite = TEST_SUITES[i];
    const indexStr = `[${i + 1}/${TEST_SUITES.length}]`;
    console.log('\n' + '-'.repeat(75));
    console.log(`🚀 ${indexStr} Preparando: ${suite}`);

    // Limpieza y restauración de test.db desde plantilla limpia
    try {
      resetTestDb();
      console.log(`🧹 ${indexStr} Base de test descartable restablecida desde plantilla.`);
    } catch (resetErr) {
      console.error(`❌ ${indexStr} Error restableciendo test.db antes de ${suite}:`, resetErr.message);
      process.exit(1);
    }

    const tStart = Date.now();
    try {
      await ejecutarSuite(suite);
      const elapsed = ((Date.now() - tStart) / 1000).toFixed(2);
      resultados.push({ suite, status: 'PASSED', elapsed: `${elapsed}s` });
      console.log(`✅ ${indexStr} ${suite} completada con ÉXITO (${elapsed}s)`);
    } catch (err) {
      const elapsed = ((Date.now() - tStart) / 1000).toFixed(2);
      resultados.push({ suite, status: 'FAILED', elapsed: `${elapsed}s` });
      console.error(`\n❌ ${indexStr} ${suite} FALLÓ (${elapsed}s): ${err.message}`);
      console.error('\n🛑 Abortando ejecución de la suite completa.');
      process.exit(1);
    }
  }

  const totalTime = ((Date.now() - startTimeTotal) / 1000).toFixed(2);

  // Resumen final
  console.log('\n' + '='.repeat(75));
  console.log('🎉 RESUMEN DE EJECUCIÓN DE PRUEBAS');
  console.log('='.repeat(75));
  console.table(resultados);
  console.log(`\n✨ TODAS LAS ${TEST_SUITES.length} SUITES PASARON EXITOSAMENTE en ${totalTime}s.`);
  console.log('🛡️ Base dev.db 100% protegida y aislada.');
  console.log('='.repeat(75) + '\n');
}

runAllTests().catch((err) => {
  console.error('❌ Error fatal en test runner:', err);
  process.exit(1);
});
