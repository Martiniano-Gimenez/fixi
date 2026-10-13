const { ensureTestDb } = require('./utils/testEnvGuard');
const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');
const backendDateUtils = require('../src/utils/dateUtils');

async function main() {
  await ensureTestDb();
  console.log('🧪 Iniciando test: Equivalencia de Zona Horaria y Trasnoche (Backend vs Frontend)...\n');

  // 1. Verificación de entorno del proceso padre
  console.log('--- 1. Entorno del proceso padre (Backend) ---');
  assert.strictEqual(process.env.TZ, 'America/Argentina/Buenos_Aires', 'process.env.TZ debe ser America/Argentina/Buenos_Aires');
  const offset = new Date(2026, 0, 1, 12).getTimezoneOffset();
  assert.strictEqual(offset, 180, 'Offset de Argentina debe ser 180 min');
  console.log(`  ✓ Proceso backend fijado a: ${process.env.TZ} (offset: ${offset} min)`);

  // 2. Generación de la grilla de instantes (cada 15 minutos durante 9 días consecutivos + casos borde)
  console.log('\n--- 2. Generación de grilla de instantes y casos borde ---');

  // 9 días consecutivos que abarcan cambio de mes: 2026-10-25 00:00:00 UTC al 2026-11-03 00:00:00 UTC
  const testInstants = [];
  const startMs = Date.UTC(2026, 9, 25, 0, 0, 0); // 25 de Octubre 2026
  const endMs = Date.UTC(2026, 10, 3, 0, 0, 0);   // 3 de Noviembre 2026 (9 días después)
  const stepMs = 15 * 60 * 1000;                  // 15 minutos

  for (let ms = startMs; ms <= endMs; ms += stepMs) {
    testInstants.push(new Date(ms).toISOString());
  }

  // Casos borde explícitos (medianoche exacta en Argentina, 05:59, 06:00, cambio de mes exacto)
  const explicitEdges = [
    // Medianoche exacta en ART (03:00:00Z)
    '2026-10-24T03:00:00.000Z', // 00:00:00 ART
    '2026-10-31T03:00:00.000Z', // 00:00:00 ART (Sábado)
    '2026-11-01T03:00:00.000Z', // 00:00:00 ART (Domingo, cambio de mes)
    '2026-11-02T03:00:00.000Z', // 00:00:00 ART (Lunes)

    // 05:59:00 en ART (08:59:00Z)
    '2026-10-31T08:59:00.000Z', // 05:59:00 ART Sábado
    '2026-11-01T08:59:00.000Z', // 05:59:00 ART Domingo (cambio de mes)

    // 06:00:00 en ART (09:00:00Z - límite de corte por defecto)
    '2026-10-31T09:00:00.000Z', // 06:00:00 ART Sábado
    '2026-11-01T09:00:00.000Z', // 06:00:00 ART Domingo (cambio de mes)

    // 23:59:00 en ART (02:59:00Z del día siguiente en UTC)
    '2026-10-31T02:59:00.000Z', // 23:59:00 ART del Viernes 30
    '2026-11-01T02:59:00.000Z', // 23:59:00 ART del Sábado 31 (último minuto del mes)
  ];

  for (const edgeIso of explicitEdges) {
    if (!testInstants.includes(edgeIso)) {
      testInstants.push(edgeIso);
    }
  }

  // Configuraciones de horarios del club a evaluar
  const clubConfigs = [
    null,
    { sabadoInicio: '06:00', domingoInicio: '06:00' },
    { sabadoInicio: '08:00', domingoInicio: '08:00' },
    { sabadoInicio: '00:00', domingoInicio: '00:00' },
  ];

  const totalCombinations = testInstants.length * clubConfigs.length;
  console.log(`  ✓ Grilla generada: ${testInstants.length} instantes × ${clubConfigs.length} configs = ${totalCombinations} combinaciones`);

  // Construir matriz plana de casos
  const testCases = [];
  for (const iso of testInstants) {
    for (const horariosClub of clubConfigs) {
      testCases.push({ iso, horariosClub });
    }
  }

  // 3. Calcular la verdad de referencia con el backend (key, label, diaNombre, diaNumero)
  console.log('\n--- 3. Cálculo de referencia (Backend en TZ=America/Argentina/Buenos_Aires) ---');
  const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const backendResults = testCases.map((tc) => {
    const res = backendDateUtils.getDiaCalendarioConTrasnoche(tc.iso, tc.horariosClub);
    if (!res) return null;
    const diaNombre = DIAS_SEMANA[res.logicalDate.getDay()];
    const diaNumero = res.logicalDate.getDate();
    const label = `${diaNombre} ${diaNumero}`;
    return { key: res.key, label, diaNombre, diaNumero };
  });
  console.log(`  ✓ ${backendResults.length} resultados completos calculados por el backend (key, label, diaNombre, diaNumero).`);

  // 4. Ejecutar el helper del frontend en procesos hijos aislados con distintas zonas horarias
  console.log('\n--- 4. Validación de equivalencia en procesos hijos del frontend ---');
  const workerPath = path.resolve(__dirname, 'utils/frontend-date-worker.js');
  const timezonesToTest = ['UTC', 'Europe/Madrid', 'Asia/Tokyo'];

  for (const tz of timezonesToTest) {
    console.log(`  Probando frontend con TZ=${tz}...`);
    const stdout = execFileSync(process.execPath, [workerPath], {
      env: { ...process.env, TZ: tz },
      input: JSON.stringify(testCases),
      maxBuffer: 50 * 1024 * 1024,
    }).toString();

    const frontendResults = JSON.parse(stdout);
    assert.strictEqual(
      frontendResults.length,
      backendResults.length,
      `La cantidad de resultados en TZ=${tz} debe ser idéntica`
    );

    let mismatches = 0;
    for (let i = 0; i < backendResults.length; i++) {
      const b = backendResults[i];
      const f = frontendResults[i];
      if (!b && !f) continue;
      if (!b || !f || b.key !== f.key || b.label !== f.label || b.diaNombre !== f.diaNombre || b.diaNumero !== f.diaNumero) {
        mismatches++;
        if (mismatches <= 5) {
          console.error(
            `    ❌ DISCREPANCIA en #${i}: instant=${testCases[i].iso}, config=${JSON.stringify(testCases[i].horariosClub)}\n` +
            `       Backend:  key=${b?.key}, label="${b?.label}", diaNombre="${b?.diaNombre}", diaNumero=${b?.diaNumero}\n` +
            `       Frontend: key=${f?.key}, label="${f?.label}", diaNombre="${f?.diaNombre}", diaNumero=${f?.diaNumero}`
          );
        }
      }
    }

    assert.strictEqual(
      mismatches,
      0,
      `Se encontraron ${mismatches} discrepancias entre backend y frontend en TZ=${tz}`
    );
    console.log(`  ✓ TZ=${tz}: 100% de coincidencia exacta en (key, label, diaNombre, diaNumero) (${frontendResults.length}/${frontendResults.length} casos OK).`);
  }

  // 5. Verificación de formateo de medianoche (00:xx)
  console.log('\n--- 5. Verificación de formateo de medianoche (00:xx) ---');
  const frontendHelperPath = path.resolve(__dirname, '../../frontend/src/utils/dateUtils.js');
  const frontendMod = await import('file:///' + frontendHelperPath.replace(/\\/g, '/'));

  // 00:00:00 ART (03:00:00Z)
  const midnightIso = '2026-10-17T03:00:00.000Z';
  const midnight15Iso = '2026-10-17T03:15:00.000Z';

  const horaMidnight = frontendMod.formatHora(midnightIso);
  const diaHorarioMidnight = frontendMod.formatDiaHorario(midnightIso);
  const partidoHorarioMidnight = frontendMod.formatPartidoHorario(midnightIso);

  assert.strictEqual(horaMidnight, '00:00', `formatHora en medianoche debe ser "00:00", obtenido: "${horaMidnight}"`);
  assert(diaHorarioMidnight.includes('00:00'), `formatDiaHorario debe contener "00:00", obtenido: "${diaHorarioMidnight}"`);
  assert(!diaHorarioMidnight.includes('24:00'), `formatDiaHorario NUNCA debe contener "24:00", obtenido: "${diaHorarioMidnight}"`);
  assert(partidoHorarioMidnight.includes('00:00'), `formatPartidoHorario debe contener "00:00", obtenido: "${partidoHorarioMidnight}"`);
  assert(!partidoHorarioMidnight.includes('24:00'), `formatPartidoHorario NUNCA debe contener "24:00", obtenido: "${partidoHorarioMidnight}"`);

  const hora15 = frontendMod.formatHora(midnight15Iso);
  assert.strictEqual(hora15, '00:15', `formatHora a las 00:15 debe ser "00:15", obtenido: "${hora15}"`);
  console.log(`  ✓ Medianoche exacta: formatHora="${horaMidnight}", formatDiaHorario="${diaHorarioMidnight}", formatPartidoHorario="${partidoHorarioMidnight}"`);
  console.log(`  ✓ 00:15 hs: formatHora="${hora15}"`);

  // 6. Verificación de formatFechaTorneo ("9 de octubre de 2026")
  console.log('\n--- 6. Verificación de formatFechaTorneo ---');
  const fechaPlana = '2026-10-09';
  const fechaMediodiaUtc = '2026-10-09T15:00:00.000Z';
  const fechaMedianocheUtc = '2026-10-09T00:00:00.000Z';

  const resPlana = frontendMod.formatFechaTorneo(fechaPlana);
  const resMediodia = frontendMod.formatFechaTorneo(fechaMediodiaUtc);
  const resMedianoche = frontendMod.formatFechaTorneo(fechaMedianocheUtc);

  assert.strictEqual(resPlana, '9 de octubre de 2026', `formatFechaTorneo('2026-10-09') debe ser '9 de octubre de 2026', obtenido: "${resPlana}"`);
  assert.strictEqual(resMediodia, '9 de octubre de 2026', `formatFechaTorneo(mediodía) debe ser '9 de octubre de 2026', obtenido: "${resMediodia}"`);
  assert.strictEqual(resMedianoche, '9 de octubre de 2026', `formatFechaTorneo(medianoche UTC) debe ser '9 de octubre de 2026', obtenido: "${resMedianoche}"`);
  console.log(`  ✓ String '2026-10-09'       -> "${resPlana}"`);
  console.log(`  ✓ Mediodía (15:00Z)         -> "${resMediodia}"`);
  console.log(`  ✓ Medianoche UTC (00:00Z)   -> "${resMedianoche}"`);

  // 7. Verificación de rotulado de slot de trasnoche a día calendario
  console.log('\n--- 7. Verificación de rotulado de slot de trasnoche a día calendario ---');
  const casosSlot = [
    { slot: 'Sabado-00:00', esperado: 'Domingo 00:00' },
    { slot: 'Sabado-00:45', esperado: 'Domingo 00:45' },
    { slot: 'Sabado-13:30', esperado: 'Sábado 13:30' },
    { slot: 'Viernes-00:00', esperado: 'Sábado 00:00' },
    { slot: 'Viernes-12:00', esperado: 'Viernes 12:00' },
    { slot: 'Sabado-06:00', esperado: 'Sábado 06:00' },
  ];

  for (const { slot, esperado } of casosSlot) {
    const obtenido = frontendMod.formatSlotCalendario(slot);
    assert.strictEqual(
      obtenido,
      esperado,
      `formatSlotCalendario('${slot}') debe ser '${esperado}', obtenido: '${obtenido}'`
    );
    const parsed = frontendMod.getSlotCalendario(slot);
    assert.strictEqual(parsed.texto, esperado, `getSlotCalendario('${slot}').texto debe ser '${esperado}'`);
    console.log(`  ✓ '${slot}' -> "${obtenido}"`);
  }

  console.log('\n🎉 TODAS LAS PRUEBAS DE EQUIVALENCIA FRONTEND/BACKEND PASARON AL 100%!');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ ERROR EN TEST DE PARIDAD DE ZONA HORARIA:', err);
    process.exit(1);
  });
