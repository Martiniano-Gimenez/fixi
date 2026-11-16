const { ensureTestDb } = require('./utils/testEnvGuard');
const prisma = require('../src/lib/prisma');
const faseEliminatoriaService = require('../src/services/faseEliminatoria.service');
const zonaService = require('../src/services/zona.service');
const partidoService = require('../src/services/partido.service');
const organizadorService = require('../src/services/organizador.service');
const canchasOverridesService = require('../src/services/canchasOverrides.service');
const crypto = require('crypto');
const assert = require('node:assert/strict');

async function testIntercambioCruces(organizadorId, torneoId) {
  const categoria = await prisma.categoria.create({ data: { torneoId, nombre: 'Intercambio de octavos', estado: 'EN_CURSO',
    parejas: { create: Array.from({ length: 6 }, (_, i) => ({ orden: i + 1, jugador1: `Pareja ${i + 1}`, jugador2: 'Intercambio' })) },
  }, include: { parejas: { orderBy: { orden: 'asc' } } } });
  try {
    const fase = await prisma.faseEliminatoria.create({ data: { categoriaId: categoria.id, nombre: 'Octavos de Final', ronda: 16 } });
    const [a, b, c, d, e, f] = categoria.parejas;
    const bases = [
      { posicionEnRonda: 1, origenPareja1: '1° Zona A', origenPareja2: '1° Zona B', pareja1Id: a.id, pareja2Id: b.id },
      { posicionEnRonda: 8, origenPareja1: '2° Zona A', origenPareja2: '2° Zona B', pareja1Id: c.id, pareja2Id: d.id },
      { posicionEnRonda: 2, origenPareja1: '1° Zona C', origenPareja2: '2° Zona C', pareja1Id: e.id, pareja2Id: f.id },
    ];
    const partidos = [];
    for (const base of bases) partidos.push(await prisma.partido.create({ data: {
      ...base, categoriaId: categoria.id, faseEliminatoriaId: fase.id,
      fechaHora: new Date('2026-11-08T15:00:00.000Z'), canchaNumero: 1, horarioManual: true,
    } }));
    const [actual, otro, testigo] = partidos;
    const leer = () => prisma.partido.findMany({ where: { categoriaId: categoria.id }, orderBy: { posicionEnRonda: 'asc' }, include: { sets: true } });
    const restaurar = async () => {
      for (let i = 0; i < partidos.length; i++) await prisma.partido.update({ where: { id: partidos[i].id }, data: { ...bases[i], estado: 'PENDIENTE' } });
    };
    for (const ladoActual of [1, 2]) for (const ladoOtro of [1, 2]) {
      await restaurar();
      const antes = await leer();
      await partidoService.updateBracketMatch(organizadorId, actual.id, {
        [`origenPareja${ladoActual}`]: otro[`origenPareja${ladoOtro}`], liberarEnOtros: true,
      });
      const despues = await leer();
      const esperado = structuredClone(antes);
      const p = esperado.find((r) => r.id === actual.id), q = esperado.find((r) => r.id === otro.id);
      for (const campo of ['origenPareja', 'pareja']) {
        const cp = campo === 'pareja' ? `pareja${ladoActual}Id` : `origenPareja${ladoActual}`;
        const cq = campo === 'pareja' ? `pareja${ladoOtro}Id` : `origenPareja${ladoOtro}`;
        [p[cp], q[cq]] = [q[cq], p[cp]];
      }
      assert.deepEqual(despues, esperado, 'Se intercambian ambos lados con sus parejas, sin cambiar otros campos ni partidos');
    }

    await restaurar();
    await prisma.partido.update({ where: { id: actual.id }, data: { origenPareja1: null, pareja1Id: null } });
    await partidoService.updateBracketMatch(organizadorId, actual.id, { origenPareja1: otro.origenPareja2, liberarEnOtros: true });
    let p = await prisma.partido.findUnique({ where: { id: actual.id } });
    let q = await prisma.partido.findUnique({ where: { id: otro.id } });
    assert.equal(p.origenPareja1, otro.origenPareja2); assert.equal(p.pareja1Id, d.id);
    assert.equal(q.origenPareja2, null); assert.equal(q.pareja2Id, null, 'El origen de un lugar vacío deja vacío al otro');

    await restaurar();
    await prisma.partido.update({ where: { id: otro.id }, data: { pareja1Id: null } });
    await partidoService.updateBracketMatch(organizadorId, actual.id, { origenPareja1: otro.origenPareja1, liberarEnOtros: true });
    assert.equal((await prisma.partido.findUnique({ where: { id: actual.id } })).pareja1Id, null, 'Un origen sin clasificado no arrastra la pareja vieja');

    for (const estado of ['FINALIZADO', 'EN_CURSO']) for (const id of [actual.id, otro.id]) {
      await restaurar(); await prisma.partido.update({ where: { id }, data: { estado } });
      const antes = await leer();
      await assert.rejects(() => partidoService.updateBracketMatch(organizadorId, actual.id, {
        origenPareja1: otro.origenPareja1, liberarEnOtros: true,
      }), { statusCode: 400 });
      assert.deepEqual(await leer(), antes, 'Un partido finalizado o en juego bloquea toda la operación');
    }
    await restaurar();
    let antes = await leer();
    await assert.rejects(() => partidoService.updateBracketMatch(organizadorId, actual.id, { origenPareja1: otro.origenPareja1 }), { statusCode: 400 });
    assert.deepEqual(await leer(), antes, 'Sin confirmación no se mueve un origen ajeno');
    await assert.rejects(() => partidoService.updateBracketMatch(organizadorId, actual.id, { origenPareja1: actual.origenPareja2 }), { statusCode: 400 });

    await partidoService.updateBracketMatch(organizadorId, actual.id, {
      origenPareja1: otro.origenPareja2, origenPareja2: otro.origenPareja1, liberarEnOtros: true,
    });
    p = await prisma.partido.findUnique({ where: { id: actual.id } }); q = await prisma.partido.findUnique({ where: { id: otro.id } });
    assert.deepEqual([p.origenPareja1, p.origenPareja2, q.origenPareja1, q.origenPareja2], [bases[1].origenPareja2, bases[1].origenPareja1, bases[0].origenPareja2, bases[0].origenPareja1]);
    assert.deepEqual([p.pareja1Id, p.pareja2Id, q.pareja1Id, q.pareja2Id], [d.id, c.id, b.id, a.id]);

    await restaurar();
    await partidoService.updateBracketMatch(organizadorId, actual.id, {
      origenPareja1: otro.origenPareja1, origenPareja2: actual.origenPareja1, liberarEnOtros: true,
    });
    p = await prisma.partido.findUnique({ where: { id: actual.id } }); q = await prisma.partido.findUnique({ where: { id: otro.id } });
    assert.deepEqual([p.origenPareja1, p.origenPareja2, q.origenPareja1], [bases[1].origenPareja1, bases[0].origenPareja1, bases[0].origenPareja2]);
    assert.deepEqual([p.pareja1Id, p.pareja2Id, q.pareja1Id], [c.id, a.id, b.id], 'Los intercambios encadenados no duplican orígenes ni parejas');

    await restaurar(); antes = await leer();
    const transaction = prisma.$transaction;
    prisma.$transaction = (fn, ...args) => transaction.call(prisma, async (tx) => { await fn(tx); throw new Error('Fallo simulado antes del commit'); }, ...args);
    try {
      await assert.rejects(() => partidoService.updateBracketMatch(organizadorId, actual.id, { origenPareja1: otro.origenPareja1, liberarEnOtros: true }), /Fallo simulado/);
    } finally { prisma.$transaction = transaction; }
    assert.deepEqual(await leer(), antes, 'El rollback conserva los dos partidos enteros');
    assert.deepEqual(await prisma.partido.findUnique({ where: { id: testigo.id } }), testigo);
    console.log('  ✅ Intercambio de octavos: ambos lados, lugar vacío, parejas, bloqueos, encadenados y rollback.');
  } finally { await prisma.categoria.delete({ where: { id: categoria.id } }); }
}

async function testSincronizarCuadro() {
  await ensureTestDb();
  await canchasOverridesService.loadFromDb();
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

    // [b.c] Sincronizar el cuadro recalcula los esBye:
    // Con 9 clasificados en cuadro de 16, hay exactamente 7 BYEs (16 - 9 = 7)
    const byesPostSync = faseOctavos.partidos.filter((p) => p.esBye);
    if (byesPostSync.length !== 7) {
      throw new Error(`Tras sincronizar a 16 con 9 clasificados, se esperaban 7 BYEs con esBye=true, encontrado: ${byesPostSync.length}`);
    }
    const partidosPosteriores = await prisma.partido.findMany({
      where: {
        categoriaId: categoria.id,
        faseEliminatoria: { ronda: { lt: 16 } },
      },
    });
    if (partidosPosteriores.some((p) => p.esBye)) {
      throw new Error('Ningún partido de fases posteriores debe tener esBye=true');
    }
    console.log('  ✅ [b.c] Cumplido: sincronizarCuadro recalculó exactamente 7 partidos con esBye=true.');

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

    // =========================================================================
    // TEST (f): Cuadro de 32 con BYEs:
    // - Ningún BYE tiene horario asignado ni figura en conteo de partidos sin horario.
    // - esBye correcto (13 BYEs y 3 normales para 19 clasificados).
    // - El display de la ronda siguiente (Octavos) proyecta el origen ("1° Zona A").
    // - Al finalizar la zona, el ganador del BYE avanza y se muestra en ambas tarjetas.
    // =========================================================================
    console.log('\n  [f] Probando cuadro de 32 con BYEs, scheduler, conteos y avance tras fin de zona...');
    const cat32 = await prisma.categoria.create({
      data: {
        torneoId: torneo.id,
        nombre: '5ta Con Byes',
        estado: 'EN_CURSO',
      },
    });

    // 7 zonas: 5 de 4 parejas clasifican 3 (= 15) y 2 de 3 parejas clasifican 2 (= 4).
    // Total clasificados = 19 -> Cuadro de 32 (Dieciseisavos) con 13 BYEs y 3 cruces normales.
    const zonas32 = [];
    const nombresZonas32 = ['Zona A', 'Zona B', 'Zona C', 'Zona D', 'Zona E', 'Zona F', 'Zona G'];
    const tamaniosZonas = [4, 4, 4, 4, 4, 3, 3];
    const clasificanZonas = [3, 3, 3, 3, 3, 2, 2];

    const parejasPorZona = {};

    for (let i = 0; i < 7; i++) {
      const z = await prisma.zona.create({
        data: {
          categoriaId: cat32.id,
          nombre: nombresZonas32[i],
          formato: tamaniosZonas[i] === 4 ? 'MINI_BRACKET' : 'ROUND_ROBIN',
          clasifican: clasificanZonas[i],
        },
      });

      parejasPorZona[z.id] = [];
      for (let p = 1; p <= tamaniosZonas[i]; p++) {
        const pareja = await prisma.pareja.create({
          data: {
            categoriaId: cat32.id,
            jugador1: `J1 ${z.nombre} P${p}`,
            jugador2: `J2 ${z.nombre} P${p}`,
            orden: i * 10 + p,
          },
        });
        await prisma.zonaPareja.create({
          data: {
            zonaId: z.id,
            parejaId: pareja.id,
            posicion: p,
          },
        });
        parejasPorZona[z.id].push(pareja);
      }

      // Crear al menos 1 partido pendiente en cada zona para simular que el torneo está en curso
      const mockZonaFecha = new Date('2026-09-11T21:00:00.000Z'); // Viernes 18:00 ART
      if (tamaniosZonas[i] === 4) {
        await prisma.partido.create({
          data: {
            categoriaId: cat32.id,
            zonaId: z.id,
            pareja1Id: parejasPorZona[z.id][0].id,
            pareja2Id: parejasPorZona[z.id][1].id,
            posicionEnRonda: 1,
            estado: 'PENDIENTE',
            fechaHora: mockZonaFecha,
            canchaNumero: 1,
            sinHorarioAsignado: false,
          },
        });
        await prisma.partido.create({
          data: {
            categoriaId: cat32.id,
            zonaId: z.id,
            pareja1Id: parejasPorZona[z.id][2].id,
            pareja2Id: parejasPorZona[z.id][3].id,
            posicionEnRonda: 2,
            estado: 'PENDIENTE',
            fechaHora: mockZonaFecha,
            canchaNumero: 2,
            sinHorarioAsignado: false,
          },
        });
      } else {
        await prisma.partido.create({
          data: {
            categoriaId: cat32.id,
            zonaId: z.id,
            pareja1Id: parejasPorZona[z.id][0].id,
            pareja2Id: parejasPorZona[z.id][1].id,
            posicionEnRonda: 1,
            estado: 'PENDIENTE',
            fechaHora: mockZonaFecha,
            canchaNumero: 1,
            sinHorarioAsignado: false,
          },
        });
      }

      zonas32.push(z);
    }

    // Generar eliminatoria para cat32
    await faseEliminatoriaService.generarEliminatoria(organizador.id, cat32.id);

    // Programar horarios con el scheduler
    await programarHorariosEliminatorias(organizador.id, torneo.id, cat32.id);

    // Obtener fases eliminatorias con la API
    const fasesCat32 = await faseEliminatoriaService.getFasesEliminatorias(organizador.id, cat32.id);

    const faseDieciseisavos = fasesCat32.find((f) => f.ronda === 32);
    if (!faseDieciseisavos) {
      throw new Error('No se generó la fase de Dieciseisavos (ronda 32).');
    }
    if (faseDieciseisavos.partidos.length !== 16) {
      throw new Error(`Se esperaban 16 partidos en Dieciseisavos, hay ${faseDieciseisavos.partidos.length}`);
    }

    const partidosBye = faseDieciseisavos.partidos.filter((p) => p.esBye);
    const partidosNormales = faseDieciseisavos.partidos.filter((p) => !p.esBye);

    if (partidosBye.length !== 13) {
      throw new Error(`Se esperaban exactamente 13 BYEs en cuadro de 32 con 19 parejas, recibido: ${partidosBye.length}`);
    }
    if (partidosNormales.length !== 3) {
      throw new Error(`Se esperaban 3 cruces normales en Dieciseisavos, recibido: ${partidosNormales.length}`);
    }

    // (a) Verificar que los 13 BYEs están en los primeros 13 cabezas de serie según la secuencia de seeding
    const seq16 = [1, 16, 9, 8, 5, 12, 13, 4, 3, 14, 11, 6, 7, 10, 15, 2];
    const posicionesEsperadasBye = new Set(seq16.slice(0, 13));
    for (const p of faseDieciseisavos.partidos) {
      const debeSerBye = posicionesEsperadasBye.has(p.posicionEnRonda);
      if (p.esBye !== debeSerBye) {
        throw new Error(`Partido #${p.posicionEnRonda} en DB tiene esBye=${p.esBye}, esperado: ${debeSerBye}`);
      }
    }
    console.log('  ✅ [f.a] Exactamente 13 partidos con esBye=true en los primeros 13 cabezas de serie.');

    // 1. Ningún BYE tiene horario ni cancha ni sinHorarioAsignado = true
    for (const byeMatch of partidosBye) {
      if (byeMatch.fechaHora !== null) {
        throw new Error(`El partido BYE #${byeMatch.posicionEnRonda} no debería tener fechaHora asignada: ${byeMatch.fechaHora}`);
      }
      if (byeMatch.canchaNumero !== null) {
        throw new Error(`El partido BYE #${byeMatch.posicionEnRonda} no debería tener cancha asignada: ${byeMatch.canchaNumero}`);
      }
      if (byeMatch.sinHorarioAsignado === true) {
        throw new Error(`El partido BYE #${byeMatch.posicionEnRonda} no debería tener sinHorarioAsignado: true`);
      }
    }
    console.log('  ✅ [f.1] Ningún BYE tiene horario ni figura como sinHorarioAsignado.');

    // 2. Verificar que los reportes de sin horario no incluyen los BYEs
    const sinHorarioList = await organizadorService.getPartidosSinHorarioTorneo(organizador.id, torneo.id);
    const byeIds = new Set(partidosBye.map((p) => p.id));
    const byeEnSinHorario = sinHorarioList.filter((p) => byeIds.has(p.id));
    if (byeEnSinHorario.length > 0) {
      throw new Error(`Se encontraron ${byeEnSinHorario.length} BYEs en getPartidosSinHorarioTorneo!`);
    }
    console.log('  ✅ [f.2] Los BYEs no figuran en getPartidosSinHorarioTorneo.');

    // (b) Edición manual: vaciar un lado de un cruce NO bye
    const cruceNormal = partidosNormales[0];

    // Intentar editar un BYE debe fallar con 400
    let falloEditarBye = false;
    try {
      await partidoService.updateBracketMatch(organizador.id, partidosBye[0].id, {
        origenPareja2: '2° Zona A',
      });
    } catch (err) {
      falloEditarBye = true;
      if (!err.message.includes('No se pueden editar cruces de un partido pase directo (BYE)')) {
        throw new Error(`Mensaje inesperado al editar BYE: ${err.message}`);
      }
    }
    if (!falloEditarBye) {
      throw new Error('updateBracketMatch debió fallar al intentar editar un cruce BYE.');
    }

    // La API conserva todos los clasificados; el lugar vacío se prepara como fixture del scheduler.
    const cruceAntesDeVaciar = await prisma.partido.findUnique({ where: { id: cruceNormal.id } });
    await assert.rejects(() => partidoService.updateBracketMatch(organizador.id, cruceNormal.id, {
      origenPareja2: null,
    }), { statusCode: 400, message: 'Cada clasificado tiene que seguir en el cuadro.' });
    assert.deepEqual(await prisma.partido.findUnique({ where: { id: cruceNormal.id } }), cruceAntesDeVaciar);
    await prisma.partido.update({ where: { id: cruceNormal.id }, data: { origenPareja2: null, pareja2Id: null } });

    const cruceEditadoDb = await prisma.partido.findUnique({ where: { id: cruceNormal.id } });
    if (cruceEditadoDb.esBye !== false) {
      throw new Error(`Al vaciar un lado, el cruce NO debe convertirse en BYE. Recibido esBye=${cruceEditadoDb.esBye}`);
    }
    if (cruceEditadoDb.origenPareja2 !== null) {
      throw new Error('origenPareja2 debió quedar en null');
    }

    // Comprobar que conserva su lugar en el scheduler (no se borró ni se convirtió en BYE)
    if (!cruceEditadoDb.fechaHora || !cruceEditadoDb.canchaNumero) {
      throw new Error('El cruce normal editado debe conservar su lugar asignado en el scheduler');
    }

    // Si el cruce normal queda pendiente sin horario asignado
    await prisma.partido.update({
      where: { id: cruceNormal.id },
      data: { fechaHora: null, canchaNumero: null, sinHorarioAsignado: true },
    });

    // Comprobar que aparece en el conteo de partidos sin horario (los BYE nunca aparecen)
    const sinHorarioPostEdit = await organizadorService.getPartidosSinHorarioTorneo(organizador.id, torneo.id);
    const estaEnSinHorario = sinHorarioPostEdit.some((p) => p.id === cruceNormal.id);
    if (!estaEnSinHorario) {
      throw new Error('El cruce normal con un lado vacío debe aparecer en getPartidosSinHorarioTorneo.');
    }

    // Y al re-ejecutar el scheduler, vuelve a recibir horario porque NO es un BYE
    await programarHorariosEliminatorias(organizador.id, torneo.id, cat32.id);
    const cruceReprogramado = await prisma.partido.findUnique({ where: { id: cruceNormal.id } });
    if (!cruceReprogramado.fechaHora || !cruceReprogramado.canchaNumero) {
      throw new Error('El scheduler debió reprogramar el cruce normal con lado vacío');
    }
    console.log('  ✅ [f.b] Cruce normal con lado vacío conserva esBye=false, se programa en scheduler y figura en conteo sin horario.');

    // 3. Verificar display de la ronda siguiente (Octavos = 16)
    const faseOctavos32 = fasesCat32.find((f) => f.ronda === 16);
    if (!faseOctavos32) {
      throw new Error('No se encontró la fase de Octavos (ronda 16).');
    }

    // El partido #1 de Dieciseisavos es BYE con 1° Zona A
    const partido1Dieciseisavos = faseDieciseisavos.partidos.find((p) => p.posicionEnRonda === 1);
    if (!partido1Dieciseisavos || !partido1Dieciseisavos.esBye) {
      throw new Error('El partido #1 de Dieciseisavos debe ser BYE.');
    }
    const origenByeP1 = partido1Dieciseisavos.origenPareja1 || partido1Dieciseisavos.origenPareja2;

    // En Octavos, partido #1 slot 1 proviene del partido #1 de Dieciseisavos
    const partido1Octavos = faseOctavos32.partidos.find((p) => p.posicionEnRonda === 1);
    if (!partido1Octavos) {
      throw new Error('No se encontró el partido #1 de Octavos.');
    }
    if (partido1Octavos.displayOrigenPareja1 !== origenByeP1) {
      throw new Error(`El displayOrigenPareja1 de Octavos debía ser "${origenByeP1}", recibido: "${partido1Octavos.displayOrigenPareja1}"`);
    }
    if (partido1Octavos.displayOrigenPareja2 !== 'Ganador Dieciseisavos #2') {
      throw new Error(`El displayOrigenPareja2 de Octavos debía ser "Ganador Dieciseisavos #2", recibido: "${partido1Octavos.displayOrigenPareja2}"`);
    }

    const faseCuartos32 = fasesCat32.find((f) => f.ronda === 8);
    const partido1Cuartos = faseCuartos32?.partidos.find((p) => p.posicionEnRonda === 1);
    if (!partido1Cuartos || partido1Cuartos.displayOrigenPareja1 !== 'Ganador Octavos #1' || partido1Cuartos.displayOrigenPareja2 !== 'Ganador Octavos #2') {
      throw new Error(`Cuartos #1 debía proyectar "Ganador Octavos #1" y "Ganador Octavos #2", recibido: "${partido1Cuartos?.displayOrigenPareja1}" y "${partido1Cuartos?.displayOrigenPareja2}"`);
    }

    const faseFinal32 = fasesCat32.find((f) => f.ronda === 2);
    const partido1Final = faseFinal32?.partidos.find((p) => p.posicionEnRonda === 1);
    if (!partido1Final || partido1Final.displayOrigenPareja1 !== 'Ganador Semifinal #1' || partido1Final.displayOrigenPareja2 !== 'Ganador Semifinal #2') {
      throw new Error(`Final #1 debía proyectar "Ganador Semifinal #1" y "Ganador Semifinal #2", recibido: "${partido1Final?.displayOrigenPareja1}" y "${partido1Final?.displayOrigenPareja2}"`);
    }

    console.log(`  ✅ [f.3] Display de Octavos proyecta "${partido1Octavos.displayOrigenPareja1}" y "${partido1Octavos.displayOrigenPareja2}".`);
    console.log(`  ✅ [f.3] Display de Cuartos y Final proyecta correctamente "Ganador [Ronda] #[Pos]".`);

    // 4. Finalizar la Zona A: la pareja real avanza y reemplaza el texto en Dieciseisavos y Octavos
    console.log('  Finalizando los partidos de Zona A...');
    const parejaGanadoraZonaA = parejasPorZona[zonas32[0].id][0];

    // Finalizamos los partidos de zona de cat32 (completando la fase de zonas)
    await prisma.partido.updateMany({
      where: { categoriaId: cat32.id, zonaId: { not: null } },
      data: {
        estado: 'FINALIZADO',
        ganadorId: parejaGanadoraZonaA.id,
      },
    });

    // Actualizamos las stats de la pareja ganadora para que quede en primer lugar
    await prisma.zonaPareja.updateMany({
      where: { zonaId: zonas32[0].id, parejaId: parejaGanadoraZonaA.id },
      data: { posicion: 1, puntos: 9, pg: 3 },
    });

    // Ejecutar verificación y autoasignación de la categoría
    await partidoService.verificarYAutoAsignarEliminatoria(organizador.id, cat32.id);

    // Verificar que el partido #1 de Dieciseisavos ahora está FINALIZADO con la pareja ganadora
    const partido1DieciseisavosPost = await prisma.partido.findUnique({
      where: { id: partido1Dieciseisavos.id },
    });
    if (partido1DieciseisavosPost.estado !== 'FINALIZADO') {
      throw new Error(`El BYE debía quedar FINALIZADO tras finalizar su zona, estado: ${partido1DieciseisavosPost.estado}`);
    }
    if (partido1DieciseisavosPost.ganadorId !== parejaGanadoraZonaA.id) {
      throw new Error(`El ganador del BYE debía ser ${parejaGanadoraZonaA.id}, recibido: ${partido1DieciseisavosPost.ganadorId}`);
    }

    // Verificar que en Octavos el ganador avanzó a la base de datos
    const partido1OctavosPost = await prisma.partido.findUnique({
      where: { id: partido1Octavos.id },
    });
    if (partido1OctavosPost.pareja1Id !== parejaGanadoraZonaA.id) {
      throw new Error(`En Octavos la pareja1Id debía ser ${parejaGanadoraZonaA.id}, recibido: ${partido1OctavosPost.pareja1Id}`);
    }

    // Y en la API getFasesEliminatorias
    const fasesPostFinZona = await faseEliminatoriaService.getFasesEliminatorias(organizador.id, cat32.id);
    const octavosPostFin = fasesPostFinZona.find((f) => f.ronda === 16);
    const p1OctavosApi = octavosPostFin.partidos.find((p) => p.posicionEnRonda === 1);
    if (!p1OctavosApi.pareja1 || p1OctavosApi.pareja1.id !== parejaGanadoraZonaA.id) {
      throw new Error('La respuesta de la API para Octavos debe incluir el objeto de pareja1 con la pareja ganadora.');
    }

    // Verificación requerida: tipo y estructura de displayPareja1 en la ronda siguiente
    if (typeof p1OctavosApi.displayPareja1 !== 'object' || p1OctavosApi.displayPareja1 === null) {
      throw new Error(`displayPareja1 en admin debe ser un objeto de pareja, recibido: ${typeof p1OctavosApi.displayPareja1}`);
    }
    if (typeof p1OctavosApi.displayPareja1.jugador1 !== 'string' || typeof p1OctavosApi.displayPareja1.jugador2 !== 'string') {
      throw new Error('displayPareja1 debe ser un objeto con jugador1 y jugador2 definidos como texto.');
    }
    if (p1OctavosApi.displayPareja1.id !== parejaGanadoraZonaA.id) {
      throw new Error(`displayPareja1.id debe coincidir con la pareja ganadora (${parejaGanadoraZonaA.id}), recibido: ${p1OctavosApi.displayPareja1.id}`);
    }
    console.log(`  ✅ [f.4] displayPareja1 en Octavos es un objeto válido: "${p1OctavosApi.displayPareja1.jugador1} / ${p1OctavosApi.displayPareja1.jugador2}" (id: ${p1OctavosApi.displayPareja1.id}).`);
    console.log('  ✅ [f.4] Al finalizar la zona, el ganador del BYE avanzó y se muestra en Octavos.');

    await testIntercambioCruces(organizador.id, torneo.id);
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
