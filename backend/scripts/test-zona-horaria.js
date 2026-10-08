const { ensureTestDb } = require('./utils/testEnvGuard');
const assert = require('assert');
const { parseFechaLocal, getDiaCalendarioConTrasnoche } = require('../src/utils/dateUtils');
const { parseSlotToDate } = require('../src/services/zona.service');

async function main() {
  await ensureTestDb();
  console.log('🧪 Iniciando test: Blindaje y Forzado de Zona Horaria (America/Argentina/Buenos_Aires)...\n');

  // Test 0: Verificación directa de process.env.TZ y getTimezoneOffset
  console.log('--- 0. Verificación de entorno del proceso ---');
  assert.strictEqual(process.env.TZ, 'America/Argentina/Buenos_Aires', 'process.env.TZ debe ser America/Argentina/Buenos_Aires');
  const offset = new Date(2026, 0, 1, 12).getTimezoneOffset();
  assert.strictEqual(offset, 180, 'El offset del proceso debe ser exactamente 180 minutos (UTC-3)');
  console.log(`  ✓ Zona horaria del proceso: ${process.env.TZ} (offset: ${offset} min)`);

  // Test 1: parseSlotToDate produce instante exacto T22:00:00.000Z
  console.log('\n--- 1. Slot de partido: parseSlotToDate("Viernes-19:00") ---');
  const refFecha = '2026-10-09'; // Viernes
  const slotDate = parseSlotToDate('Viernes-19:00', refFecha);
  assert(slotDate instanceof Date, 'slotDate debe ser Date');
  const isoSlot = slotDate.toISOString();
  assert(
    isoSlot.endsWith('T22:00:00.000Z'),
    `parseSlotToDate('Viernes-19:00') debe producir un instante que termine en T22:00:00.000Z, obtenido: ${isoSlot}`
  );
  console.log(`  ✓ Slot 'Viernes-19:00' generado como: ${isoSlot} (correcto: 19:00 ART == 22:00Z)`);

  // Test 2: Trasnoche (Sábado 01:00 ART == 04:00Z) clasifica en Viernes lógico
  console.log('\n--- 2. Trasnoche: getDiaCalendarioConTrasnoche ---');
  const matchDateTrasnoche = new Date('2026-10-10T04:00:00.000Z'); // Sábado 01:00 ART
  const clubHorarios = { sabadoInicio: '08:00', sabadoFin: '23:00' };
  const diaInfo = getDiaCalendarioConTrasnoche(matchDateTrasnoche, clubHorarios);
  assert.strictEqual(diaInfo.key, '2026-10-09', 'Sábado 01:00 ART debe clasificarse en la jornada lógica de Viernes (2026-10-09)');
  assert.strictEqual(diaInfo.logicalDate.getDay(), 5, 'El día de la semana lógico debe ser Viernes (5)');
  console.log(`  ✓ Partido 01:00 ART (04:00Z) asignado a jornada lógica: ${diaInfo.key} (día semana: ${diaInfo.logicalDate.getDay()})`);

  // Test 3: Límite del día lógico (dayLimitMs) corresponde a las 06:00 ART
  console.log('\n--- 3. Límite del día lógico (dayLimitMs) ---');
  const diaInfoCorte06 = getDiaCalendarioConTrasnoche(matchDateTrasnoche, { sabadoInicio: '06:00' });
  const dayLimitDate = new Date(diaInfoCorte06.dayLimitMs);
  const dayLimitIso = dayLimitDate.toISOString();
  assert.strictEqual(
    dayLimitIso,
    '2026-10-10T09:00:00.000Z',
    `dayLimitMs debe corresponder a las 06:00 ART (09:00Z), obtenido: ${dayLimitIso}`
  );
  assert.strictEqual(dayLimitDate.getHours(), 6, 'La hora local del dayLimitDate debe ser 6');
  console.log(`  ✓ dayLimitMs corresponde a: ${dayLimitIso} (06:00 ART local)`);

  // Test 4: parseFechaLocal('2026-10-09') da mediodía ART (15:00Z)
  console.log('\n--- 4. parseFechaLocal("2026-10-09") ---');
  const parsedFecha = parseFechaLocal('2026-10-09');
  assert(parsedFecha instanceof Date, 'parsedFecha debe ser Date');
  const parsedIso = parsedFecha.toISOString();
  assert.strictEqual(
    parsedIso,
    '2026-10-09T15:00:00.000Z',
    `parseFechaLocal('2026-10-09') debe dar el mediodía ART (15:00Z), obtenido: ${parsedIso}`
  );
  assert.strictEqual(parsedFecha.getHours(), 12, 'parsedFecha.getHours() debe ser 12 (mediodía)');
  console.log(`  ✓ parseFechaLocal('2026-10-09') generado como: ${parsedIso} (mediodía 12:00 ART == 15:00Z)`);

  console.log('\n🎉 TODOS LOS CHEQUEOS DE ZONA HORARIA PASARON CON ÉXITO AL 100%!');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ ERROR EN TEST DE ZONA HORARIA:', err);
    process.exit(1);
  });
