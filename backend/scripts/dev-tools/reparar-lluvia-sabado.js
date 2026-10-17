'use strict';

/**
 * Script puntual para reparar los partidos de sábado afectados indebidamente por la reducción del viernes.
 *
 * Alcance:
 * 1. Elimina del mapa partidosSinSlot de la fila OverrideCanchasDia del viernes (2026-09-04) los 3 IDs afectados:
 *    - cf535357-0a62-45e1-b73f-ceaa05a98649 (Zona B P4: Figueroa/Esquivel vs Zelaya/Frías)
 *    - acfb1242-871c-483e-a4d2-96a82df580c2 (Zona H P3: Ganador P1 vs Ganador P2)
 *    - 569fa39a-e0fe-48d4-ad12-4f4b194bf83c (Zona H P4: Perdedor P1 vs Perdedor P2)
 * 2. Restaura para cada uno su horario y cancha original con sinHorarioAsignado: false:
 *    - cf535357... -> Sábado 05/09 09:45 hs ART (12:45 UTC), Cancha 5
 *    - acfb1242... -> Sábado 05/09 18:30 hs ART (21:30 UTC), Cancha 2
 *    - 569fa39a... -> Sábado 05/09 18:30 hs ART (21:30 UTC), Cancha 3
 * 3. Valida colisiones de slot (cancha) y parejas con otros partidos antes de aplicar cambios.
 *    Si existe colisión, aborta sin escribir nada.
 * 4. Por defecto corre en modo --dry-run. Requiere --confirmar-dev para escribir en la base de datos.
 * 5. Si no es dry-run, crea automáticamente un backup fechado de la base antes de escribir.
 *
 * Uso:
 *   node scripts/dev-tools/reparar-lluvia-sabado.js [--db-path <ruta.db>] [--torneoId <id>] [--confirmar-dev] [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

// Configuración por defecto
const DEFAULT_TORNEO_ID = '9b5c0e4b-90cf-432f-a9ec-0bdc2619b2af';
const DIA_KEY_VIERNES = '2026-09-04';
const DURACION_PARTIDO_MS = 75 * 60 * 1000;

// Especificación de partidos a restaurar
const PARTIDOS_A_REPARAR = [
  {
    id: 'cf535357-0a62-45e1-b73f-ceaa05a98649',
    descripcion: 'Zona B P4 (Figueroa / Esquivel vs Zelaya / Frías)',
    fechaHoraUtc: '2026-09-05T12:45:00.000Z', // 09:45 hs ART
    horaArt: 'Sábado 05/09/2026 09:45 hs',
    canchaNumero: 5,
  },
  {
    id: 'acfb1242-871c-483e-a4d2-96a82df580c2',
    descripcion: 'Zona H P3 (Ganador P1 vs Ganador P2)',
    fechaHoraUtc: '2026-09-05T21:30:00.000Z', // 18:30 hs ART
    horaArt: 'Sábado 05/09/2026 18:30 hs',
    canchaNumero: 2,
  },
  {
    id: '569fa39a-e0fe-48d4-ad12-4f4b194bf83c',
    descripcion: 'Zona H P4 (Perdedor P1 vs Perdedor P2)',
    fechaHoraUtc: '2026-09-05T21:30:00.000Z', // 18:30 hs ART
    horaArt: 'Sábado 05/09/2026 18:30 hs',
    canchaNumero: 3,
  },
];

const IDS_AFECTADOS = new Set(PARTIDOS_A_REPARAR.map((p) => p.id));

function parseArgs() {
  const args = process.argv.slice(2);
  let torneoId = DEFAULT_TORNEO_ID;
  let dbPath = null;
  let confirmarDev = false;
  let explicitDryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--torneoId' && args[i + 1]) {
      torneoId = args[++i];
    } else if (arg.startsWith('--torneoId=')) {
      torneoId = arg.split('=')[1];
    } else if ((arg === '--db-path' || arg === '--db') && args[i + 1]) {
      dbPath = args[++i];
    } else if (arg.startsWith('--db-path=') || arg.startsWith('--db=')) {
      dbPath = arg.split('=')[1];
    } else if (arg === '--confirmar-dev') {
      confirmarDev = true;
    } else if (arg === '--dry-run') {
      explicitDryRun = true;
    }
  }

  // Por defecto es dry-run salvo que se pase --confirmar-dev y NO se pase --dry-run
  const isDryRun = explicitDryRun || !confirmarDev;

  const defaultDbFile = path.resolve(__dirname, '../../prisma/dev.db');
  const resolvedDbPath = dbPath ? path.resolve(process.cwd(), dbPath) : defaultDbFile;

  return { torneoId, dbPath: resolvedDbPath, isDryRun, confirmarDev };
}

function crearBackupDb(dbFilePath) {
  if (!fs.existsSync(dbFilePath)) {
    throw new Error(`No se encontró el archivo de base de datos para backup: ${dbFilePath}`);
  }
  const dir = path.dirname(dbFilePath);
  const ext = path.extname(dbFilePath);
  const base = path.basename(dbFilePath, ext);

  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const backupFileName = `${base}.backup-${stamp}${ext}`;
  const backupPath = path.join(dir, backupFileName);

  fs.copyFileSync(dbFilePath, backupPath);
  return backupPath;
}

async function repararLluviaSabado() {
  const { torneoId, dbPath, isDryRun, confirmarDev } = parseArgs();

  console.log('='.repeat(80));
  console.log('🛠️  HERRAMIENTA DE REPARACIÓN DE MODO LLUVIA - PARTIDOS DE SÁBADO');
  console.log('='.repeat(80));
  console.log(`- Base de datos destino: ${dbPath}`);
  console.log(`- Torneo ID:             ${torneoId}`);
  console.log(`- Modo de ejecución:     ${isDryRun ? 'DRY-RUN (Simulación, sin escritura)' : 'ESCRITURA REAL (--confirmar-dev activo)'}`);
  console.log('='.repeat(80));

  if (!fs.existsSync(dbPath)) {
    console.error(`❌ ERROR: El archivo de base de datos no existe: ${dbPath}`);
    process.exit(1);
  }

  // Crear cliente prisma apuntando a la base seleccionada
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: `file:${dbPath}`,
      },
    },
  });

  try {
    // 1. Verificar existencia del torneo
    const torneo = await prisma.torneo.findUnique({
      where: { id: torneoId },
      include: { organizador: true },
    });

    if (!torneo) {
      console.error(`❌ ERROR: No se encontró el torneo con ID: ${torneoId}`);
      process.exit(1);
    }
    console.log(`\n📌 Torneo encontrado: "${torneo.nombre}" (${torneo.estado})`);

    // 2. Consultar partidos a restaurar
    const partidosDb = await prisma.partido.findMany({
      where: { id: { in: Array.from(IDS_AFECTADOS) } },
      include: {
        categoria: true,
        zona: true,
        pareja1: true,
        pareja2: true,
      },
    });

    if (partidosDb.length !== PARTIDOS_A_REPARAR.length) {
      console.warn(`⚠️  Advertencia: se esperaban ${PARTIDOS_A_REPARAR.length} partidos, pero se encontraron ${partidosDb.length} en la base.`);
    }

    console.log('\n📋 Partidos a restaurar:');
    for (const spec of PARTIDOS_A_REPARAR) {
      const dbMatch = partidosDb.find((p) => p.id === spec.id);
      if (!dbMatch) {
        console.error(`❌ ERROR: Partido ${spec.id} no encontrado en la base.`);
        process.exit(1);
      }
      console.log(`  • [${spec.id}] ${spec.descripcion}`);
      console.log(`      Estado actual en DB:   fechaHora=${dbMatch.fechaHora ? dbMatch.fechaHora.toISOString() : 'null'}, cancha=${dbMatch.canchaNumero}, sinHorario=${dbMatch.sinHorarioAsignado}`);
      console.log(`      Objetivo restauración: ${spec.horaArt} (UTC: ${spec.fechaHoraUtc}), Cancha ${spec.canchaNumero}`);
    }

    // 3. Chequeo de colisiones de slot y de parejas
    console.log('\n🔍 Verificando disponibilidad de cancha y parejas (detección de colisiones)...');

    const todosLosPartidosConHorario = await prisma.partido.findMany({
      where: {
        categoria: { torneoId },
        fechaHora: { not: null },
        id: { notIn: Array.from(IDS_AFECTADOS) },
      },
      include: {
        pareja1: true,
        pareja2: true,
      },
    });

    const colisiones = [];

    for (const spec of PARTIDOS_A_REPARAR) {
      const targetStartMs = new Date(spec.fechaHoraUtc).getTime();
      const targetEndMs = targetStartMs + DURACION_PARTIDO_MS;
      const targetCancha = spec.canchaNumero;
      const dbMatch = partidosDb.find((p) => p.id === spec.id);

      for (const otro of todosLosPartidosConHorario) {
        const oStartMs = new Date(otro.fechaHora).getTime();
        const oEndMs = oStartMs + DURACION_PARTIDO_MS;

        const solapamientoHorario = Math.max(targetStartMs, oStartMs) < Math.min(targetEndMs, oEndMs);
        if (!solapamientoHorario) continue;

        // Conflicto de cancha
        if (otro.canchaNumero === targetCancha) {
          colisiones.push(
            `Colisión de Cancha ${targetCancha}: Partido ${spec.id} (${spec.descripcion}) choca con partido ${otro.id} (${otro.fechaHora.toISOString()})`
          );
        }

        // Conflicto de pareja 1
        if (dbMatch.pareja1Id && (otro.pareja1Id === dbMatch.pareja1Id || otro.pareja2Id === dbMatch.pareja1Id)) {
          colisiones.push(
            `Colisión de Pareja 1 (${dbMatch.pareja1?.jugador1}/${dbMatch.pareja1?.jugador2}): Partido ${spec.id} choca con partido ${otro.id}`
          );
        }

        // Conflicto de pareja 2
        if (dbMatch.pareja2Id && (otro.pareja1Id === dbMatch.pareja2Id || otro.pareja2Id === dbMatch.pareja2Id)) {
          colisiones.push(
            `Colisión de Pareja 2 (${dbMatch.pareja2?.jugador1}/${dbMatch.pareja2?.jugador2}): Partido ${spec.id} choca con partido ${otro.id}`
          );
        }
      }
    }

    if (colisiones.length > 0) {
      console.error('\n❌ ABORTANDO: Se detectaron colisiones de horario/cancha/pareja:');
      for (const col of colisiones) {
        console.error(`  - ${col}`);
      }
      console.error('\nNo se realizaron modificaciones.');
      process.exit(1);
    }

    console.log('✅ Sin colisiones: Todos los slots (Sábado 09:45 C5, 18:30 C2, 18:30 C3) y parejas están 100% libres.');

    // 4. Leer fila de OverrideCanchasDia del viernes
    console.log(`\n🔍 Consultando OverrideCanchasDia para ${DIA_KEY_VIERNES}...`);
    const overrideViernes = await prisma.overrideCanchasDia.findUnique({
      where: {
        torneoId_diaKey: {
          torneoId,
          diaKey: DIA_KEY_VIERNES,
        },
      },
    });

    let mapaPartidosSinSlot = {};
    if (overrideViernes) {
      if (typeof overrideViernes.partidosSinSlot === 'string') {
        try {
          mapaPartidosSinSlot = JSON.parse(overrideViernes.partidosSinSlot);
        } catch (_) {
          mapaPartidosSinSlot = {};
        }
      } else if (typeof overrideViernes.partidosSinSlot === 'object' && overrideViernes.partidosSinSlot !== null) {
        mapaPartidosSinSlot = { ...overrideViernes.partidosSinSlot };
      }
    }

    const idsPresentesEnMapa = Array.from(IDS_AFECTADOS).filter((id) =>
      Object.prototype.hasOwnProperty.call(mapaPartidosSinSlot, id)
    );

    console.log(`  • Override ID: ${overrideViernes?.id || 'No existe'}`);
    console.log(`  • Canchas activas: ${overrideViernes?.canchas ?? 'N/A'}`);
    console.log(`  • IDs de sábado encontrados en partidosSinSlot del viernes: ${idsPresentesEnMapa.length}`);
    for (const id of idsPresentesEnMapa) {
      console.log(`      - [${id}]: "${mapaPartidosSinSlot[id]}"`);
    }

    // Preparar nuevo mapa sin esos IDs
    const nuevoMapa = { ...mapaPartidosSinSlot };
    for (const id of IDS_AFECTADOS) {
      delete nuevoMapa[id];
    }

    // 5. Aplicar o Simular cambios
    if (isDryRun) {
      console.log('\n' + '='.repeat(80));
      console.log('🔎 MODO DRY-RUN: Las siguientes acciones se ejecutarían con --confirmar-dev:');
      console.log('='.repeat(80));
      console.log(`1. Crear backup fechado de: ${dbPath}`);
      console.log(`2. Actualizar tabla OverrideCanchasDia (${overrideViernes?.id}):`);
      console.log(`   - Remover keys: ${Array.from(IDS_AFECTADOS).join(', ')}`);
      console.log(`   - Keys restantes en partidosSinSlot: ${Object.keys(nuevoMapa).length}`);
      console.log('3. Restaurar partidos en tabla Partido:');
      for (const spec of PARTIDOS_A_REPARAR) {
        console.log(`   - Partido ${spec.id}:`);
        console.log(`       fechaHora:          ${spec.fechaHoraUtc} (${spec.horaArt})`);
        console.log(`       canchaNumero:       ${spec.canchaNumero}`);
        console.log(`       sinHorarioAsignado: false`);
      }
      console.log('='.repeat(80));
      console.log('💡 Para aplicar efectivamente estos cambios, ejecute:');
      console.log(`   node scripts/dev-tools/reparar-lluvia-sabado.js --confirmar-dev ${dbPath !== path.resolve(__dirname, '../../prisma/dev.db') ? `--db-path "${dbPath}"` : ''}`);
      console.log('='.repeat(80));
    } else {
      console.log('\n💾 APLICANDO CAMBIOS (--confirmar-dev activo)...');

      // Crear backup automático fechado
      const backupPath = crearBackupDb(dbPath);
      console.log(`✅ Backup automático de seguridad creado: ${backupPath}`);

      // Transacción atómica
      await prisma.$transaction(async (tx) => {
        // a) Actualizar OverrideCanchasDia si existe
        if (overrideViernes) {
          await tx.overrideCanchasDia.update({
            where: { id: overrideViernes.id },
            data: {
              partidosSinSlot: nuevoMapa,
            },
          });
          console.log(`✅ Fila OverrideCanchasDia actualizada: se removieron los 3 IDs de sábado.`);
        }

        // b) Restaurar los 3 partidos
        for (const spec of PARTIDOS_A_REPARAR) {
          await tx.partido.update({
            where: { id: spec.id },
            data: {
              fechaHora: new Date(spec.fechaHoraUtc),
              canchaNumero: spec.canchaNumero,
              sinHorarioAsignado: false,
            },
          });
          console.log(`✅ Partido restaurado: ${spec.id} -> ${spec.horaArt}, Cancha ${spec.canchaNumero}`);
        }
      });

      console.log('\n🎉 REPARACIÓN COMPLETADA CON ÉXITO.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  repararLluviaSabado().catch((err) => {
    console.error('❌ Error fatal en reparar-lluvia-sabado:', err);
    process.exit(1);
  });
}

module.exports = { repararLluviaSabado };
