const { ensureTestDb } = require('./utils/testEnvGuard');
const prisma = require('../src/lib/prisma');
const faseEliminatoriaService = require('../src/services/faseEliminatoria.service');
const zonaService = require('../src/services/zona.service');
const crypto = require('crypto');

async function testSincronizarCuadro() {
  await ensureTestDb();
  console.log('🧪 Iniciando prueba automatizada de Sincronización del Cuadro Eliminatorio...');

  let organizador = null;
  let torneo = null;
  let categoria = null;

  try {
    const orgEmail = `test-sync-${Date.now()}@test.com`;
    organizador = await prisma.organizador.create({
      data: {
        nombre: 'Club Test Sync Cuadro',
        email: orgEmail,
        passwordHash: 'dummy',
        cantidadCanchas: 3,
        viernesInicio: '14:00',
        viernesFin: '22:00',
        sabadoInicio: '08:00',
        sabadoFin: '22:00',
        domingoInicio: '08:00',
        domingoFin: '22:00',
      },
    });

    torneo = await prisma.torneo.create({
      data: {
        organizadorId: organizador.id,
        nombre: 'Torneo Test Sync',
        slug: 'torneo-sync-' + crypto.randomBytes(3).toString('hex'),
        fecha: new Date('2026-09-11T10:00:00.000Z'),
        estado: 'EN_CURSO',
      },
    });

    categoria = await prisma.categoria.create({
      data: {
        torneoId: torneo.id,
        nombre: '5ta Varones',
        estado: 'EN_CURSO',
      },
    });

    // Crear 4 zonas (A, B, C, D) con 3 parejas cada una (total 12 parejas)
    // Inicialmente clasifican 2 por zona -> total 8 clasificados -> Cuadro de 8 (Cuartos de Final)
    const zonas = [];
    const nombresZonas = ['Zona A', 'Zona B', 'Zona C', 'Zona D'];

    for (let zIdx = 0; zIdx < 4; zIdx++) {
      const z = await prisma.zona.create({
        data: {
          categoriaId: categoria.id,
          nombre: nombresZonas[zIdx],
          formato: 'ROUND_ROBIN',
          clasifican: 2,
        },
      });

      for (let pIdx = 1; pIdx <= 3; pIdx++) {
        const pareja = await prisma.pareja.create({
          data: {
            categoriaId: categoria.id,
            jugador1: `Jugador ${zIdx + 1}.${pIdx}A`,
            jugador2: `Jugador ${zIdx + 1}.${pIdx}B`,
            orden: zIdx * 3 + pIdx,
          },
        });

        await prisma.slotPareja.create({
          data: {
            parejaId: pareja.id,
            slotId: 'Viernes-18:00',
          },
        });

        await prisma.zonaPareja.create({
          data: {
            zonaId: z.id,
            parejaId: pareja.id,
          },
        });
      }

      zonas.push(z);
    }

    // Generar cuadro inicial
    await faseEliminatoriaService.generarEliminatoria(organizador.id, categoria.id);
    const { programarHorariosEliminatorias } = require('../src/services/eliminatoriaScheduler.service');
    await programarHorariosEliminatorias(organizador.id, torneo.id, categoria.id);

    const estadoInicial = await faseEliminatoriaService.estadoCuadro(categoria.id);
    console.log('  Estado inicial:', {
      totalClasificadosEsperados: estadoInicial.totalClasificadosEsperados,
      lugaresEnPrimeraRonda: estadoInicial.lugaresEnPrimeraRonda,
      desactualizado: estadoInicial.desactualizado,
    });

    if (estadoInicial.desactualizado) {
      throw new Error('El cuadro inicial no debería estar desactualizado.');
    }
    if (estadoInicial.totalClasificadosEsperados !== 8 || estadoInicial.lugaresEnPrimeraRonda !== 8) {
      throw new Error(`Esperados 8 clasificados y 8 lugares, recibido: ${JSON.stringify(estadoInicial)}`);
    }

    // =========================================================================
    // TEST (a): Categoría con zona de 3 que pasa a 4: estadoCuadro.desactualizado = true
    // =========================================================================
    console.log('\n  [a] Probando alta de 4ta pareja en Zona A...');
    const altaRes = await zonaService.agregarParejaAZona(organizador.id, categoria.id, {
      zonaDestinoId: zonas[0].id,
      jugador1: 'Nuevo 1',
      jugador2: 'Nuevo 2',
      slotIds: ['Viernes-18:00'],
    });

    if (!altaRes.cuadroDesactualizado) {
      throw new Error('agregarParejaAZona debería devolver cuadroDesactualizado: true');
    }

    const estadoPostAlta = await faseEliminatoriaService.estadoCuadro(categoria.id);
    console.log('  Estado post alta:', {
      totalClasificadosEsperados: estadoPostAlta.totalClasificadosEsperados,
      lugaresEnPrimeraRonda: estadoPostAlta.lugaresEnPrimeraRonda,
      desactualizado: estadoPostAlta.desactualizado,
      puedeSincronizar: estadoPostAlta.puedeSincronizar,
    });

    if (!estadoPostAlta.desactualizado) {
      throw new Error('estadoCuadro.desactualizado debe ser true cuando una zona pasa a 4 parejas.');
    }
    if (estadoPostAlta.totalClasificadosEsperados !== 9) {
      throw new Error(`Se esperaban 9 clasificados (Zona A aporta 3 y B,C,D aportan 2 c/u), pero hay ${estadoPostAlta.totalClasificadosEsperados}`);
    }
    if (estadoPostAlta.lugaresEnPrimeraRonda !== 8) {
      throw new Error(`El cuadro viejo debería conservar 8 lugares, pero tiene ${estadoPostAlta.lugaresEnPrimeraRonda}`);
    }
    if (!estadoPostAlta.puedeSincronizar) {
      throw new Error('puedeSincronizar debe ser true cuando está desactualizado y no hubo juego.');
    }
    console.log('  ✅ [a] Cumplido: estadoCuadro.desactualizado = true y alta exitosa.');

    // =========================================================================
    // TEST (e): La simulación no modifica nada en la base
    // =========================================================================
    console.log('\n  [e] Probando simulación de sincronización (sin alterar DB)...');
    const simRes = await faseEliminatoriaService.sincronizarCuadro(organizador.id, categoria.id, { simular: true });
    console.log('  Resultado simulación:', {
      simulacion: simRes.simulacion,
      rondasTexto: simRes.rondasTexto,
      totalClasificadosActual: simRes.totalClasificadosActual,
      totalClasificadosNuevo: simRes.totalClasificadosNuevo,
      byesNuevos: simRes.byesNuevos,
      partidosACrear: simRes.partidosACrear,
      horariosQueCambian: simRes.horariosQueCambian,
    });

    if (!simRes.simulacion) {
      throw new Error('La respuesta de simulación debe tener simulacion: true.');
    }
    if (simRes.tamanoActual !== 8 || simRes.tamanoNuevo !== 16) {
      throw new Error(`Simulación incorrecta de tamaños: actual=${simRes.tamanoActual}, nuevo=${simRes.tamanoNuevo}`);
    }
    if (simRes.byesNuevos !== 7) {
      throw new Error(`En cuadro de 16 con 9 clasificados debe haber 7 byes, recibido: ${simRes.byesNuevos}`);
    }

    // Verificar que en la DB el bracket sigue intacto (Cuartos de final = ronda 8)
    const fasesPostSim = await prisma.faseEliminatoria.findMany({
      where: { categoriaId: categoria.id },
      orderBy: { ronda: 'desc' },
    });
    if (fasesPostSim.length !== 3 || fasesPostSim[0].ronda !== 8) {
      throw new Error('La simulación alteró indebidamente las fases en la base de datos.');
    }
    console.log('  ✅ [e] Cumplido: la simulación devuelve métricas precisas y no modifica nada en DB.');

    // =========================================================================
    // TEST (b): Sincronizar con 0 partidos jugados actualiza el cuadro con todos los lugares
    // =========================================================================
    console.log('\n  [b] Ejecutando sincronizarCuadro con 0 partidos eliminatorios jugados...');
    const syncRes = await faseEliminatoriaService.sincronizarCuadro(organizador.id, categoria.id);
    console.log('  Resultado sincronización:', syncRes.message);

    const estadoPostSync = await faseEliminatoriaService.estadoCuadro(categoria.id);
    console.log('  Estado post sync:', {
      totalClasificadosEsperados: estadoPostSync.totalClasificadosEsperados,
      lugaresEnPrimeraRonda: estadoPostSync.lugaresEnPrimeraRonda,
      desactualizado: estadoPostSync.desactualizado,
      puedeSincronizar: estadoPostSync.puedeSincronizar,
    });

    if (estadoPostSync.desactualizado) {
      throw new Error('Tras sincronizar, el cuadro NO debe figurar desactualizado.');
    }
    if (estadoPostSync.lugaresEnPrimeraRonda !== 9) {
      throw new Error(`El nuevo cuadro debe reservar 9 lugares para clasificados, pero tiene ${estadoPostSync.lugaresEnPrimeraRonda}`);
    }

    // Verificar que cada clasificado esperado tiene su placeholder en la primera ronda (Octavos = 16)
    const faseOctavos = await prisma.faseEliminatoria.findFirst({
      where: { categoriaId: categoria.id, ronda: 16 },
      include: { partidos: true },
    });
    if (!faseOctavos) {
      throw new Error('No se creó la fase de Octavos de Final (ronda 16).');
    }

    const placeholdersEnCuadro = new Set();
    faseOctavos.partidos.forEach((p) => {
      if (p.origenPareja1) placeholdersEnCuadro.add(p.origenPareja1);
      if (p.origenPareja2) placeholdersEnCuadro.add(p.origenPareja2);
    });

    const expectedPlaceholders = [
      '1° Zona A', '2° Zona A', '3° Zona A',
      '1° Zona B', '2° Zona B',
      '1° Zona C', '2° Zona C',
      '1° Zona D', '2° Zona D',
    ];

    for (const exp of expectedPlaceholders) {
      if (!placeholdersEnCuadro.has(exp)) {
        throw new Error(`Falta el placeholder esperado "${exp}" en la primera ronda del cuadro.`);
      }
    }
    console.log('  ✅ [b] Cumplido: cuadro sincronizado a 16 con los 9 lugares y placeholders completos.');

    // =========================================================================
    // TEST (c): Con un partido eliminatorio FINALIZADO, sincronizar -> 400 y cuadro no cambia
    // =========================================================================
    console.log('\n  [c] Simulando partido eliminatorio FINALIZADO e intentando sincronizar...');
    const partidoAJugar = faseOctavos.partidos[0];
    await prisma.partido.update({
      where: { id: partidoAJugar.id },
      data: { estado: 'FINALIZADO' },
    });

    let sincronizoConError = false;
    try {
      await faseEliminatoriaService.sincronizarCuadro(organizador.id, categoria.id);
    } catch (err) {
      sincronizoConError = true;
      console.log('  Capturado error esperado al sincronizar:', err.message);
      if (err.statusCode !== 400) {
        throw new Error(`Esperado statusCode 400, recibido: ${err.statusCode}`);
      }
      if (!err.message.includes('ya hay partidos eliminatorios jugados')) {
        throw new Error(`Mensaje inesperado: ${err.message}`);
      }
    }

    if (!sincronizoConError) {
      throw new Error('sincronizarCuadro debió fallar con 400 al haber partidos eliminatorios finalizados.');
    }

    // Verificar que el cuadro no cambió
    const fasePostIntento = await prisma.faseEliminatoria.findFirst({
      where: { categoriaId: categoria.id, ronda: 16 },
    });
    if (!fasePostIntento || fasePostIntento.id !== faseOctavos.id) {
      throw new Error('El cuadro no debió modificarse tras el error 400.');
    }
    console.log('  ✅ [c] Cumplido: sincronizar rechazado con 400 y cuadro inalterado.');

    // =========================================================================
    // TEST (d): Agregar pareja que cambia clasifican con partido eliminatorio jugado -> 400
    // =========================================================================
    console.log('\n  [d] Intentando agregar 4ta pareja a Zona B mientras hay partido eliminatorio jugado...');
    let altaConError = false;
    try {
      await zonaService.agregarParejaAZona(organizador.id, categoria.id, {
        zonaDestinoId: zonas[1].id,
        jugador1: 'Intento 1',
        jugador2: 'Intento 2',
        slotIds: ['Viernes-18:00'],
      });
    } catch (err) {
      altaConError = true;
      console.log('  Capturado error esperado en alta tardía:', err.message);
      if (err.statusCode !== 400) {
        throw new Error(`Esperado statusCode 400, recibido: ${err.statusCode}`);
      }
      if (!err.message.includes('el cuadro eliminatorio ya está en juego')) {
        throw new Error(`Mensaje inesperado: ${err.message}`);
      }
    }

    if (!altaConError) {
      throw new Error('agregarParejaAZona debió fallar con 400 cuando cambia clasifican y la eliminatoria está en juego.');
    }

    // Verificar que Zona B sigue teniendo 3 parejas
    const countZonaB = await prisma.zonaPareja.count({ where: { zonaId: zonas[1].id } });
    if (countZonaB !== 3) {
      throw new Error(`Zona B debió mantener 3 parejas, pero tiene ${countZonaB}`);
    }
    console.log('  ✅ [d] Cumplido: agregar pareja rechazado con 400 por eliminatoria en juego.');

    console.log('\n🎉 ¡TODAS LAS ASSECIONES DE SINCRONIZACIÓN DE CUADRO PASARON EXITOSAMENTE!');
  } finally {
    try {
      if (torneo) {
        await prisma.partido.deleteMany({ where: { categoria: { torneoId: torneo.id } } });
        await prisma.faseEliminatoria.deleteMany({ where: { categoria: { torneoId: torneo.id } } });
        await prisma.zonaPareja.deleteMany({ where: { zona: { categoria: { torneoId: torneo.id } } } });
        await prisma.slotPareja.deleteMany({ where: { pareja: { categoria: { torneoId: torneo.id } } } });
        await prisma.pareja.deleteMany({ where: { categoria: { torneoId: torneo.id } } });
        await prisma.zona.deleteMany({ where: { categoria: { torneoId: torneo.id } } });
        await prisma.categoria.deleteMany({ where: { torneoId: torneo.id } });
        await prisma.torneo.deleteMany({ where: { id: torneo.id } });
      }
      if (organizador) {
        await prisma.organizador.deleteMany({ where: { id: organizador.id } });
      }
    } catch (_) {}
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  testSincronizarCuadro()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Error en test-sincronizar-cuadro:', err);
      process.exit(1);
    });
}

module.exports = { testSincronizarCuadro };
