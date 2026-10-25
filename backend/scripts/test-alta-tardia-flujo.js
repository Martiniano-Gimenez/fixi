/**
 * test-alta-tardia-flujo.js
 * Prueba completa del flujo de alta tardía:
 * 1. Alta sin slots: se asigna igual y no falla (adopta disponibilidad o queda programable).
 * 2. Validación de slots: slots con formato inválido o fuera del club arrojan 400.
 * 3. Alta con slots: guarda SlotPareja en DB y auto-asigna el partido dentro de los slots provistos.
 * 4. Limpieza garantizada en bloque finally.
 */

const { ensureTestDb } = require('./utils/testEnvGuard');
const prisma = require('../src/lib/prisma');
const zonaService = require('../src/services/zona.service');
const partidoService = require('../src/services/partido.service');

async function testAltaTardiaFlujo() {
  await ensureTestDb();
  console.log('🧪 Iniciando prueba de flujo: Alta tardía con y sin slots, y validación de 400...');

  const timestamp = Date.now();
  let orgId = null;
  let torneoId = null;
  let catId = null;

  try {
    const org = await prisma.organizador.create({
      data: {
        nombre: `Org Tardio ${timestamp}`,
        email: `tardio-${timestamp}@test.com`,
        passwordHash: 'dummy',
        cantidadCanchas: 4,
        viernesInicio: '14:00',
        viernesFin: '23:00',
        sabadoInicio: '09:00',
        sabadoFin: '21:00',
      },
    });
    orgId = org.id;

    const torneo = await prisma.torneo.create({
      data: {
        nombre: `Torneo Tardio ${timestamp}`,
        slug: `torneo-tardio-${timestamp}`,
        organizadorId: org.id,
        estado: 'EN_CURSO',
        fecha: new Date('2026-10-16T00:00:00.000Z'),
      },
    });
    torneoId = torneo.id;

    const cat = await prisma.categoria.create({
      data: {
        nombre: '4ta Libres',
        torneoId: torneo.id,
        estado: 'EN_CURSO',
      },
    });
    catId = cat.id;

    // --- SECCIÓN 1: Alta sin slots (comportamiento base) ---
    console.log('\n--- 1. Probando alta tardía SIN slots (se agrega y no falla) ---');
    const p1 = await prisma.pareja.create({
      data: {
        categoriaId: cat.id,
        jugador1: 'A1',
        jugador2: 'A2',
        orden: 1,
        slotsSeleccionados: {
          create: [{ slotId: 'Viernes-18:00' }, { slotId: 'Viernes-19:15' }],
        },
      },
    });

    const p2 = await prisma.pareja.create({
      data: {
        categoriaId: cat.id,
        jugador1: 'B1',
        jugador2: 'B2',
        orden: 2,
        slotsSeleccionados: {
          create: [{ slotId: 'Viernes-18:00' }, { slotId: 'Viernes-19:15' }],
        },
      },
    });

    const zona1 = await prisma.zona.create({
      data: {
        categoriaId: cat.id,
        nombre: 'Zona A',
        formato: 'ROUND_ROBIN',
        clasifican: 2,
      },
    });

    await prisma.zonaPareja.createMany({
      data: [
        { zonaId: zona1.id, parejaId: p1.id },
        { zonaId: zona1.id, parejaId: p2.id },
      ],
    });

    await zonaService.regenerarPartidosZona(prisma, cat.id, zona1.id);

    // --- SECCIÓN 1: Rechazo de alta sin slots (HTTP 400) ---
    console.log('\n--- 1. Probando rechazo de alta tardía sin slots (HTTP 400) ---');
    let errorSinSlotsCapturado = false;
    try {
      await zonaService.agregarParejaAZona(org.id, cat.id, {
        zonaDestinoId: zona1.id,
        jugador1: 'Tardío Juan',
        jugador2: 'Tardío Pedro',
        slotIds: [],
      });
    } catch (err) {
      if (err.statusCode === 400 && err.message.includes('obligatoria')) {
        errorSinSlotsCapturado = true;
        console.log(`✓ Alta tardía con slotIds vacíos rechazada con 400: "${err.message}"`);
      } else {
        throw err;
      }
    }
    if (!errorSinSlotsCapturado) {
      throw new Error('[FALLO] Se esperaba que alta tardía con slotIds vacíos fuera rechazada con 400.');
    }

    let errorAusenteCapturado = false;
    try {
      await zonaService.agregarParejaAZona(org.id, cat.id, {
        zonaDestinoId: zona1.id,
        jugador1: 'Tardío Juan',
        jugador2: 'Tardío Pedro',
      });
    } catch (err) {
      if (err.statusCode === 400 && err.message.includes('obligatoria')) {
        errorAusenteCapturado = true;
        console.log(`✓ Alta tardía con slotIds ausente rechazada con 400: "${err.message}"`);
      } else {
        throw err;
      }
    }
    if (!errorAusenteCapturado) {
      throw new Error('[FALLO] Se esperaba que alta tardía con slotIds ausente fuera rechazada con 400.');
    }

    // --- SECCIÓN 2: Validaciones de slot inválido → 400 ---
    console.log('\n--- 2. Probando rechazo de slots inválidos (HTTP 400) ---');

    // 2a. Formato inválido
    let errorFormatoCapturado = false;
    try {
      await zonaService.agregarParejaAZona(org.id, cat.id, {
        zonaDestinoId: zona1.id,
        jugador1: 'Invalido 1',
        jugador2: 'Invalido 2',
        slotIds: ['FormatoInvalido-99:99'],
      });
    } catch (err) {
      if (err.statusCode === 400) {
        errorFormatoCapturado = true;
        console.log(`✓ Slot con formato inválido rechazado con 400: "${err.message}"`);
      } else {
        throw err;
      }
    }
    if (!errorFormatoCapturado) {
      throw new Error('[FALLO] Se esperaba que un slot con formato inválido fuera rechazado con 400.');
    }

    // 2b. Slot fuera de los horarios del club (el club cierra a las 21:00 los sábados)
    let errorClubCapturado = false;
    try {
      await zonaService.agregarParejaAZona(org.id, cat.id, {
        zonaDestinoId: zona1.id,
        jugador1: 'Fuera Horario 1',
        jugador2: 'Fuera Horario 2',
        slotIds: ['Sabado-22:00'],
      });
    } catch (err) {
      if (err.statusCode === 400) {
        errorClubCapturado = true;
        console.log(`✓ Slot fuera del horario del club rechazado con 400: "${err.message}"`);
      } else {
        throw err;
      }
    }
    if (!errorClubCapturado) {
      throw new Error('[FALLO] Se esperaba que un slot fuera de horario del club fuera rechazado con 400.');
    }

    // 2c. Slot de Domingo (el domingo se juegan los brackets/eliminatorias, no las zonas)
    let errorDomingoCapturado = false;
    try {
      await zonaService.agregarParejaAZona(org.id, cat.id, {
        zonaDestinoId: zona1.id,
        jugador1: 'Domingo 1',
        jugador2: 'Domingo 2',
        slotIds: ['Domingo-10:00'],
      });
    } catch (err) {
      if (err.statusCode === 400) {
        errorDomingoCapturado = true;
        console.log(`✓ Slot de Domingo rechazado con 400: "${err.message}"`);
      } else {
        throw err;
      }
    }
    if (!errorDomingoCapturado) {
      throw new Error('[FALLO] Se esperaba que un slot de Domingo fuera rechazado con 400 para zonas.');
    }

    // --- SECCIÓN 3: Alta con slots válidos (auto-asignación en los slots) ---
    console.log('\n--- 3. Probando alta tardía CON slots (el partido se asigna dentro de esos slots) ---');
    const zona2 = await prisma.zona.create({
      data: {
        categoriaId: cat.id,
        nombre: 'Zona B',
        formato: 'ROUND_ROBIN',
        clasifican: 2,
      },
    });

    const p3 = await prisma.pareja.create({
      data: {
        categoriaId: cat.id,
        jugador1: 'C1',
        jugador2: 'C2',
        orden: 4,
        slotsSeleccionados: {
          create: [{ slotId: 'Sabado-10:00' }, { slotId: 'Sabado-11:15' }, { slotId: 'Sabado-12:30' }],
        },
      },
    });

    const p4 = await prisma.pareja.create({
      data: {
        categoriaId: cat.id,
        jugador1: 'D1',
        jugador2: 'D2',
        orden: 5,
        slotsSeleccionados: {
          create: [{ slotId: 'Sabado-10:00' }, { slotId: 'Sabado-11:15' }, { slotId: 'Sabado-12:30' }],
        },
      },
    });

    await prisma.zonaPareja.createMany({
      data: [
        { zonaId: zona2.id, parejaId: p3.id },
        { zonaId: zona2.id, parejaId: p4.id },
      ],
    });

    await zonaService.regenerarPartidosZona(prisma, cat.id, zona2.id);

    // Agregar pareja tardía especificando slots comunes: ['Sabado-10:00', 'Sabado-11:15', 'Sabado-12:30']
    const slotsSolicitados = ['Sabado-10:00', 'Sabado-11:15', 'Sabado-12:30'];
    const resConSlots = await zonaService.agregarParejaAZona(org.id, cat.id, {
      zonaDestinoId: zona2.id,
      jugador1: 'ConSlot A',
      jugador2: 'ConSlot B',
      slotIds: slotsSolicitados,
    });

    const parejaConSlots = resConSlots.pareja;
    console.log(`✓ Pareja agregada con slots: "${parejaConSlots.jugador1} / ${parejaConSlots.jugador2}" (ID: ${parejaConSlots.id})`);

    // El orden de la pareja tardía es max(orden) + 1: la categoría tiene 1, 2, 4 y 5 (hueco en 3)
    const ordenesCat = (await prisma.pareja.findMany({ where: { categoriaId: cat.id } })).map((p) => p.orden);
    if (parejaConSlots.orden !== 6) {
      throw new Error(`La pareja tardía debía recibir orden 6 (max + 1), recibió ${parejaConSlots.orden}. Órdenes: ${JSON.stringify(ordenesCat)}`);
    }
    if (new Set(ordenesCat).size !== ordenesCat.length) {
      throw new Error(`Orden repetido en la categoría: ${JSON.stringify(ordenesCat)}`);
    }
    console.log(`✓ Orden de la pareja tardía: ${parejaConSlots.orden} (órdenes de la categoría ${JSON.stringify(ordenesCat.sort((a, b) => a - b))})`);

    // Verificar que los slots existen en SlotPareja
    const dbSlots = await prisma.slotPareja.findMany({
      where: { parejaId: parejaConSlots.id },
      select: { slotId: true },
    });
    const dbSlotIds = dbSlots.map((s) => s.slotId);
    console.log(`✓ Slots persistidos en DB: ${JSON.stringify(dbSlotIds)}`);
    if (dbSlotIds.length !== 3 || !dbSlotIds.includes('Sabado-10:00') || !dbSlotIds.includes('Sabado-11:15') || !dbSlotIds.includes('Sabado-12:30')) {
      throw new Error(`Los slots guardados en DB no coinciden. Esperados: ${JSON.stringify(slotsSolicitados)}, En DB: ${JSON.stringify(dbSlotIds)}`);
    }

    // Verificar los partidos de la nueva pareja
    const partidosNuevaPareja = await prisma.partido.findMany({
      where: {
        zonaId: zona2.id,
        OR: [{ pareja1Id: parejaConSlots.id }, { pareja2Id: parejaConSlots.id }],
      },
      include: { pareja1: true, pareja2: true },
    });

    console.log(`✓ Partidos generados para la pareja en Zona B: ${partidosNuevaPareja.length}`);
    if (partidosNuevaPareja.length !== 2) {
      throw new Error(`Se esperaban 2 partidos para la nueva pareja en zona de 3, se encontraron ${partidosNuevaPareja.length}`);
    }

    for (const part of partidosNuevaPareja) {
      if (!part.fechaHora) {
        throw new Error(`El partido #${part.id} debía asignarse automáticamente y quedó sin horario.`);
      }

      const fechaHora = new Date(part.fechaHora);
      const horasUTC = fechaHora.getUTCHours();
      const minutosUTC = fechaHora.getUTCMinutes();
      // 10:00 ART == 13:00 UTC
      // 11:15 ART == 14:15 UTC
      // 12:30 ART == 15:30 UTC
      const es1000 = horasUTC === 13 && minutosUTC === 0;
      const es1115 = horasUTC === 14 && minutosUTC === 15;
      const es1230 = horasUTC === 15 && minutosUTC === 30;

      console.log(`  - Partido: ${part.pareja1?.jugador1} vs ${part.pareja2?.jugador1} → ${fechaHora.toISOString()} (UTC ${horasUTC}:${minutosUTC})`);

      if (!es1000 && !es1115 && !es1230) {
        throw new Error(
          `El partido fue asignado fuera de los slots seleccionados: UTC ${horasUTC}:${minutosUTC} no corresponde a 10:00, 11:15 ni 12:30 ART.`
        );
      }
    }
    console.log('✓ Todos los partidos de la pareja con slots fueron auto-asignados dentro de sus slots declarados.');

    // --- SECCIÓN 4: Agregar pareja a una zona NO asigna partidos pendientes de OTRAS zonas ---
    console.log('\n--- 4. Probando que agregar pareja a Zona C NO auto-asigna partidos pendientes de Zona B ---');
    const zonaB = await prisma.zona.create({
      data: {
        categoriaId: catId,
        nombre: 'Zona B Aislada',
        clasifican: 3,
        formato: 'MINI_BRACKET',
      },
    });

    const pB1 = await prisma.pareja.create({ data: { categoriaId: catId, jugador1: 'B1_1', jugador2: 'B1_2', orden: 10 } });
    const pB2 = await prisma.pareja.create({ data: { categoriaId: catId, jugador1: 'B2_1', jugador2: 'B2_2', orden: 11 } });
    const pB3 = await prisma.pareja.create({ data: { categoriaId: catId, jugador1: 'B3_1', jugador2: 'B3_2', orden: 12 } });
    const pB4 = await prisma.pareja.create({ data: { categoriaId: catId, jugador1: 'B4_1', jugador2: 'B4_2', orden: 13 } });

    await prisma.zonaPareja.createMany({
      data: [
        { zonaId: zonaB.id, parejaId: pB1.id },
        { zonaId: zonaB.id, parejaId: pB2.id },
        { zonaId: zonaB.id, parejaId: pB3.id },
        { zonaId: zonaB.id, parejaId: pB4.id },
      ],
    });

    // Crear P3 y P4 de Zona B explícitamente sin horario
    const p3_zonaB = await prisma.partido.create({
      data: {
        categoriaId: catId,
        zonaId: zonaB.id,
        posicionEnRonda: 3,
        sinHorarioAsignado: true,
        fechaHora: null,
        canchaNumero: null,
        estado: 'PENDIENTE',
      },
    });
    const p4_zonaB = await prisma.partido.create({
      data: {
        categoriaId: catId,
        zonaId: zonaB.id,
        posicionEnRonda: 4,
        sinHorarioAsignado: true,
        fechaHora: null,
        canchaNumero: null,
        estado: 'PENDIENTE',
      },
    });

    // Crear Zona C con 2 parejas
    const zonaC = await prisma.zona.create({
      data: {
        categoriaId: catId,
        nombre: 'Zona C Destino',
        clasifican: 2,
        formato: 'ROUND_ROBIN',
      },
    });
    const pC1 = await prisma.pareja.create({ data: { categoriaId: catId, jugador1: 'C1_1', jugador2: 'C1_2', orden: 20 } });
    const pC2 = await prisma.pareja.create({ data: { categoriaId: catId, jugador1: 'C2_1', jugador2: 'C2_2', orden: 21 } });
    await prisma.zonaPareja.createMany({
      data: [
        { zonaId: zonaC.id, parejaId: pC1.id },
        { zonaId: zonaC.id, parejaId: pC2.id },
      ],
    });

    // Agregar pareja 3 a Zona C
    await zonaService.agregarParejaAZona(orgId, catId, {
      zonaDestinoId: zonaC.id,
      jugador1: 'C3_1',
      jugador2: 'C3_2',
      slotIds: ['Sabado-15:00'],
    });

    // Verificar que P3 y P4 de Zona B siguen sin horario
    const p3_b_check = await prisma.partido.findUnique({ where: { id: p3_zonaB.id } });
    const p4_b_check = await prisma.partido.findUnique({ where: { id: p4_zonaB.id } });

    if (!p3_b_check.sinHorarioAsignado || p3_b_check.fechaHora !== null) {
      throw new Error('Fallo: P3 de Zona B fue modificado indebidamente al agregar pareja a Zona C');
    }
    if (!p4_b_check.sinHorarioAsignado || p4_b_check.fechaHora !== null) {
      throw new Error('Fallo: P4 de Zona B fue modificado indebidamente al agregar pareja a Zona C');
    }
    console.log('✓ P3 y P4 de Zona B se mantuvieron sin horario intactos al agregar pareja a Zona C.');

    console.log('\n🎉 ¡Todos los tests de alta tardía (con slots, sin slots, 400 y aislamiento de zonas) pasaron exitosamente!');
  } finally {
    console.log('\n🧹 Limpiando datos de prueba...');
    if (catId) {
      await prisma.slotPareja.deleteMany({ where: { pareja: { categoriaId: catId } } });
      await prisma.partido.deleteMany({ where: { categoriaId: catId } });
      await prisma.zonaPareja.deleteMany({ where: { zona: { categoriaId: catId } } });
      await prisma.zona.deleteMany({ where: { categoriaId: catId } });
      await prisma.pareja.deleteMany({ where: { categoriaId: catId } });
      await prisma.categoria.deleteMany({ where: { id: catId } });
    }
    if (torneoId) {
      await prisma.torneo.deleteMany({ where: { id: torneoId } });
    }
    if (orgId) {
      await prisma.organizador.deleteMany({ where: { id: orgId } });
    }
    await prisma.$disconnect();
    console.log('✓ Limpieza completada.');
  }
}

if (require.main === module) {
  testAltaTardiaFlujo()
    .then(() => {
      console.log('✅ Suite test-alta-tardia-flujo completada con éxito.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Error en suite test-alta-tardia-flujo:', err);
      process.exit(1);
    });
}

module.exports = { testAltaTardiaFlujo };
