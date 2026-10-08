const prisma = require('../src/lib/prisma');
const organizadorService = require('../src/services/organizador.service');
const torneoService = require('../src/services/torneo.service');
const canchasOverridesService = require('../src/services/canchasOverrides.service');
const { parseFechaLocal, formatDiaHorario, getDiaCalendarioConTrasnoche } = require('../src/utils/dateUtils');
const { programarHorariosEliminatorias } = require('../src/services/eliminatoriaScheduler.service');

async function main() {
  console.log('=== TEST MODO LLUVIA INDEPENDIENTE POR DÍA Y PLAYOFFS DOMINGO ===\n');
  await canchasOverridesService.loadFromDb();

  // Buscar un organizador y torneo de prueba en curso o crear escenario
  let torneo = await prisma.torneo.findFirst({
    where: {
      estado: 'EN_CURSO',
      categorias: {
        some: {
          fasesEliminatorias: {
            some: {
              partidos: { some: {} },
            },
          },
        },
      },
    },
    include: {
      organizador: true,
      categorias: {
        include: {
          fasesEliminatorias: {
            include: {
              partidos: true,
            },
          },
        },
      },
    },
  });

  if (!torneo) {
    console.log('No se encontró un torneo en curso con eliminatorias. Buscando cualquier torneo en curso...');
    torneo = await prisma.torneo.findFirst({
      where: { estado: 'EN_CURSO' },
      include: {
        organizador: true,
        categorias: {
          include: {
            fasesEliminatorias: {
              include: {
                partidos: true,
              },
            },
          },
        },
      },
    });
  }

  if (!torneo) {
    console.error('ERROR: No se encontró ningún torneo EN_CURSO en la base de datos para probar.');
    process.exit(1);
  }

  const organizador = torneo.organizador;
  const canchasClub = organizador.cantidadCanchas || 4;
  console.log(`Torneo ID: ${torneo.id}, Nombre: "${torneo.nombre}", Canchas Club: ${canchasClub}`);

  // Asegurar que overrides previos estén limpios para el test
  canchasOverridesService.clearOverridesTorneo(torneo.id);

  // Calcular las fechas de Viernes, Sábado y Domingo del torneo
  const refFecha = parseFechaLocal(torneo.fecha);
  const horariosClubObj = {
    viernesInicio: organizador.viernesInicio,
    viernesFin: organizador.viernesFin,
    sabadoInicio: organizador.sabadoInicio,
    sabadoFin: organizador.sabadoFin,
    domingoInicio: organizador.domingoInicio,
    domingoFin: organizador.domingoFin,
  };

  const viernesKey = getDiaCalendarioConTrasnoche(refFecha, horariosClubObj).key;
  const sabadoKey = getDiaCalendarioConTrasnoche(new Date(refFecha.getTime() + 24 * 3600 * 1000), horariosClubObj).key;
  const domingoKey = getDiaCalendarioConTrasnoche(new Date(refFecha.getTime() + 2 * 24 * 3600 * 1000), horariosClubObj).key;

  console.log(`Días detectados: Viernes=${viernesKey}, Sábado=${sabadoKey}, Domingo=${domingoKey}`);

  // 1. Reducir canchas solo el VIERNES a 2 canchas
  console.log('\n--- Paso 1: Reducir canchas el VIERNES a 2 canchas ---');
  const resViernes = await organizadorService.reprogramarPorReduccionCanchas(
    organizador.id,
    torneo.id,
    2,
    null,
    viernesKey
  );
  console.log('Resultado reducción Viernes:', resViernes.message);

  let estadoEnVivo = await organizadorService.getEstadoEnVivo(organizador.id, torneo.id);
  console.log('canchasPorDia después de reducir Viernes:');
  console.log(JSON.stringify(estadoEnVivo.canchasPorDia, null, 2));

  if (estadoEnVivo.canchasPorDia[viernesKey]?.canchas !== 2 || !estadoEnVivo.canchasPorDia[viernesKey]?.isLluvia) {
    throw new Error(`FAIL: Viernes debería tener 2 canchas con lluvia activa, pero tiene: ${JSON.stringify(estadoEnVivo.canchasPorDia[viernesKey])}`);
  }
  if (estadoEnVivo.canchasPorDia[sabadoKey]?.canchas !== canchasClub || estadoEnVivo.canchasPorDia[sabadoKey]?.isLluvia) {
    throw new Error(`FAIL: Sábado no debería tener lluvia activa y debería tener ${canchasClub} canchas, pero tiene: ${JSON.stringify(estadoEnVivo.canchasPorDia[sabadoKey])}`);
  }
  if (estadoEnVivo.canchasPorDia[domingoKey]?.canchas !== canchasClub || estadoEnVivo.canchasPorDia[domingoKey]?.isLluvia) {
    throw new Error(`FAIL: Domingo no debería tener lluvia activa y debería tener ${canchasClub} canchas, pero tiene: ${JSON.stringify(estadoEnVivo.canchasPorDia[domingoKey])}`);
  }
  console.log('✔ Paso 1 EXITOSO: Viernes reducido a 2 canchas sin afectar Sábado ni Domingo.');

  // 2. Reducir canchas el DOMINGO a 2 canchas
  console.log('\n--- Paso 2: Reducir canchas el DOMINGO a 2 canchas ---');
  const resDomingo = await organizadorService.reprogramarPorReduccionCanchas(
    organizador.id,
    torneo.id,
    2,
    null,
    domingoKey
  );
  console.log('Resultado reducción Domingo:', resDomingo.message);

  estadoEnVivo = await organizadorService.getEstadoEnVivo(organizador.id, torneo.id);
  console.log('canchasPorDia después de reducir Domingo:');
  console.log(JSON.stringify(estadoEnVivo.canchasPorDia, null, 2));

  if (estadoEnVivo.canchasPorDia[domingoKey]?.canchas !== 2 || !estadoEnVivo.canchasPorDia[domingoKey]?.isLluvia) {
    throw new Error(`FAIL: Domingo debería tener 2 canchas con lluvia activa.`);
  }
  if (estadoEnVivo.canchasPorDia[viernesKey]?.canchas !== 2 || !estadoEnVivo.canchasPorDia[viernesKey]?.isLluvia) {
    throw new Error(`FAIL: Viernes debería seguir teniendo 2 canchas independientes.`);
  }
  if (estadoEnVivo.canchasPorDia[sabadoKey]?.canchas !== canchasClub || estadoEnVivo.canchasPorDia[sabadoKey]?.isLluvia) {
    throw new Error(`FAIL: Sábado debería seguir teniendo ${canchasClub} canchas sin lluvia.`);
  }
  console.log('✔ Paso 2 EXITOSO: Domingo reducido a 2 canchas manteniendo Viernes en 2 y Sábado en 4.');

  // 3. Verificar los horarios y descansos en los partidos de eliminatorias reprogramados para el Domingo
  console.log('\n--- Paso 3: Verificar partidos de eliminatorias en Domingo con 2 canchas ---');
  const partidosDomingo = await prisma.partido.findMany({
    where: {
      categoria: { torneoId: torneo.id },
      faseEliminatoriaId: { not: null },
      fechaHora: { not: null },
    },
    include: {
      faseEliminatoria: true,
      categoria: true,
    },
    orderBy: { fechaHora: 'asc' },
  });

  console.log(`Se encontraron ${partidosDomingo.length} partidos de eliminatoria con horario en el torneo.`);
  const canchasUsadasDomingo = new Set();

  for (const p of partidosDomingo) {
    const diaInfo = getDiaCalendarioConTrasnoche(p.fechaHora, horariosClubObj);
    if (diaInfo?.key === domingoKey) {
      canchasUsadasDomingo.add(p.canchaNumero);
      if (p.canchaNumero > 2) {
        throw new Error(`FAIL: Partido ${p.id} (${p.faseEliminatoria?.nombre}) fue asignado a Cancha ${p.canchaNumero}, pero Domingo está reducido a 2 canchas.`);
      }
    }
  }

  console.log(`Canchas utilizadas en Domingo bajo lluvia: ${Array.from(canchasUsadasDomingo).join(', ')} (todas <= 2).`);
  console.log('✔ Paso 3 EXITOSO: Ningún partido de Domingo supera las 2 canchas habilitadas.');

  // 4. Restaurar canchas de Domingo al total del club
  console.log('\n--- Paso 4: Restaurar Domingo al total del club ---');
  const resRestaurarDomingo = await organizadorService.reprogramarPorReduccionCanchas(
    organizador.id,
    torneo.id,
    null,
    null,
    domingoKey
  );
  console.log('Resultado restauración Domingo:', resRestaurarDomingo.message);

  estadoEnVivo = await organizadorService.getEstadoEnVivo(organizador.id, torneo.id);
  console.log('canchasPorDia después de restaurar Domingo:');
  console.log(JSON.stringify(estadoEnVivo.canchasPorDia, null, 2));

  if (estadoEnVivo.canchasPorDia[domingoKey]?.canchas !== canchasClub || estadoEnVivo.canchasPorDia[domingoKey]?.isLluvia) {
    throw new Error(`FAIL: Domingo debería estar restaurado a ${canchasClub} canchas sin lluvia.`);
  }
  if (estadoEnVivo.canchasPorDia[viernesKey]?.canchas !== 2 || !estadoEnVivo.canchasPorDia[viernesKey]?.isLluvia) {
    throw new Error(`FAIL: Viernes debería seguir en modo lluvia independiente con 2 canchas.`);
  }
  console.log('✔ Paso 4 EXITOSO: Domingo restaurado sin afectar el modo lluvia de Viernes.');

  // 5. Restaurar Viernes
  console.log('\n--- Paso 5: Restaurar Viernes ---');
  await organizadorService.reprogramarPorReduccionCanchas(
    organizador.id,
    torneo.id,
    null,
    null,
    viernesKey
  );

  estadoEnVivo = await organizadorService.getEstadoEnVivo(organizador.id, torneo.id);
  console.log('canchasPorDia después de restaurar Viernes:');
  console.log(JSON.stringify(estadoEnVivo.canchasPorDia, null, 2));

  const allNormal = Object.values(estadoEnVivo.canchasPorDia).every((d) => !d.isLluvia && d.canchas === canchasClub);
  if (!allNormal) {
    throw new Error(`FAIL: Todos los días deberían estar restaurados sin lluvia.`);
  }
  console.log('✔ Paso 5 EXITOSO: Todos los días quedaron restaurados correctamente.');

  console.log('\n============================================================');
  console.log('🎉 TODOS LOS TESTS DE MODO LLUVIA INDEPENDIENTE PASARON CON ÉXITO!');
  console.log('============================================================\n');
}

main()
  .catch((err) => {
    console.error('ERROR EN TEST:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
