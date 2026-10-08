'use strict';

// 1. Guarda fail-safe: DEBE ejecutarse ANTES de cualquier require que instancie Prisma
const { ensureTestDb } = require('./utils/testEnvGuard');

const assert = require('assert');
const prisma = require('../src/lib/prisma');
const organizadorService = require('../src/services/organizador.service');
const canchasOverridesService = require('../src/services/canchasOverrides.service');
const { getDiaCalendarioConTrasnoche } = require('../src/utils/dateUtils');
const { programarHorariosEliminatorias } = require('../src/services/eliminatoriaScheduler.service');
const { generarSlotsDia } = require('../src/services/slots.service');

async function main() {
  console.log('=== TEST MODO LLUVIA INDEPENDIENTE POR DÍA Y PLAYOFFS (FLUJO REAL) ===\n');

  // Verificar que estamos conectados a prisma/test.db
  await ensureTestDb();
  await canchasOverridesService.loadFromDb();

  const timestamp = Date.now();
  let organizador = null;
  let torneo = null;

  try {
    // ─── 1. Siembra mediante flujo real ─────────────────────────────────────────
    console.log('1. Creando Club con 6 canchas y horarios viernes, sábado y domingo...');
    organizador = await prisma.organizador.create({
      data: {
        nombre: 'Club Test Lluvia 6 Canchas',
        email: `test-indep-${timestamp}@padel.test`,
        passwordHash: 'dummy_hash',
        cantidadCanchas: 6,
        viernesInicio: '14:00',
        viernesFin: '23:00',
        sabadoInicio: '09:00',
        sabadoFin: '23:00',
        domingoInicio: '08:00',
        domingoFin: '22:00',
      },
    });

    const now = new Date();
    let offsetToFriday = 5 - now.getDay();
    if (offsetToFriday <= 0) offsetToFriday += 7;
    const refViernes = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetToFriday, 12, 0, 0);

    console.log(`2. Creando Torneo para el viernes ${refViernes.toISOString().slice(0, 10)}...`);
    torneo = await prisma.torneo.create({
      data: {
        nombre: 'Torneo Test Flujo Real Lluvia',
        slug: `torneo-lluvia-real-${timestamp}`,
        fecha: refViernes,
        estado: 'BORRADOR',
        organizadorId: organizador.id,
      },
    });

    console.log('3. Creando 2 categorías (Cat A 12 parejas viernes, Cat B 12 parejas viernes/sábado)...');
    const catA = await prisma.categoria.create({
      data: { torneoId: torneo.id, nombre: '4ta Varones', estado: 'BORRADOR' },
    });
    const catB = await prisma.categoria.create({
      data: { torneoId: torneo.id, nombre: '5ta Varones', estado: 'BORRADOR' },
    });

    const slotsViernes = generarSlotsDia('Viernes', organizador.viernesInicio, organizador.viernesFin);
    const slotsSabado  = generarSlotsDia('Sabado',  organizador.sabadoInicio,  organizador.sabadoFin);

    // Inscribir 12 parejas en Cat A con disponibilidad en Viernes (4 zonas de 3)
    for (let i = 1; i <= 12; i++) {
      await prisma.pareja.create({
        data: {
          categoriaId: catA.id,
          jugador1: `A_J1_${i}`,
          jugador2: `A_J2_${i}`,
          orden: i,
          slotsSeleccionados: {
            create: slotsViernes.map((slotId) => ({ slotId })),
          },
        },
      });
    }

    // Inscribir 12 parejas en Cat B:
    // Parejas 1-6 con disponibilidad Viernes (2 zonas de 3 -> junto con Cat A ocupan las 6 canchas el viernes a las 14:00)
    // Parejas 7-12 con disponibilidad Sábado (2 zonas de 3 -> garantizan partidos el sábado)
    for (let i = 1; i <= 12; i++) {
      const slots = i <= 6 ? slotsViernes : slotsSabado;
      await prisma.pareja.create({
        data: {
          categoriaId: catB.id,
          jugador1: `B_J1_${i}`,
          jugador2: `B_J2_${i}`,
          orden: i,
          slotsSeleccionados: {
            create: slots.map((slotId) => ({ slotId })),
          },
        },
      });
    }

    console.log('4. Ejecutando iniciarTorneoMultiCategoria (genera zonas y brackets)...');
    await organizadorService.iniciarTorneoMultiCategoria(organizador.id, torneo.id);

    console.log('5. Ejecutando programarHorariosEliminatorias (asigna playoffs el domingo)...');
    await programarHorariosEliminatorias(organizador.id, torneo.id);

    // Días del torneo
    const horariosClubObj = {
      viernesInicio: organizador.viernesInicio,
      viernesFin: organizador.viernesFin,
      sabadoInicio: organizador.sabadoInicio,
      sabadoFin: organizador.sabadoFin,
      domingoInicio: organizador.domingoInicio,
      domingoFin: organizador.domingoFin,
    };

    const viernesKey = getDiaCalendarioConTrasnoche(refViernes, horariosClubObj).key;
    const sabadoKey = getDiaCalendarioConTrasnoche(new Date(refViernes.getTime() + 24 * 3600 * 1000), horariosClubObj).key;
    const domingoKey = getDiaCalendarioConTrasnoche(new Date(refViernes.getTime() + 2 * 24 * 3600 * 1000), horariosClubObj).key;

    console.log(`Días detectados: Viernes=${viernesKey}, Sábado=${sabadoKey}, Domingo=${domingoKey}`);

    const todosPartidos = await prisma.partido.findMany({
      where: { categoria: { torneoId: torneo.id }, fechaHora: { not: null } },
    });

    console.log(`Total partidos programados en el torneo: ${todosPartidos.length}`);
    const partidosViernesPre = todosPartidos.filter((p) => getDiaCalendarioConTrasnoche(p.fechaHora, horariosClubObj)?.key === viernesKey);
    const partidosSabadoPre  = todosPartidos.filter((p) => getDiaCalendarioConTrasnoche(p.fechaHora, horariosClubObj)?.key === sabadoKey);
    const partidosDomingoPre = todosPartidos.filter((p) => getDiaCalendarioConTrasnoche(p.fechaHora, horariosClubObj)?.key === domingoKey);

    console.log(`Partidos por día -> Viernes: ${partidosViernesPre.length}, Sábado: ${partidosSabadoPre.length}, Domingo: ${partidosDomingoPre.length}`);
    assert.ok(partidosViernesPre.length > 0, 'FALLO: No hay partidos programados el Viernes');
    assert.ok(partidosSabadoPre.length > 0, 'FALLO: No hay partidos programados el Sábado');
    assert.ok(partidosDomingoPre.length > 0, 'FALLO: No hay partidos programados el Domingo');

    const canchasViernesPre = new Set(partidosViernesPre.map((p) => p.canchaNumero));
    const canchasSabadoPre  = new Set(partidosSabadoPre.map((p) => p.canchaNumero));
    const canchasDomingoPre = new Set(partidosDomingoPre.map((p) => p.canchaNumero));
    console.log(`Canchas Viernes inicial: ${Array.from(canchasViernesPre).sort().join(', ')}`);
    console.log(`Canchas Sábado inicial : ${Array.from(canchasSabadoPre).sort().join(', ')}`);
    console.log(`Canchas Domingo inicial: ${Array.from(canchasDomingoPre).sort().join(', ')}`);

    // ─── 2. Reducir canchas el VIERNES a 2 canchas ─────────────────────────────
    console.log('\n--- Paso 1: Reducir canchas el VIERNES a 2 canchas ---');
    const resViernes = await organizadorService.reprogramarPorReduccionCanchas(
      organizador.id,
      torneo.id,
      2,
      null,
      viernesKey
    );
    console.log('Resultado reducción Viernes:', resViernes.message);

    // Verificar que la reducción reprogramó al menos N > 0 partidos
    const reprogramadosViernes = resViernes.reprogramacion?.partidosReprogramados ?? 0;
    console.log(`Partidos reprogramados en Viernes: ${reprogramadosViernes}`);
    assert.ok(
      reprogramadosViernes > 0,
      `FALLO DE ASERCIÓN: La reducción de Viernes debía reprogramar al menos 1 partido (N > 0), pero reprogramó ${reprogramadosViernes}.`
    );

    let estadoEnVivo = await organizadorService.getEstadoEnVivo(organizador.id, torneo.id);

    // Validar aislamiento del estado por día
    assert.strictEqual(estadoEnVivo.canchasPorDia[viernesKey]?.canchas, 2, 'Viernes debe tener 2 canchas');
    assert.strictEqual(estadoEnVivo.canchasPorDia[viernesKey]?.isLluvia, true, 'Viernes debe tener isLluvia: true');
    assert.strictEqual(estadoEnVivo.canchasPorDia[sabadoKey]?.canchas, 6, 'Sábado debe seguir con 6 canchas');
    assert.strictEqual(estadoEnVivo.canchasPorDia[sabadoKey]?.isLluvia, false, 'Sábado no debe tener lluvia');
    assert.strictEqual(estadoEnVivo.canchasPorDia[domingoKey]?.canchas, 6, 'Domingo debe seguir con 6 canchas');
    assert.strictEqual(estadoEnVivo.canchasPorDia[domingoKey]?.isLluvia, false, 'Domingo no debe tener lluvia');

    // Verificar que ningún partido de Viernes use cancha > 2
    const partidosPostViernes = await prisma.partido.findMany({
      where: { categoria: { torneoId: torneo.id }, fechaHora: { not: null } },
    });
    for (const p of partidosPostViernes) {
      const diaKey = getDiaCalendarioConTrasnoche(p.fechaHora, horariosClubObj)?.key;
      if (diaKey === viernesKey && p.canchaNumero > 2) {
        throw new Error(`FAIL: Partido ${p.id} de Viernes asignado a Cancha ${p.canchaNumero} (> 2)`);
      }
    }
    console.log('✔ Paso 1 EXITOSO: Viernes reducido a 2 canchas (reprogramados N > 0) sin afectar Sábado ni Domingo.');

    // ─── 3. Reducir canchas el DOMINGO a 2 canchas ─────────────────────────────
    console.log('\n--- Paso 2: Reducir canchas el DOMINGO a 2 canchas (eliminatorias) ---');
    const resDomingo = await organizadorService.reprogramarPorReduccionCanchas(
      organizador.id,
      torneo.id,
      2,
      null,
      domingoKey
    );
    console.log('Resultado reducción Domingo:', resDomingo.message);

    const reprogramadosDomingo = resDomingo.reprogramacion?.partidosReprogramados ?? 0;
    console.log(`Partidos reprogramados en Domingo: ${reprogramadosDomingo}`);
    assert.ok(
      reprogramadosDomingo > 0,
      `FALLO DE ASERCIÓN: La reducción de Domingo debía reprogramar al menos 1 partido (N > 0), pero reprogramó ${reprogramadosDomingo}.`
    );

    estadoEnVivo = await organizadorService.getEstadoEnVivo(organizador.id, torneo.id);
    assert.strictEqual(estadoEnVivo.canchasPorDia[domingoKey]?.canchas, 2, 'Domingo debe tener 2 canchas');
    assert.strictEqual(estadoEnVivo.canchasPorDia[domingoKey]?.isLluvia, true, 'Domingo debe tener isLluvia: true');
    assert.strictEqual(estadoEnVivo.canchasPorDia[viernesKey]?.canchas, 2, 'Viernes debe seguir en 2 canchas');
    assert.strictEqual(estadoEnVivo.canchasPorDia[viernesKey]?.isLluvia, true, 'Viernes debe seguir con lluvia');
    assert.strictEqual(estadoEnVivo.canchasPorDia[sabadoKey]?.canchas, 6, 'Sábado debe seguir normal en 6 canchas');
    assert.strictEqual(estadoEnVivo.canchasPorDia[sabadoKey]?.isLluvia, false, 'Sábado debe seguir sin lluvia');

    const partidosPostDomingo = await prisma.partido.findMany({
      where: { categoria: { torneoId: torneo.id }, fechaHora: { not: null } },
    });
    for (const p of partidosPostDomingo) {
      const diaKey = getDiaCalendarioConTrasnoche(p.fechaHora, horariosClubObj)?.key;
      if (diaKey === domingoKey && p.canchaNumero > 2) {
        throw new Error(`FAIL: Partido ${p.id} de Domingo asignado a Cancha ${p.canchaNumero} (> 2)`);
      }
    }
    console.log('✔ Paso 2 EXITOSO: Domingo reducido a 2 canchas manteniendo Viernes en 2 y Sábado intacto en 6.');

    // ─── 4. Restaurar Domingo al total del club ───────────────────────────────
    console.log('\n--- Paso 3: Restaurar Domingo a 6 canchas ---');
    await organizadorService.reprogramarPorReduccionCanchas(
      organizador.id,
      torneo.id,
      null,
      null,
      domingoKey
    );

    estadoEnVivo = await organizadorService.getEstadoEnVivo(organizador.id, torneo.id);
    assert.strictEqual(estadoEnVivo.canchasPorDia[domingoKey]?.canchas, 6, 'Domingo debe estar restaurado a 6 canchas');
    assert.strictEqual(estadoEnVivo.canchasPorDia[domingoKey]?.isLluvia, false, 'Domingo debe estar sin lluvia');
    assert.strictEqual(estadoEnVivo.canchasPorDia[viernesKey]?.canchas, 2, 'Viernes debe seguir con lluvia en 2 canchas');
    assert.strictEqual(estadoEnVivo.canchasPorDia[viernesKey]?.isLluvia, true, 'Viernes debe seguir en lluvia');
    console.log('✔ Paso 3 EXITOSO: Domingo restaurado sin afectar el modo lluvia de Viernes.');

    // ─── 5. Restaurar Viernes al total del club ───────────────────────────────
    console.log('\n--- Paso 4: Restaurar Viernes a 6 canchas ---');
    await organizadorService.reprogramarPorReduccionCanchas(
      organizador.id,
      torneo.id,
      null,
      null,
      viernesKey
    );

    estadoEnVivo = await organizadorService.getEstadoEnVivo(organizador.id, torneo.id);
    const todosNormales = Object.values(estadoEnVivo.canchasPorDia).every((d) => !d.isLluvia && d.canchas === 6);
    assert.ok(todosNormales, 'Todos los días deben quedar restaurados a 6 canchas sin lluvia');
    console.log('✔ Paso 4 EXITOSO: Todos los días quedaron restaurados correctamente.');

    console.log('\n🎉 TEST MODO LLUVIA INDEPENDIENTE PASÓ EXITOSAMENTE AL 100%!');
  } finally {
    // Limpieza garantizada en finally
    if (torneo && organizador) {
      await prisma.setPartido.deleteMany({ where: { partido: { categoria: { torneoId: torneo.id } } } });
      await prisma.partido.deleteMany({ where: { categoria: { torneoId: torneo.id } } });
      await prisma.faseEliminatoria.deleteMany({ where: { categoria: { torneoId: torneo.id } } });
      await prisma.zonaPareja.deleteMany({ where: { zona: { categoria: { torneoId: torneo.id } } } });
      await prisma.zona.deleteMany({ where: { categoria: { torneoId: torneo.id } } });
      await prisma.slotPareja.deleteMany({ where: { pareja: { categoria: { torneoId: torneo.id } } } });
      await prisma.pareja.deleteMany({ where: { categoria: { torneoId: torneo.id } } });
      await prisma.overrideCanchasDia.deleteMany({ where: { torneoId: torneo.id } });
      await prisma.categoria.deleteMany({ where: { torneoId: torneo.id } });
      await prisma.torneo.deleteMany({ where: { id: torneo.id } });
      await prisma.organizador.deleteMany({ where: { id: organizador.id } });
      console.log('✓ Limpieza de datos de prueba completada en bloque finally.');
    }
  }
}

main()
  .catch((err) => {
    console.error('\n❌ ERROR EN TEST:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
