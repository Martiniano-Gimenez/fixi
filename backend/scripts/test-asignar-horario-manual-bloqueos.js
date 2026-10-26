'use strict';

/**
 * test-asignar-horario-manual-bloqueos.js
 * Suite oficial de las validaciones bloqueantes de PUT /api/partidos/:id/asignar-horario-manual
 * (estado del partido, día según el tipo de partido y canchas cerradas por lluvia) y de las canchas
 * por jornada que devuelve GET /api/torneos/:id/canchas-disponibles (la fuente de AsignarHorarioModal).
 *
 * Todo se prueba por HTTP contra un servidor de test. Cada rechazo verifica el código, el mensaje y que
 * el partido quedó intacto en la base (fechaHora, canchaNumero, horarioManual, sinHorarioAsignado).
 *
 * Club de prueba: 4 canchas. Viernes 18:00-23:00, sábado 09:00-02:00 (con trasnoche), domingo 09:00-22:00.
 * Torneo: viernes 16/10/2026. Jornadas lógicas: 2026-10-16 (vie), 2026-10-17 (sáb), 2026-10-18 (dom).
 */

require('./utils/testEnvGuard');
const { ensureTestDb } = require('./utils/testEnvGuard');
const { resetTestDb } = require('./reset-test-db');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const prisma = require('../src/lib/prisma');
const { JWT_SECRET } = require('../src/config/env');
const { startTestServer } = require('./utils/testServer');
const canchasOverridesService = require('../src/services/canchasOverrides.service');
const { parseSlotToDate } = require('../src/services/zona.service');
const { parseFechaLocal } = require('../src/utils/dateUtils');

const MSG_EN_JUEGO = 'No se puede cambiar el horario de un partido en juego.';
const MSG_FINALIZADO = 'No se puede cambiar el horario de un partido finalizado.';
const MSG_DIA_ZONA = 'Los partidos de zona se juegan viernes o sábado.';
const MSG_DIA_R32 = 'Los dieciseisavos se juegan el sábado.';
const MSG_DIA_OCTAVOS = 'Las eliminatorias desde octavos se juegan el domingo.';
const msgLluvia = (cancha, dia) => `La cancha ${cancha} está cerrada por lluvia el ${dia}. Elegí otra cancha.`;

const DIA_VIERNES = '2026-10-16';
const DIA_SABADO = '2026-10-17';
const DIA_DOMINGO = '2026-10-18';

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

async function crearOrganizador(sufijo) {
  return prisma.organizador.create({
    data: {
      nombre: `Club Bloqueos ${sufijo}`,
      email: `test_bloqueos_${sufijo}_${Date.now()}_${Math.random()}@padel.test`,
      passwordHash: 'hash',
      cantidadCanchas: 4,
      viernesInicio: '18:00',
      viernesFin: '23:00',
      sabadoInicio: '09:00',
      sabadoFin: '02:00',
      domingoInicio: '09:00',
      domingoFin: '22:00',
    },
  });
}

function tokenDe(org) {
  return jwt.sign({ id: org.id, email: org.email }, JWT_SECRET, { expiresIn: '1h' });
}

async function setupBase() {
  await limpiarDb();
  // Caché de overrides vacía y coherente con la base limpia
  await canchasOverridesService.loadFromDb();

  const org = await crearOrganizador('A');
  const orgAjeno = await crearOrganizador('B');

  const torneo = await prisma.torneo.create({
    data: {
      organizadorId: org.id,
      nombre: 'Torneo Bloqueos',
      slug: `torneo-bloqueos-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      fecha: parseFechaLocal(DIA_VIERNES),
      estado: 'EN_CURSO',
    },
  });

  const cat = await prisma.categoria.create({
    data: { torneoId: torneo.id, nombre: '5ta', estado: 'EN_CURSO' },
  });

  const parejas = [];
  for (let i = 1; i <= 4; i++) {
    parejas.push(await prisma.pareja.create({
      data: { categoriaId: cat.id, jugador1: `J${i}a`, jugador2: `J${i}b`, orden: i },
    }));
  }

  return { org, orgAjeno, torneo, cat, parejas, token: tokenDe(org), tokenAjeno: tokenDe(orgAjeno) };
}

/**
 * Crea un partido con un horario inicial conocido (en cancha 4, sin marca manual) para poder verificar
 * que un rechazo no lo modifica.
 * tipo: 'zona' | 'r32' | 'octavos' | 'sinTipo'
 */
async function crearPartido(ctx, tipo, estado = 'PENDIENTE') {
  const { torneo, cat, parejas } = ctx;
  let zonaId = null;
  let faseEliminatoriaId = null;
  let slotInicial = null;

  if (tipo === 'zona') {
    const zona = await prisma.zona.create({ data: { categoriaId: cat.id, nombre: 'Zona A' } });
    zonaId = zona.id;
    slotInicial = 'Viernes-21:45';
  } else if (tipo === 'r32') {
    const fase = await prisma.faseEliminatoria.create({ data: { categoriaId: cat.id, nombre: 'Dieciseisavos', ronda: 32 } });
    faseEliminatoriaId = fase.id;
    slotInicial = 'Sabado-22:00';
  } else if (tipo === 'octavos') {
    const fase = await prisma.faseEliminatoria.create({ data: { categoriaId: cat.id, nombre: 'Octavos de Final', ronda: 16 } });
    faseEliminatoriaId = fase.id;
    slotInicial = 'Domingo-18:00';
  } else {
    slotInicial = 'Viernes-21:45';
  }

  return prisma.partido.create({
    data: {
      categoriaId: cat.id,
      zonaId,
      faseEliminatoriaId,
      posicionEnRonda: 1,
      pareja1Id: parejas[0].id,
      pareja2Id: parejas[1].id,
      estado,
      fechaHora: parseSlotToDate(slotInicial, torneo.fecha),
      canchaNumero: 4,
      sinHorarioAsignado: false,
      horarioManual: false,
    },
  });
}

async function lluvia(ctx, diaKey, canchas) {
  await canchasOverridesService.setOverrideDia(ctx.torneo.id, diaKey, canchas, parseFechaLocal(diaKey), {});
}

async function snapshot(partidoId) {
  const p = await prisma.partido.findUnique({ where: { id: partidoId } });
  return {
    fechaHora: p.fechaHora ? new Date(p.fechaHora).toISOString() : null,
    canchaNumero: p.canchaNumero,
    horarioManual: p.horarioManual,
    sinHorarioAsignado: p.sinHorarioAsignado,
  };
}

async function asignar(partidoId, body, token) {
  const res = await fetch(`${BASE_URL}/partidos/${partidoId}/asignar-horario-manual`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function esperarRechazo(partidoId, body, token, statusEsperado, mensajeEsperado) {
  const antes = await snapshot(partidoId);
  const { status, json } = await asignar(partidoId, body, token);
  assert.strictEqual(status, statusEsperado, `HTTP esperado ${statusEsperado}, recibido ${status} (${json?.error || json?.message})`);
  assert.strictEqual(json?.error, mensajeEsperado, `Mensaje esperado "${mensajeEsperado}", recibido "${json?.error}"`);
  const despues = await snapshot(partidoId);
  assert.deepStrictEqual(despues, antes, `El partido cambió en la base pese al rechazo: antes ${JSON.stringify(antes)}, después ${JSON.stringify(despues)}`);
}

async function esperarAsignado(partidoId, body, token, fechaEsperada, canchaEsperada) {
  const { status, json } = await asignar(partidoId, body, token);
  assert.strictEqual(status, 200, `HTTP esperado 200, recibido ${status} (${json?.error || json?.message})`);
  const despues = await snapshot(partidoId);
  assert.deepStrictEqual(despues, {
    fechaHora: fechaEsperada.toISOString(),
    canchaNumero: canchaEsperada,
    horarioManual: true,
    sinHorarioAsignado: false,
  });
}

function fechaSlot(ctx, slotId) {
  return parseSlotToDate(slotId, ctx.torneo.fecha);
}

// ---------------------------------------------------------------------------
// Estado del partido
// ---------------------------------------------------------------------------
async function v1_en_curso() {
  const ctx = await setupBase();
  const p = await crearPartido(ctx, 'zona', 'EN_CURSO');
  await esperarRechazo(p.id, { slotId: 'Sabado-10:00', canchaNumero: 1 }, ctx.token, 400, MSG_EN_JUEGO);
}

async function v2_finalizado() {
  const ctx = await setupBase();
  const p = await crearPartido(ctx, 'zona', 'FINALIZADO');
  await esperarRechazo(p.id, { slotId: 'Sabado-10:00', canchaNumero: 1 }, ctx.token, 400, MSG_FINALIZADO);
}

async function v3_pendiente_valido() {
  const ctx = await setupBase();
  const p = await crearPartido(ctx, 'zona', 'PENDIENTE');
  await esperarAsignado(p.id, { slotId: 'Sabado-10:00', canchaNumero: 1 }, ctx.token, fechaSlot(ctx, 'Sabado-10:00'), 1);
}

// ---------------------------------------------------------------------------
// Día según el tipo de partido
// ---------------------------------------------------------------------------
async function v4_zona_domingo() {
  const ctx = await setupBase();
  const p = await crearPartido(ctx, 'zona');
  await esperarRechazo(p.id, { slotId: 'Domingo-10:00', canchaNumero: 1 }, ctx.token, 400, MSG_DIA_ZONA);
}

async function v5_zona_sabado() {
  const ctx = await setupBase();
  const p = await crearPartido(ctx, 'zona');
  await esperarAsignado(p.id, { slotId: 'Sabado-12:00', canchaNumero: 2 }, ctx.token, fechaSlot(ctx, 'Sabado-12:00'), 2);
}

async function v6_zona_trasnoche_sabado() {
  const ctx = await setupBase();
  const p = await crearPartido(ctx, 'zona');
  await esperarAsignado(p.id, { slotId: 'Sabado-00:30', canchaNumero: 1 }, ctx.token, fechaSlot(ctx, 'Sabado-00:30'), 1);
}

async function v7_r32_viernes() {
  const ctx = await setupBase();
  const p = await crearPartido(ctx, 'r32');
  await esperarRechazo(p.id, { slotId: 'Viernes-20:00', canchaNumero: 1 }, ctx.token, 400, MSG_DIA_R32);
}

async function v8_r32_sabado() {
  const ctx = await setupBase();
  const p = await crearPartido(ctx, 'r32');
  await esperarAsignado(p.id, { slotId: 'Sabado-20:00', canchaNumero: 1 }, ctx.token, fechaSlot(ctx, 'Sabado-20:00'), 1);
}

async function v8b_r32_domingo() {
  const ctx = await setupBase();
  const p = await crearPartido(ctx, 'r32');
  await esperarRechazo(p.id, { slotId: 'Domingo-10:00', canchaNumero: 1 }, ctx.token, 400, MSG_DIA_R32);
}

async function v8c_r32_trasnoche_sabado() {
  const ctx = await setupBase();
  const p = await crearPartido(ctx, 'r32');
  await esperarAsignado(p.id, { slotId: 'Sabado-00:30', canchaNumero: 2 }, ctx.token, fechaSlot(ctx, 'Sabado-00:30'), 2);
}

async function v9_octavos_sabado() {
  const ctx = await setupBase();
  const p = await crearPartido(ctx, 'octavos');
  await esperarRechazo(p.id, { slotId: 'Sabado-20:00', canchaNumero: 1 }, ctx.token, 400, MSG_DIA_OCTAVOS);
}

async function v10_octavos_domingo() {
  const ctx = await setupBase();
  const p = await crearPartido(ctx, 'octavos');
  await esperarAsignado(p.id, { slotId: 'Domingo-10:00', canchaNumero: 1 }, ctx.token, fechaSlot(ctx, 'Domingo-10:00'), 1);
}

// ---------------------------------------------------------------------------
// Canchas cerradas por lluvia
// ---------------------------------------------------------------------------
async function v11_lluvia_sabado_cancha_cerrada() {
  const ctx = await setupBase();
  await lluvia(ctx, DIA_SABADO, 2);
  const p = await crearPartido(ctx, 'zona');
  await esperarRechazo(p.id, { slotId: 'Sabado-10:00', canchaNumero: 3 }, ctx.token, 400, msgLluvia(3, 'sábado'));
}

async function v12_lluvia_sabado_cancha_activa() {
  const ctx = await setupBase();
  await lluvia(ctx, DIA_SABADO, 2);
  const p = await crearPartido(ctx, 'zona');
  await esperarAsignado(p.id, { slotId: 'Sabado-10:00', canchaNumero: 2 }, ctx.token, fechaSlot(ctx, 'Sabado-10:00'), 2);
}

async function v13_lluvia_sabado_cancha3_viernes() {
  const ctx = await setupBase();
  await lluvia(ctx, DIA_SABADO, 2);
  const p = await crearPartido(ctx, 'zona');
  await esperarAsignado(p.id, { slotId: 'Viernes-20:00', canchaNumero: 3 }, ctx.token, fechaSlot(ctx, 'Viernes-20:00'), 3);
}

async function v14_lluvia_domingo_eliminatoria() {
  const ctx = await setupBase();
  await lluvia(ctx, DIA_DOMINGO, 2);
  const p = await crearPartido(ctx, 'octavos');
  await esperarRechazo(p.id, { slotId: 'Domingo-10:00', canchaNumero: 3 }, ctx.token, 400, msgLluvia(3, 'domingo'));
}

async function v15_lluvia_sabado_trasnoche() {
  const ctx = await setupBase();
  await lluvia(ctx, DIA_SABADO, 2);
  const p = await crearPartido(ctx, 'zona');
  await esperarRechazo(p.id, { slotId: 'Sabado-01:00', canchaNumero: 3 }, ctx.token, 400, msgLluvia(3, 'sábado'));
}

// ---------------------------------------------------------------------------
// Orden de las validaciones y respuestas existentes
// ---------------------------------------------------------------------------
async function v16_finalizado_en_cancha_cerrada() {
  const ctx = await setupBase();
  await lluvia(ctx, DIA_DOMINGO, 2);
  const p = await crearPartido(ctx, 'zona', 'FINALIZADO');
  // Falla las tres reglas a la vez (estado, día de zona en domingo y cancha cerrada): gana la de estado
  await esperarRechazo(p.id, { slotId: 'Domingo-10:00', canchaNumero: 3 }, ctx.token, 400, MSG_FINALIZADO);
}

async function v17_organizador_ajeno_403() {
  const ctx = await setupBase();
  await lluvia(ctx, DIA_SABADO, 2);
  const p = await crearPartido(ctx, 'zona', 'FINALIZADO');
  // Partido finalizado, día y cancha inválidos: el 403 de autorización va antes que todo
  await esperarRechazo(p.id, { slotId: 'Domingo-10:00', canchaNumero: 3 }, ctx.tokenAjeno, 403, 'No tenés permisos sobre este partido.');
}

async function v17b_partido_inexistente_404() {
  const ctx = await setupBase();
  const { status, json } = await asignar('00000000-0000-0000-0000-000000000000', { slotId: 'Sabado-10:00', canchaNumero: 1 }, ctx.token);
  assert.strictEqual(status, 404, `HTTP esperado 404, recibido ${status}`);
  assert.strictEqual(json?.error, 'Partido no encontrado.');
}

// ---------------------------------------------------------------------------
// Entrada por fechaHora (sin slotId) y partidos sin tipo
// ---------------------------------------------------------------------------
async function v18_fechaHora_zona_domingo() {
  const ctx = await setupBase();
  const p = await crearPartido(ctx, 'zona');
  const domingo10 = new Date(2026, 9, 18, 10, 0, 0, 0);
  await esperarRechazo(p.id, { fechaHora: domingo10.toISOString(), canchaNumero: 1 }, ctx.token, 400, MSG_DIA_ZONA);
}

async function v19_fechaHora_r32_madrugada_sabado() {
  const ctx = await setupBase();
  const p = await crearPartido(ctx, 'r32');
  // Domingo 00:30 en el calendario: es trasnoche de la jornada del sábado
  const domingo0030 = new Date(2026, 9, 18, 0, 30, 0, 0);
  await esperarAsignado(p.id, { fechaHora: domingo0030.toISOString(), canchaNumero: 1 }, ctx.token, domingo0030, 1);
}

// ---------------------------------------------------------------------------
// fechaHora en jueves o lunes, y octavos el viernes antes de viernesInicio (18:00): 400, nunca 500
// ---------------------------------------------------------------------------
const JUEVES_20 = () => new Date(2026, 9, 15, 20, 0, 0, 0);
const LUNES_20 = () => new Date(2026, 9, 19, 20, 0, 0, 0);
const VIERNES_10 = () => new Date(2026, 9, 16, 10, 0, 0, 0);

async function rechazoPorFechaHora(tipo, fecha, mensaje) {
  const ctx = await setupBase();
  const p = await crearPartido(ctx, tipo);
  await esperarRechazo(p.id, { fechaHora: fecha.toISOString(), canchaNumero: 1 }, ctx.token, 400, mensaje);
}

const v23_jueves_zona = () => rechazoPorFechaHora('zona', JUEVES_20(), MSG_DIA_ZONA);
const v24_jueves_octavos = () => rechazoPorFechaHora('octavos', JUEVES_20(), MSG_DIA_OCTAVOS);
const v25_lunes_zona = () => rechazoPorFechaHora('zona', LUNES_20(), MSG_DIA_ZONA);
const v26_lunes_octavos = () => rechazoPorFechaHora('octavos', LUNES_20(), MSG_DIA_OCTAVOS);
const v28_viernes_antes_inicio_octavos = () => rechazoPorFechaHora('octavos', VIERNES_10(), MSG_DIA_OCTAVOS);

async function v20_sin_tipo_sin_restriccion_dia() {
  const ctx = await setupBase();
  const p = await crearPartido(ctx, 'sinTipo');
  await esperarAsignado(p.id, { slotId: 'Domingo-10:00', canchaNumero: 1 }, ctx.token, fechaSlot(ctx, 'Domingo-10:00'), 1);
}

// ---------------------------------------------------------------------------
// GET /torneos/:id/canchas-disponibles: canchas por jornada lógica
// ---------------------------------------------------------------------------
async function getCanchasDisponibles(ctx) {
  const res = await fetch(`${BASE_URL}/torneos/${ctx.torneo.id}/canchas-disponibles`, {
    headers: { Authorization: `Bearer ${ctx.token}` },
  });
  const json = await res.json();
  assert.strictEqual(res.status, 200, `HTTP esperado 200, recibido ${res.status} (${JSON.stringify(json)})`);
  return json;
}

function assertSlotCanchas(data, slotId, canchasEsperadas) {
  const s = data.slots.find((x) => x.slotId === slotId);
  assert.ok(s, `No se encontró el turno ${slotId}`);
  assert.strictEqual(s.totalCanchas, canchasEsperadas.length, `${slotId}: totalCanchas esperado ${canchasEsperadas.length}, recibido ${s.totalCanchas}`);
  assert.deepStrictEqual(s.canchasLibres, canchasEsperadas, `${slotId}: canchasLibres esperado [${canchasEsperadas}], recibido [${s.canchasLibres}]`);
}

async function v21_canchas_lluvia_solo_sabado() {
  const ctx = await setupBase();
  await lluvia(ctx, DIA_SABADO, 2);
  // Igual que reprogramarPorReduccionCanchas: el campo legacy queda con el último override. No debe leerse.
  await prisma.torneo.update({ where: { id: ctx.torneo.id }, data: { canchasDisponiblesOverride: 2 } });

  const data = await getCanchasDisponibles(ctx);
  assertSlotCanchas(data, 'Viernes-20:00', [1, 2, 3, 4]);
  assertSlotCanchas(data, 'Sabado-18:00', [1, 2]);
  assertSlotCanchas(data, 'Sabado-00:30', [1, 2]);
  assertSlotCanchas(data, 'Domingo-10:00', [1, 2, 3, 4]);
  assert.strictEqual(data.cantidadCanchas, 4, `cantidadCanchas esperado 4 (club), recibido ${data.cantidadCanchas}`);
}

async function v22_canchas_lluvia_sabado_y_domingo() {
  const ctx = await setupBase();
  await lluvia(ctx, DIA_SABADO, 2);
  await lluvia(ctx, DIA_DOMINGO, 3);
  await prisma.torneo.update({ where: { id: ctx.torneo.id }, data: { canchasDisponiblesOverride: 3 } });

  const data = await getCanchasDisponibles(ctx);
  assertSlotCanchas(data, 'Viernes-20:00', [1, 2, 3, 4]);
  assertSlotCanchas(data, 'Sabado-18:00', [1, 2]);
  assertSlotCanchas(data, 'Sabado-00:30', [1, 2]);
  assertSlotCanchas(data, 'Domingo-10:00', [1, 2, 3]);
  assert.strictEqual(data.cantidadCanchas, 4, `cantidadCanchas esperado 4 (club), recibido ${data.cantidadCanchas}`);
}

async function run() {
  await ensureTestDb();
  resetTestDb();
  const { server, baseUrl } = await startTestServer();
  BASE_URL = baseUrl;

  console.log('='.repeat(85));
  console.log('🧪 SUITE OFICIAL: BLOQUEOS EN ASIGNAR HORARIO MANUAL (ESTADO, DÍA Y LLUVIA)');
  console.log('='.repeat(85));

  const allTests = [
    { nombre: 'v1: partido EN_CURSO -> 400', fn: v1_en_curso },
    { nombre: 'v2: partido FINALIZADO -> 400', fn: v2_finalizado },
    { nombre: 'v3: partido PENDIENTE válido -> 200 (control)', fn: v3_pendiente_valido },
    { nombre: 'v4: zona en Domingo -> 400', fn: v4_zona_domingo },
    { nombre: 'v5: zona en Sábado -> 200', fn: v5_zona_sabado },
    { nombre: 'v6: zona en Sabado-00:30 (trasnoche del sábado) -> 200', fn: v6_zona_trasnoche_sabado },
    { nombre: 'v7: dieciseisavos en Viernes -> 400', fn: v7_r32_viernes },
    { nombre: 'v8: dieciseisavos en Sábado -> 200', fn: v8_r32_sabado },
    { nombre: 'v8b: dieciseisavos en Domingo -> 400', fn: v8b_r32_domingo },
    { nombre: 'v8c: dieciseisavos en Sabado-00:30 (trasnoche del sábado) -> 200', fn: v8c_r32_trasnoche_sabado },
    { nombre: 'v9: octavos en Sábado -> 400', fn: v9_octavos_sabado },
    { nombre: 'v10: octavos en Domingo -> 200', fn: v10_octavos_domingo },
    { nombre: 'v11: lluvia sábado 2 canchas, cancha 3 el sábado -> 400', fn: v11_lluvia_sabado_cancha_cerrada },
    { nombre: 'v12: lluvia sábado 2 canchas, cancha 2 el sábado -> 200', fn: v12_lluvia_sabado_cancha_activa },
    { nombre: 'v13: lluvia sábado, cancha 3 el viernes -> 200 (otra jornada)', fn: v13_lluvia_sabado_cancha3_viernes },
    { nombre: 'v14: lluvia domingo, eliminatoria en cancha cerrada -> 400', fn: v14_lluvia_domingo_eliminatoria },
    { nombre: 'v15: lluvia sábado, cancha cerrada en Sabado-01:00 -> 400', fn: v15_lluvia_sabado_trasnoche },
    { nombre: 'v16: FINALIZADO en cancha cerrada y día inválido -> mensaje de estado', fn: v16_finalizado_en_cancha_cerrada },
    { nombre: 'v17: organizador ajeno -> 403 sin cambios', fn: v17_organizador_ajeno_403 },
    { nombre: 'v17b: partido inexistente -> 404 sin cambios', fn: v17b_partido_inexistente_404 },
    { nombre: 'v18: fechaHora (sin slotId) zona en domingo -> 400 por día', fn: v18_fechaHora_zona_domingo },
    { nombre: 'v19: fechaHora domingo 00:30 (trasnoche del sábado) dieciseisavos -> 200', fn: v19_fechaHora_r32_madrugada_sabado },
    { nombre: 'v20: partido sin zona ni fase en Domingo -> 200 (sin restricción de día)', fn: v20_sin_tipo_sin_restriccion_dia },
    { nombre: 'v23: fechaHora jueves, zona -> 400', fn: v23_jueves_zona },
    { nombre: 'v24: fechaHora jueves, octavos -> 400', fn: v24_jueves_octavos },
    { nombre: 'v25: fechaHora lunes, zona -> 400', fn: v25_lunes_zona },
    { nombre: 'v26: fechaHora lunes, octavos -> 400', fn: v26_lunes_octavos },
    { nombre: 'v28: fechaHora viernes 10:00 (antes de 18:00), octavos -> 400', fn: v28_viernes_antes_inicio_octavos },
    { nombre: 'v21: canchas-disponibles con lluvia solo el sábado', fn: v21_canchas_lluvia_solo_sabado },
    { nombre: 'v22: canchas-disponibles con lluvia sábado y domingo distintas', fn: v22_canchas_lluvia_sabado_y_domingo },
  ];

  const resultados = [];
  const fallasDetalle = [];

  for (const t of allTests) {
    try {
      await t.fn();
      resultados.push({ caso: t.nombre, estado: 'PASS', detalle: 'OK' });
    } catch (err) {
      const msg = err.message || String(err);
      resultados.push({ caso: t.nombre, estado: 'FAIL', detalle: msg.split('\n')[0].slice(0, 60) });
      fallasDetalle.push({ caso: t.nombre, error: err });
    }
  }

  await limpiarDb();
  await new Promise((resolve) => server.close(resolve));
  await prisma.$disconnect();

  console.log('\n' + '='.repeat(85));
  console.log('📊 RESUMEN DE BLOQUEOS EN ASIGNAR HORARIO MANUAL:');
  console.log('='.repeat(85));
  console.table(resultados);

  if (fallasDetalle.length > 0) {
    console.log(`\n❌ ${fallasDetalle.length}/${allTests.length} casos fallaron.`);
    for (const f of fallasDetalle) {
      console.error(`🔴 [${f.caso}] ${(f.error.message || '').split('\n')[0]}`);
    }
    return false;
  }
  console.log(`\n✅ ${allTests.length}/${allTests.length} casos pasaron.`);
  return true;
}

if (require.main === module) {
  run()
    .then((ok) => process.exit(ok ? 0 : 1))
    .catch((e) => {
      console.error('Error fatal en test-asignar-horario-manual-bloqueos.js:', e);
      process.exit(1);
    });
}

module.exports = { run };
