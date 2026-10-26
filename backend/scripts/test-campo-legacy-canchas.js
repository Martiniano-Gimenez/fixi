'use strict';

/**
 * test-campo-legacy-canchas.js
 * Lecturas del campo legacy Torneo.canchasDisponiblesOverride (guarda el ÚLTIMO override aplicado) en
 * lugar de las canchas de la jornada que se evalúa (OverrideCanchasDia, fuente única de verdad).
 *
 * Todo con los services reales, sin mocks, sobre un club de 4 canchas. La lluvia se aplica siempre por
 * reprogramarPorReduccionCanchas (el mismo camino que POST /torneos/:id/canchas-override), que escribe
 * OverrideCanchasDia y el campo legacy.
 *
 * Torneo: viernes 16/10/2026. Jornadas: 2026-10-16 (vie), 2026-10-17 (sáb), 2026-10-18 (dom).
 *
 * L1  Lluvia sábado (2) y se cargan los resultados de zona por HTTP: la auto-asignación de playoffs
 *     programa el domingo (sin override) con las 4 canchas, igual que al iniciar.
 * L1c Control de L1 sin lluvia: misma comparación, tiene que dar igual.
 * L2  Lluvia sábado (2): la bandeja de pendientes cuenta 4 canchas el viernes y 2 el sábado.
 * L3  Lluvia sábado (2): en-vivo ya no trae la grilla `canchas` ni valores del campo legacy, y
 *     canchasPorDia da 4, 2 y 4 para viernes, sábado y domingo.
 * L4  Lluvia sábado (2), domingo (3) y se restaura el domingo: ningún cálculo del viernes ni del
 *     domingo usa 2 (programación del domingo, bandeja del viernes y en-vivo).
 * L5  isLluviaActive (TorneoEnVivo.jsx) no es una función pura exportada: no se prueba acá.
 * L6  Lluvia domingo (3) y termina la última zona de una categoría con dieciseisavos (HTTP): los R32 del
 *     sábado siguen con las 4 canchas.
 * L6b Igual, por POST /categorias/:id/sincronizar-cuadro, que reprograma los R32: mismo sábado con y sin
 *     lluvia el domingo.
 * L7  POST /canchas-override con diaKey 'TODO': 400 "Jornada inválida." sin tocar overrides, caché,
 *     partidos ni campos legacy.
 * L8  diaKey fuera de las tres jornadas del torneo: 400 sin cambios.
 * L9  Sin diaKey: reducir responde 400 "Indicá la jornada."; restaurar restaura todas las jornadas.
 * L10 Motivo de cancha fantasma con lluvia sábado y después domingo: se compara con el activoDesde de la
 *     lluvia del día del partido, no con el de la última.
 */

require('./utils/testEnvGuard');
const { ensureTestDb } = require('./utils/testEnvGuard');
const { resetTestDb } = require('./reset-test-db');
const jwt = require('jsonwebtoken');
const prisma = require('../src/lib/prisma');
const { JWT_SECRET } = require('../src/config/env');
const { startTestServer } = require('./utils/testServer');
const canchasOverridesService = require('../src/services/canchasOverrides.service');
const organizadorService = require('../src/services/organizador.service');
const zonaService = require('../src/services/zona.service');
const { generarEliminatoria } = require('../src/services/faseEliminatoria.service');
const { programarHorariosEliminatorias, asignarHorariosRondaUno } = require('../src/services/eliminatoriaScheduler.service');
const { parseFechaLocal, getDiaCalendarioConTrasnoche } = require('../src/utils/dateUtils');

const DIA_VIERNES = '2026-10-16';
const DIA_SABADO = '2026-10-17';
const DIA_DOMINGO = '2026-10-18';
const DURACION_MS = 75 * 60 * 1000;

let BASE_URL = null;

async function limpiarDb() {
  await prisma.setPartido.deleteMany({});
  await prisma.partido.deleteMany({});
  await prisma.faseEliminatoria.deleteMany({});
  await prisma.zonaPareja.deleteMany({});
  await prisma.zona.deleteMany({});
  await prisma.slotPareja.deleteMany({});
  await prisma.pareja.deleteMany({});
  await prisma.categoria.deleteMany({});
  await prisma.overrideCanchasDia.deleteMany({});
  await prisma.torneo.deleteMany({});
  await prisma.organizador.deleteMany({});
}

async function setupBase(estadoTorneo = 'EN_CURSO') {
  await limpiarDb();
  await canchasOverridesService.loadFromDb();

  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club Legacy Canchas',
      email: `test_legacy_${Date.now()}_${Math.random()}@padel.test`,
      passwordHash: 'hash',
      cantidadCanchas: 4,
      viernesInicio: '18:00',
      viernesFin: '23:00',
      sabadoInicio: '09:00',
      sabadoFin: '24:00',
      domingoInicio: '09:00',
      domingoFin: '22:00',
    },
  });
  const torneo = await prisma.torneo.create({
    data: {
      organizadorId: org.id,
      nombre: 'Torneo Legacy Canchas',
      slug: `torneo-legacy-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      fecha: parseFechaLocal(DIA_VIERNES),
      estado: estadoTorneo,
    },
  });
  const token = jwt.sign({ id: org.id, email: org.email }, JWT_SECRET, { expiresIn: '1h' });
  return { org, torneo, token };
}

/** Fecha local a partir de la jornada y la hora ('HH:MM'); horas < 06:00 caen en la madrugada siguiente. */
function fecha(diaKey, hora) {
  const [y, m, d] = diaKey.split('-').map(Number);
  const [hh, mm] = hora.split(':').map(Number);
  const dt = new Date(y, m - 1, d, hh, mm, 0, 0);
  if (hh < 6) dt.setDate(dt.getDate() + 1);
  return dt;
}

async function lluvia(ctx, diaKey, canchas) {
  return organizadorService.reprogramarPorReduccionCanchas(ctx.org.id, ctx.torneo.id, canchas, null, diaKey);
}

async function legacyActual(ctx) {
  const t = await prisma.torneo.findUnique({ where: { id: ctx.torneo.id } });
  return t.canchasDisponiblesOverride;
}

/**
 * Categoría de 12 parejas con zonas (iniciarCategoria), cuadro (generarEliminatoria) y horarios de zona
 * fijos: el partido k de cada zona va a Vie 19:00, Vie 20:15, Sáb 10:00, Sáb 11:15..., en la cancha
 * (índice de zona + 1). Después programa las eliminatorias como al iniciar el torneo.
 */
async function armarCategoriaConZonas(ctx) {
  const cat = await prisma.categoria.create({ data: { torneoId: ctx.torneo.id, nombre: '5ta', estado: 'BORRADOR' } });
  for (let i = 1; i <= 12; i++) {
    await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: `J${i}a`, jugador2: `J${i}b`, orden: i } });
  }
  await zonaService.iniciarCategoria(ctx.org.id, cat.id);
  await prisma.torneo.update({ where: { id: ctx.torneo.id }, data: { estado: 'EN_CURSO' } });
  await generarEliminatoria(ctx.org.id, cat.id);

  const turnos = [fecha(DIA_VIERNES, '19:00'), fecha(DIA_VIERNES, '20:15'), fecha(DIA_SABADO, '10:00'), fecha(DIA_SABADO, '11:15')];
  const zonas = await prisma.zona.findMany({ where: { categoriaId: cat.id }, orderBy: { nombre: 'asc' } });
  for (let z = 0; z < zonas.length; z++) {
    const partidos = await prisma.partido.findMany({ where: { zonaId: zonas[z].id }, orderBy: { posicionEnRonda: 'asc' } });
    for (let k = 0; k < partidos.length; k++) {
      await prisma.partido.update({
        where: { id: partidos[k].id },
        data: { fechaHora: turnos[k], canchaNumero: z + 1, sinHorarioAsignado: false },
      });
    }
  }

  await programarHorariosEliminatorias(ctx.org.id, ctx.torneo.id);
  return cat;
}

async function cruces(cat) {
  return prisma.partido.findMany({
    where: { categoriaId: cat.id, faseEliminatoriaId: { not: null }, esBye: false },
    include: { faseEliminatoria: true },
    orderBy: [{ faseEliminatoria: { ronda: 'desc' } }, { posicionEnRonda: 'asc' }],
  });
}

/** { 'ronda-posicion': 'iso@cancha' } de los cruces cuya jornada lógica es el domingo del torneo. */
async function cronogramaDomingo(ctx, cat) {
  const lista = await cruces(cat);
  const res = {};
  for (const p of lista) {
    if (!p.fechaHora) {
      res[`${p.faseEliminatoria.ronda}-${p.posicionEnRonda}`] = 'SIN_HORARIO';
      continue;
    }
    if (getDiaCalendarioConTrasnoche(p.fechaHora, ctx.org)?.key !== DIA_DOMINGO) continue;
    res[`${p.faseEliminatoria.ronda}-${p.posicionEnRonda}`] = `${new Date(p.fechaHora).toISOString()}@${p.canchaNumero}`;
  }
  return res;
}

function canchasUsadas(crono) {
  return [...new Set(Object.values(crono).filter((v) => v !== 'SIN_HORARIO').map((v) => Number(v.split('@')[1])))].sort();
}

function diffCronogramas(esperado, real) {
  const diffs = [];
  for (const k of Object.keys({ ...esperado, ...real })) {
    if (esperado[k] !== real[k]) diffs.push(`${k}: esperado ${esperado[k]} recibido ${real[k]}`);
  }
  return diffs;
}

async function snapshotZona(cat) {
  const ps = await prisma.partido.findMany({ where: { categoriaId: cat.id, zonaId: { not: null } }, orderBy: { id: 'asc' } });
  return ps.map((p) => `${p.id}:${p.fechaHora ? new Date(p.fechaHora).toISOString() : null}@${p.canchaNumero}`);
}

/** Carga por HTTP (PUT /partidos/:id/resultado) todos los partidos de zona; gana la pareja de menor orden. */
async function cargarResultadosZona(ctx, cat) {
  for (let vuelta = 0; vuelta < 10; vuelta++) {
    const pendientes = await prisma.partido.findMany({
      where: { categoriaId: cat.id, zonaId: { not: null }, estado: { not: 'FINALIZADO' }, pareja1Id: { not: null }, pareja2Id: { not: null } },
      include: { pareja1: true, pareja2: true },
      orderBy: [{ fechaHora: 'asc' }, { canchaNumero: 'asc' }],
    });
    if (pendientes.length === 0) break;
    for (const p of pendientes) {
      const ganaP1 = p.pareja1.orden < p.pareja2.orden;
      const sets = ganaP1
        ? [{ gamesPareja1: 6, gamesPareja2: 0 }, { gamesPareja1: 6, gamesPareja2: 0 }]
        : [{ gamesPareja1: 0, gamesPareja2: 6 }, { gamesPareja1: 0, gamesPareja2: 6 }];
      const res = await fetch(`${BASE_URL}/partidos/${p.id}/resultado`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${ctx.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sets }),
      });
      if (res.status !== 200) {
        throw new Error(`PUT /partidos/${p.id}/resultado respondió ${res.status}: ${JSON.stringify(await res.json().catch(() => null))}`);
      }
    }
  }
  const quedan = await prisma.partido.count({ where: { categoriaId: cat.id, zonaId: { not: null }, estado: { not: 'FINALIZADO' } } });
  if (quedan > 0) throw new Error(`Quedaron ${quedan} partidos de zona sin finalizar`);
}

// ---------------------------------------------------------------------------
// L1 / L1c: auto-asignación de playoffs al terminar las zonas
// ---------------------------------------------------------------------------
async function casoAutoAsignacion(conLluvia) {
  const ctx = await setupBase('BORRADOR');
  const cat = await armarCategoriaConZonas(ctx);
  const cronoInicio = await cronogramaDomingo(ctx, cat);
  if (Object.keys(cronoInicio).length === 0) throw new Error('El escenario no programó cruces el domingo al iniciar');

  if (conLluvia) await lluvia(ctx, DIA_SABADO, 2);
  const legacy = await legacyActual(ctx);
  const zonaAntes = await snapshotZona(cat);

  await cargarResultadosZona(ctx, cat);

  const zonaDespues = await snapshotZona(cat);
  const cronoFinal = await cronogramaDomingo(ctx, cat);
  const problemas = [];
  if (JSON.stringify(zonaDespues) !== JSON.stringify(zonaAntes)) problemas.push('cambió el horario o la cancha de algún partido de viernes o sábado');
  const diffs = diffCronogramas(cronoInicio, cronoFinal);
  if (diffs.length > 0) {
    problemas.push(`el domingo no quedó como al iniciar (legacy=${legacy}; canchas al iniciar [${canchasUsadas(cronoInicio)}], después [${canchasUsadas(cronoFinal)}]); ${diffs.length} cruces distintos, p. ej. ${diffs.slice(0, 2).join(' | ')}`);
  }
  if (problemas.length > 0) throw new Error(problemas.join(' ; '));
}

const l1 = () => casoAutoAsignacion(true);
const l1c = () => casoAutoAsignacion(false);

// ---------------------------------------------------------------------------
// Helpers para bandeja y en-vivo
// ---------------------------------------------------------------------------
async function crearOcupacion(ctx, nombre, turnos) {
  const cat = await prisma.categoria.create({ data: { torneoId: ctx.torneo.id, nombre, estado: 'EN_CURSO' } });
  for (const { fechaHora, canchas } of turnos) {
    for (const c of canchas) {
      await prisma.partido.create({ data: { categoriaId: cat.id, fechaHora, canchaNumero: c, sinHorarioAsignado: false } });
    }
  }
}

async function crearPartidoSinHorario(ctx) {
  const cat = await prisma.categoria.create({ data: { torneoId: ctx.torneo.id, nombre: 'Bandeja', estado: 'EN_CURSO' } });
  const a = await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: 'B1a', jugador2: 'B1b', orden: 1 } });
  const b = await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: 'B2a', jugador2: 'B2b', orden: 2 } });
  return prisma.partido.create({
    data: { categoriaId: cat.id, pareja1Id: a.id, pareja2Id: b.id, sinHorarioAsignado: true, estado: 'PENDIENTE' },
  });
}

async function slotsViablesDe(ctx, partidoId) {
  const lista = await organizadorService.getPartidosSinHorarioTorneo(ctx.org.id, ctx.torneo.id);
  const p = lista.find((x) => x.id === partidoId);
  if (!p) throw new Error('El partido sin horario no aparece en la bandeja');
  return p.slotsViables;
}

/**
 * Turnos de prueba de la bandeja: viernes 21:45 con 3 canchas ocupadas (libre 1 de 4), sábado 20:00 con
 * 2 ocupadas (libre 0 de 2) y sábado 21:30 con 1 ocupada (libre 1 de 2).
 */
const TURNOS_BANDEJA = () => [
  { fechaHora: fecha(DIA_VIERNES, '21:45'), canchas: [1, 2, 3] },
  { fechaHora: fecha(DIA_SABADO, '20:00'), canchas: [1, 2] },
  { fechaHora: fecha(DIA_SABADO, '21:30'), canchas: [1] },
];

function verificarBandeja(slots, problemas) {
  if (!slots.includes('Viernes-21:45')) problemas.push('bandeja: Viernes-21:45 (3 de 4 ocupadas) no aparece como viable');
  if (slots.includes('Sabado-20:00')) problemas.push('bandeja: Sabado-20:00 (2 de 2 ocupadas) aparece como viable');
  if (!slots.includes('Sabado-21:30')) problemas.push('bandeja: Sabado-21:30 (1 de 2 ocupadas) no aparece como viable');
}

async function crearEnCursoViernesCancha3(ctx) {
  const cat = await prisma.categoria.create({ data: { torneoId: ctx.torneo.id, nombre: 'EnVivo', estado: 'EN_CURSO' } });
  return prisma.partido.create({
    data: { categoriaId: cat.id, fechaHora: fecha(DIA_VIERNES, '20:00'), canchaNumero: 3, sinHorarioAsignado: false, estado: 'EN_CURSO' },
  });
}

/**
 * La respuesta de en-vivo ya no trae la grilla `canchas` ni valores que salgan del campo legacy
 * (canchasActivas, torneo.overrideDiaKey, torneo.canchasDisponiblesOverride, torneo.overrideActivoDesde):
 * las canchas de cada jornada salen solo de canchasPorDia.
 */
async function verificarEnVivo(ctx, partidoEnCurso, esperadoPorDia, problemas) {
  const estado = await organizadorService.getEstadoEnVivo(ctx.org.id, ctx.torneo.id);
  const sobrantes = ['canchas', 'canchasActivas'].filter((k) => k in estado);
  const sobrantesTorneo = ['overrideDiaKey', 'canchasDisponiblesOverride', 'overrideActivoDesde'].filter((k) => k in estado.torneo);
  if (sobrantes.length > 0 || sobrantesTorneo.length > 0) {
    problemas.push(`en-vivo: la respuesta todavía trae [${sobrantes.join(', ')}] y torneo.[${sobrantesTorneo.join(', ')}]`);
  }
  if (!estado.partidosEnCurso.some((p) => p.id === partidoEnCurso.id)) {
    problemas.push('en-vivo: el partido en juego del viernes no aparece en partidosEnCurso');
  }
  for (const [k, v] of Object.entries(esperadoPorDia)) {
    if (estado.canchasPorDia[k]?.canchas !== v) problemas.push(`en-vivo: canchasPorDia[${k}] esperado ${v}, recibido ${estado.canchasPorDia[k]?.canchas}`);
  }
}

// ---------------------------------------------------------------------------
// L2, L3, L4
// ---------------------------------------------------------------------------
async function l2_bandeja_lluvia_sabado() {
  const ctx = await setupBase();
  await lluvia(ctx, DIA_SABADO, 2);
  await crearOcupacion(ctx, 'Ocupacion', TURNOS_BANDEJA());
  const p = await crearPartidoSinHorario(ctx);
  const slots = await slotsViablesDe(ctx, p.id);
  const problemas = [];
  verificarBandeja(slots, problemas);
  if (problemas.length > 0) throw new Error(`${problemas.join(' ; ')} (legacy=${await legacyActual(ctx)})`);
}

async function l3_en_vivo_lluvia_sabado() {
  const ctx = await setupBase();
  const enCurso = await crearEnCursoViernesCancha3(ctx);
  // La reducción del sábado se permite: el partido en juego es de otra jornada
  await lluvia(ctx, DIA_SABADO, 2);
  const problemas = [];
  await verificarEnVivo(ctx, enCurso, { [DIA_VIERNES]: 4, [DIA_SABADO]: 2, [DIA_DOMINGO]: 4 }, problemas);
  if (problemas.length > 0) throw new Error(`${problemas.join(' ; ')} (legacy=${await legacyActual(ctx)})`);
}

async function l4_restaurar_domingo_deja_sabado() {
  const ctx = await setupBase('BORRADOR');
  const cat = await armarCategoriaConZonas(ctx);
  const cronoInicio = await cronogramaDomingo(ctx, cat);

  await lluvia(ctx, DIA_SABADO, 2);
  await lluvia(ctx, DIA_DOMINGO, 3);
  await lluvia(ctx, DIA_DOMINGO, 4); // restauración solo del domingo
  const legacy = await legacyActual(ctx);
  const problemas = [];

  // a) Programar el domingo por el camino de POST /categorias/:id/eliminatoria (faseEliminatoria.controller.js:24)
  await asignarHorariosRondaUno(ctx.org.id, ctx.torneo.id, cat.id);
  const cronoFinal = await cronogramaDomingo(ctx, cat);
  const diffs = diffCronogramas(cronoInicio, cronoFinal);
  if (diffs.length > 0) {
    problemas.push(`domingo: no quedó como al iniciar (canchas al iniciar [${canchasUsadas(cronoInicio)}], después [${canchasUsadas(cronoFinal)}]); ${diffs.length} cruces distintos`);
  }

  // b) Bandeja del viernes y del sábado
  await crearOcupacion(ctx, 'Ocupacion', TURNOS_BANDEJA());
  const p = await crearPartidoSinHorario(ctx);
  verificarBandeja(await slotsViablesDe(ctx, p.id), problemas);

  // c) En-vivo con un partido en juego el viernes en la cancha 3
  const enCurso = await crearEnCursoViernesCancha3(ctx);
  await verificarEnVivo(ctx, enCurso, { [DIA_VIERNES]: 4, [DIA_SABADO]: 2, [DIA_DOMINGO]: 4 }, problemas);

  if (problemas.length > 0) throw new Error(`${problemas.join(' ; ')} (legacy=${legacy})`);
}

// ---------------------------------------------------------------------------
// L6 / L6b: categoría con dieciseisavos y lluvia el domingo
// ---------------------------------------------------------------------------
/**
 * Categoría de 36 parejas (12 zonas, 24 clasificados: 8 dieciseisavos con rival). Los partidos de zona van de viernes 18:00 a sábado,
 * cuatro zonas por turno (cancha = índice de zona % 4 + 1), así terminan antes de la ventana de R32.
 */
async function armarCategoriaConDieciseisavos(ctx) {
  const cat = await prisma.categoria.create({ data: { torneoId: ctx.torneo.id, nombre: '6ta', estado: 'BORRADOR' } });
  for (let i = 1; i <= 36; i++) {
    await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: `R${i}a`, jugador2: `R${i}b`, orden: i } });
  }
  await zonaService.iniciarCategoria(ctx.org.id, cat.id);
  await prisma.torneo.update({ where: { id: ctx.torneo.id }, data: { estado: 'EN_CURSO' } });
  await generarEliminatoria(ctx.org.id, cat.id);

  const turnos = [
    fecha(DIA_VIERNES, '18:00'), fecha(DIA_VIERNES, '19:15'), fecha(DIA_VIERNES, '20:30'), fecha(DIA_VIERNES, '21:45'),
    fecha(DIA_SABADO, '09:00'), fecha(DIA_SABADO, '10:15'), fecha(DIA_SABADO, '11:30'), fecha(DIA_SABADO, '12:45'),
    fecha(DIA_SABADO, '14:00'), fecha(DIA_SABADO, '15:15'), fecha(DIA_SABADO, '16:30'), fecha(DIA_SABADO, '17:45'),
  ];
  const zonas = await prisma.zona.findMany({ where: { categoriaId: cat.id }, orderBy: { nombre: 'asc' } });
  const grupos = Math.ceil(zonas.length / 4);
  for (let z = 0; z < zonas.length; z++) {
    const partidos = await prisma.partido.findMany({ where: { zonaId: zonas[z].id }, orderBy: { posicionEnRonda: 'asc' } });
    for (let k = 0; k < partidos.length; k++) {
      await prisma.partido.update({
        where: { id: partidos[k].id },
        data: { fechaHora: turnos[k * grupos + Math.floor(z / 4)], canchaNumero: (z % 4) + 1, sinHorarioAsignado: false },
      });
    }
  }

  await programarHorariosEliminatorias(ctx.org.id, ctx.torneo.id);
  return cat;
}

/** { 'ronda-posicion': 'iso@cancha' } de los R32 (no BYE) con horario en la jornada del sábado. */
async function cronogramaR32Sabado(ctx, cat) {
  const lista = await prisma.partido.findMany({
    where: { categoriaId: cat.id, faseEliminatoria: { ronda: { gte: 32 } }, esBye: false },
    include: { faseEliminatoria: true },
    orderBy: { posicionEnRonda: 'asc' },
  });
  const res = {};
  for (const p of lista) {
    if (!p.fechaHora) continue;
    if (getDiaCalendarioConTrasnoche(p.fechaHora, ctx.org)?.key !== DIA_SABADO) continue;
    res[`${p.faseEliminatoria.ronda}-${p.posicionEnRonda}`] = `${new Date(p.fechaHora).toISOString()}@${p.canchaNumero}`;
  }
  return res;
}

async function sincronizarPorHttp(ctx, cat) {
  const res = await fetch(`${BASE_URL}/categorias/${cat.id}/sincronizar-cuadro`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ctx.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (res.status !== 200) throw new Error(`POST sincronizar-cuadro respondió ${res.status}: ${JSON.stringify(await res.json().catch(() => null))}`);
}

function verificarR32(cronoEsperado, cronoReal, etiqueta, problemas) {
  if (Object.keys(cronoEsperado).length === 0) problemas.push(`${etiqueta}: el escenario no programó R32 el sábado`);
  if (!canchasUsadas(cronoEsperado).includes(4)) problemas.push(`${etiqueta}: el escenario no usa la cancha 4 el sábado (canchas [${canchasUsadas(cronoEsperado)}])`);
  const diffs = diffCronogramas(cronoEsperado, cronoReal);
  if (diffs.length > 0) {
    problemas.push(`${etiqueta}: los R32 del sábado cambiaron (canchas esperadas [${canchasUsadas(cronoEsperado)}], recibidas [${canchasUsadas(cronoReal)}]); ${diffs.length} distintos, p. ej. ${diffs.slice(0, 2).join(' | ')}`);
  }
}

// L6: camino pedido (lluvia del domingo y fin de la última zona por HTTP)
async function l6_r32_fin_zonas_lluvia_domingo() {
  const ctx = await setupBase('BORRADOR');
  const cat = await armarCategoriaConDieciseisavos(ctx);
  const cronoInicio = await cronogramaR32Sabado(ctx, cat);
  await lluvia(ctx, DIA_DOMINGO, 3);
  await cargarResultadosZona(ctx, cat);
  const problemas = [];
  verificarR32(cronoInicio, await cronogramaR32Sabado(ctx, cat), 'L6', problemas);
  if (problemas.length > 0) throw new Error(`${problemas.join(' ; ')} (legacy=${await legacyActual(ctx)})`);
}

// L6b: el otro camino real que reprograma los R32 sin canchasOverride (POST /categorias/:id/sincronizar-cuadro)
async function l6b_r32_sincronizar_lluvia_domingo() {
  const ctx = await setupBase('BORRADOR');
  const cat = await armarCategoriaConDieciseisavos(ctx);
  await sincronizarPorHttp(ctx, cat);
  const cronoSinLluvia = await cronogramaR32Sabado(ctx, cat);
  await lluvia(ctx, DIA_DOMINGO, 3);
  await sincronizarPorHttp(ctx, cat);
  const problemas = [];
  verificarR32(cronoSinLluvia, await cronogramaR32Sabado(ctx, cat), 'L6b', problemas);
  if (problemas.length > 0) throw new Error(`${problemas.join(' ; ')} (legacy=${await legacyActual(ctx)})`);
}

// ---------------------------------------------------------------------------
// L7 a L9: validación de diaKey en POST /torneos/:id/canchas-override
// ---------------------------------------------------------------------------
async function postCanchasOverride(ctx, body) {
  const res = await fetch(`${BASE_URL}/torneos/${ctx.torneo.id}/canchas-override`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ctx.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

/** Todo lo que una reducción o restauración puede tocar: overrides (base y caché), partidos y campos legacy. */
async function snapshotTorneo(ctx) {
  const t = await prisma.torneo.findUnique({ where: { id: ctx.torneo.id } });
  const overrides = await prisma.overrideCanchasDia.findMany({ where: { torneoId: ctx.torneo.id }, orderBy: { diaKey: 'asc' } });
  const partidos = await prisma.partido.findMany({ where: { categoria: { torneoId: ctx.torneo.id } }, orderBy: { id: 'asc' } });
  return JSON.stringify({
    legacy: [t.canchasDisponiblesOverride, t.overrideActivoDesde ? t.overrideActivoDesde.toISOString() : null],
    overrides: overrides.map((o) => [o.diaKey, o.canchas, o.activoDesde.toISOString(), JSON.stringify(o.partidosSinSlot)]),
    cache: canchasOverridesService.getOverridesTorneo(ctx.torneo.id),
    partidos: partidos.map((p) => [p.id, p.fechaHora ? p.fechaHora.toISOString() : null, p.canchaNumero, p.sinHorarioAsignado, p.estado]),
  });
}

/** Torneo con lluvia el sábado (2 canchas) y partidos del sábado en las canchas 1 y 2, más uno pendiente sin cancha. */
async function setupConLluviaSabado() {
  const ctx = await setupBase();
  await lluvia(ctx, DIA_SABADO, 2);
  await crearOcupacion(ctx, 'Sabado', [{ fechaHora: fecha(DIA_SABADO, '10:00'), canchas: [1, 2] }, { fechaHora: fecha(DIA_VIERNES, '20:00'), canchas: [3, 4] }]);
  return ctx;
}

async function esperar400SinCambios(ctx, body, mensaje, problemas) {
  const antes = await snapshotTorneo(ctx);
  const { status, json } = await postCanchasOverride(ctx, body);
  if (status !== 400 || json?.error !== mensaje) {
    problemas.push(`${JSON.stringify(body)}: esperado 400 "${mensaje}", recibido ${status} "${json?.error || json?.message}"`);
  }
  if ((await snapshotTorneo(ctx)) !== antes) problemas.push(`${JSON.stringify(body)}: cambió algo en la base o en la caché`);
}

async function l7_diakey_todo() {
  const ctx = await setupConLluviaSabado();
  const problemas = [];
  await esperar400SinCambios(ctx, { canchasDisponiblesOverride: 3, diaKey: 'TODO' }, 'Jornada inválida.', problemas);
  await esperar400SinCambios(ctx, { canchasDisponiblesOverride: null, diaKey: 'TODO' }, 'Jornada inválida.', problemas);
  if (problemas.length > 0) throw new Error(problemas.join(' ; '));
}

async function l8_diakey_fuera_del_torneo() {
  const ctx = await setupConLluviaSabado();
  const problemas = [];
  await esperar400SinCambios(ctx, { canchasDisponiblesOverride: 2, diaKey: '2026-10-23' }, 'Jornada inválida.', problemas);
  await esperar400SinCambios(ctx, { canchasDisponiblesOverride: 2, diaKey: '2026-10-15' }, 'Jornada inválida.', problemas);
  await esperar400SinCambios(ctx, { canchasDisponiblesOverride: null, diaKey: '2026-10-25' }, 'Jornada inválida.', problemas);
  if (problemas.length > 0) throw new Error(problemas.join(' ; '));
}

async function l9_sin_diakey() {
  const ctx = await setupConLluviaSabado();
  const problemas = [];
  await esperar400SinCambios(ctx, { canchasDisponiblesOverride: 2 }, 'Indicá la jornada.', problemas);

  await lluvia(ctx, DIA_DOMINGO, 3);
  const { status, json } = await postCanchasOverride(ctx, { canchasDisponiblesOverride: null });
  if (status !== 200) problemas.push(`restauración sin diaKey: esperado 200, recibido ${status} "${json?.error}"`);
  const overrides = await prisma.overrideCanchasDia.count({ where: { torneoId: ctx.torneo.id } });
  const cache = canchasOverridesService.getOverridesTorneo(ctx.torneo.id);
  const t = await prisma.torneo.findUnique({ where: { id: ctx.torneo.id } });
  if (overrides !== 0 || Object.keys(cache).length !== 0) problemas.push(`restauración sin diaKey: quedaron overrides (base ${overrides}, caché ${JSON.stringify(cache)})`);
  if (t.canchasDisponiblesOverride !== null || t.overrideActivoDesde !== null) problemas.push(`restauración sin diaKey: campos legacy no quedaron en null (${t.canchasDisponiblesOverride}, ${t.overrideActivoDesde})`);
  if (problemas.length > 0) throw new Error(problemas.join(' ; '));
}

// ---------------------------------------------------------------------------
// L10: motivo de cancha fantasma con lluvia el sábado y después el domingo
// ---------------------------------------------------------------------------
async function l10_motivo_fantasma() {
  const ctx = await setupBase();
  await lluvia(ctx, DIA_SABADO, 2); // activoDesde: sábado 12:00
  await lluvia(ctx, DIA_DOMINGO, 3); // activoDesde: domingo 12:00

  const cat = await prisma.categoria.create({ data: { torneoId: ctx.torneo.id, nombre: 'Fantasma', estado: 'EN_CURSO' } });
  const parejas = [];
  for (let i = 1; i <= 4; i++) parejas.push(await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: `F${i}a`, jugador2: `F${i}b`, orden: i } }));
  const despues = await prisma.partido.create({
    data: { categoriaId: cat.id, pareja1Id: parejas[0].id, pareja2Id: parejas[1].id, fechaHora: fecha(DIA_SABADO, '15:00'), canchaNumero: 3, estado: 'PENDIENTE' },
  });
  const antes = await prisma.partido.create({
    data: { categoriaId: cat.id, pareja1Id: parejas[2].id, pareja2Id: parejas[3].id, fechaHora: fecha(DIA_SABADO, '10:00'), canchaNumero: 4, estado: 'PENDIENTE' },
  });

  const estado = await organizadorService.getEstadoEnVivo(ctx.org.id, ctx.torneo.id);
  const motivo = (id) => estado.partidosEnCanchaFantasma.find((p) => p.id === id)?.motivo;
  const problemas = [];
  if (motivo(despues.id) !== 'Cancha inhabilitada por modo lluvia') {
    problemas.push(`sábado 15:00 (después de la lluvia del sábado): motivo "${motivo(despues.id)}"`);
  }
  if (motivo(antes.id) !== 'Horario anterior a la activación del modo lluvia') {
    problemas.push(`sábado 10:00 (antes de la lluvia del sábado): motivo "${motivo(antes.id)}"`);
  }
  if (problemas.length > 0) throw new Error(problemas.join(' ; '));
}

async function run() {
  await ensureTestDb();
  resetTestDb();
  const { server, baseUrl } = await startTestServer();
  BASE_URL = baseUrl;

  console.log('='.repeat(85));
  console.log('🧪 SUITE: LECTURAS DEL CAMPO LEGACY canchasDisponiblesOverride');
  console.log('='.repeat(85));

  const allTests = [
    { nombre: 'L1: lluvia sáb 2, fin de zonas por HTTP -> domingo con 4 canchas', fn: l1 },
    { nombre: 'L1c: control de L1 sin lluvia', fn: l1c },
    { nombre: 'L2: lluvia sáb 2 -> bandeja viernes 4 canchas, sábado 2', fn: l2_bandeja_lluvia_sabado },
    { nombre: 'L3: lluvia sáb 2 -> en-vivo sin grilla ni legacy, canchasPorDia correcto', fn: l3_en_vivo_lluvia_sabado },
    { nombre: 'L4: lluvia sáb 2 y dom 3, restaurar dom -> vie y dom nunca 2', fn: l4_restaurar_domingo_deja_sabado },
    { nombre: 'L6: lluvia dom 3, fin de zonas con R32 por HTTP -> R32 del sábado con 4', fn: l6_r32_fin_zonas_lluvia_domingo },
    { nombre: 'L6b: lluvia dom 3, sincronizar cuadro -> R32 del sábado con 4', fn: l6b_r32_sincronizar_lluvia_domingo },
    { nombre: "L7: canchas-override con diaKey 'TODO' -> 400 sin cambios", fn: l7_diakey_todo },
    { nombre: 'L8: canchas-override con diaKey fuera del torneo -> 400', fn: l8_diakey_fuera_del_torneo },
    { nombre: 'L9: sin diaKey: reducir 400, restaurar todo', fn: l9_sin_diakey },
    { nombre: 'L10: motivo de cancha fantasma con lluvia sáb y dom', fn: l10_motivo_fantasma },
  ];

  const resultados = [];
  const fallas = [];
  for (const t of allTests) {
    try {
      await t.fn();
      resultados.push({ caso: t.nombre, estado: 'PASS' });
    } catch (err) {
      resultados.push({ caso: t.nombre, estado: 'FAIL' });
      fallas.push({ caso: t.nombre, error: err });
    }
  }

  await limpiarDb();
  await new Promise((resolve) => server.close(resolve));
  await prisma.$disconnect();

  console.log('\n' + '='.repeat(85));
  console.table(resultados);
  if (fallas.length > 0) {
    console.log(`\n❌ ${fallas.length}/${allTests.length} casos fallaron.`);
    for (const f of fallas) console.error(`🔴 [${f.caso}]\n   ${f.error.message}`);
    return false;
  }
  console.log(`\n✅ ${allTests.length}/${allTests.length} casos pasaron.`);
  return true;
}

if (require.main === module) {
  run()
    .then((ok) => process.exit(ok ? 0 : 1))
    .catch((e) => {
      console.error('Error fatal en test-campo-legacy-canchas.js:', e);
      process.exit(1);
    });
}

module.exports = { run };
