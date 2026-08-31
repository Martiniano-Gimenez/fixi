const assert = require('assert');
const { getAhora, isDebugNowActive } = require('../src/utils/dateUtils');

console.log('🧪 Iniciando tests de blindaje para DEBUG_NOW y getAhora()...\n');

const originalNodeEnv = process.env.NODE_ENV;
const originalDebugNow = process.env.DEBUG_NOW;

try {
  // Test 1: Comportamiento estándar sin DEBUG_NOW
  delete process.env.DEBUG_NOW;
  process.env.NODE_ENV = 'development';
  assert.strictEqual(isDebugNowActive(), false, 'isDebugNowActive debe ser false sin DEBUG_NOW');
  const t1 = getAhora();
  assert(Math.abs(t1.getTime() - Date.now()) < 1000, 'getAhora debe devolver la fecha actual');
  console.log('✅ Test 1: Sin DEBUG_NOW devuelve la fecha real del sistema.');

  // Test 2: Modo Desarrollo con DEBUG_NOW válido
  process.env.NODE_ENV = 'development';
  process.env.DEBUG_NOW = '2026-08-28T18:30:00.000Z';
  assert.strictEqual(isDebugNowActive(), true, 'isDebugNowActive debe ser true');
  const t2 = getAhora();
  assert.strictEqual(t2.toISOString(), '2026-08-28T18:30:00.000Z', 'getAhora debe devolver la fecha simulada');
  console.log('✅ Test 2: En desarrollo con DEBUG_NOW devuelve la fecha simulada exacta.');

  // Test 3: BLINDAJE DE PRODUCCIÓN (NODE_ENV === 'production')
  process.env.NODE_ENV = 'production';
  process.env.DEBUG_NOW = '2026-08-28T18:30:00.000Z';
  assert.strictEqual(isDebugNowActive(), false, 'isDebugNowActive DEBE ser false en producción');
  const t3 = getAhora();
  assert(Math.abs(t3.getTime() - Date.now()) < 1000, 'getAhora DEBE ignorar DEBUG_NOW en producción');
  assert.notStrictEqual(t3.toISOString(), '2026-08-28T18:30:00.000Z', 'En producción nunca debe devolver la fecha simulada');
  console.log('✅ Test 3 (CRÍTICO): En producción DEBUG_NOW es completamente ignorado (blindaje 100%).');

  // Test 4: DEBUG_NOW con formato inválido en desarrollo
  process.env.NODE_ENV = 'development';
  process.env.DEBUG_NOW = 'fecha-invalida-123';
  const t4 = getAhora();
  assert(Math.abs(t4.getTime() - Date.now()) < 1000, 'getAhora debe hacer fallback a fecha real si DEBUG_NOW es inválido');
  console.log('✅ Test 4: Fallback seguro a fecha real ante strings inválidos.');

  console.log('\n🎉 TODOS LOS TESTS DE BLINDAJE DE DEBUG_NOW PASARON EXITOSAMENTE!');
} finally {
  if (originalNodeEnv !== undefined) process.env.NODE_ENV = originalNodeEnv;
  else delete process.env.NODE_ENV;

  if (originalDebugNow !== undefined) process.env.DEBUG_NOW = originalDebugNow;
  else delete process.env.DEBUG_NOW;
}
