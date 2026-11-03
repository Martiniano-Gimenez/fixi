'use strict';
const { ensureTestDb } = require('./utils/testEnvGuard');
const assert = require('node:assert/strict');
const { reacomodarPrecheck } = require('../src/utils/reacomodarPrecheck');
const { slotIdToMsWindow } = require('../src/services/zona.service');
const prisma = require('../src/lib/prisma');
const svc = require('../src/services/organizador.service');
const FECHA = new Date('2026-11-06T15:00:00Z');
const ms = (s) => slotIdToMsWindow(s, FECHA).startMs;
function entrada(cadena = false) {
  const parejasMap = new Map();
  const categoriasPlan = [];
  function zona(nombre, slots, fechaHora) {
    const ids = [1, 2].map((i) => `${nombre}-${i}`);
    for (const [i, id] of ids.entries()) parejasMap.set(id, { id, orden: i + 1, jugador1: nombre, jugador2: String(i),
      slotsSeleccionados: slots.map((slotId) => ({ slotId })) });
    const p = { posicionEnRonda: 1, pareja1Id: ids[0], pareja2Id: ids[1], fechaHora: fechaHora ? new Date(ms(fechaHora)) : null,
      canchaNumero: fechaHora ? 1 : null, sinHorarioAsignado: !fechaHora };
    categoriasPlan.push({ nombre, categoriaId: nombre, zonas: [{ nombre: 'Zona A', id: nombre, formato: 'ROUND_ROBIN', parejaIds: ids, partidos: [p] }] });
    return p;
  }
  const donante = zona('A', ['Viernes-09:00', cadena ? 'Viernes-12:00' : 'Viernes-10:15', 'Sabado-09:00'], 'Viernes-09:00');
  const objetivo = zona('B', ['Viernes-09:00'], null);
  if (cadena) zona('C', ['Viernes-12:00', 'Viernes-13:15'], 'Viernes-12:00');
  return { categoriasPlan, parejasMap, refFecha: FECHA, organizador: {
    cantidadCanchas: 1, viernesInicio: '09:00', viernesFin: '14:30', sabadoInicio: '09:00', sabadoFin: '14:30',
  }, donante, objetivo };
}
async function main() {
  await ensureTestDb();
  const e = entrada(), r = reacomodarPrecheck(e);
  assert.equal(r.resueltos, 1); assert.equal(r.movimientos, 1);
  assert.equal(+e.objetivo.fechaHora, ms('Viernes-09:00')); assert.equal(+e.donante.fechaHora, ms('Viernes-10:15'));
  assert.equal(reacomodarPrecheck(e).resueltos, 0, 'Idempotencia');
  for (const marca of ['fijadoManual', 'horarioManual']) {
    const f = entrada(); f.donante[marca] = true;
    assert.equal(reacomodarPrecheck(f).resueltos, 0, `Respeta ${marca}, incluidas propuestas aplicadas`);
  }
  const manual = entrada(); manual.objetivo.pendienteManual = true;
  assert.equal(reacomodarPrecheck(manual).resueltos, 0, 'No reasigna lo quitado');
  const jornada = entrada(); jornada.externos = [{ fechaHora: new Date(ms('Viernes-10:15')), canchaNumero: 1 }];
  assert.equal(reacomodarPrecheck(jornada).resueltos, 0, 'No mueve al sabado ni a cancha externa ocupada');
  const limite = entrada(); assert.equal(reacomodarPrecheck({ ...limite, maxNodos: 0 }).resueltos, 0);
  assert.equal(limite.donante.sinHorarioAsignado, false); assert.equal(limite.objetivo.fechaHora, null, 'No adopta parciales');
  const cadena = entrada(true); assert.equal(reacomodarPrecheck(cadena).resueltos, 0);
  assert.equal(reacomodarPrecheck({ ...cadena, maxMovimientos: 2 }).resueltos, 1);
  const permutado = entrada(); permutado.categoriasPlan.reverse(); permutado.parejasMap = new Map([...permutado.parejasMap].reverse());
  reacomodarPrecheck(permutado);
  assert.equal(+permutado.donante.fechaHora, +e.donante.fechaHora, 'Orden determinista');
  // P3 y P4 simultáneos son válidos; mover una base después de ellos está prohibido.
  const mini = entrada(); mini.organizador.cantidadCanchas = 2;
  const z = mini.categoriasPlan[0].zonas[0]; z.formato = 'MINI_BRACKET';
  const ids = ['mini3', 'mini4']; z.parejaIds.push(...ids);
  for (const [i, id] of ids.entries()) mini.parejasMap.set(id, { id, orden: i + 3, slotsSeleccionados: [{ slotId: 'Viernes-09:00' }, { slotId: 'Viernes-10:15' }] });
  z.partidos.push({ posicionEnRonda: 2, pareja1Id: ids[0], pareja2Id: ids[1], fechaHora: new Date(ms('Viernes-09:00')), canchaNumero: 2, sinHorarioAsignado: false, fijadoManual: true },
    ...[3, 4].map((pos) => ({ posicionEnRonda: pos, fechaHora: new Date(ms('Viernes-10:15')), canchaNumero: pos - 2, sinHorarioAsignado: false, fijadoManual: true })));
  assert.equal(reacomodarPrecheck(mini).resueltos, 0, 'No desplaza una base después de definiciones fijadas');
  // Mismo fixture sin objetivo: conserva P3/P4 simultáneos y todos los fijos.
  mini.categoriasPlan.pop();
  const p3 = z.partidos.find((p) => p.posicionEnRonda === 3), p4 = z.partidos.find((p) => p.posicionEnRonda === 4);
  Object.assign(p3, { fijadoManual: false, fechaHora: null, canchaNumero: null, sinHorarioAsignado: true });
  assert.equal(reacomodarPrecheck(mini).resueltos, 1);
  assert.equal(+p3.fechaHora, +p4.fechaHora); assert.notEqual(p3.canchaNumero, p4.canchaNumero, 'P3/P4 simultaneos con participantes disjuntos');
  const antes = JSON.stringify(mini.categoriasPlan);
  assert.equal(reacomodarPrecheck(mini).resueltos, 0); assert.equal(JSON.stringify(mini.categoriasPlan), antes);
  // Sin bases, una definición pendiente no tiene dominio utilizable.
  const sinBases = structuredClone(mini);
  const zb = sinBases.categoriasPlan[0].zonas[0];
  zb.partidos[0].fechaHora = null; zb.partidos[0].sinHorarioAsignado = true; zb.partidos[0].pendienteManual = true;
  for (const p of zb.partidos.filter((p) => p.posicionEnRonda >= 3)) Object.assign(p, { fijadoManual: false, sinHorarioAsignado: true, fechaHora: null, canchaNumero: null });
  assert.equal(reacomodarPrecheck(sinBases).resueltos, 0, 'Definiciones esperan bases');
  await integracion();
  console.log('PASS: reacomodo compatible, fijos, propuestas, externos, jornada, MINI, limite, cadenas y determinismo');
}
async function integracion() {
  const org = await prisma.organizador.create({ data: { nombre: 'Reacomodo', email: 'reacomodo@test.local', passwordHash: 'test',
    cantidadCanchas: 1, viernesInicio: '09:00', viernesFin: '11:30', sabadoInicio: '09:00', sabadoFin: '11:30' } });
  const torneo = await prisma.torneo.create({ data: { organizadorId: org.id, nombre: 'Reacomodo', slug: 'reacomodo', fecha: FECHA } });
  for (const nombre of ['A', 'B']) {
    const cat = await prisma.categoria.create({ data: { torneoId: torneo.id, nombre } });
    for (let i = 1; i <= 2; i++) await prisma.pareja.create({ data: { categoriaId: cat.id, orden: i, jugador1: nombre, jugador2: String(i),
      slotsSeleccionados: { create: (nombre === 'A' ? ['Viernes-09:00', 'Viernes-10:15'] : ['Viernes-09:00']).map((slotId) => ({ slotId })) } } });
  }
  await svc.preCheckInicioTorneo(org.id, torneo.id);
  const sesion = svc.preCheckSessions.get(torneo.id);
  const a = sesion.categoriasPlan.find((c) => c.nombre === 'A').zonas[0].partidos[0];
  const b = sesion.categoriasPlan.find((c) => c.nombre === 'B').zonas[0].partidos[0];
  Object.assign(a, { fechaHora: new Date(ms('Viernes-09:00')), canchaNumero: 1, sinHorarioAsignado: false });
  Object.assign(b, { fechaHora: null, canchaNumero: null, sinHorarioAsignado: true });
  const r = await svc.preCheckInicioTorneo(org.id, torneo.id, { isReCheck: true });
  assert.equal(r.bloqueado, false); assert.equal(+a.fechaHora, ms('Viernes-10:15')); assert.equal(+b.fechaHora, ms('Viernes-09:00'));
  const fila = await prisma.precheckPlan.findUnique({ where: { torneoId: torneo.id } });
  assert.equal(fila.contenido.categoriasPlan.flatMap((c) => c.zonas.flatMap((z) => z.partidos)).filter((p) => p.sinHorarioAsignado).length, 0);
  Object.assign(a, { fechaHora: new Date(ms('Viernes-09:00')), fijadoManual: true });
  Object.assign(b, { fechaHora: null, canchaNumero: null, sinHorarioAsignado: true });
  assert.equal((await svc.preCheckInicioTorneo(org.id, torneo.id)).bloqueado, true);
  assert.equal(b.fechaHora, null, 'El re-check respeta el fijo');
}
main().then(async () => { await prisma.$disconnect(); process.exit(0); }).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
