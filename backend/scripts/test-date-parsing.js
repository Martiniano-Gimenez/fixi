const { ensureTestDb } = require('./utils/testEnvGuard');
const assert = require('assert');
const { parseFechaLocal, requireTorneoFecha, getDiaCalendarioConTrasnoche } = require('../src/utils/dateUtils');

async function main() {
  await ensureTestDb();
  console.log('🧪 Iniciando tests unitarios para parseFechaLocal y requireTorneoFecha...\n');

// Test 1: String "YYYY-MM-DD" da Viernes y día exacto
const fechaStr = '2026-08-28';
const d1 = parseFechaLocal(fechaStr);
assert(d1 instanceof Date, 'd1 debe ser instancia de Date');
assert.strictEqual(d1.getFullYear(), 2026, 'Año debe ser 2026');
assert.strictEqual(d1.getMonth(), 7, 'Mes debe ser Agosto (7)');
assert.strictEqual(d1.getDate(), 28, 'Día debe ser 28');
assert.strictEqual(d1.getDay(), 5, 'Día de la semana DEBE ser Viernes (5)');
console.log('✅ Test 1: parseFechaLocal("2026-08-28") interpreta correctamente Viernes 28 de Agosto.');

// Test 2: Date object (ej. retornado por Prisma)
const prismaDate = new Date('2026-08-28T12:00:00.000Z');
const d2 = parseFechaLocal(prismaDate);
assert(d2 instanceof Date, 'd2 debe ser instancia de Date');
assert.strictEqual(d2.getFullYear(), 2026, 'Año debe ser 2026');
assert.strictEqual(d2.getMonth(), 7, 'Mes debe ser Agosto (7)');
assert.strictEqual(d2.getDate(), 28, 'Día debe ser 28');
assert.strictEqual(d2.getDay(), 5, 'Día de la semana DEBE ser Viernes (5)');
console.log('✅ Test 2: parseFechaLocal con objeto Date de Prisma preserva día y día de semana exacto.');

// Test 3: Casos nulos o vacíos
assert.strictEqual(parseFechaLocal(null), null, 'null debe devolver null');
assert.strictEqual(parseFechaLocal(undefined), null, 'undefined debe devolver null');
assert.strictEqual(parseFechaLocal(''), null, 'string vacío debe devolver null');
assert.strictEqual(parseFechaLocal('fecha-invalida'), null, 'string inválido debe devolver null');
console.log('✅ Test 3: parseFechaLocal maneja null, undefined y valores inválidos retornando null.');

// Test 4: requireTorneoFecha con torneo válido
const torneoOk = { id: 'torneo-1', nombre: 'Pares Agosto', fecha: '2026-08-28' };
const d4 = requireTorneoFecha(torneoOk);
assert.strictEqual(d4.getDay(), 5, 'requireTorneoFecha devuelve fecha parseada');
console.log('✅ Test 4: requireTorneoFecha con torneo válido retorna Date local.');

// Test 5: requireTorneoFecha sin fecha lanza Error 400
let errorLanzado = false;
try {
  requireTorneoFecha({ id: 'torneo-2', nombre: 'Sin fecha', fecha: null });
} catch (err) {
  errorLanzado = true;
  assert.strictEqual(err.statusCode, 400, 'Status code debe ser 400');
  assert.strictEqual(err.message, 'El torneo debe tener una fecha definida para asignar horarios.');
}
assert(errorLanzado, 'requireTorneoFecha DEBE lanzar error si no hay fecha');

let errorLanzado2 = false;
try {
  requireTorneoFecha(null);
} catch (err) {
  errorLanzado2 = true;
  assert.strictEqual(err.statusCode, 400);
}
assert(errorLanzado2, 'requireTorneoFecha DEBE lanzar error si el torneo es null');
console.log('✅ Test 5: requireTorneoFecha lanza HTTP 400 si falta la fecha.');

// Test 6: Simulación de Sábado (fecha + 1 día)
const dSabado = parseFechaLocal('2026-08-29');
assert.strictEqual(dSabado.getDay(), 6, 'Día debe ser Sábado (6)');
assert.strictEqual(dSabado.getDate(), 29, 'Día debe ser 29');
console.log('✅ Test 6: parseFechaLocal("2026-08-29") da Sábado 29 correctamente.');

// Test 7: Trasnoche (Sábado 01:00 AM pertenece al Viernes lógico de torneo)
const clubHorarios = { viernesInicio: '18:00', viernesFin: '02:00', sabadoInicio: '09:00', sabadoFin: '22:00' };
const fechaTrasnoche = new Date(2026, 7, 29, 1, 0, 0); // Sábado 01:00 AM
const diaTrasnocheInfo = getDiaCalendarioConTrasnoche(fechaTrasnoche, clubHorarios);
assert.strictEqual(diaTrasnocheInfo.key, '2026-08-28', 'Sábado 01:00 AM debe mapear al Viernes lógico 2026-08-28');
assert.strictEqual(diaTrasnocheInfo.logicalDate.getDay(), 5, 'El día lógico debe ser Viernes (5)');
console.log('✅ Test 7: getDiaCalendarioConTrasnoche mapea Sábado 01:00 AM al Viernes lógico del torneo.');

// Test 8: parseSlotToDate con trasnoche ("Viernes-00:00" es posterior a "Viernes-23:45" y pertenece al Viernes lógico)
const { parseSlotToDate } = require('../src/services/zona.service');
const refTorneo = '2026-09-04'; // Viernes 4 de Septiembre
const tVie20 = parseSlotToDate('Viernes-20:00', refTorneo);
const tVie00 = parseSlotToDate('Viernes-00:00', refTorneo);
const tVie01 = parseSlotToDate('Viernes-01:30', refTorneo);

assert(tVie00.getTime() > tVie20.getTime(), '"Viernes-00:00" debe ser cronológicamente posterior a "Viernes-20:00"');
assert(tVie01.getTime() > tVie00.getTime(), '"Viernes-01:30" debe ser cronológicamente posterior a "Viernes-00:00"');

// Al evaluar Viernes-00:00 en getDiaCalendarioConTrasnoche debe mapear a Viernes 4 de Septiembre (NUNCA Jueves 3)
const infoVie00 = getDiaCalendarioConTrasnoche(tVie00, clubHorarios);
assert.strictEqual(infoVie00.key, '2026-09-04', '"Viernes-00:00" debe pertenecer al Viernes 2026-09-04');
assert.strictEqual(infoVie00.logicalDate.getDay(), 5, '"Viernes-00:00" debe tener día lógico Viernes');
console.log('✅ Test 8: parseSlotToDate("Viernes-00:00") ubica la trasnoche en la madrugada correcta y mapea al Viernes lógico.');

  console.log('\n🎉 TODOS LOS TESTS DE PARSEO Y VALIDACIÓN DE FECHAS PASARON EXITOSAMENTE!');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ ERROR EN TEST:', err);
    process.exit(1);
  });
