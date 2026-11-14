const { ensureTestDb } = require('./utils/testEnvGuard');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const prisma = new PrismaClient();

const organizadorService = require('../src/services/organizador.service');
const zonaService = require('../src/services/zona.service');
const torneoService = require('../src/services/torneo.service');
const partidoService = require('../src/services/partido.service');
const categoriaService = require('../src/services/categoria.service');
const { parseFechaLocal, getDiaCalendarioConTrasnoche, clavesJornadasTorneo } = require('../src/utils/dateUtils');
const canchasOverridesService = require('../src/services/canchasOverrides.service');
const assert = require('assert');

/**
 * Verifica canchasPorDia de getEstadoEnVivo jornada por jornada. `esperado` es { diaKey: canchas } o
 * { diaKey: { canchas, activoDesde } }; sin activoDesde, una jornada con todas las canchas del club
 * tiene que estar sin lluvia.
 */
function assertCanchasPorDia(estadoEnVivo, esperado, canchasClub, mensaje) {
  for (const [diaKey, valor] of Object.entries(esperado)) {
    const { canchas, activoDesde } = typeof valor === 'number' ? { canchas: valor } : valor;
    const real = estadoEnVivo.canchasPorDia?.[diaKey];
    assert.strictEqual(real?.canchas, canchas, `${mensaje}: canchasPorDia[${diaKey}].canchas esperado ${canchas}, recibido ${real?.canchas}`);
    if (canchas === canchasClub) {
      assert.strictEqual(real.isLluvia, false, `${mensaje}: canchasPorDia[${diaKey}] tiene todas las canchas pero figura con lluvia`);
    } else {
      assert.ok(canchas < canchasClub && real.isLluvia === true, `${mensaje}: canchasPorDia[${diaKey}] tiene menos canchas que el club y no figura con lluvia`);
    }
    if (activoDesde) {
      assert.strictEqual(new Date(real.activoDesde).getTime(), activoDesde.getTime(), `${mensaje}: canchasPorDia[${diaKey}].activoDesde esperado ${activoDesde.toISOString()}, recibido ${real.activoDesde}`);
    }
  }
}

// Casos del cronómetro real, dentro de la suite registrada en npm test y sobre test.db.
async function testEnJuegoDesde(organizadorId, torneoId) {
  const categoria = await prisma.categoria.create({
    data: { torneoId, nombre: 'Prueba enJuegoDesde', estado: 'EN_CURSO', parejas: { create: [
      { jugador1: 'Inicio A1', jugador2: 'Inicio A2', orden: 1 },
      { jugador1: 'Inicio B1', jugador2: 'Inicio B2', orden: 2 },
    ] } },
    include: { parejas: { orderBy: { orden: 'asc' } } },
  });
  try {
    const fechaHora = new Date('2026-11-06T16:45:00.000Z');
    const partido = await prisma.partido.create({ data: {
      categoriaId: categoria.id, pareja1Id: categoria.parejas[0].id, pareja2Id: categoria.parejas[1].id,
      fechaHora, canchaNumero: 1,
    } });
    const leer = () => prisma.partido.findUnique({ where: { id: partido.id } });
    const parcial = { sets: [{ gamesPareja1: 6, gamesPareja2: 4 }] };
    const completo = { sets: [...parcial.sets, { gamesPareja1: 6, gamesPareja2: 3 }] };
    const inicioActual = async (accion) => {
      const antes = Date.now();
      await accion();
      const despues = Date.now();
      const actual = await leer();
      assert.strictEqual(actual.estado, 'EN_CURSO');
      assert.ok(actual.enJuegoDesde instanceof Date, 'La entrada a En juego tiene inicio real');
      assert.ok(actual.enJuegoDesde.getTime() >= antes && actual.enJuegoDesde.getTime() <= despues,
        'El inicio real corresponde a esta acción, no al horario programado');
      assert.strictEqual(actual.fechaHora.toISOString(), fechaHora.toISOString(), 'No cambia el horario programado');
      return actual.enJuegoDesde.toISOString();
    };
    assert.strictEqual((await leer()).enJuegoDesde, null, 'Un pendiente nuevo no tiene inicio');
    const marcado = await inicioActual(() => partidoService.updateEstado(organizadorId, partido.id, 'EN_CURSO'));
    let vivo = await organizadorService.getEstadoEnVivo(organizadorId, torneoId);
    let enJuego = vivo.partidosEnCurso.find((p) => p.id === partido.id);
    assert.strictEqual(enJuego.enJuegoDesde.toISOString(), marcado, 'En-vivo expone el inicio real');
    assert.strictEqual(enJuego.horaInicio.toISOString(), fechaHora.toISOString(), 'horaInicio mantiene su contrato');
    await assert.rejects(() => partidoService.updateEstado(organizadorId, partido.id, 'EN_CURSO'), { statusCode: 400 });
    assert.strictEqual((await leer()).enJuegoDesde.toISOString(), marcado, 'Un intento inválido no reinicia el reloj');
    await partidoService.cargarResultado(organizadorId, partido.id, parcial);
    assert.strictEqual((await leer()).enJuegoDesde.toISOString(), marcado, 'Un parcial en juego conserva el inicio');

    await partidoService.updateEstado(organizadorId, partido.id, 'PENDIENTE');
    assert.strictEqual((await leer()).enJuegoDesde, null, 'Quitar de En juego limpia el inicio');
    assert.strictEqual(await prisma.setPartido.count({ where: { partidoId: partido.id } }), 0);
    vivo = await organizadorService.getEstadoEnVivo(organizadorId, torneoId);
    assert.strictEqual(vivo.proximosPartidos.find((p) => p.id === partido.id).enJuegoDesde, null);
    await inicioActual(() => partidoService.cargarResultado(organizadorId, partido.id, parcial));

    await partidoService.updateEstado(organizadorId, partido.id, 'PENDIENTE');
    const previo = new Date('2026-11-05T15:02:00.000Z');
    await prisma.partido.update({ where: { id: partido.id }, data: { enJuegoDesde: previo } });
    await partidoService.cargarResultado(organizadorId, partido.id, parcial);
    assert.strictEqual((await leer()).enJuegoDesde.toISOString(), previo.toISOString(), 'Un parcial con inicio previo no lo pisa');
    await partidoService.cargarResultado(organizadorId, partido.id, completo);
    assert.strictEqual((await leer()).estado, 'FINALIZADO');
    assert.strictEqual((await leer()).enJuegoDesde.toISOString(), previo.toISOString(), 'Finalizar conserva el inicio');
    await partidoService.cargarResultado(organizadorId, partido.id, parcial);
    assert.strictEqual((await leer()).estado, 'EN_CURSO');
    assert.strictEqual((await leer()).enJuegoDesde.toISOString(), previo.toISOString(), 'Reabrir con parcial conserva el inicio previo');
    await partidoService.cargarResultado(organizadorId, partido.id, completo);
    await partidoService.borrarResultado(organizadorId, partido.id);
    assert.strictEqual((await leer()).estado, 'PENDIENTE');
    assert.strictEqual((await leer()).enJuegoDesde, null, 'Borrar el resultado limpia el inicio');

    await prisma.partido.update({ where: { id: partido.id }, data: { estado: 'EN_CURSO' } });
    await partidoService.cargarResultado(organizadorId, partido.id, parcial);
    assert.strictEqual((await leer()).enJuegoDesde, null, 'Un parcial no inventa el inicio de un partido antiguo ya en juego');
    vivo = await organizadorService.getEstadoEnVivo(organizadorId, torneoId);
    enJuego = vivo.partidosEnCurso.find((p) => p.id === partido.id);
    assert.strictEqual(enJuego.enJuegoDesde, null, 'En-vivo permite distinguir los partidos antiguos');
    await partidoService.updateEstado(organizadorId, partido.id, 'PENDIENTE');
    await partidoService.cargarResultado(organizadorId, partido.id, completo);
    assert.strictEqual((await leer()).enJuegoDesde, null, 'Cargar un resultado completo no inventa un inicio');
    await inicioActual(() => partidoService.cargarResultado(organizadorId, partido.id, parcial));
    console.log('✓ enJuegoDesde: marcar/quitar, parciales con/sin inicio, finalizar/reabrir, borrar y compatibilidad en-vivo');
  } finally {
    await prisma.categoria.delete({ where: { id: categoria.id } });
  }
}

async function testParejasEnJuego(organizadorId, torneoId) {
  const categoria = await prisma.categoria.create({
    data: { torneoId, nombre: '7ma Damas', estado: 'EN_CURSO', parejas: { create: [
      { jugador1: 'Dávila', jugador2: 'Arrieta', orden: 1 },
      { jugador1: 'Tapia', jugador2: 'Nieva', orden: 2 },
      ...[3, 4, 5, 6].map((orden) => ({ jugador1: `Libre ${orden} A`, jugador2: `Libre ${orden} B`, orden })),
    ] } },
    include: { parejas: { orderBy: { orden: 'asc' } } },
  });
  try {
    const [a, b, c, d, e, f] = categoria.parejas;
    const zona = await prisma.zona.create({ data: { categoriaId: categoria.id, nombre: 'Zona C', formato: 'ROUND_ROBIN', clasifican: 2 } });
    const crear = (p1, p2, extra = {}) => prisma.partido.create({ data: {
      categoriaId: categoria.id, pareja1Id: p1.id, pareja2Id: p2.id, fechaHora: new Date('2026-11-08T15:00:00.000Z'),
      canchaNumero: 1, ...extra,
    } });
    const bloqueante = await crear(a, b, { zonaId: zona.id, fechaHora: new Date('2026-11-06T15:00:00.000Z') });
    await partidoService.updateEstado(organizadorId, bloqueante.id, 'EN_CURSO');
    const candidatos = [];
    for (const [p1, p2] of [[a, c], [c, a], [b, c], [c, b]]) candidatos.push(await crear(p1, p2));
    // Un rechazo tampoco puede borrar sets que ya estuvieran guardados.
    await prisma.setPartido.create({ data: { partidoId: candidatos[0].id, numero: 1, gamesPareja1: 6, gamesPareja2: 4 } });
    const parcial = { sets: [{ gamesPareja1: 6, gamesPareja2: 4 }] };
    const completo = { sets: [...parcial.sets, { gamesPareja1: 6, gamesPareja2: 3 }] };
    const leer = (id) => prisma.partido.findUnique({ where: { id }, include: { sets: { orderBy: { numero: 'asc' } } } });
    const rechazarSinCambios = async (partido, accion, nombre, contexto = 'Zona C') => {
      const antes = await leer(partido.id);
      await assert.rejects(accion, {
        statusCode: 400,
        message: `${nombre} ya está jugando otro partido (7ma Damas · ${contexto}). Cargá ese resultado o quitalo de en juego primero.`,
      });
      assert.deepStrictEqual(await leer(partido.id), antes, 'El rechazo conserva estado, inicio real, ganador, horario y sets');
    };
    for (let i = 0; i < candidatos.length; i++) {
      const partido = candidatos[i];
      const nombre = i < 2 ? 'Dávila / Arrieta' : 'Tapia / Nieva';
      await rechazarSinCambios(partido, () => partidoService.updateEstado(organizadorId, partido.id, 'EN_CURSO'), nombre);
      await rechazarSinCambios(partido, () => partidoService.cargarResultado(organizadorId, partido.id, parcial), nombre);
    }
    const libre = await crear(d, e);
    await partidoService.updateEstado(organizadorId, libre.id, 'EN_CURSO');
    assert.strictEqual((await leer(libre.id)).estado, 'EN_CURSO', 'Las otras parejas pueden jugar');
    const inicio = (await leer(bloqueante.id)).enJuegoDesde;
    await partidoService.cargarResultado(organizadorId, bloqueante.id, parcial);
    assert.strictEqual((await leer(bloqueante.id)).enJuegoDesde.toISOString(), inicio.toISOString(), 'El mismo partido ya en juego acepta parciales');
    await partidoService.cargarResultado(organizadorId, libre.id, parcial);
    await partidoService.cargarResultado(organizadorId, candidatos[0].id, completo);
    assert.strictEqual((await leer(candidatos[0].id)).estado, 'FINALIZADO', 'Un resultado completo no se bloquea');
    await rechazarSinCambios(candidatos[0], () => partidoService.cargarResultado(organizadorId, candidatos[0].id, parcial), 'Dávila / Arrieta');

    await partidoService.updateEstado(organizadorId, bloqueante.id, 'PENDIENTE');
    await partidoService.cargarResultado(organizadorId, candidatos[1].id, parcial);
    assert.strictEqual((await leer(candidatos[1].id)).estado, 'EN_CURSO', 'La pareja liberada puede iniciar con un parcial');
    await partidoService.updateEstado(organizadorId, candidatos[1].id, 'PENDIENTE');
    const fase = await prisma.faseEliminatoria.create({ data: { categoriaId: categoria.id, nombre: 'Semifinales', ronda: 4 } });
    const cruce = await crear(b, f, { faseEliminatoriaId: fase.id });
    await partidoService.updateEstado(organizadorId, cruce.id, 'EN_CURSO');
    await rechazarSinCambios(candidatos[2], () => partidoService.updateEstado(organizadorId, candidatos[2].id, 'EN_CURSO'), 'Tapia / Nieva', 'Semifinales');
    await rechazarSinCambios(candidatos[3], () => partidoService.cargarResultado(organizadorId, candidatos[3].id, parcial), 'Tapia / Nieva', 'Semifinales');
    console.log('✓ Parejas en juego: ambos lados, cualquier jornada, zona/fase, rechazo sin escrituras y casos permitidos');
  } finally {
    await prisma.categoria.delete({ where: { id: categoria.id } });
  }
}

async function testLimpiarReiniciarCategoria(organizadorId) {
  const torneo = await prisma.torneo.create({ data: {
    organizadorId, nombre: 'Limpieza de categoría', slug: crypto.randomUUID(),
    estado: 'EN_CURSO', fecha: new Date('2026-11-06T15:00:00.000Z'),
  } });
  try {
    const crearCategoria = (nombre, estado = 'EN_CURSO') => prisma.categoria.create({ data: {
      torneoId: torneo.id, nombre, estado, parejas: { create: [
        { jugador1: 'Pareja A', jugador2: nombre, orden: 1, resolucionManual: true,
          slotsSeleccionados: { create: { slotId: 'Viernes-18:00' } } },
        { jugador1: 'Pareja B', jugador2: nombre, orden: 2 },
      ] },
    }, include: { parejas: { orderBy: { orden: 'asc' }, include: { slotsSeleccionados: true } } } });
    const categoria = await crearCategoria('Limpiar y reiniciar');
    const testigo = await crearCategoria('Testigo');
    const borrador = await crearCategoria('Borrador con restos', 'BORRADOR');
    const terminada = await crearCategoria('Terminada', 'FINALIZADO');
    const zona = await prisma.zona.create({ data: { categoriaId: categoria.id, nombre: 'Zona A' } });
    const fechaHora = new Date('2026-11-06T21:00:00.000Z');
    const inicio = new Date('2026-11-06T21:05:00.000Z');
    const partido = await prisma.partido.create({ data: {
      categoriaId: categoria.id, zonaId: zona.id, pareja1Id: categoria.parejas[0].id,
      pareja2Id: categoria.parejas[1].id, estado: 'EN_CURSO', enJuegoDesde: inicio,
      fechaHora, canchaNumero: 2, horarioManual: true,
      sets: { create: { numero: 1, gamesPareja1: 6, gamesPareja2: 4 } },
    } });
    await zonaService.limpiarResultadosZonas(organizadorId, categoria.id);
    const limpio = await prisma.partido.findUnique({ where: { id: partido.id }, include: { sets: true } });
    assert.strictEqual(limpio.estado, 'PENDIENTE');
    assert.strictEqual(limpio.enJuegoDesde, null, 'Limpiar borra el inicio real');
    assert.deepStrictEqual(limpio.sets, []);
    assert.strictEqual(limpio.fechaHora.toISOString(), fechaHora.toISOString());
    assert.strictEqual(limpio.canchaNumero, 2);
    assert.strictEqual(limpio.horarioManual, true);
    const antesDelParcial = Date.now();
    await partidoService.cargarResultado(organizadorId, partido.id, { sets: [{ gamesPareja1: 6, gamesPareja2: 4 }] });
    const parcial = await prisma.partido.findUnique({ where: { id: partido.id } });
    assert.ok(parcial.enJuegoDesde.getTime() >= antesDelParcial, 'Un parcial después de limpiar inicia un cronómetro nuevo');

    // Un borrador con datos residuales tampoco debe ofrecer Generar cuadro ni asignar clasificados.
    let partidoTestigo;
    for (const cat of [testigo, borrador]) {
      const z = await prisma.zona.create({ data: { categoriaId: cat.id, nombre: 'Zona lista' } });
      const p = await prisma.partido.create({ data: { categoriaId: cat.id, zonaId: z.id, estado: 'FINALIZADO' } });
      if (cat.id === testigo.id) partidoTestigo = p;
      await prisma.faseEliminatoria.create({ data: {
        categoriaId: cat.id, nombre: 'Final', ronda: 2,
        partidos: { create: { categoriaId: cat.id, posicionEnRonda: 1 } },
      } });
    }
    const fase = await prisma.faseEliminatoria.create({ data: { categoriaId: categoria.id, nombre: 'Final', ronda: 2 } });
    const cruce = await prisma.partido.create({ data: { categoriaId: categoria.id, faseEliminatoriaId: fase.id } });
    const registro = { fechaHora: fechaHora.toISOString(), canchaNumero: 2, sinHorarioAsignado: false };
    const mapa = { [partido.id]: registro, [cruce.id]: registro, [partidoTestigo.id]: registro };
    const motivos = { [partido.id]: 'SIN_CANCHA', [cruce.id]: 'SIN_TURNO', [partidoTestigo.id]: 'CONSERVAR' };
    const fechaRegistro = new Date('2026-11-05T10:00:00.000Z');
    const crearOverride = (diaKey, horariosAntesLluvia, partidosSinSlot) => prisma.overrideCanchasDia.create({ data: {
      torneoId: torneo.id, diaKey, canchas: 3, isLluvia: true, activoDesde: fechaRegistro,
      createdAt: fechaRegistro, updatedAt: fechaRegistro, horariosAntesLluvia, partidosSinSlot,
    } });
    await crearOverride('2026-11-06', mapa, motivos);
    await crearOverride('2026-11-07', JSON.stringify({ [cruce.id]: registro }), JSON.stringify(motivos));
    await crearOverride('2026-11-08', undefined, { [partido.id]: 'SIN_CANCHA' });
    await canchasOverridesService.loadFromDb();
    const leerOverrides = () => prisma.overrideCanchasDia.findMany({ where: { torneoId: torneo.id }, orderBy: { diaKey: 'asc' } });
    const originales = await leerOverrides();
    const cacheOriginal = structuredClone(canchasOverridesService.getOverridesTorneo(torneo.id));

    // Provocar un fallo antes del commit: ni la base ni la caché deben quedar a medio reiniciar.
    const servicioPrisma = require('../src/lib/prisma');
    const transaccion = servicioPrisma.$transaction;
    servicioPrisma.$transaction = (fn, ...args) => transaccion.call(servicioPrisma, async (tx) => {
      await fn(tx);
      throw new Error('Fallo simulado antes del commit');
    }, ...args);
    try {
      await assert.rejects(() => categoriaService.reiniciarCategoria(organizadorId, categoria.id), /Fallo simulado/);
    } finally {
      servicioPrisma.$transaction = transaccion;
    }
    assert.deepStrictEqual(await leerOverrides(), originales, 'El fallo revierte los registros de lluvia');
    assert.deepStrictEqual(canchasOverridesService.getOverridesTorneo(torneo.id), cacheOriginal, 'No se toca la caché antes del commit');
    assert.ok(await prisma.partido.findUnique({ where: { id: partido.id } }), 'El fallo revierte la eliminación');

    await categoriaService.reiniciarCategoria(organizadorId, categoria.id);
    const actualizados = await leerOverrides();
    const parsear = (valor) => typeof valor === 'string' ? JSON.parse(valor) : valor;
    for (let i = 0; i < originales.length; i++) {
      const original = originales[i], actual = actualizados[i];
      const quitar = (valor) => valor == null ? valor : Object.fromEntries(Object.entries(parsear(valor))
        .filter(([id]) => ![partido.id, cruce.id].includes(id)));
      const esperado = { ...original };
      for (const campo of ['horariosAntesLluvia', 'partidosSinSlot']) {
        const valor = quitar(original[campo]);
        esperado[campo] = typeof original[campo] === 'string' ? JSON.stringify(valor) : valor;
      }
      assert.deepStrictEqual(actual, esperado, 'Solo se quitan los IDs de la categoría, sin cambiar metadatos ni otros valores');
      const cache = canchasOverridesService.getOverridesTorneo(torneo.id)[actual.diaKey];
      assert.deepStrictEqual(cache, { ...cacheOriginal[actual.diaKey], partidosSinSlot: parsear(actual.partidosSinSlot) });
    }
    assert.deepStrictEqual(await prisma.partido.findUnique({ where: { id: partidoTestigo.id } }), partidoTestigo);
    const reiniciada = await prisma.categoria.findUnique({ where: { id: categoria.id }, include: {
      parejas: { orderBy: { orden: 'asc' }, include: { slotsSeleccionados: true } }, zonas: true, partidos: true, fasesEliminatorias: true,
    } });
    assert.strictEqual(reiniciada.estado, 'BORRADOR');
    assert.deepStrictEqual(reiniciada.parejas, categoria.parejas.map((p) => ({ ...p, resolucionManual: false })));
    for (const campo of ['zonas', 'partidos', 'fasesEliminatorias']) assert.deepStrictEqual(reiniciada[campo], []);
    const vivo = await organizadorService.getEstadoEnVivo(organizadorId, torneo.id);
    for (const lista of [vivo.categorias, vivo.categoriasListasParaEliminatoria]) {
      assert.ok(!lista.some((c) => [categoria.id, borrador.id].includes(c.id)), 'Los borradores quedan fuera del bloque eliminatorio');
      assert.ok(lista.some((c) => c.id === testigo.id), 'Se conservan las categorías en curso');
    }
    assert.ok(vivo.categorias.some((c) => c.id === terminada.id), 'Se conservan las categorías finalizadas');
    console.log('✅ Limpiar y reiniciar: cronómetro nuevo, lluvia y caché depuradas tras commit, rollback íntegro y borradores fuera de eliminatoria.');
  } finally {
    await prisma.torneo.delete({ where: { id: torneo.id } });
    await canchasOverridesService.loadFromDb();
  }
}

async function testModoDiaTorneo() {
  await ensureTestDb();
  console.log('🧪 Iniciando test automatizado de Modo Día de Torneo...');
  await canchasOverridesService.loadFromDb();

  async function limpiarPiloto() {
    const existingPiloto = await prisma.organizador.findUnique({ where: { email: 'piloto@padel.com' } });
    if (existingPiloto) {
      const torneos = await prisma.torneo.findMany({ where: { organizadorId: existingPiloto.id } });
      const torneoIds = torneos.map((t) => t.id);
      const categorias = await prisma.categoria.findMany({ where: { torneoId: { in: torneoIds } } });
      const categoriaIds = categorias.map((c) => c.id);
      
      await prisma.setPartido.deleteMany({ where: { partido: { categoriaId: { in: categoriaIds } } } });
      await prisma.partido.deleteMany({ where: { categoriaId: { in: categoriaIds } } });
      await prisma.faseEliminatoria.deleteMany({ where: { categoriaId: { in: categoriaIds } } });
      await prisma.zonaPareja.deleteMany({ where: { zona: { categoriaId: { in: categoriaIds } } } });
      await prisma.zona.deleteMany({ where: { categoriaId: { in: categoriaIds } } });
      await prisma.slotPareja.deleteMany({ where: { pareja: { categoriaId: { in: categoriaIds } } } });
      await prisma.pareja.deleteMany({ where: { categoriaId: { in: categoriaIds } } });
      await prisma.categoria.deleteMany({ where: { id: { in: categoriaIds } } });
      await prisma.overrideCanchasDia.deleteMany({ where: { torneoId: { in: torneoIds } } });
      await prisma.torneo.deleteMany({ where: { id: { in: torneoIds } } });
      await prisma.organizador.delete({ where: { id: existingPiloto.id } });
    }
  }

  // 1. Limpiar datos previos del test piloto si existieran
  await limpiarPiloto();

  try {
  // 2. Crear Organizador con 6 canchas (4 techadas, 2 aire libre)
  const passwordHash = await bcrypt.hash('123456', 10);
  const organizador = await prisma.organizador.create({
    data: {
      nombre: 'Club Piloto 6 Canchas',
      email: 'piloto@padel.com',
      passwordHash,
      cantidadCanchas: 6,
      viernesInicio: '18:00',
      viernesFin: '02:00',
      sabadoInicio: '09:00',
      sabadoFin: '22:00',
    },
  });
  console.log('✅ Organizador creado con 6 canchas');

  // 3. Crear Torneo (Próximo viernes desde hoy)
  const now = new Date();
  let offsetToFriday = 5 - now.getDay();
  if (offsetToFriday < 0) offsetToFriday += 7;
  
  const fechaTorneo = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetToFriday, 12, 0, 0);
  const torneo = await torneoService.createTorneo(organizador.id, {
    nombre: 'Torneo Piloto Lluvia',
    fecha: fechaTorneo.toISOString(),
  });
  console.log(`✅ Torneo creado: ${torneo.nombre} (ID: ${torneo.id})`);

  // 4. Crear 2 Categorías (4ta y 6ta) con 6 parejas cada una (total 12 parejas, 6 partidos de zona)
  const cat4ta = await prisma.categoria.create({
    data: { torneoId: torneo.id, nombre: '4ta Libres', estado: 'BORRADOR' },
  });
  const cat6ta = await prisma.categoria.create({
    data: { torneoId: torneo.id, nombre: '6ta Libres', estado: 'BORRADOR' },
  });

  const nombres = [
    ['P1 A', 'P1 B'], ['P2 A', 'P2 B'], ['P3 A', 'P3 B'],
    ['P4 A', 'P4 B'], ['P5 A', 'P5 B'], ['P6 A', 'P6 B'],
  ];

  for (let i = 0; i < nombres.length; i++) {
    await prisma.pareja.create({
      data: { categoriaId: cat4ta.id, jugador1: nombres[i][0], jugador2: nombres[i][1], orden: i + 1 },
    });
    await prisma.pareja.create({
      data: { categoriaId: cat6ta.id, jugador1: `6ta ${nombres[i][0]}`, jugador2: `6ta ${nombres[i][1]}`, orden: i + 1 },
    });
  }
  console.log('✅ 12 parejas creadas en 4ta y 6ta');

  // 5. Iniciar categorías y asignar horarios sobre las 6 canchas
  await zonaService.iniciarCategoria(organizador.id, cat4ta.id);
  await zonaService.iniciarCategoria(organizador.id, cat6ta.id);
  await zonaService.asignarHorariosAutomatico(organizador.id, [cat4ta.id, cat6ta.id]);

  await prisma.torneo.update({
    where: { id: torneo.id },
    data: { estado: 'EN_CURSO' },
  });
  console.log('✅ Torneo y categorías iniciados con asignación de horarios en 6 canchas');

  await testEnJuegoDesde(organizador.id, torneo.id);
  await testParejasEnJuego(organizador.id, torneo.id);
  await testLimpiarReiniciarCategoria(organizador.id);

  // 6. Test GET /en-vivo inicial
  let estadoEnVivo = await organizadorService.getEstadoEnVivo(organizador.id, torneo.id);
  // Jornadas del torneo: viernes, sábado y domingo
  const [kVie, kSab, kDom] = clavesJornadasTorneo(parseFechaLocal(fechaTorneo));
  assert.strictEqual(estadoEnVivo.canchasClub, 6, `Error: se esperaban 6 canchas del club, se obtuvieron ${estadoEnVivo.canchasClub}`);
  assertCanchasPorDia(estadoEnVivo, { [kVie]: 6, [kSab]: 6, [kDom]: 6 }, 6, 'Estado inicial en vivo');
  console.log(`✅ Estado inicial en vivo: 6 canchas en viernes, sábado y domingo (${estadoEnVivo.canchasClub} del club)`);

  // 7. Simular que un partido en Cancha 1 está EN_CURSO y otro en Cancha 2 está FINALIZADO
  const partidosCat4ta = await prisma.partido.findMany({
    where: { categoriaId: cat4ta.id },
    orderBy: { fechaHora: 'asc' },
  });

  const pEnCurso = partidosCat4ta[0];
  const pFinalizado = partidosCat4ta[1];

  await prisma.partido.update({
    where: { id: pEnCurso.id },
    data: { canchaNumero: 1 },
  });
  // Usar el nuevo servicio updateEstado para marcar EN_CURSO
  await partidoService.updateEstado(organizador.id, pEnCurso.id, 'EN_CURSO');

  await prisma.partido.update({
    where: { id: pFinalizado.id },
    data: { estado: 'FINALIZADO', canchaNumero: 2 },
  });
  console.log('✅ Partidos configurados: 1 EN_CURSO (vía updateEstado) en Cancha 1, 1 FINALIZADO en Cancha 2');

  // 8. Test Reducción a 4 canchas (MODO LLUVIA)
  console.log('🌧️ Ejecutando reducción de canchas a 4 (Modo Lluvia)...');
  
  const resReduccion = await organizadorService.reprogramarPorReduccionCanchas(organizador.id, torneo.id, 4, pEnCurso.fechaHora);
  console.log(`✅ Resultado reprogramación: ${resReduccion.message}`);
  console.log(`   - Partidos reprogramados: ${resReduccion.reprogramacion.partidosReprogramados}`);
  console.log(`   - Partidos sin cambio: ${resReduccion.reprogramacion.partidosSinCambio}`);
  console.log(`   - Partidos sin horario nuevo: ${resReduccion.reprogramacion.partidosSinHorarioNuevo}`);

  // Verificar estado post-reducción
  estadoEnVivo = await organizadorService.getEstadoEnVivo(organizador.id, torneo.id);
  // La reducción afecta solo la jornada del partido en juego; las otras dos siguen con 6
  const diaReduccion = getDiaCalendarioConTrasnoche(pEnCurso.fechaHora, organizador).key;
  const esperadoReduccion = { [kVie]: 6, [kSab]: 6, [kDom]: 6, [diaReduccion]: { canchas: 4, activoDesde: new Date(pEnCurso.fechaHora) } };
  assertCanchasPorDia(estadoEnVivo, esperadoReduccion, 6, 'Post-reducción a 4');

  // Verificar que ninguna cancha activa > 4 tiene partidos pendientes
  const partidosPendientesPost = await prisma.partido.findMany({
    where: {
      categoria: { torneoId: torneo.id },
      estado: 'PENDIENTE',
    },
  });

  for (const p of partidosPendientesPost) {
    if (p.canchaNumero && p.canchaNumero > 4) {
      throw new Error(`Error: Partido pendiente ${p.id} quedó asignado a cancha inhabilitada ${p.canchaNumero}`);
    }
  }
  console.log('✅ Verificado: Ningún partido pendiente quedó en canchas 5 o 6');

  // Verificar que el partido EN_CURSO y el FINALIZADO no cambiaron
  const pEnCursoPost = await prisma.partido.findUnique({ where: { id: pEnCurso.id } });
  const pFinalizadoPost = await prisma.partido.findUnique({ where: { id: pFinalizado.id } });
  if (pEnCursoPost.estado !== 'EN_CURSO' || pEnCursoPost.canchaNumero !== 1) {
    throw new Error('Error: Partido EN_CURSO fue modificado');
  }
  if (pFinalizadoPost.estado !== 'FINALIZADO' || pFinalizadoPost.canchaNumero !== 2) {
    throw new Error('Error: Partido FINALIZADO fue modificado');
  }
  console.log('✅ Verificado: Partidos EN_CURSO y FINALIZADO se mantuvieron intactos');

  // 9. Test de Bloqueo: Si ponemos un partido EN_CURSO en Cancha 4 (vía updateEstado) e intentamos reducir a 3
  // Otra categoría garantiza que no repita una pareja del partido que ya está en juego.
  const pBloqueoCancha = await prisma.partido.findFirst({
    where: { categoriaId: cat6ta.id, estado: 'PENDIENTE' },
    orderBy: { fechaHora: 'asc' },
  });
  assert.ok(pBloqueoCancha);
  await prisma.partido.update({
    where: { id: pBloqueoCancha.id },
    data: { canchaNumero: 4, fechaHora: pEnCurso.fechaHora },
  });
  await partidoService.updateEstado(organizador.id, pBloqueoCancha.id, 'EN_CURSO');

  console.log('🔒 Probando bloqueo al reducir cuando hay partido EN_CURSO en cancha afectada...');
  try {
    await organizadorService.reprogramarPorReduccionCanchas(organizador.id, torneo.id, 3, pEnCurso.fechaHora);
    throw new Error('FALLÓ EL TEST: Debería haber bloqueado la reducción a 3');
  } catch (err) {
    if (err.statusCode === 400 && err.message.includes('partido en curso en la Cancha 4')) {
      console.log(`✅ Bloqueo correcto verificado: "${err.message}"`);
    } else {
      throw err;
    }
  }

  // 9b. Test de Revertir a PENDIENTE (vía updateEstado)
  console.log('🔄 Probando reversión de estado EN_CURSO a PENDIENTE...');
  const resRevertir = await partidoService.updateEstado(organizador.id, pBloqueoCancha.id, 'PENDIENTE');
  if (resRevertir.partido.estado !== 'PENDIENTE') {
    throw new Error('FALLÓ EL TEST: No se pudo revertir el partido a PENDIENTE');
  }
  console.log(`✅ Reversión exitosa: ${resRevertir.message}`);

  // 9c. Test Validación: No permitir updateEstado en partido FINALIZADO
  try {
    await partidoService.updateEstado(organizador.id, pFinalizado.id, 'EN_CURSO');
    throw new Error('FALLÓ EL TEST: Debería haber bloqueado modificar un partido FINALIZADO');
  } catch (err) {
    if (err.statusCode === 400 && err.message.includes('No se puede modificar el estado de un partido finalizado')) {
      console.log(`✅ Validación partido FINALIZADO verificada: "${err.message}"`);
    } else {
      throw err;
    }
  }

  // 10. Test Validaciones: Override 0 y Override > 6
  // El error esperado se captura en una variable y se verifica afuera del try: antes el throw de
  // "FALLÓ EL TEST" quedaba atrapado por el propio catch y la suite pasaba aunque no hubiera validación.
  let errorCero = null;
  try {
    await organizadorService.reprogramarPorReduccionCanchas(organizador.id, torneo.id, 0);
  } catch (err) {
    errorCero = err;
  }
  if (!errorCero || errorCero.statusCode !== 400 || !errorCero.message.includes('mayor o igual a 1')) {
    throw new Error(`FALLÓ EL TEST: con 0 canchas se esperaba 400 "mayor o igual a 1", se obtuvo: ${errorCero ? `${errorCero.statusCode} "${errorCero.message}"` : 'sin error'}`);
  }
  console.log(`✅ Validación 0 canchas verificada: "${errorCero.message}"`);

  let errorExceso = null;
  try {
    await organizadorService.reprogramarPorReduccionCanchas(organizador.id, torneo.id, 8);
  } catch (err) {
    errorExceso = err;
  }
  if (!errorExceso || errorExceso.statusCode !== 400 || !errorExceso.message.includes('no puede superar el total del club')) {
    throw new Error(`FALLÓ EL TEST: con 8 canchas se esperaba 400 "no puede superar el total del club", se obtuvo: ${errorExceso ? `${errorExceso.statusCode} "${errorExceso.message}"` : 'sin error'}`);
  }
  console.log(`✅ Validación superación de canchas del club verificada: "${errorExceso.message}"`);

  // 11. Test Restaurar canchas (null)
  console.log('☀️ Probando restauración de todas las canchas...');
  const resRestaurar = await organizadorService.reprogramarPorReduccionCanchas(organizador.id, torneo.id, null);
  if (resRestaurar.canchasActivas !== 6 || resRestaurar.reprogramacion.ejecutada !== true) {
    throw new Error('Error al restaurar canchas: se esperaba reprogramación ejecutada');
  }
  console.log(`✅ Restauración exitosa: ${resRestaurar.message}`);

  // Verificar que al restaurar, se ejecutó la reprogramación
  const partidosPendientesRestaurados = await prisma.partido.findMany({
    where: {
      categoria: { torneoId: torneo.id },
      estado: 'PENDIENTE',
    },
  });
  const canchasUsadas = new Set(partidosPendientesRestaurados.map((p) => p.canchaNumero).filter(Boolean));
  console.log('🏟️ Canchas utilizadas por partidos pendientes tras restaurar:', Array.from(canchasUsadas));
  console.log('✅ Verificado: Al restaurar canchas, la reprogramación se ejecutó exitosamente.');

  // =======================================================================
  // 12. Test Límite Real: Activar Modo Lluvia en ventana de trasnoche
  // =======================================================================
  console.log('\n🌙 Probando Modo Lluvia en horario de trasnoche...');
  // Tomamos un partido pendiente cualquiera y lo forzamos a estar en horario de trasnoche (ej. Sábado 01:00 AM, lógicamente Viernes)
  const pTrasnoche = partidosCat4ta[3]; 
  const dTrasnoche = new Date(fechaTorneo);
  dTrasnoche.setDate(dTrasnoche.getDate() + 1); // Sábado
  dTrasnoche.setHours(1, 0, 0, 0); // 01:00 AM del Sábado

  await prisma.partido.update({
    where: { id: pTrasnoche.id },
    data: { 
      estado: 'PENDIENTE', 
      canchaNumero: 5, 
      fechaHora: dTrasnoche,
      sinHorarioAsignado: false
    },
  });

  // Simulamos activar lluvia a las 23:30 del Viernes
  const dLluviaTrasnoche = new Date(fechaTorneo);
  dLluviaTrasnoche.setHours(23, 30, 0, 0);

  console.log('🌧️ Ejecutando reducción de canchas a 4 (Modo Lluvia en Trasnoche)...');
  const resTrasnoche = await organizadorService.reprogramarPorReduccionCanchas(organizador.id, torneo.id, 4, dLluviaTrasnoche);
  console.log(`✅ Resultado reprogramación trasnoche: ${resTrasnoche.message}`);
  
  if (resTrasnoche.reprogramacion.partidosReprogramados === 0) {
    throw new Error('FALLÓ EL TEST: El partido de trasnoche (Sábado 01:00 AM) no fue reprogramado a pesar de pertenecer lógicamente al Viernes.');
  }

  const pTrasnochePost = await prisma.partido.findUnique({ where: { id: pTrasnoche.id } });
  if (pTrasnochePost.canchaNumero > 4) {
    throw new Error(`FALLÓ EL TEST: El partido de trasnoche quedó en cancha inhabilitada: ${pTrasnochePost.canchaNumero}`);
  }
  console.log('✅ Partido de trasnoche (Sábado 01:00) fue correctamente reprogramado al reducir canchas!');

  // =======================================================================
  // 13. Test A: Aislamiento por día lógico en reducción (Opción B)
  // =======================================================================
  console.log('\n🎯 TEST A: Aislamiento por día lógico en reducción (Viernes no toca Sábado)...');
  
  // Primero restauramos a 6 canchas para tener el club completo
  await organizadorService.reprogramarPorReduccionCanchas(organizador.id, torneo.id, null);

  // Obtener partidos pendientes actuales
  const todosPartidosTorneo = await prisma.partido.findMany({
    where: { categoria: { torneoId: torneo.id } },
    orderBy: { id: 'asc' },
  });

  const horariosClubTest = {
    viernesInicio: organizador.viernesInicio,
    viernesFin: organizador.viernesFin,
    sabadoInicio: organizador.sabadoInicio,
    sabadoFin: organizador.sabadoFin,
  };

  // Asignar explícitamente 2 partidos al Sábado (uno en Cancha 5 y otro en Cancha 6)
  const dSabadoManana = new Date(fechaTorneo);
  dSabadoManana.setDate(dSabadoManana.getDate() + 1);
  dSabadoManana.setHours(10, 0, 0, 0); // Sábado 10:00 AM

  const dSabadoMediodia = new Date(fechaTorneo);
  dSabadoMediodia.setDate(dSabadoMediodia.getDate() + 1);
  dSabadoMediodia.setHours(11, 15, 0, 0); // Sábado 11:15 AM

  const pSabado1 = todosPartidosTorneo[0];
  const pSabado2 = todosPartidosTorneo[1];

  await prisma.partido.update({
    where: { id: pSabado1.id },
    data: {
      estado: 'PENDIENTE',
      fechaHora: dSabadoManana,
      canchaNumero: 5,
      sinHorarioAsignado: false,
    },
  });

  await prisma.partido.update({
    where: { id: pSabado2.id },
    data: {
      estado: 'PENDIENTE',
      fechaHora: dSabadoMediodia,
      canchaNumero: 6,
      sinHorarioAsignado: false,
    },
  });

  // Asignar el resto de los partidos al Viernes
  const dViernesTarde = new Date(fechaTorneo);
  dViernesTarde.setHours(19, 0, 0, 0);

  for (let i = 2; i < todosPartidosTorneo.length; i++) {
    const p = todosPartidosTorneo[i];
    if (p.estado === 'FINALIZADO') continue;
    const horaP = new Date(dViernesTarde.getTime() + (i - 2) * 45 * 60 * 1000);
    await prisma.partido.update({
      where: { id: p.id },
      data: {
        estado: 'PENDIENTE',
        fechaHora: horaP,
        canchaNumero: (i % 6) + 1,
        sinHorarioAsignado: false,
      },
    });
  }

  // Snapshot de los partidos del sábado antes de reducir canchas
  const snapshotSabado = [
    await prisma.partido.findUnique({ where: { id: pSabado1.id } }),
    await prisma.partido.findUnique({ where: { id: pSabado2.id } }),
  ];

  console.log(`📌 Snapshot Sábado: Partido 1 en Cancha ${snapshotSabado[0].canchaNumero} (${snapshotSabado[0].fechaHora.toISOString()})`);
  console.log(`📌 Snapshot Sábado: Partido 2 en Cancha ${snapshotSabado[1].canchaNumero} (${snapshotSabado[1].fechaHora.toISOString()})`);

  // Activar Modo Lluvia un Viernes (reducir a 4 canchas)
  const dViernesLluvia = new Date(fechaTorneo);
  dViernesLluvia.setHours(20, 0, 0, 0);

  const resReduccionViernes = await organizadorService.reprogramarPorReduccionCanchas(organizador.id, torneo.id, 4, dViernesLluvia);
  console.log(`✅ Reducción a 4 canchas ejecutada: ${resReduccionViernes.message}`);

  // Aserciones estrictas Test A:
  // 1. Partidos del sábado deben ser idénticos antes y después
  const pSabado1Post = await prisma.partido.findUnique({ where: { id: pSabado1.id } });
  const pSabado2Post = await prisma.partido.findUnique({ where: { id: pSabado2.id } });

  assert.strictEqual(
    pSabado1Post.fechaHora.getTime(),
    snapshotSabado[0].fechaHora.getTime(),
    'FALLÓ TEST A: El horario del partido de sábado fue modificado por el override del viernes'
  );
  assert.strictEqual(
    pSabado1Post.canchaNumero,
    snapshotSabado[0].canchaNumero,
    'FALLÓ TEST A: La cancha del partido de sábado fue modificada por el override del viernes'
  );
  assert.strictEqual(
    pSabado2Post.fechaHora.getTime(),
    snapshotSabado[1].fechaHora.getTime(),
    'FALLÓ TEST A: El horario del partido 2 de sábado fue modificado por el override del viernes'
  );
  assert.strictEqual(
    pSabado2Post.canchaNumero,
    snapshotSabado[1].canchaNumero,
    'FALLÓ TEST A: La cancha del partido 2 de sábado fue modificada por el override del viernes'
  );

  // 2. Partidos del sábado NO deben figurar en la lista de cambios
  const cambiosIds = (resReduccionViernes.reprogramacion.cambios || []).map((c) => c.partidoId);
  assert.ok(!cambiosIds.includes(pSabado1.id), 'FALLÓ TEST A: Partido de sábado apareció en cambios de la reducción');
  assert.ok(!cambiosIds.includes(pSabado2.id), 'FALLÓ TEST A: Partido de sábado 2 apareció en cambios de la reducción');

  // 3. Partidos pendientes del viernes deben estar en canchas <= 4
  const pendientesViernesPost = await prisma.partido.findMany({
    where: {
      categoria: { torneoId: torneo.id },
      estado: 'PENDIENTE',
      id: { notIn: [pSabado1.id, pSabado2.id] },
    },
  });
  for (const pv of pendientesViernesPost) {
    if (pv.canchaNumero) {
      assert.ok(pv.canchaNumero <= 4, `FALLÓ TEST A: Partido de viernes quedó en cancha inhabilitada: ${pv.canchaNumero}`);
    }
  }

  // 4. getEstadoEnVivo: Partidos del sábado en canchas 5/6 NO deben ser clasificados como 'partidosEnCanchaFantasma'
  const estadoEnVivoPostA = await organizadorService.getEstadoEnVivo(organizador.id, torneo.id);
  const fantasmaIds = estadoEnVivoPostA.partidosEnCanchaFantasma.map((p) => p.id);
  assert.ok(!fantasmaIds.includes(pSabado1.id), 'FALLÓ TEST A: Partido de sábado en cancha 5 marcado falsamente como cancha fantasma');
  assert.ok(!fantasmaIds.includes(pSabado2.id), 'FALLÓ TEST A: Partido de sábado en cancha 6 marcado falsamente como cancha fantasma');

  // 5. getEstadoEnVivo: la lluvia está en el viernes lógico (4 canchas, activa desde dViernesLluvia);
  // sábado y domingo siguen con las 6 y sin lluvia
  const diaViernesEsperado = getDiaCalendarioConTrasnoche(dViernesLluvia, horariosClubTest).key;
  assert.strictEqual(diaViernesEsperado, kVie, 'FALLÓ TEST A: el día lógico de la lluvia no es el viernes del torneo');
  assertCanchasPorDia(
    estadoEnVivoPostA,
    { [kVie]: { canchas: 4, activoDesde: dViernesLluvia }, [kSab]: 6, [kDom]: 6 },
    6,
    'FALLÓ TEST A'
  );
  console.log('✅ TEST A PASÓ: Partidos del Sábado 100% inalterados, canchas 5 y 6 protegidas y canchas fantasma filtradas correctamente.');

  // =======================================================================
  // 14. Test B: Restauración simétrica y atomicidad
  // =======================================================================
  console.log('\n🎯 TEST B: Restauración simétrica (Sábado sigue intacto, Viernes se redistribuye)...');

  // Verificar explícitamente que todos los partidos pendientes del viernes fueron evaluados como candidatos por el scheduler
  const pendientesViernesCount = await prisma.partido.count({
    where: {
      categoria: { torneoId: torneo.id },
      estado: 'PENDIENTE',
      id: { notIn: [pSabado1.id, pSabado2.id] },
    },
  });
  const resRestauracionSimetrica = await organizadorService.reprogramarPorReduccionCanchas(organizador.id, torneo.id, null);
  console.log(`✅ Restauración ejecutada: ${resRestauracionSimetrica.message}`);

  const totalEvaluadosViernes = resRestauracionSimetrica.reprogramacion.partidosReprogramados + resRestauracionSimetrica.reprogramacion.partidosSinCambio;
  assert.strictEqual(
    totalEvaluadosViernes,
    pendientesViernesCount,
    `FALLÓ TEST B: Se esperaban ${pendientesViernesCount} partidos del viernes evaluados en el scheduler, se evaluaron ${totalEvaluadosViernes}`
  );
  console.log(`📊 Métricas de restauración: ${totalEvaluadosViernes} partidos pendientes del viernes evaluados en scheduler (${resRestauracionSimetrica.reprogramacion.partidosSinCambio} sin cambio de hora por saturación de descanso entre las 4 zonas), 2 partidos del sábado excluidos.`);

  const pSabado1PostB = await prisma.partido.findUnique({ where: { id: pSabado1.id } });
  const pSabado2PostB = await prisma.partido.findUnique({ where: { id: pSabado2.id } });

  assert.strictEqual(
    pSabado1PostB.fechaHora.getTime(),
    snapshotSabado[0].fechaHora.getTime(),
    'FALLÓ TEST B: La restauración modificó el horario del partido de sábado'
  );
  assert.strictEqual(
    pSabado1PostB.canchaNumero,
    snapshotSabado[0].canchaNumero,
    'FALLÓ TEST B: La restauración modificó la cancha del partido de sábado'
  );
  assert.strictEqual(
    pSabado2PostB.fechaHora.getTime(),
    snapshotSabado[1].fechaHora.getTime(),
    'FALLÓ TEST B: La restauración modificó el horario del partido 2 de sábado'
  );
  assert.strictEqual(
    pSabado2PostB.canchaNumero,
    snapshotSabado[1].canchaNumero,
    'FALLÓ TEST B: La restauración modificó la cancha del partido 2 de sábado'
  );

  // Verificar que post restauración ninguna jornada quedó con lluvia: las tres con 6 canchas y sin lluvia
  const estadoEnVivoPostB = await organizadorService.getEstadoEnVivo(organizador.id, torneo.id);
  assertCanchasPorDia(estadoEnVivoPostB, { [kVie]: 6, [kSab]: 6, [kDom]: 6 }, 6, 'FALLÓ TEST B');
  console.log('✅ TEST B PASÓ: Restauración simétrica respetó el sábado, evaluó todos los partidos del viernes y dejó las tres jornadas sin lluvia.');

  // =======================================================================
  // 15. Test C: partidos sin fechaHora antes de la lluvia:
  // - Un pendiente que no está en partidosSinSlot no se toca.
  // - Restaurar devuelve el horario de antes de la lluvia: un partido que ya estaba sin horario no está en
  //   ese registro y sigue sin horario, aunque se haya cargado a mano en partidosSinSlot.
  // - Lo que vuelve a su horario no depende del reloj del sistema.
  // =======================================================================
  console.log('\n🎯 TEST C: Contrato nuevo para partidos sin horario: no tocar pendientes fuera del mapa y agendar en el día del override a los que sí están...');

  // Tomamos un partido del viernes y lo forzamos a estado sin horario (NO está en el mapa partidosSinSlot)
  const pSinHorario = pendientesViernesPost[0];
  await prisma.partido.update({
    where: { id: pSinHorario.id },
    data: {
      estado: 'PENDIENTE',
      fechaHora: null,
      canchaNumero: null,
      sinHorarioAsignado: true,
    },
  });

  // Tomamos otro partido del viernes para que SÍ esté en el mapa partidosSinSlot
  const pEnMapa = pendientesViernesPost[1];
  await prisma.partido.update({
    where: { id: pEnMapa.id },
    data: {
      estado: 'PENDIENTE',
      fechaHora: null,
      canchaNumero: null,
      sinHorarioAsignado: true,
    },
  });

  const diaOverrideViernesEsperado = getDiaCalendarioConTrasnoche(dViernesLluvia, horariosClubTest).key;

  // Activar lluvia un viernes
  await organizadorService.reprogramarPorReduccionCanchas(organizador.id, torneo.id, 4, dViernesLluvia);

  // Registrar pEnMapa en el override del día viernes
  await canchasOverridesService.setOverrideDia(
    torneo.id,
    diaOverrideViernesEsperado,
    4,
    dViernesLluvia,
    { [pEnMapa.id]: 'Sin cancha activa libre disponible en ese horario' }
  );

  // 1. Verificación en reducción: pSinHorario (fuera de mapa) NO se toca
  const pSinHorarioPostRed = await prisma.partido.findUnique({ where: { id: pSinHorario.id } });
  assert.strictEqual(
    pSinHorarioPostRed.fechaHora,
    null,
    'FALLÓ TEST C: El partido sin horario fuera de partidosSinSlot fue modificado en reducción'
  );
  assert.strictEqual(pSinHorarioPostRed.sinHorarioAsignado, true);

  // Para verificar que la asignación del partido en mapa no depende del reloj del sistema,
  // mockeamos global.Date y Date.now a un año futuro distante (2038).
  const OriginalDate = global.Date;
  const mockFutureMs = new OriginalDate('2038-03-15T12:00:00.000Z').getTime();

  class MockDate extends OriginalDate {
    constructor(...args) {
      if (args.length === 0) {
        super(mockFutureMs);
      } else {
        super(...args);
      }
    }
    static now() {
      return mockFutureMs;
    }
  }

  global.Date = MockDate;

  try {
    // Restaurar a 6 canchas para el día del override (Viernes) con reloj en 2038
    await organizadorService.reprogramarPorReduccionCanchas(organizador.id, torneo.id, null, dViernesLluvia);

    // 2. Verificación al restaurar:
    // - pSinHorario (fuera de mapa) sigue sin tocarse
    const pSinHorarioPostRest = await prisma.partido.findUnique({ where: { id: pSinHorario.id } });
    assert.strictEqual(
      pSinHorarioPostRest.fechaHora,
      null,
      'FALLÓ TEST C: El partido sin horario fuera de partidosSinSlot fue modificado en restauración'
    );
    assert.strictEqual(pSinHorarioPostRest.sinHorarioAsignado, true);

    // - pEnMapa no tenía horario antes de la lluvia: sigue sin horario
    const pEnMapaPost = await prisma.partido.findUnique({ where: { id: pEnMapa.id } });
    assert.strictEqual(pEnMapaPost.fechaHora, null, 'FALLÓ TEST C: Un partido sin horario antes de la lluvia recibió horario al restaurar');
    assert.strictEqual(pEnMapaPost.sinHorarioAsignado, true);

    // - Los pendientes del viernes quedan en el año del torneo (el reloj de 2038 no influye)
    const anioEsperado = new OriginalDate(fechaTorneo).getFullYear();
    const pendientesTrasRestaurar = await prisma.partido.findMany({
      where: { categoria: { torneoId: torneo.id }, estado: 'PENDIENTE', fechaHora: { not: null } },
    });
    for (const p of pendientesTrasRestaurar) {
      assert.strictEqual(
        new OriginalDate(p.fechaHora).getFullYear(),
        anioEsperado,
        'FALLÓ TEST C: El horario restaurado fue influenciado por el reloj del sistema mockeado (2038)'
      );
    }

    console.log(`✅ TEST C PASÓ: Los partidos sin horario antes de la lluvia no se tocaron y el resto volvió a su horario (${diaOverrideViernesEsperado}) sin depender del reloj del sistema.`);
  } finally {
    global.Date = OriginalDate;
  }

  // =======================================================================
  // 16. Test Concurrencia y Atomicidad: Operaciones concurrentes durante reducción
  // =======================================================================
  console.log('\n🎯 TEST Concurrencia: Verificando que lecturas y escrituras simultáneas no produzcan lock timeout...');
  
  // Ejecutamos simultáneamente:
  // 1. Una lectura intensiva de getEstadoEnVivo (findMany con includes de categorías, zonas, parejas, sets)
  // 2. Una escritura transaccional de reprogramarPorReduccionCanchas (prisma.$transaction con scheduler MCF y update de torneo)
  // 3. Una mutación puntual de updateEstado sobre un partido
  const enJuegoConcurrencia = await prisma.partido.findMany({
    where: { categoria: { torneoId: torneo.id }, estado: 'EN_CURSO' },
    select: { pareja1Id: true, pareja2Id: true },
  });
  const ocupadasConcurrencia = new Set(enJuegoConcurrencia.flatMap((p) => [p.pareja1Id, p.pareja2Id]));
  const pTestConc = pendientesViernesPost.find((p) => !ocupadasConcurrencia.has(p.pareja1Id) && !ocupadasConcurrencia.has(p.pareja2Id));
  assert.ok(pTestConc, 'El caso de concurrencia usa parejas libres');
  const t0 = Date.now();
  const [resRead, resReducir, resUpdateEstado] = await Promise.all([
    organizadorService.getEstadoEnVivo(organizador.id, torneo.id),
    organizadorService.reprogramarPorReduccionCanchas(organizador.id, torneo.id, 5, dViernesLluvia),
    partidoService.updateEstado(organizador.id, pTestConc.id, 'EN_CURSO'),
  ]);
  const duracionMs = Date.now() - t0;

  assert.ok(resRead.torneo !== null, 'Lectura getEstadoEnVivo falló durante concurrencia');
  assert.ok(resReducir.reprogramacion.ejecutada === true, 'Transacción de reducción falló durante concurrencia');
  assert.ok(resUpdateEstado.partido !== null, 'Escritura updateEstado falló durante concurrencia');
  console.log(`✅ TEST Concurrencia PASÓ en ${duracionMs}ms: getEstadoEnVivo (lectura), reprogramarPorReduccionCanchas (tx) y updateEstado (escritura) ejecutaron concurrentemente sin bloqueo.`);

  // =======================================================================
  // 17. Test D: Escenario Multi-Día sin restauración previa (Viernes lluvia -> Sábado lluvia)
  // =======================================================================
  console.log('\n🎯 TEST D: Escenario Multi-Día sin restauración previa (Viernes activa lluvia, no restaura, Sábado activa lluvia)...');

  // Restaurar previamente para partir de estado limpio
  await organizadorService.reprogramarPorReduccionCanchas(organizador.id, torneo.id, null);

  const partidosParaTestD = await prisma.partido.findMany({
    where: { categoria: { torneoId: torneo.id } },
    orderBy: { id: 'asc' },
  });

  const pD_Sabado1 = partidosParaTestD[0];
  const pD_Sabado2 = partidosParaTestD[1];

  const dSabadoMananaD = new Date(fechaTorneo);
  dSabadoMananaD.setDate(dSabadoMananaD.getDate() + 1);
  dSabadoMananaD.setHours(10, 0, 0, 0);

  const dSabadoMediodiaD = new Date(fechaTorneo);
  dSabadoMediodiaD.setDate(dSabadoMediodiaD.getDate() + 1);
  dSabadoMediodiaD.setHours(11, 15, 0, 0);

  // Asignar 2 partidos al sábado en Canchas 5 y 6
  await prisma.partido.update({
    where: { id: pD_Sabado1.id },
    data: {
      estado: 'PENDIENTE',
      fechaHora: dSabadoMananaD,
      canchaNumero: 5,
      sinHorarioAsignado: false,
    },
  });

  await prisma.partido.update({
    where: { id: pD_Sabado2.id },
    data: {
      estado: 'PENDIENTE',
      fechaHora: dSabadoMediodiaD,
      canchaNumero: 6,
      sinHorarioAsignado: false,
    },
  });

  // El resto de los partidos asignados al viernes en canchas 1 a 6
  const dViernesInicioD = new Date(fechaTorneo);
  dViernesInicioD.setHours(19, 0, 0, 0);
  for (let i = 2; i < partidosParaTestD.length; i++) {
    const p = partidosParaTestD[i];
    if (p.estado === 'FINALIZADO') continue;
    const horaP = new Date(dViernesInicioD.getTime() + (i - 2) * 45 * 60 * 1000);
    await prisma.partido.update({
      where: { id: p.id },
      data: {
        estado: 'PENDIENTE',
        fechaHora: horaP,
        canchaNumero: (i % 6) + 1,
        sinHorarioAsignado: false,
      },
    });
  }

  // PASO 1: Viernes 18:00 - Se activa Modo Lluvia (reducir a 4 canchas)
  const dViernesLluviaD = new Date(fechaTorneo);
  dViernesLluviaD.setHours(18, 0, 0, 0);
  const resReduccionViernesD = await organizadorService.reprogramarPorReduccionCanchas(
    organizador.id,
    torneo.id,
    4,
    dViernesLluviaD
  );
  console.log(`✅ Paso 1: Modo Lluvia Viernes activado (${resReduccionViernesD.message})`);

  // Verificar que en DB quedó persistido el timestamp del viernes
  const torneoPostViernes = await prisma.torneo.findUnique({ where: { id: torneo.id } });
  assert.strictEqual(
    torneoPostViernes.overrideActivoDesde.getTime(),
    dViernesLluviaD.getTime(),
    'FALLÓ TEST D: overrideActivoDesde no se persistió con el timestamp del viernes'
  );
  assert.strictEqual(
    torneoPostViernes.canchasDisponiblesOverride,
    4,
    'FALLÓ TEST D: canchasDisponiblesOverride no es 4 tras reducción del viernes'
  );

  // Snapshot de los que siguen en el viernes: los que pasaron al sábado por lluvia sí pueden
  // reprogramarse con la reducción del sábado, respetando el horario que tienen en esa jornada.
  const partidosPostViernes = await prisma.partido.findMany({
    where: {
      categoria: { torneoId: torneo.id },
      id: { notIn: [pD_Sabado1.id, pD_Sabado2.id] },
    },
  });
  const partidosViernesSnapshot = partidosPostViernes.filter((p) =>
    !p.fechaHora || getDiaCalendarioConTrasnoche(p.fechaHora, horariosClubTest).key === kVie
  );

  // PASO 2: El organizador NUNCA restaura las canchas el viernes.
  // El torneo queda con overrideActivoDesde = Viernes 18:00 en DB.
  // Sábado por la mañana amanece lloviendo. El organizador activa Modo Lluvia el sábado a las 09:30 AM (reduce a 4 canchas).
  const dSabadoLluviaD = new Date(fechaTorneo);
  dSabadoLluviaD.setDate(dSabadoLluviaD.getDate() + 1);
  dSabadoLluviaD.setHours(9, 30, 0, 0);

  console.log('🌧️ Paso 2: Sábado por la mañana — Activando Modo Lluvia sin haber restaurado el viernes...');
  const resReduccionSabadoD = await organizadorService.reprogramarPorReduccionCanchas(
    organizador.id,
    torneo.id,
    4,
    dSabadoLluviaD
  );
  console.log(`✅ Resultado reprogramación sábado: ${resReduccionSabadoD.message}`);

  // ASERCIONES CRÍTICAS TEST D:
  // 1. La reprogramación de sábado DEBE haberse ejecutado (no descartada como no-op por tener la misma cantidad de canchas)
  assert.strictEqual(
    resReduccionSabadoD.reprogramacion.ejecutada,
    true,
    'FALLÓ TEST D: La reprogramación del sábado fue descartada erróneamente como no-op'
  );

  // 2. En la base de datos, overrideActivoDesde DEBE haberse actualizado a la fecha del SÁBADO (no retener el viernes)
  const torneoPostSabado = await prisma.torneo.findUnique({ where: { id: torneo.id } });
  assert.strictEqual(
    torneoPostSabado.overrideActivoDesde.getTime(),
    dSabadoLluviaD.getTime(),
    `FALLÓ TEST D: overrideActivoDesde en DB retuvo el timestamp viejo del viernes en vez de actualizar al sábado (${torneoPostSabado.overrideActivoDesde.toISOString()} vs ${dSabadoLluviaD.toISOString()})`
  );

  // 3. En getEstadoEnVivo, el sábado tiene su propia lluvia (4 canchas, activa desde dSabadoLluviaD), el
  // viernes conserva la suya (nunca se restauró: 4 canchas, activa desde dViernesLluviaD) y el domingo tiene las 6
  const estadoEnVivoSabado = await organizadorService.getEstadoEnVivo(organizador.id, torneo.id);
  const diaSabadoEsperado = getDiaCalendarioConTrasnoche(dSabadoLluviaD, horariosClubTest).key;
  assert.strictEqual(diaSabadoEsperado, kSab, `FALLÓ TEST D: el día lógico de la lluvia es ${diaSabadoEsperado}, se esperaba el sábado ${kSab}`);
  assertCanchasPorDia(
    estadoEnVivoSabado,
    {
      [kVie]: { canchas: 4, activoDesde: dViernesLluviaD },
      [kSab]: { canchas: 4, activoDesde: dSabadoLluviaD },
      [kDom]: 6,
    },
    6,
    'FALLÓ TEST D'
  );

  // 4. Los partidos del sábado que estaban en canchas 5 y 6 DEBEN haber sido reprogramados a canchas <= 4
  const pD_Sabado1Post = await prisma.partido.findUnique({ where: { id: pD_Sabado1.id } });
  const pD_Sabado2Post = await prisma.partido.findUnique({ where: { id: pD_Sabado2.id } });
  assert.ok(
    pD_Sabado1Post.canchaNumero <= 4,
    `FALLÓ TEST D: Partido del sábado 1 quedó en cancha inhabilitada: ${pD_Sabado1Post.canchaNumero}`
  );
  assert.ok(
    pD_Sabado2Post.canchaNumero <= 4,
    `FALLÓ TEST D: Partido del sábado 2 quedó en cancha inhabilitada: ${pD_Sabado2Post.canchaNumero}`
  );

  // 5. Los partidos del viernes NO deben haber sido tocados por la activación del sábado
  for (const pViernesSnap of partidosViernesSnapshot) {
    const pActual = await prisma.partido.findUnique({ where: { id: pViernesSnap.id } });
    if (pViernesSnap.fechaHora) {
      assert.strictEqual(
        pActual.fechaHora.getTime(),
        pViernesSnap.fechaHora.getTime(),
        `FALLÓ TEST D: Partido del viernes ${pActual.id} fue modificado por el override del sábado`
      );
    }
    assert.strictEqual(
      pActual.canchaNumero,
      pViernesSnap.canchaNumero,
      `FALLÓ TEST D: Cancha del partido de viernes ${pActual.id} fue modificada por el override del sábado`
    );
  }

  // 6. Restauración final limpia el override por completo
  const resRestaurarD = await organizadorService.reprogramarPorReduccionCanchas(organizador.id, torneo.id, null);
  assert.strictEqual(resRestaurarD.canchasActivas, 6);
  const torneoFinal = await prisma.torneo.findUnique({ where: { id: torneo.id } });
  assert.strictEqual(torneoFinal.canchasDisponiblesOverride, null);
  assert.strictEqual(torneoFinal.overrideActivoDesde, null);

  // 7. Prueba con diaKey (simulando request real desde el tab activo del frontend sin mockTimestamp)
  const diaSabadoKey = getDiaCalendarioConTrasnoche(dSabadoLluviaD, horariosClubTest).key;
  const resDiaKey = await organizadorService.reprogramarPorReduccionCanchas(
    organizador.id,
    torneo.id,
    5,
    null, // mockTimestamp null
    diaSabadoKey
  );
  assert.strictEqual(resDiaKey.reprogramacion.ejecutada, true);
  assert.strictEqual(resDiaKey.reprogramacion.overrideDiaKey, diaSabadoKey);
  await organizadorService.reprogramarPorReduccionCanchas(organizador.id, torneo.id, null);

  console.log('✅ TEST D PASÓ: Activación multi-día sin restauración previa actualizó overrideActivoDesde al sábado, reprogramó partidos del sábado a canchas válidas y soportó diaKey del frontend.');

  // =======================================================================
  // 18. Test E: Partido EN_CURSO de día anterior no bloquea reducción del día actual
  // =======================================================================
  console.log('\n🎯 TEST E: Validación EN_CURSO aislada por jornada (partido colgado del viernes en Cancha 5 no bloquea reducción a 4 del sábado)...');

  // 1. Restauramos a 6 canchas para tener estado base
  await organizadorService.reprogramarPorReduccionCanchas(organizador.id, torneo.id, null);

  const partidosParaTestE = await prisma.partido.findMany({
    where: { categoria: { torneoId: torneo.id } },
    orderBy: { id: 'asc' },
  });

  const pViernesColgado = partidosParaTestE[2];
  const dViernesNoche = new Date(fechaTorneo);
  dViernesNoche.setHours(23, 0, 0, 0);

  // Simular un partido del viernes que quedó 'EN_CURSO' en Cancha 5 (ej. el organizador se fue a dormir sin cerrarlo)
  await prisma.partido.update({
    where: { id: pViernesColgado.id },
    data: {
      estado: 'EN_CURSO',
      canchaNumero: 5,
      fechaHora: dViernesNoche,
    },
  });

  // Simular activación de lluvia el sábado por la mañana reduciendo a 4 canchas
  const dSabadoLluviaE = new Date(fechaTorneo);
  dSabadoLluviaE.setDate(dSabadoLluviaE.getDate() + 1);
  dSabadoLluviaE.setHours(10, 0, 0, 0);

  // 2. Intentar reducir canchas a 4 para el sábado.
  // Con el fix de filtrado por día lógico, esto DEBE tener éxito (el partido EN_CURSO pertenece al viernes, no al sábado).
  const resReduccionSabadoE = await organizadorService.reprogramarPorReduccionCanchas(
    organizador.id,
    torneo.id,
    4,
    dSabadoLluviaE
  );
  assert.strictEqual(
    resReduccionSabadoE.canchasActivas,
    4,
    'FALLÓ TEST E: La reducción a 4 canchas del sábado fue bloqueada erróneamente por un EN_CURSO del viernes'
  );
  console.log('✅ Verificado: Partido EN_CURSO del viernes en Cancha 5 NO bloqueó la reducción a 4 canchas del sábado.');

  // 3. Contraprueba estricta: Si un partido del SÁBADO está EN_CURSO en Cancha 4 e intentamos reducir el sábado a 3 canchas,
  // la validación SÍ debe bloquear la acción.
  const pSabadoEnCurso = partidosParaTestE[0];
  const dSabadoMananaE = new Date(fechaTorneo);
  dSabadoMananaE.setDate(dSabadoMananaE.getDate() + 1);
  dSabadoMananaE.setHours(10, 0, 0, 0);

  await prisma.partido.update({
    where: { id: pSabadoEnCurso.id },
    data: {
      estado: 'EN_CURSO',
      canchaNumero: 4,
      fechaHora: dSabadoMananaE,
    },
  });

  let bloqueoExitoso = false;
  try {
    await organizadorService.reprogramarPorReduccionCanchas(
      organizador.id,
      torneo.id,
      3,
      dSabadoLluviaE
    );
  } catch (err) {
    if (err.statusCode === 400 && err.message.includes('Cancha 4')) {
      bloqueoExitoso = true;
      console.log(`✅ Verificado: Partido EN_CURSO del sábado en Cancha 4 bloqueó correctamente la reducción a 3 canchas ("${err.message}").`);
    } else {
      throw err;
    }
  }
  assert.ok(bloqueoExitoso, 'FALLÓ TEST E: No bloqueó la reducción cuando había un partido del mismo día EN_CURSO en cancha afectada');

  // Limpieza final de estados
  await prisma.partido.update({
    where: { id: pViernesColgado.id },
    data: { estado: 'FINALIZADO' },
  });
  await prisma.partido.update({
    where: { id: pSabadoEnCurso.id },
    data: { estado: 'PENDIENTE' },
  });
  await organizadorService.reprogramarPorReduccionCanchas(organizador.id, torneo.id, null);
  console.log('✅ TEST E PASÓ: Validación EN_CURSO scopeada con precisión a la jornada bajo lluvia.');

  console.log('\n🎉 TODOS LOS TESTS DE MODO DÍA DE TORNEO PASARON EXITOSAMENTE!');
  } finally {
    try {
      await limpiarPiloto();
      console.log('✓ Limpieza en finally completada para piloto@padel.com');
    } catch (e) {
      console.error('Error limpiando piloto en finally:', e);
    }
  }
}

testModoDiaTorneo()
  .catch((err) => {
    console.error('❌ Error en el test:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
