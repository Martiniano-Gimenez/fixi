'use strict';

/**
 * test-padres-hijo-fijo.js
 * Un partido de eliminatoria ya fijo (FINALIZADO, EN_CURSO o con horario manual) le pone un techo a toda su
 * cadena de antecesores: cada antecesor tiene que terminar, más el descanso mínimo de la ronda siguiente, antes
 * del inicio de su hijo (techoInicio = inicioHijo - descanso - 75 min, encadenado hacia atrás). Si algún
 * antecesor no entra antes del techo de un hijo manual PENDIENTE, el hijo pierde horarioManual, se reprograma
 * después de sus padres y aparece en cambios. "Iniciar" (PATCH /partidos/:id/estado a EN_CURSO) exige las dos
 * parejas.
 *
 * Torneo del viernes 16/10/2026, club de 4 canchas. Salvo H5, H7, H8, H9 y H10: domingo 10:00-23:00, categoría A de
 * 24 parejas (octavos, cuartos, semis y final) y B de 6 (semis y final). Caminos de la app: asignación manual
 * (PUT /partidos/:id/asignar-horario-manual), lluvia del domingo (POST /torneos/:id/canchas-override con
 * diaKey), reprogramar la categoría (POST /categorias/:id/generar-eliminatoria), resultados
 * (PUT /partidos/:id/resultado) y estado (PATCH /partidos/:id/estado).
 *
 * H1  Final de A fijada a mano en su turno (20:00) y lluvia del domingo a 2 canchas.
 * H2  Cuartos A#4 fijados a mano a las 15:00 y lluvia del domingo a 1 y a 2 canchas.
 * H3  Sin lluvia: final de A fijada a mano y cuartos A#1 movidos a mano a las 18:45; reprogramar A.
 * H4  Sin lluvia: final de A fijada a mano justo al terminar sus semis (18:45, descanso 0); reprogramar A.
 * H5  Como H1 con el domingo hasta las 21:00 (las semis no entran antes del cierre): la final manual no puede
 *     quedar con horario y sus semis sin horario sin moverse ni avisar.
 * H6  Control: cuartos A#1 fijados a mano en su turno (13:45) y lluvia del domingo a 2: sus octavos entran
 *     antes del techo y los cuartos no se mueven.
 * H7  "Iniciar" exige las dos parejas; EN_CURSO -> PENDIENTE sigue permitido sin condición.
 * H8  Una semi de primera ronda no se puede iniciar antes de que terminen las zonas, y al terminarlas recibe
 *     sus parejas.
 * H9  Cadena de antecesores: categoría de 18 parejas (4 octavos con BYE), final fijada a mano a las 17:30;
 *     reprogramar A. Solo entra si los cuartos (abuelos de la final) se adelantan a las 12:30: la final
 *     conserva su horario manual.
 * H10 Estado histórico de padre pendiente con un hijo EN_CURSO (domingo 10:00-12:30, A y B de 6 parejas): la lluvia del domingo lo
 *     deja sin horario y en partidosSinSlot del domingo con su motivo; restaurar el domingo con diaKey (H10a) o
 *     sin diaKey (H10b) borra el override (base y caché) y lo vuelve a programar.
 * H11 Cambiar o borrar un ganador se bloquea si el siguiente está jugado/en juego; corregir sets con el mismo
 *     ganador sigue permitido. Con el siguiente pendiente se conserva la propagación atómica y su rollback.
 *
 * En todos los casos de A se verifica que ningún par padre/hijo con horario tenga descanso menor al mínimo de la
 * ronda del hijo (obtenerDescansoMinimoRequeridoMs: 30 min antes de la final, 75 en las demás).
 */

require('./utils/testEnvGuard');
const { ensureTestDb } = require('./utils/testEnvGuard');
const { resetTestDb } = require('./reset-test-db');
const jwt = require('jsonwebtoken');
const prisma = require('../src/lib/prisma');
const partidoService = require('../src/services/partido.service');
const assertResultado = require('node:assert/strict');
const { JWT_SECRET } = require('../src/config/env');
const { startTestServer } = require('./utils/testServer');
const canchasOverridesService = require('../src/services/canchasOverrides.service');
const zonaService = require('../src/services/zona.service');
const { generarEliminatoria } = require('../src/services/faseEliminatoria.service');
const { programarHorariosEliminatorias } = require('../src/services/eliminatoriaScheduler.service');
const { obtenerDescansoMinimoRequeridoMs } = require('../src/utils/bracketWarnings');
const { parseFechaLocal } = require('../src/utils/dateUtils');

const VIE = '2026-10-16';
const SAB = '2026-10-17';
const DOM = '2026-10-18';
const D = 75 * 60 * 1000;
let BASE_URL = null;
let TOKEN = null;

function fecha(diaKey, hora) {
  const [y, m, d] = diaKey.split('-').map(Number);
  const [hh, mm] = hora.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}
const hora = (d) =>
  d ? new Date(d).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : 'sin horario';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function limpiarDb() {
  for (const m of ['setPartido', 'partido', 'faseEliminatoria', 'zonaPareja', 'zona', 'slotPareja', 'pareja', 'categoria', 'overrideCanchasDia', 'torneo', 'organizador']) {
    await prisma[m].deleteMany({});
  }
  await canchasOverridesService.loadFromDb();
}

async function http(method, path, body) {
  const r = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await r.json();
  } catch {
    json = null;
  }
  return { status: r.status, json };
}

/**
 * Club, torneo y categorías iniciadas con el cuadro creado. Los partidos de zona se agendan viernes y sábado
 * temprano (no es lo que se prueba) y después se programan las eliminatorias de todas las categorías en una
 * corrida, como iniciarTorneoMultiCategoria.
 */
async function armar({ domingo = ['10:00', '23:00'], cats = [['A', 24], ['B', 6]] } = {}) {
  await limpiarDb();
  const org = await prisma.organizador.create({
    data: {
      nombre: 'Club H',
      email: `h_${Date.now()}_${Math.random().toString(36).slice(2)}@padel.test`,
      passwordHash: 'x',
      cantidadCanchas: 4,
      viernesInicio: '18:00',
      viernesFin: '23:00',
      sabadoInicio: '09:00',
      sabadoFin: '24:00',
      domingoInicio: domingo[0],
      domingoFin: domingo[1],
    },
  });
  const torneo = await prisma.torneo.create({
    data: { organizadorId: org.id, nombre: 'Torneo H', slug: `h-${Date.now()}-${Math.random().toString(36).slice(2)}`, fecha: parseFechaLocal(VIE), estado: 'BORRADOR' },
  });
  TOKEN = jwt.sign({ id: org.id, email: org.email }, JWT_SECRET, { expiresIn: '1h' });

  const turnos = ['18:00', '19:15', '20:30', '21:45'].map((h) => fecha(VIE, h)).concat(['09:00', '10:15', '11:30', '12:45', '14:00', '15:15'].map((h) => fecha(SAB, h)));
  const out = {};
  for (const [nombre, n] of cats) {
    const cat = await prisma.categoria.create({ data: { torneoId: torneo.id, nombre, estado: 'BORRADOR' } });
    for (let i = 1; i <= n; i++) {
      await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: `${nombre}${i}a`, jugador2: `${nombre}${i}b`, orden: i } });
    }
    await zonaService.iniciarCategoria(org.id, cat.id);
    await prisma.torneo.update({ where: { id: torneo.id }, data: { estado: 'EN_CURSO' } });
    await generarEliminatoria(org.id, cat.id);
    out[nombre] = cat;
  }
  // Zonas de todas las categorías repartidas en las 4 canchas, sin solapes
  let k = 0;
  for (const [nombre] of cats) {
    const zonas = await prisma.zona.findMany({ where: { categoriaId: out[nombre].id }, orderBy: { nombre: 'asc' } });
    for (const z of zonas) {
      const ps = await prisma.partido.findMany({ where: { zonaId: z.id }, orderBy: { posicionEnRonda: 'asc' } });
      for (const p of ps) {
        await prisma.partido.update({ where: { id: p.id }, data: { fechaHora: turnos[Math.floor(k / 4)], canchaNumero: (k % 4) + 1, sinHorarioAsignado: false } });
        k++;
      }
    }
  }
  await programarHorariosEliminatorias(org.id, torneo.id);
  return { org, torneo, cats: out };
}

const partidoDe = (catId, ronda, pos) =>
  prisma.partido.findFirst({ where: { categoriaId: catId, faseEliminatoria: { ronda }, posicionEnRonda: pos } });

async function eliminatorias(torneoId) {
  return prisma.partido.findMany({
    where: { categoria: { torneoId }, faseEliminatoriaId: { not: null } },
    include: { faseEliminatoria: true, categoria: true },
    orderBy: [{ categoria: { nombre: 'asc' } }, { faseEliminatoria: { ronda: 'desc' } }, { posicionEnRonda: 'asc' }],
  });
}

const tieneHorario = (p) => Boolean(p.fechaHora && !p.sinHorarioAsignado);

/** Pares padre/hijo (sin BYE) con los dos con horario y descanso menor al mínimo de la ronda del hijo */
async function violacionesDescanso(torneoId) {
  const el = await eliminatorias(torneoId);
  const idx = new Map(el.map((p) => [`${p.categoriaId}:${p.faseEliminatoria.ronda}:${p.posicionEnRonda}`, p]));
  const out = [];
  for (const h of el) {
    if (h.esBye || !tieneHorario(h)) continue;
    const r = h.faseEliminatoria.ronda;
    for (const pos of [2 * h.posicionEnRonda - 1, 2 * h.posicionEnRonda]) {
      const pa = idx.get(`${h.categoriaId}:${r * 2}:${pos}`);
      if (!pa || pa.esBye || !tieneHorario(pa)) continue;
      const descansoMs = new Date(h.fechaHora).getTime() - (new Date(pa.fechaHora).getTime() + D);
      const minMs = obtenerDescansoMinimoRequeridoMs(r * 2, r);
      if (descansoMs < minMs) {
        out.push(`${h.categoria.nombre} R${r * 2}#${pos} (${hora(pa.fechaHora)}) -> R${r}#${h.posicionEnRonda} (${hora(h.fechaHora)}): descanso ${descansoMs / 60000} min < ${minMs / 60000}`);
      }
    }
  }
  return out;
}

async function asignarManual(partido, fechaHora, cancha) {
  const r = await http('PUT', `/partidos/${partido.id}/asignar-horario-manual`, { fechaHora: fechaHora.toISOString(), canchaNumero: cancha });
  assert(r.status === 200, `asignar-horario-manual ${hora(fechaHora)} c${cancha}: HTTP ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
}

async function lluviaDomingo(torneo, canchas) {
  const r = await http('POST', `/torneos/${torneo.id}/canchas-override`, { canchasDisponiblesOverride: canchas, diaKey: DOM });
  assert(r.status === 200, `canchas-override domingo a ${canchas}: HTTP ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.reprogramacion.cambios || [];
}

async function reprogramarCategoria(cat) {
  const r = await http('POST', `/categorias/${cat.id}/generar-eliminatoria`);
  assert(r.status === 201, `generar-eliminatoria: HTTP ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.schedulingResult?.cambios || [];
}

/**
 * Un hijo que estaba fijado a mano: o conserva el horario manual (y entonces su cadena no tiene violaciones,
 * que se verifican aparte), o lo perdió, quedó después de sus padres con horario y figura en cambios con su
 * horario anterior.
 */
async function verificarHijoManual(hijoAntes, cambios, etiqueta) {
  const hijo = await prisma.partido.findUnique({ where: { id: hijoAntes.id }, include: { faseEliminatoria: true } });
  if (hijo.horarioManual) {
    assert(
      new Date(hijo.fechaHora).getTime() === new Date(hijoAntes.fechaHora).getTime() && hijo.canchaNumero === hijoAntes.canchaNumero,
      `${etiqueta}: conserva horarioManual pero cambió de horario o de cancha (${hora(hijo.fechaHora)} c${hijo.canchaNumero})`
    );
    return { movido: false, hijo };
  }
  const cambio = cambios.find((c) => c.partidoId === hijo.id);
  assert(cambio, `${etiqueta}: perdió horarioManual pero no figura en cambios`);
  assert(
    cambio.antes.fechaHora === new Date(hijoAntes.fechaHora).toISOString(),
    `${etiqueta}: cambios.antes.fechaHora=${cambio.antes.fechaHora}, se esperaba ${new Date(hijoAntes.fechaHora).toISOString()}`
  );
  return { movido: true, hijo };
}

// ---------------------------------------------------------------------------

async function h1_final_manual_lluvia_domingo() {
  const { torneo, cats } = await armar();
  const final = await partidoDe(cats.A.id, 2, 1);
  await asignarManual(final, final.fechaHora, 1);
  const finalAntes = await prisma.partido.findUnique({ where: { id: final.id } });
  const cambios = await lluviaDomingo(torneo, 2);
  const v = await violacionesDescanso(torneo.id);
  assert(v.length === 0, `violaciones de descanso: ${v.join(' | ')}`);
  const { movido, hijo } = await verificarHijoManual(finalAntes, cambios, 'final de A');
  if (movido) {
    const s1 = await partidoDe(cats.A.id, 4, 1);
    const s2 = await partidoDe(cats.A.id, 4, 2);
    for (const s of [s1, s2]) {
      if (tieneHorario(s) && tieneHorario(hijo)) {
        assert(new Date(hijo.fechaHora).getTime() >= new Date(s.fechaHora).getTime() + D + 30 * 60000, `final ${hora(hijo.fechaHora)} antes del fin de su semi ${hora(s.fechaHora)} + 30`);
      }
    }
  }
}

async function h2_cuartos_manuales_lluvia(canchas) {
  const { torneo, cats } = await armar();
  const q4 = await partidoDe(cats.A.id, 8, 4);
  await asignarManual(q4, fecha(DOM, '15:00'), 1);
  const q4Antes = await prisma.partido.findUnique({ where: { id: q4.id } });
  const cambios = await lluviaDomingo(torneo, canchas);
  const v = await violacionesDescanso(torneo.id);
  assert(v.length === 0, `violaciones de descanso: ${v.join(' | ')}`);
  await verificarHijoManual(q4Antes, cambios, 'cuartos A#4');
}

async function h3_reprogramar_final_y_cuartos_manuales() {
  const { torneo, cats } = await armar();
  const final = await partidoDe(cats.A.id, 2, 1);
  await asignarManual(final, final.fechaHora, final.canchaNumero);
  const q1 = await partidoDe(cats.A.id, 8, 1);
  await asignarManual(q1, fecha(DOM, '18:45'), 1);
  const finalAntes = await prisma.partido.findUnique({ where: { id: final.id } });
  const cambios = await reprogramarCategoria(cats.A);
  const v = await violacionesDescanso(torneo.id);
  assert(v.length === 0, `violaciones de descanso: ${v.join(' | ')}`);
  await verificarHijoManual(finalAntes, cambios, 'final de A');
}

async function h4_reprogramar_final_manual_descanso_cero() {
  const { torneo, cats } = await armar();
  const s1 = await partidoDe(cats.A.id, 4, 1);
  const final = await partidoDe(cats.A.id, 2, 1);
  const res = await asignarManual(final, new Date(new Date(s1.fechaHora).getTime() + D), 1);
  assert((res.advertencias || []).some((a) => a.codigo === 'DESCANSO_INSUFICIENTE_PADRE'), 'se esperaba la advertencia DESCANSO_INSUFICIENTE_PADRE al fijar la final');
  const finalAntes = await prisma.partido.findUnique({ where: { id: final.id } });
  const cambios = await reprogramarCategoria(cats.A);
  const v = await violacionesDescanso(torneo.id);
  assert(v.length === 0, `violaciones de descanso: ${v.join(' | ')}`);
  await verificarHijoManual(finalAntes, cambios, 'final de A');
}

async function h5_final_manual_semis_sin_horario() {
  const { torneo, cats } = await armar({ domingo: ['10:00', '21:00'] });
  const final = await partidoDe(cats.A.id, 2, 1);
  await asignarManual(final, final.fechaHora, 1);
  await lluviaDomingo(torneo, 2);
  const f = await prisma.partido.findUnique({ where: { id: final.id } });
  const semis = [await partidoDe(cats.A.id, 4, 1), await partidoDe(cats.A.id, 4, 2)];
  const semisSinHorario = semis.filter((s) => !tieneHorario(s));
  if (f.horarioManual && tieneHorario(f) && semisSinHorario.length > 0) {
    const r = await http('GET', `/categorias/${cats.A.id}/fases-eliminatorias`);
    const pf = (r.json || []).find((fa) => fa.ronda === 2)?.partidos?.[0];
    assert(
      (pf?.advertencias || []).length > 0,
      `la final sigue manual a las ${hora(f.fechaHora)} con ${semisSinHorario.length} semis sin horario y sin advertencias`
    );
  }
  const v = await violacionesDescanso(torneo.id);
  assert(v.length === 0, `violaciones de descanso: ${v.join(' | ')}`);
}

async function h6_control_cuartos_manuales_entran() {
  const { torneo, cats } = await armar();
  const q1 = await partidoDe(cats.A.id, 8, 1);
  await asignarManual(q1, q1.fechaHora, 1);
  const q1Antes = await prisma.partido.findUnique({ where: { id: q1.id } });
  await lluviaDomingo(torneo, 2);
  const q = await prisma.partido.findUnique({ where: { id: q1.id } });
  assert(q.horarioManual === true, 'los cuartos A#1 perdieron horarioManual aunque sus octavos entran antes del techo');
  assert(new Date(q.fechaHora).getTime() === new Date(q1Antes.fechaHora).getTime() && q.canchaNumero === q1Antes.canchaNumero, `los cuartos A#1 se movieron a ${hora(q.fechaHora)} c${q.canchaNumero}`);
  const v = await violacionesDescanso(torneo.id);
  assert(v.length === 0, `violaciones de descanso: ${v.join(' | ')}`);
}

async function cargarZonas(cat) {
  for (let vuelta = 0; vuelta < 10; vuelta++) {
    const pend = await prisma.partido.findMany({
      where: { categoriaId: cat.id, zonaId: { not: null }, estado: { not: 'FINALIZADO' }, pareja1Id: { not: null }, pareja2Id: { not: null } },
      include: { pareja1: true, pareja2: true },
    });
    if (pend.length === 0) return;
    for (const p of pend) {
      const gana1 = p.pareja1.orden < p.pareja2.orden;
      const sets = gana1 ? [{ gamesPareja1: 6, gamesPareja2: 0 }, { gamesPareja1: 6, gamesPareja2: 0 }] : [{ gamesPareja1: 0, gamesPareja2: 6 }, { gamesPareja1: 0, gamesPareja2: 6 }];
      const r = await http('PUT', `/partidos/${p.id}/resultado`, { sets });
      assert(r.status === 200, `PUT resultado zona: HTTP ${r.status}`);
    }
  }
}

const SETS_GANA_1 = { sets: [{ gamesPareja1: 6, gamesPareja2: 0 }, { gamesPareja1: 6, gamesPareja2: 0 }] };
const MSG_SIN_PAREJAS = 'El partido no tiene las parejas definidas todavía.';

async function h7_iniciar_exige_parejas() {
  const { cats } = await armar({ domingo: ['10:00', '21:00'], cats: [['A', 6], ['B', 6]] });
  const final = await partidoDe(cats.B.id, 2, 1);

  // Sin ninguna pareja
  let r = await http('PATCH', `/partidos/${final.id}/estado`, { estado: 'EN_CURSO' });
  assert(r.status === 400 && r.json?.error === MSG_SIN_PAREJAS, `sin parejas: HTTP ${r.status} ${JSON.stringify(r.json)}`);
  let f = await prisma.partido.findUnique({ where: { id: final.id } });
  assert(f.estado === 'PENDIENTE', `sin parejas: el estado cambió a ${f.estado}`);

  // Con una sola pareja (terminan las zonas y la semi 1)
  await cargarZonas(cats.B);
  const s1 = await partidoDe(cats.B.id, 4, 1);
  r = await http('PUT', `/partidos/${s1.id}/resultado`, SETS_GANA_1);
  assert(r.status === 200, `PUT resultado semi 1: HTTP ${r.status}`);
  f = await prisma.partido.findUnique({ where: { id: final.id } });
  assert(Boolean(f.pareja1Id) !== Boolean(f.pareja2Id), 'se esperaba la final con una sola pareja');
  r = await http('PATCH', `/partidos/${final.id}/estado`, { estado: 'EN_CURSO' });
  assert(r.status === 400 && r.json?.error === MSG_SIN_PAREJAS, `una pareja: HTTP ${r.status} ${JSON.stringify(r.json)}`);
  f = await prisma.partido.findUnique({ where: { id: final.id } });
  assert(f.estado === 'PENDIENTE', `una pareja: el estado cambió a ${f.estado}`);

  // Con las dos parejas
  const s2 = await partidoDe(cats.B.id, 4, 2);
  r = await http('PUT', `/partidos/${s2.id}/resultado`, SETS_GANA_1);
  assert(r.status === 200, `PUT resultado semi 2: HTTP ${r.status}`);
  r = await http('PATCH', `/partidos/${final.id}/estado`, { estado: 'EN_CURSO' });
  assert(r.status === 200, `dos parejas: HTTP ${r.status} ${JSON.stringify(r.json)}`);
  f = await prisma.partido.findUnique({ where: { id: final.id } });
  assert(f.estado === 'EN_CURSO', `dos parejas: estado ${f.estado}`);

  // EN_CURSO -> PENDIENTE sigue funcionando
  r = await http('PATCH', `/partidos/${final.id}/estado`, { estado: 'PENDIENTE' });
  assert(r.status === 200, `EN_CURSO -> PENDIENTE: HTTP ${r.status}`);

  // EN_CURSO -> PENDIENTE sin parejas (dato viejo, anterior a la regla) también
  const finalA = await partidoDe(cats.A.id, 2, 1);
  await prisma.partido.update({ where: { id: finalA.id }, data: { estado: 'EN_CURSO' } });
  r = await http('PATCH', `/partidos/${finalA.id}/estado`, { estado: 'PENDIENTE' });
  assert(r.status === 200, `EN_CURSO sin parejas -> PENDIENTE: HTTP ${r.status} ${JSON.stringify(r.json)}`);
}

async function h8_semi_primera_ronda() {
  const { cats } = await armar({ domingo: ['10:00', '21:00'], cats: [['A', 6], ['B', 6]] });
  const s1 = await partidoDe(cats.B.id, 4, 1);
  let r = await http('PATCH', `/partidos/${s1.id}/estado`, { estado: 'EN_CURSO' });
  assert(r.status === 400 && r.json?.error === MSG_SIN_PAREJAS, `antes de las zonas: HTTP ${r.status} ${JSON.stringify(r.json)}`);
  await cargarZonas(cats.B);
  const s = await prisma.partido.findUnique({ where: { id: s1.id } });
  assert(s.estado === 'PENDIENTE' && s.pareja1Id && s.pareja2Id, `después de las zonas: estado=${s.estado} parejas=${Boolean(s.pareja1Id)}/${Boolean(s.pareja2Id)}`);
  r = await http('PATCH', `/partidos/${s1.id}/estado`, { estado: 'EN_CURSO' });
  assert(r.status === 200, `después de las zonas: HTTP ${r.status} ${JSON.stringify(r.json)}`);
}

async function h9_cadena_de_antecesores() {
  const { torneo, cats } = await armar({ cats: [['A', 18]] });
  const final = await partidoDe(cats.A.id, 2, 1);
  const q = await partidoDe(cats.A.id, 8, 1);
  assert(hora(q.fechaHora) === 'dom, 13:45', `precondición: cuartos a las 13:45 (están a las ${hora(q.fechaHora)})`);
  // A las 17:30 juegan las semis en las canchas 1 y 2
  await asignarManual(final, fecha(DOM, '17:30'), 3);
  await reprogramarCategoria(cats.A);
  const f = await prisma.partido.findUnique({ where: { id: final.id } });
  assert(f.horarioManual === true && hora(f.fechaHora) === 'dom, 17:30' && f.canchaNumero === 3, `la final perdió su horario manual: ${hora(f.fechaHora)} c${f.canchaNumero} manual=${f.horarioManual}`);
  const v = await violacionesDescanso(torneo.id);
  assert(v.length === 0, `violaciones de descanso: ${v.join(' | ')}`);
}

/**
 * H10. Padre sin turno por un hijo EN_CURSO (no se puede mover): se terminan las zonas y las dos semis de A,
 * se inicia la final y se verifica que borrar la semi 2 ya se rechaza. Se siembra luego el estado histórico que
 * antes dejaba ese borrado: semi 2 pendiente y final en juego sin su segunda pareja. Con lluvia a 1 cancha, el techo de la semi 2
 * es 10:45 y a las 10:00 la cancha 1 la ocupa la semi 1 finalizada. Se verifica partidosSinSlot del domingo y la
 * restauración del domingo (con diaKey o sin diaKey).
 */
const MOTIVO_TECHO = 'Sin turno antes del partido siguiente, que ya está finalizado o en juego';

async function h10_padre_sin_turno_por_hijo_en_curso(restaurarConDiaKey) {
  const { torneo, cats } = await armar({ domingo: ['10:00', '12:30'], cats: [['A', 6], ['B', 6]] });
  await cargarZonas(cats.A);
  const s1 = await partidoDe(cats.A.id, 4, 1);
  const s2 = await partidoDe(cats.A.id, 4, 2);
  const final = await partidoDe(cats.A.id, 2, 1);
  assert(
    hora(s1.fechaHora) === 'dom, 10:00' && s1.canchaNumero === 1 && hora(final.fechaHora) === 'dom, 12:30' && final.canchaNumero === 1,
    `precondición: semi 1 ${hora(s1.fechaHora)} c${s1.canchaNumero}, final ${hora(final.fechaHora)} c${final.canchaNumero}`
  );
  for (const s of [s1, s2]) {
    const r = await http('PUT', `/partidos/${s.id}/resultado`, SETS_GANA_1);
    assert(r.status === 200, `PUT resultado semi: HTTP ${r.status}`);
  }
  let r = await http('PATCH', `/partidos/${final.id}/estado`, { estado: 'EN_CURSO' });
  assert(r.status === 200, `PATCH final EN_CURSO: HTTP ${r.status} ${JSON.stringify(r.json)}`);
  r = await http('DELETE', `/partidos/${s2.id}/resultado`);
  assert(r.status === 400 && r.json.error.includes('la Final ya está en juego'),
    `DELETE resultado semi 2 debe bloquearse: HTTP ${r.status} ${JSON.stringify(r.json)}`);
  // Antes del bloqueo, borrar esta semifinal dejaba la final en juego sin su segunda pareja.
  // Sembrar solo ese estado histórico: el scheduler debe seguir pudiendo recuperar bases anteriores.
  await prisma.$transaction(async (tx) => {
    await tx.setPartido.deleteMany({ where: { partidoId: s2.id } });
    await tx.partido.update({ where: { id: s2.id }, data: { estado: 'PENDIENTE', ganadorId: null, enJuegoDesde: null } });
    await tx.partido.update({ where: { id: final.id }, data: { pareja2Id: null, origenPareja2: null } });
  });

  await lluviaDomingo(torneo, 1);
  const s2Lluvia = await prisma.partido.findUnique({ where: { id: s2.id } });
  assert(s2Lluvia.estado === 'PENDIENTE' && !tieneHorario(s2Lluvia), `semi 2 tras la lluvia: ${s2Lluvia.estado} ${hora(s2Lluvia.fechaHora)} sinHorario=${s2Lluvia.sinHorarioAsignado}`);
  const ovDom = await prisma.overrideCanchasDia.findUnique({ where: { torneoId_diaKey: { torneoId: torneo.id, diaKey: DOM } } });
  const mapa = typeof ovDom?.partidosSinSlot === 'string' ? JSON.parse(ovDom.partidosSinSlot) : ovDom?.partidosSinSlot || {};
  assert(mapa[s2.id] === MOTIVO_TECHO, `partidosSinSlot del domingo: ${JSON.stringify(mapa)}`);

  // En-vivo no muestra el motivo de un partido sin horario (solo lo suma a pendientesSinHorario): pendiente
  // documentado en CONTEXT.md, fuera de este ticket.

  // Restaurar el domingo
  r = restaurarConDiaKey
    ? await http('POST', `/torneos/${torneo.id}/canchas-override`, { canchasDisponiblesOverride: 4, diaKey: DOM })
    : await http('POST', `/torneos/${torneo.id}/canchas-override`, { canchasDisponiblesOverride: 4 });
  assert(r.status === 200, `restaurar: HTTP ${r.status} ${JSON.stringify(r.json)}`);
  const ovDespues = await prisma.overrideCanchasDia.findMany({ where: { torneoId: torneo.id } });
  assert(ovDespues.length === 0, `quedaron overrides: ${JSON.stringify(ovDespues.map((o) => [o.diaKey, o.partidosSinSlot]))}`);
  assert(Object.keys(canchasOverridesService.getCanchasDia(torneo.id, DOM, 4).partidosSinSlot || {}).length === 0, 'la caché conserva partidosSinSlot del domingo');
  const s2Final = await prisma.partido.findUnique({ where: { id: s2.id } });
  assert(tieneHorario(s2Final), `la semi 2 no se reprogramó al restaurar: ${hora(s2Final.fechaHora)} sinHorario=${s2Final.sinHorarioAsignado}`);
  const v = await violacionesDescanso(torneo.id);
  assert(v.length === 0, `violaciones de descanso: ${v.join(' | ')}`);
}

async function testGanadorConSiguienteJugado(organizadorId, torneoId) {
  const categoria = await prisma.categoria.create({ data: {
    torneoId, nombre: 'Ganador con siguiente jugado', estado: 'EN_CURSO',
    parejas: { create: Array.from({ length: 4 }, (_, i) => ({ orden: i + 1, jugador1: `Pareja ${i + 1}`, jugador2: 'Ganador' })) },
  }, include: { parejas: { orderBy: { orden: 'asc' } } } });
  try {
    const [a, b, c, d] = categoria.parejas;
    const semis = await prisma.faseEliminatoria.create({ data: { categoriaId: categoria.id, nombre: 'Semifinal', ronda: 4 } });
    const final = await prisma.faseEliminatoria.create({ data: { categoriaId: categoria.id, nombre: 'Final', ronda: 2 } });
    const crear = (faseId, posicionEnRonda, pareja1Id = null, pareja2Id = null) => prisma.partido.create({ data: {
      categoriaId: categoria.id, faseEliminatoriaId: faseId, posicionEnRonda, pareja1Id, pareja2Id,
      origenPareja1: pareja1Id ? `1° Zona ${posicionEnRonda}` : null,
      origenPareja2: pareja2Id ? `2° Zona ${posicionEnRonda}` : null,
      fechaHora: new Date('2026-11-08T15:00:00.000Z'), canchaNumero: posicionEnRonda,
    } });
    const semi1 = await crear(semis.id, 1, a.id, b.id);
    const semi2 = await crear(semis.id, 2, c.id, d.id);
    const destino = await crear(final.id, 1);
    const gana1 = { sets: [{ gamesPareja1: 6, gamesPareja2: 2 }, { gamesPareja1: 6, gamesPareja2: 3 }] };
    const gana2 = { sets: [{ gamesPareja1: 2, gamesPareja2: 6 }, { gamesPareja1: 3, gamesPareja2: 6 }] };
    const correccion = { sets: [{ gamesPareja1: 6, gamesPareja2: 4 }, { gamesPareja1: 7, gamesPareja2: 5 }] };
    const parcial = { sets: [{ gamesPareja1: 6, gamesPareja2: 4 }] };
    const leer = () => prisma.partido.findMany({ where: { categoriaId: categoria.id }, orderBy: { id: 'asc' },
      include: { sets: { orderBy: { numero: 'asc' } } } });
    const rechazaSinCambios = async (accion, mensaje) => {
      const antes = await leer();
      await assertResultado.rejects(accion, { statusCode: 400, message: mensaje });
      assertResultado.deepEqual(await leer(), antes, 'El rechazo conserva sets, estado, ganador, inicio, horarios y ambos cruces completos');
    };
    await partidoService.cargarResultado(organizadorId, semi1.id, gana1);
    await partidoService.cargarResultado(organizadorId, semi2.id, gana1);

    for (const estado of ['FINALIZADO', 'EN_CURSO']) {
      if (estado === 'FINALIZADO') await partidoService.cargarResultado(organizadorId, destino.id, gana1);
      else {
        await partidoService.borrarResultado(organizadorId, destino.id);
        // Marcado en juego sin sets: el bloqueo depende del estado, no de tener un parcial.
        await partidoService.updateEstado(organizadorId, destino.id, 'EN_CURSO');
      }
      const mensaje = estado === 'FINALIZADO'
        ? 'No se puede cambiar el ganador: la Final ya tiene resultado. Borrá primero el resultado de la Final.'
        : 'No se puede cambiar el ganador: la Final ya está en juego. Quitalo de en juego primero.';
      await rechazaSinCambios(() => partidoService.cargarResultado(organizadorId, semi1.id, gana2), mensaje);
      await rechazaSinCambios(() => partidoService.cargarResultado(organizadorId, semi1.id, parcial), mensaje);
      await rechazaSinCambios(() => partidoService.borrarResultado(organizadorId, semi1.id), mensaje);
      const antes = await leer();
      await partidoService.cargarResultado(organizadorId, semi1.id, correccion);
      const despues = await leer();
      const corregido = despues.find((p) => p.id === semi1.id);
      assertResultado.equal(corregido.ganadorId, a.id);
      assertResultado.deepEqual(corregido.sets.map(({ gamesPareja1, gamesPareja2 }) => ({ gamesPareja1, gamesPareja2 })), correccion.sets);
      assertResultado.deepEqual(despues.filter((p) => p.id !== semi1.id), antes.filter((p) => p.id !== semi1.id),
        'Corregir sets con el mismo ganador no toca la final ni la otra semifinal');
    }

    await partidoService.updateEstado(organizadorId, destino.id, 'PENDIENTE');
    const antes = await leer();
    const transaction = prisma.$transaction;
    prisma.$transaction = (fn, ...args) => transaction.call(prisma, async (tx) => { await fn(tx); throw new Error('Fallo antes del commit del ganador'); }, ...args);
    try {
      await assertResultado.rejects(() => partidoService.cargarResultado(organizadorId, semi1.id, gana2), /Fallo antes del commit/);
    } finally { prisma.$transaction = transaction; }
    assertResultado.deepEqual(await leer(), antes, 'Un rollback revierte juntos los sets y la propagación de la pareja');

    await partidoService.cargarResultado(organizadorId, semi1.id, gana2);
    let siguiente = await prisma.partido.findUnique({ where: { id: destino.id } });
    assertResultado.equal(siguiente.estado, 'PENDIENTE');
    assertResultado.equal(siguiente.pareja1Id, b.id);
    assertResultado.equal(siguiente.origenPareja1, semi1.origenPareja2);
    assertResultado.equal(siguiente.pareja2Id, c.id);
    await partidoService.cargarResultado(organizadorId, semi2.id, gana2);
    siguiente = await prisma.partido.findUnique({ where: { id: destino.id } });
    assertResultado.equal(siguiente.pareja2Id, d.id, 'La semifinal par actualiza el segundo lugar de la final');
    await partidoService.borrarResultado(organizadorId, semi1.id);
    const borrado = (await leer()).find((p) => p.id === semi1.id);
    assertResultado.equal(borrado.estado, 'PENDIENTE'); assertResultado.equal(borrado.ganadorId, null); assertResultado.equal(borrado.enJuegoDesde, null);
    assertResultado.deepEqual(borrado.sets, []);
    siguiente = await prisma.partido.findUnique({ where: { id: destino.id } });
    assertResultado.equal(siguiente.pareja1Id, null); assertResultado.equal(siguiente.origenPareja1, null);
    assertResultado.equal(siguiente.pareja2Id, d.id);

    await partidoService.cargarResultado(organizadorId, semi1.id, gana1);
    await partidoService.cargarResultado(organizadorId, destino.id, gana1);
    await partidoService.cargarResultado(organizadorId, destino.id, gana2);
    assertResultado.equal((await prisma.partido.findUnique({ where: { id: destino.id } })).ganadorId, d.id,
      'La final no tiene partido siguiente y permite corregir su ganador');
    console.log('  ✅ Ganador protegido: siguiente finalizado/en juego, parciales, borrado, corrección de sets, destino pendiente y rollback.');
  } finally { await prisma.categoria.delete({ where: { id: categoria.id } }); }
}

async function run() {
  await ensureTestDb();
  resetTestDb();
  await canchasOverridesService.loadFromDb();
  const { server, baseUrl } = await startTestServer();
  BASE_URL = baseUrl;

  const allTests = [
    { nombre: 'H1: final manual + lluvia del domingo a 2', fn: h1_final_manual_lluvia_domingo },
    { nombre: 'H2a: cuartos manuales + lluvia del domingo a 1', fn: () => h2_cuartos_manuales_lluvia(1) },
    { nombre: 'H2b: cuartos manuales + lluvia del domingo a 2', fn: () => h2_cuartos_manuales_lluvia(2) },
    { nombre: 'H3: reprogramar con final y cuartos manuales', fn: h3_reprogramar_final_y_cuartos_manuales },
    { nombre: 'H4: reprogramar con final manual a descanso 0', fn: h4_reprogramar_final_manual_descanso_cero },
    { nombre: 'H5: final manual con semis sin horario', fn: h5_final_manual_semis_sin_horario },
    { nombre: 'H6: control, cuartos manuales cuyos octavos entran', fn: h6_control_cuartos_manuales_entran },
    { nombre: 'H7: Iniciar exige las dos parejas', fn: h7_iniciar_exige_parejas },
    { nombre: 'H8: semi de primera ronda antes y después de las zonas', fn: h8_semi_primera_ronda },
    { nombre: 'H9: techo de la cadena de antecesores', fn: h9_cadena_de_antecesores },
    { nombre: 'H10a: padre sin turno por hijo EN_CURSO, restaurar con diaKey', fn: () => h10_padre_sin_turno_por_hijo_en_curso(true) },
    { nombre: 'H10b: padre sin turno por hijo EN_CURSO, restaurar sin diaKey', fn: () => h10_padre_sin_turno_por_hijo_en_curso(false) },
    { nombre: 'H11: proteger ganador si el siguiente ya se jugó', fn: async () => {
      const { org, torneo } = await armar({ cats: [['A', 6]] });
      await testGanadorConSiguienteJugado(org.id, torneo.id);
    } },
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
      console.error('Error fatal en test-padres-hijo-fijo.js:', e);
      process.exit(1);
    });
}

module.exports = { run };
