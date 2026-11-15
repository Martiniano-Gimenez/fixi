'use strict';

require('./utils/testEnvGuard');
const { ensureTestDb } = require('./utils/testEnvGuard');
const { resetTestDb } = require('./reset-test-db');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const prisma = require('../src/lib/prisma');
const { JWT_SECRET } = require('../src/config/env');
const { startTestServer } = require('./utils/testServer');
const overrides = require('../src/services/canchasOverrides.service');
const scheduler = require('../src/services/eliminatoriaScheduler.service');
const { getDiaCalendarioConTrasnoche } = require('../src/utils/dateUtils');
const { obtenerDescansoMinimoRequeridoMs } = require('../src/utils/bracketWarnings');

const VIE = '2027-01-08', SAB = '2027-01-09', DOM = '2027-01-10';
const D = 75 * 60_000;
const fecha = (dia, hora) => new Date(`${dia}T${hora}:00-03:00`);
const SETS = { sets: [{ gamesPareja1: 6, gamesPareja2: 0 }, { gamesPareja1: 6, gamesPareja2: 0 }] };
let baseUrl, org, torneo, A, B, reloj = +fecha(VIE, '08:00');
const tieneHorario = (p) => Boolean(p.fechaHora && p.canchaNumero && !p.sinHorarioAsignado);
const clave = (p) => `${p.faseEliminatoria.ronda}:${p.posicionEnRonda}`;
const partidos = (categoriaId) => prisma.partido.findMany({ where: { categoriaId, faseEliminatoriaId: { not: null } },
  include: { faseEliminatoria: true }, orderBy: [{ faseEliminatoria: { ronda: 'desc' } }, { posicionEnRonda: 'asc' }] });
async function http(method, ruta, body) {
  const r = await fetch(`${baseUrl}${ruta}`, { method, headers: { 'Content-Type': 'application/json',
    Authorization: `Bearer ${jwt.sign({ id: org.id }, JWT_SECRET, { expiresIn: '1h' })}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await r.json();
  assert.ok(r.status >= 200 && r.status < 300, `${method} ${ruta}: ${r.status} ${JSON.stringify(json)}`);
  return { status: r.status, json };
}
const generar = (cat) => http('POST', `/categorias/${cat.id}/generar-eliminatoria`, {});
const borrar = (cat) => http('DELETE', `/categorias/${cat.id}/fases-eliminatorias`);
const jornada = (p) => getDiaCalendarioConTrasnoche(p.fechaHora, org).key;
const cobertura = (ps) => ps.filter((p) => !p.esBye && tieneHorario(p)).reduce((out, p) => {
  const k = `${p.faseEliminatoria.ronda}:${jornada(p)}`;
  out[k] = (out[k] || 0) + 1;
  return out;
}, {});

async function invariantes() {
  const todos = await prisma.partido.findMany({ where: { categoria: { torneoId: torneo.id } }, include: { faseEliminatoria: true } });
  const reales = todos.filter((p) => !p.esBye && tieneHorario(p));
  for (let i = 0; i < reales.length; i++) {
    const p = reales[i];
    const canchas = overrides.getCanchasDia(torneo.id, jornada(p), org.cantidadCanchas).canchas;
    assert.ok(p.canchaNumero <= canchas, 'No hay canchas cerradas en la programación');
    for (const q of reales.slice(i + 1)) {
      if (+p.fechaHora < +q.fechaHora + D && +q.fechaHora < +p.fechaHora + D) {
        assert.notEqual(p.canchaNumero, q.canchaNumero, `Cancha superpuesta: ${p.id} y ${q.id}`);
        for (const id of [p.pareja1Id, p.pareja2Id].filter(Boolean)) {
          assert.ok(id !== q.pareja1Id && id !== q.pareja2Id, 'No hay parejas superpuestas');
        }
      }
    }
  }
  const elims = todos.filter((p) => p.faseEliminatoriaId);
  const idx = new Map(elims.map((p) => [`${p.categoriaId}:${clave(p)}`, p]));
  for (const hijo of elims.filter((p) => !p.esBye && tieneHorario(p))) {
    const ronda = hijo.faseEliminatoria.ronda;
    for (const pos of [2 * hijo.posicionEnRonda - 1, 2 * hijo.posicionEnRonda]) {
      const padre = idx.get(`${hijo.categoriaId}:${ronda * 2}:${pos}`);
      if (padre && !padre.esBye && tieneHorario(padre)) {
        assert.ok(+hijo.fechaHora - +padre.fechaHora - D >= obtenerDescansoMinimoRequeridoMs(ronda * 2, ronda), 'Descanso entre rondas');
      }
    }
  }
  for (const p of elims.filter((p) => !p.esBye && !tieneHorario(p))) {
    assert.equal(p.sinHorarioAsignado, true, 'Lo que no entra queda marcado sin horario');
  }
}

async function verificarDias(cat, primeraRonda) {
  const ps = await partidos(cat.id);
  for (const p of ps.filter((p) => !p.esBye && tieneHorario(p))) {
    assert.equal(jornada(p), p.faseEliminatoria.ronda >= 32 ? SAB : DOM);
    assert.ok(+p.fechaHora >= reloj, 'No se asignan horarios anteriores a la hora de la operación');
    if (p.faseEliminatoria.ronda >= 32) {
      assert.ok(+p.fechaHora >= +fecha(SAB, '20:45'));
      const zonas = await prisma.partido.findMany({ where: { categoriaId: cat.id, zonaId: { not: null }, esBye: false } });
      assert.ok(+p.fechaHora >= Math.max(...zonas.filter(tieneHorario).map((z) => +z.fechaHora + D)), 'R32 después del cierre de las zonas');
    }
  }
  assert.equal(Math.max(...ps.map((p) => p.faseEliminatoria.ronda)), primeraRonda);
  await invariantes();
  return cobertura(ps);
}

async function crearCategoria(nombre, cantidad) {
  const cat = await prisma.categoria.create({ data: { torneoId: torneo.id, nombre } });
  for (let orden = 1; orden <= cantidad; orden++) {
    await prisma.pareja.create({ data: { categoriaId: cat.id, orden, jugador1: `${nombre} ${orden}`, jugador2: `Pareja ${orden}` } });
  }
  return cat;
}

async function run() {
  await ensureTestDb();
  resetTestDb();
  const originalNow = Date.now;
  Date.now = () => reloj;
  org = await prisma.organizador.create({ data: { nombre: 'Club regeneración', email: 'regenerar@example.com', passwordHash: 'test', cantidadCanchas: 6,
    viernesInicio: '09:00', viernesFin: '23:00', sabadoInicio: '09:00', sabadoFin: '02:00', domingoInicio: '09:00', domingoFin: '23:00' } });
  torneo = await prisma.torneo.create({ data: { organizadorId: org.id, nombre: 'Regeneración', slug: 'regeneracion-r32', fecha: fecha(VIE, '12:00') } });
  A = await crearCategoria('5ta', 36);
  B = await crearCategoria('7ma', 18);
  const { server, baseUrl: url } = await startTestServer();
  baseUrl = url;
  try {
    await http('POST', `/torneos/${torneo.id}/iniciar`, {});
    const inicialA = await verificarDias(A, 32);
    const inicialB = await verificarDias(B, 16);
    assert.equal(Object.values(inicialA).reduce((a, b) => a + b, 0), 23);
    assert.equal(Object.values(inicialB).reduce((a, b) => a + b, 0), 11);
    console.log('PASS inicio normal: cobertura por ronda y jornada', JSON.stringify({ A: inicialA, B: inicialB }));

    const bAntes = await partidos(B.id);
    await borrar(A);
    const regenerado = await generar(A);
    assert.equal(regenerado.status, 201);
    assert.ok(regenerado.json.schedulingResult.partidosAgendados > 0);
    assert.deepEqual(await verificarDias(A, 32), inicialA);
    assert.deepEqual(await partidos(B.id), bAntes, 'La otra categoría no cambia');

    // La estructura del cuadro sigue existiendo: el resultado de la última zona debe programarlo
    // aunque le falten todos los horarios, como en el cuadro regenerado de la auditoría.
    await prisma.partido.updateMany({ where: { categoriaId: A.id, faseEliminatoriaId: { not: null }, esBye: false },
      data: { fechaHora: null, canchaNumero: null, sinHorarioAsignado: true } });
    const zonas = await prisma.partido.findMany({ where: { categoriaId: A.id, zonaId: { not: null } }, orderBy: [{ zona: { nombre: 'asc' } }, { posicionEnRonda: 'asc' }] });
    let ultimo;
    for (const p of zonas) ultimo = await http('PUT', `/partidos/${p.id}/resultado`, SETS);
    assert.ok(ultimo.json.schedulingResult.partidosAgendados > 0, 'La respuesta automática informa la programación');
    assert.deepEqual(await verificarDias(A, 32), inicialA);
    console.log('PASS regeneración manual y asignación automática: misma cobertura y días que al iniciar, sin solapes');

    let ps = await partidos(A.id);
    const r32 = ps.filter((p) => !p.esBye && p.faseEliminatoria.ronda === 32);
    const manual = r32[0];
    await http('PUT', `/partidos/${manual.id}/asignar-horario-manual`, { fechaHora: manual.fechaHora, canchaNumero: manual.canchaNumero });
    await http('PATCH', `/partidos/${r32[1].id}/estado`, { estado: 'EN_CURSO' });
    await http('PUT', `/partidos/${r32[2].id}/resultado`, SETS);
    const protegidos = await partidos(A.id);
    const libre = r32[3];
    await prisma.partido.update({ where: { id: libre.id }, data: { fechaHora: null, canchaNumero: null, sinHorarioAsignado: true } });
    await generar(A);
    ps = await partidos(A.id);
    for (const p of protegidos.filter((p) => p.id !== libre.id)) {
      assert.deepEqual(ps.find((q) => q.id === p.id), p, 'Los cruces con horario, manuales y jugados se conservan');
    }
    assert.equal(ps.find((p) => p.id === manual.id).horarioManual, true);
    assert.deepEqual(await verificarDias(A, 32), inicialA);

    // Borrar elimina los partidos: la marca manual no sobrevive a esa eliminación, por diseño actual.
    await borrar(A);
    assert.equal(await prisma.partido.count({ where: { id: manual.id } }), 0);
    await prisma.overrideCanchasDia.create({ data: { torneoId: torneo.id, diaKey: SAB, canchas: 2, activoDesde: fecha(SAB, '09:00') } });
    await overrides.loadFromDb();
    await generar(A);
    assert.deepEqual(await verificarDias(A, 32), inicialA);
    assert.ok((await partidos(A.id)).filter((p) => p.faseEliminatoria.ronda === 32 && !p.esBye).every((p) => p.canchaNumero <= 2));
    assert.ok((await partidos(A.id)).every((p) => !p.horarioManual));
    console.log('PASS cruces existentes protegidos; después de borrar se recrean; lluvia del sábado usa solo las dos canchas activas');

    await borrar(B);
    await generar(B);
    assert.deepEqual(await verificarDias(B, 16), inicialB, 'Los octavos mantienen su cobertura habitual');

    // Inicio mínimo por hora real y fin de zonas; la capacidad insuficiente se informa.
    reloj = +fecha(SAB, '22:00');
    await borrar(A);
    await prisma.partido.update({ where: { id: zonas.at(-1).id }, data: { fechaHora: fecha(SAB, '22:00'), canchaNumero: 1 } });
    const tarde = await generar(A);
    assert.ok(tarde.json.schedulingResult.partidosSinHorario > 0);
    await verificarDias(A, 32);
    const conTurno = (await partidos(A.id)).filter((p) => !p.esBye && p.faseEliminatoria.ronda === 32 && tieneHorario(p));
    assert.ok(conTurno.length > 0 && conTurno.length < 8);
    assert.ok(conTurno.every((p) => +p.fechaHora >= +fecha(SAB, '23:15')));
    reloj = +fecha(DOM, '13:07');
    await borrar(A);
    await generar(A);
    await verificarDias(A, 32);
    console.log('PASS hora real, cierre de zonas, descansos y resumen de lo que no entra');

    await borrar(A);
    const originalScheduler = scheduler.programarHorariosEliminatorias;
    const originalWarn = console.warn;
    const avisos = [];
    console.warn = (...args) => avisos.push(args.join(' '));
    scheduler.programarHorariosEliminatorias = async (_org, _torneo, cat, tx) => {
      const p = await tx.partido.findFirst({ where: { categoriaId: cat, esBye: false, faseEliminatoriaId: { not: null } } });
      await tx.partido.update({ where: { id: p.id }, data: { fechaHora: fecha(DOM, '15:00'), canchaNumero: 1, sinHorarioAsignado: false } });
      throw new Error('Fallo programado de prueba');
    };
    try {
      const fallido = await generar(A);
      assert.equal(fallido.json.schedulingResult, null);
      assert.equal((await partidos(A.id)).length, 31, 'El cuadro generado no se deshace');
      assert.ok((await partidos(A.id)).filter((p) => !p.esBye).every((p) => !p.fechaHora), 'La transacción de horarios fallida se revierte completa');
      const automatico = await http('PUT', `/partidos/${zonas[0].id}/resultado`, { sets: [{ gamesPareja1: 6, gamesPareja2: 1 }, { gamesPareja1: 6, gamesPareja2: 1 }] });
      assert.equal(automatico.json.schedulingResult, null);
      assert.ok(avisos.length >= 2 && avisos.every((a) => a.includes('Fallo programado de prueba')));
      assert.equal(await prisma.setPartido.count({ where: { partidoId: zonas[0].id, gamesPareja2: 1 } }), 2, 'El resultado se conserva aunque falle la programación posterior');
    } finally {
      scheduler.programarHorariosEliminatorias = originalScheduler;
      console.warn = originalWarn;
    }
    console.log('PASS fallos en los dos caminos: cuadro y resultados conservados, programación revertida y aviso registrado');
  } finally {
    Date.now = originalNow;
    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
  }
}

run().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
