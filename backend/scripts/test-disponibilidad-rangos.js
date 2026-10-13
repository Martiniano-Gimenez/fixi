const { ensureTestDb } = require('./utils/testEnvGuard');
const assert = require('assert');
const path = require('path');
const { generarSlotsDia } = require('../src/services/slots.service');

async function main() {
  await ensureTestDb();
  console.log('🧪 Iniciando test: Idempotencia y Reconstrucción de Rangos de Disponibilidad...\n');

  // Import dinámico de las utilidades puras del frontend
  const frontendHelperPath = path.resolve(__dirname, '../../frontend/src/utils/disponibilidadUtils.js');
  const {
    reconstruirRangos,
    rangosASlots,
    areSlotArraysEqual,
  } = await import('file:///' + frontendHelperPath.replace(/\\/g, '/'));

  const grillaViernes = generarSlotsDia('Viernes', '12:00', '02:00');
  const grillaSabado = generarSlotsDia('Sabado', '08:00', '02:00');
  const maxIdxViernes = grillaViernes.length - 1;

  console.log(`  Grilla Viernes: ${grillaViernes.length} slots (${grillaViernes[0]} a ${grillaViernes[maxIdxViernes]})`);
  console.log(`  Grilla Sábado: ${grillaSabado.length} slots (${grillaSabado[0]} a ${grillaSabado[grillaSabado.length - 1]})`);

  // --- Caso 1: Rango 12:00 a 20:00 (Idempotencia) ---
  console.log('\n--- 1. Rango 12:00 a 20:00 (Idempotencia) ---');
  const r1 = [{ startIdx: 0, endIdx: 32 }]; // 0: 12:00, 32: 20:00
  const s1 = rangosASlots(r1, grillaViernes);
  assert.strictEqual(s1.length, 33, 'Deben generarse 33 slots de 15 min para 12:00-20:00');

  const rec1 = reconstruirRangos(s1, grillaViernes, 'Viernes');
  assert.strictEqual(rec1.length, 1, 'Debe haber exactamente 1 rango');
  assert.strictEqual(rec1[0].startIdx, 0, 'startIdx debe mantenerse en 0 (12:00)');
  assert.strictEqual(rec1[0].endIdx, 32, 'endIdx debe mantenerse en 32 (20:00), sin inflarse');

  const s1_rec = rangosASlots(rec1, grillaViernes);
  assert.strictEqual(areSlotArraysEqual(s1, s1_rec), true, 'Los slots generados deben ser idénticos');

  // Segunda y tercera iteración: verificar idempotencia continua
  const rec1_iter2 = reconstruirRangos(s1_rec, grillaViernes, 'Viernes');
  assert.strictEqual(rec1_iter2[0].endIdx, 32, 'Segunda iteración debe conservar endIdx: 32');
  const rec1_iter3 = reconstruirRangos(rangosASlots(rec1_iter2, grillaViernes), grillaViernes, 'Viernes');
  assert.strictEqual(rec1_iter3[0].endIdx, 32, 'Tercera iteración debe conservar endIdx: 32');
  console.log('  ✓ 12:00-20:00 es estrictamente idempotente a través de múltiples ciclos de conversión.');

  // --- Caso 2: Rango pegado al final de la grilla ---
  console.log('\n--- 2. Rango pegado al final de la grilla ---');
  const r2 = [{ startIdx: 40, endIdx: maxIdxViernes }]; // 22:00 hasta 00:45
  const s2 = rangosASlots(r2, grillaViernes);
  const rec2 = reconstruirRangos(s2, grillaViernes, 'Viernes');
  assert.strictEqual(rec2.length, 1, 'Debe haber exactamente 1 rango');
  assert.strictEqual(rec2[0].startIdx, 40, 'startIdx debe conservarse');
  assert.strictEqual(rec2[0].endIdx, maxIdxViernes, 'endIdx debe ser el último slot de la grilla');
  const s2_rec = rangosASlots(rec2, grillaViernes);
  assert.strictEqual(areSlotArraysEqual(s2, s2_rec), true, 'Slots deben ser idénticos');
  console.log('  ✓ Rango al final de la grilla se preserva fielmente sin desbordes.');

  // --- Caso 3: Dos rangos separados por un hueco de dos turnos (no se fusionan) ---
  console.log('\n--- 3. Dos rangos separados por un hueco de 2 turnos ---');
  // Rango 1: 0..16 (12:00 a 16:00). Hueco: 17 (16:15) y 18 (16:30) no seleccionados. Rango 2: 19..30 (16:45 a 19:30)
  const r3 = [
    { startIdx: 0, endIdx: 16 },
    { startIdx: 19, endIdx: 30 },
  ];
  const s3 = rangosASlots(r3, grillaViernes);
  const rec3 = reconstruirRangos(s3, grillaViernes, 'Viernes');
  assert.strictEqual(rec3.length, 2, 'Los dos rangos NO deben fusionarse cuando hay un hueco');
  assert.strictEqual(rec3[0].startIdx, 0, 'Rango 1 debe iniciar en 0');
  assert.strictEqual(rec3[0].endIdx, 16, 'Rango 1 debe finalizar en 16 (16:00)');
  assert.strictEqual(rec3[1].startIdx, 19, 'Rango 2 debe iniciar en 19 (16:45)');
  assert.strictEqual(rec3[1].endIdx, 30, 'Rango 2 debe finalizar en 30 (19:30)');
  const s3_rec = rangosASlots(rec3, grillaViernes);
  assert.strictEqual(areSlotArraysEqual(s3, s3_rec), true, 'Slots de ambos rangos deben coincidir');
  console.log('  ✓ Dos rangos con separación de 2 turnos se conservan separados sin puentes artificiales.');

  // --- Caso 4: Mover un extremo un paso cambia el slot final exactamente en uno ---
  console.log('\n--- 4. Mover un extremo un paso cambia exactamente en uno ---');
  // Incrementar 1 paso: de 32 a 33
  const r4_plus1 = [{ startIdx: 0, endIdx: 33 }];
  const s4_plus1 = rangosASlots(r4_plus1, grillaViernes);
  const rec4_plus1 = reconstruirRangos(s4_plus1, grillaViernes, 'Viernes');
  assert.strictEqual(rec4_plus1[0].endIdx, 33, 'Incrementar 1 paso debe dar endIdx: 33 (exactamente +1)');

  // Decrementar 1 paso: de 32 a 31
  const r4_minus1 = [{ startIdx: 0, endIdx: 31 }];
  const s4_minus1 = rangosASlots(r4_minus1, grillaViernes);
  const rec4_minus1 = reconstruirRangos(s4_minus1, grillaViernes, 'Viernes');
  assert.strictEqual(rec4_minus1[0].endIdx, 31, 'Decrementar 1 paso debe dar endIdx: 31 (exactamente -1)');
  console.log('  ✓ Desplazar un extremo 1 paso refleja un cambio exacto de +-1 slot en el horario final.');

  // --- Caso 5: Compatibilidad con slots aislados del formato legacy (75 min) ---
  console.log('\n--- 5. Compatibilidad con slots aislados de 75 min (formato legacy) ---');
  // Slot único aislado 'Viernes-18:00' (índice 24): debe expandirse a 5 turnos de 15 min (24 a 28)
  const idx18 = grillaViernes.indexOf('Viernes-18:00');
  const rec5_unico = reconstruirRangos(['Viernes-18:00'], grillaViernes, 'Viernes');
  assert.strictEqual(rec5_unico.length, 1, 'Debe reconstruirse 1 rango para el slot aislado');
  assert.strictEqual(rec5_unico[0].startIdx, idx18, 'startIdx debe ser el slot inicial');
  assert.strictEqual(rec5_unico[0].endIdx, idx18 + 4, 'endIdx debe expandirse 4 turnos (+60 min = 75 min de partido)');
  assert.strictEqual(grillaViernes[rec5_unico[0].endIdx], 'Viernes-19:00', 'Debe terminar en Viernes-19:00');

  // Dos slots aislados legacy distanciados ('Viernes-14:00' idx 8 y 'Viernes-16:30' idx 18)
  const rec5_doble = reconstruirRangos(['Viernes-14:00', 'Viernes-16:30'], grillaViernes, 'Viernes');
  assert.strictEqual(rec5_doble.length, 2, 'Deben reconstruirse 2 rangos independientes');
  assert.strictEqual(rec5_doble[0].startIdx, 8);
  assert.strictEqual(rec5_doble[0].endIdx, 12, '14:00 debe expandir a 14:00-15:00 (5 slots)');
  assert.strictEqual(rec5_doble[1].startIdx, 18);
  assert.strictEqual(rec5_doble[1].endIdx, 22, '16:30 debe expandir a 16:30-17:30 (5 slots)');
  console.log('  ✓ Slots aislados legacy de 75 min se expanden a su ventana completa de partido.');

  // --- Caso 6: Helper areSlotArraysEqual ---
  console.log('\n--- 6. Helper areSlotArraysEqual ---');
  assert.strictEqual(areSlotArraysEqual(['a', 'b'], ['b', 'a']), true, 'Mismos elementos en distinto orden deben ser iguales');
  assert.strictEqual(areSlotArraysEqual(['a'], ['b']), false, 'Distintos elementos deben ser falsos');
  assert.strictEqual(areSlotArraysEqual(['a'], ['a', 'b']), false, 'Distinta longitud debe ser falso');
  assert.strictEqual(areSlotArraysEqual([], []), true, 'Arrays vacíos deben ser iguales');
  console.log('  ✓ areSlotArraysEqual valida conjuntos correctamente.');

  console.log('\n✅ Todos los tests de idempotencia y disponibilidad pasaron exitosamente.');
}

main().catch((err) => {
  console.error('\n❌ ERROR EN EL TEST:', err);
  process.exit(1);
});
