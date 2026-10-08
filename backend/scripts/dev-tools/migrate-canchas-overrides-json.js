const fs = require('fs');
const path = require('path');
const prisma = require('../../src/lib/prisma');
const { getDiaCalendarioConTrasnoche } = require('../../src/utils/dateUtils');
const { requireConfirmarDev, crearBackupDevDb } = require('./devUtils');

const DATA_DIR = path.join(__dirname, '..', '..', 'src', 'data');
const JSON_FILE = path.join(DATA_DIR, 'canchasOverrides.json');

async function migrateOverrides() {
  const isDryRun = process.argv.includes('--dry-run');

  if (!isDryRun) {
    requireConfirmarDev('migrate-canchas-overrides-json.js');
    crearBackupDevDb();
  }

  console.log(`\n======================================================`);
  console.log(`📦 SCRIPT DE MIGRACIÓN: CANCHAS OVERRIDES JSON -> DB (DEV-TOOLS)`);
  console.log(`Modo: ${isDryRun ? 'DRY-RUN (Simulación, no escribe en base)' : 'EJECUCIÓN REAL (Escribe en DB)'}`);
  console.log(`======================================================\n`);

  if (!fs.existsSync(JSON_FILE)) {
    console.error(`ERROR: Archivo no encontrado en ${JSON_FILE}`);
    process.exit(1);
  }

  // 1. Copia de seguridad del JSON antes de leerlo
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(DATA_DIR, `canchasOverrides.backup.${timestamp}.json`);
  fs.copyFileSync(JSON_FILE, backupFile);
  console.log(`🔒 Copia de seguridad creada: ${backupFile}\n`);

  const rawData = fs.readFileSync(JSON_FILE, 'utf8');
  const overridesData = JSON.parse(rawData || '{}');

  const stats = {
    jsonTorneosTotal: Object.keys(overridesData).length,
    jsonTorneosOmitidosInexistentes: 0,
    jsonOverridesImportados: 0,
    dbEscalaresRevisados: 0,
    dbEscalaresYaEnJson: 0,
    dbEscalaresReportadosNoImportados: 0,
    dbEscalaresDecisionManual: 0,
  };

  const torneosInexistentes = [];
  const overridesJsonAImportar = [];

  // 2. Procesar contenido del JSON
  console.log(`--- Paso 1: Analizando overrides en canchasOverrides.json ---`);
  for (const [torneoId, diasObj] of Object.entries(overridesData)) {
    const torneo = await prisma.torneo.findUnique({
      where: { id: torneoId },
      select: { id: true, nombre: true },
    });

    if (!torneo) {
      stats.jsonTorneosOmitidosInexistentes++;
      torneosInexistentes.push({
        torneoId,
        dias: Object.keys(diasObj),
      });
      console.log(`⚠️  [OMITIDO] Torneo inexistente en DB: ${torneoId} (Días: ${Object.keys(diasObj).join(', ')})`);
      continue;
    }

    for (const [diaKey, info] of Object.entries(diasObj)) {
      overridesJsonAImportar.push({
        torneoId,
        torneoNombre: torneo.nombre,
        diaKey,
        canchas: Number(info.canchas),
        isLluvia: info.isLluvia !== undefined ? Boolean(info.isLluvia) : true,
        activoDesde: info.activoDesde ? new Date(info.activoDesde) : new Date(),
        partidosSinSlot: info.partidosSinSlot || {},
      });
      stats.jsonOverridesImportados++;
      console.log(`✅  [JSON -> DB] Torneo "${torneo.nombre}" (${torneoId}) | Día: ${diaKey} | Canchas: ${info.canchas} | ActivoDesde: ${info.activoDesde}`);
    }
  }

  // 3. Revisar Torneo.canchasDisponiblesOverride / overrideActivoDesde en DB
  console.log(`\n--- Paso 2: Analizando overrides escalares de Torneo en DB ---`);
  const torneosDb = await prisma.torneo.findMany({
    where: {
      OR: [
        { canchasDisponiblesOverride: { not: null } },
        { overrideActivoDesde: { not: null } },
      ],
    },
    include: { organizador: true },
  });

  stats.dbEscalaresRevisados = torneosDb.length;
  const escalaresAImportar = [];
  const escalaresManuales = [];

  for (const t of torneosDb) {
    const tieneEnJson = overridesData[t.id] && Object.keys(overridesData[t.id]).length > 0;
    if (tieneEnJson) {
      stats.dbEscalaresYaEnJson++;
      console.log(`ℹ️  [YA CUBIERTO] Torneo "${t.nombre}" (${t.id}) ya posee registro en JSON.`);
      continue;
    }

    if (!t.canchasDisponiblesOverride) {
      stats.dbEscalaresDecisionManual++;
      escalaresManuales.push({
        torneoId: t.id,
        nombre: t.nombre,
        motivo: 'canchasDisponiblesOverride es null pero overrideActivoDesde tiene valor',
        activoDesde: t.overrideActivoDesde,
      });
      console.log(`⚠️  [DECISIÓN MANUAL] Torneo "${t.nombre}" (${t.id}): canchasDisponiblesOverride es null.`);
      continue;
    }

    // Intentar deducir diaKey a partir de overrideActivoDesde o fecha de torneo
    const fechaRef = t.overrideActivoDesde || t.fecha;
    let diaKey = null;

    if (fechaRef && t.organizador) {
      const horariosClub = {
        viernesInicio: t.organizador.viernesInicio,
        viernesFin: t.organizador.viernesFin,
        sabadoInicio: t.organizador.sabadoInicio,
        sabadoFin: t.organizador.sabadoFin,
        domingoInicio: t.organizador.domingoInicio,
        domingoFin: t.organizador.domingoFin,
      };
      const diaInfo = getDiaCalendarioConTrasnoche(fechaRef, horariosClub);
      if (diaInfo && diaInfo.key) {
        diaKey = diaInfo.key;
      }
    }

    if (diaKey) {
      stats.dbEscalaresReportadosNoImportados++;
      console.log(`ℹ️  [ESCALAR REPORTADO - NO IMPORTAR] Torneo "${t.nombre}" (${t.id}) | diaKey deducido: ${diaKey} | Canchas: ${t.canchasDisponiblesOverride}`);
    } else {
      stats.dbEscalaresDecisionManual++;
      escalaresManuales.push({
        torneoId: t.id,
        nombre: t.nombre,
        motivo: 'No se pudo determinar diaKey de forma segura (sin fecha/horarios válidos)',
        activoDesde: t.overrideActivoDesde,
      });
      console.log(`⚠️  [ESCALAR SIN DIAKEY] Torneo "${t.nombre}" (${t.id}): No se pudo determinar diaKey.`);
    }
  }

  // 4. Si NO es dry-run, aplicar upserts a la base de datos (SOLO los del JSON)
  if (!isDryRun) {
    console.log(`\n--- Paso 3: Aplicando registros en tabla OverrideCanchasDia (solo JSON existente) ---`);
    for (const item of overridesJsonAImportar) {
      await prisma.overrideCanchasDia.upsert({
        where: {
          torneoId_diaKey: {
            torneoId: item.torneoId,
            diaKey: item.diaKey,
          },
        },
        create: {
          torneoId: item.torneoId,
          diaKey: item.diaKey,
          canchas: item.canchas,
          isLluvia: item.isLluvia,
          activoDesde: item.activoDesde,
          partidosSinSlot: item.partidosSinSlot,
        },
        update: {
          canchas: item.canchas,
          isLluvia: item.isLluvia,
          activoDesde: item.activoDesde,
          partidosSinSlot: item.partidosSinSlot,
        },
      });
      console.log(`💾 Upsert exitoso: Torneo ${item.torneoNombre} - Día ${item.diaKey}`);
    }
  }

  // 5. Resumen final
  console.log(`\n======================================================`);
  console.log(`📊 REPORTE FINAL DE MIGRACIÓN`);
  console.log(`======================================================`);
  console.log(`Total torneos en JSON: ${stats.jsonTorneosTotal}`);
  console.log(`Torneos en JSON inexistentes en DB (omitidos): ${stats.jsonTorneosOmitidosInexistentes}`);
  console.log(`Overrides desde JSON a migrar: ${stats.jsonOverridesImportados}`);
  console.log(`Torneos con override escalar en DB: ${stats.dbEscalaresRevisados}`);
  console.log(`  - Ya cubiertos en JSON: ${stats.dbEscalaresYaEnJson}`);
  console.log(`  - Escalares reportados, no importados (diaKey deducible): ${stats.dbEscalaresReportadosNoImportados}`);
  console.log(`  - Escalares para decisión manual: ${stats.dbEscalaresDecisionManual}`);
  if (escalaresManuales.length > 0) {
    console.log(`\nDetalle de torneos para decisión manual:`);
    for (const m of escalaresManuales) {
      console.log(`  * ${m.torneoId} ("${m.nombre}"): ${m.motivo}`);
    }
  }
  if (torneosInexistentes.length > 0) {
    console.log(`\nDetalle de torneos inexistentes omitidos:`);
    for (const o of torneosInexistentes) {
      console.log(`  * ${o.torneoId}: Días ${o.dias.join(', ')}`);
    }
  }
  console.log(`======================================================\n`);
}

migrateOverrides()
  .catch((err) => {
    console.error('ERROR durante la migración:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
