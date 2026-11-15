'use strict';

require('./utils/testEnvGuard');
const { ensureTestDb } = require('./utils/testEnvGuard');
const { resetTestDb } = require('./reset-test-db');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const prisma = require('../src/lib/prisma');
const { JWT_SECRET } = require('../src/config/env');
const { startTestServer } = require('./utils/testServer');
const zonas = require('../src/services/zona.service');
const overrides = require('../src/services/canchasOverrides.service');
const { getSlotsValidosSet } = require('../src/services/slots.service');
const { getDiaCalendarioConTrasnoche } = require('../src/utils/dateUtils');

const VIE = '2027-01-08', SAB = '2027-01-09';
const D = 75 * 60_000;
const fecha = (dia, hora) => new Date(`${dia}T${hora}:00-03:00`);
const conHorario = (p) => Boolean(p.fechaHora && p.canchaNumero && !p.sinHorarioAsignado);
let baseUrl, numero = 0;

async function http(ctx, method, ruta, body) {
  const r = await fetch(`${baseUrl}${ruta}`, { method, headers: { 'Content-Type': 'application/json',
    Authorization: `Bearer ${jwt.sign({ id: ctx.org.id }, JWT_SECRET, { expiresIn: '1h' })}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await r.json();
  assert.ok(r.status >= 200 && r.status < 300, `${method} ${ruta}: ${r.status} ${JSON.stringify(json)}`);
  return json;
}
const todos = (ctx) => prisma.partido.findMany({ where: { categoria: { torneoId: ctx.torneo.id } },
  include: { sets: true, pareja1: { include: { slotsSeleccionados: true } }, pareja2: { include: { slotsSeleccionados: true } } }, orderBy: { id: 'asc' } });

async function escenario({ lluvia, sinLugar, sinSlots, trasnoche = false }) {
  const org = await prisma.organizador.create({ data: { email: `mover-lluvia-${++numero}@example.com`, nombre: 'Club lluvia', passwordHash: 'test', cantidadCanchas: 3,
    viernesInicio: '18:00', viernesFin: trasnoche ? '02:00' : '23:00', sabadoInicio: '09:00', sabadoFin: '16:00', domingoInicio: '09:00', domingoFin: '23:00' } });
  const torneo = await prisma.torneo.create({ data: { organizadorId: org.id, nombre: 'Lluvia', slug: `mover-lluvia-${numero}`, fecha: fecha(VIE, '12:00'), estado: 'EN_CURSO' } });
  const categoria = await prisma.categoria.create({ data: { torneoId: torneo.id, nombre: '5ta', estado: 'EN_CURSO' } });
  const otraCategoria = await prisma.categoria.create({ data: { torneoId: torneo.id, nombre: '7ma', estado: 'EN_CURSO' } });
  const amplios = [...getSlotsValidosSet(org)];
  const soloViernes = trasnoche ? ['Viernes-00:00'] : amplios.filter((s) => s.startsWith('Viernes-'));
  const slotIds = sinLugar ? soloViernes : amplios;
  let orden = 0;
  async function zona(cat, nombre, cantidad, seleccionados) {
    const z = await prisma.zona.create({ data: { categoriaId: cat.id, nombre } });
    const parejas = [];
    for (let i = 0; i < cantidad; i++) {
      const p = await prisma.pareja.create({ data: { categoriaId: cat.id, orden: ++orden, jugador1: `${nombre} ${i}`, jugador2: 'Pareja',
        slotsSeleccionados: { create: seleccionados.map((slotId) => ({ slotId })) } } });
      parejas.push(p);
      await prisma.zonaPareja.create({ data: { zonaId: z.id, parejaId: p.id } });
    }
    await zonas.generarPartidosZonaHelper(prisma, cat.id, z.id, 'ROUND_ROBIN', cantidad, parejas);
    return { ...z, parejas };
  }
  const origen = await zona(categoria, 'Zona A', 3, sinSlots ? [] : slotIds);
  const destino = await zona(categoria, 'Zona B', sinLugar ? 2 : 3, sinSlots ? [] : slotIds);
  const fija = await zona(categoria, 'Zona C', 3, amplios);
  await zona(categoria, 'Zona D', 2, amplios); // Pendiente sin horario: mover tampoco debe asignarlo.
  const otra = await zona(otraCategoria, 'Zona A', 2, amplios);
  const fijos = await prisma.partido.findMany({ where: { zonaId: fija.id }, orderBy: { posicionEnRonda: 'asc' } });
  for (const [i, p] of fijos.entries()) {
    await prisma.partido.update({ where: { id: p.id }, data: { estado: 'FINALIZADO', ganadorId: p.pareja1Id,
      fechaHora: new Date(+fecha(VIE, '18:00') + i * D), canchaNumero: 1, sinHorarioAsignado: false,
      sets: { create: [{ numero: 1, gamesPareja1: 6, gamesPareja2: 0 }, { numero: 2, gamesPareja1: 6, gamesPareja2: 0 }] } } });
  }
  const otro = await prisma.partido.findFirst({ where: { zonaId: otra.id } });
  await prisma.partido.update({ where: { id: otro.id }, data: { estado: 'EN_CURSO', fechaHora: fecha(VIE, '21:45'), canchaNumero: 1, sinHorarioAsignado: false } });
  // Estado previo a editar: pendientes de las zonas afectadas desplazados al sábado.
  for (const [i, z] of [origen, destino].entries()) {
    const ps = await prisma.partido.findMany({ where: { zonaId: z.id }, orderBy: { posicionEnRonda: 'asc' } });
    for (const [j, p] of ps.entries()) await prisma.partido.update({ where: { id: p.id }, data: {
      fechaHora: new Date(+fecha(SAB, '09:00') + j * D), canchaNumero: i + 1, sinHorarioAsignado: false,
    } });
  }
  const ctx = { org, torneo, categoria, origen, destino, slotIds, amplios };
  if (lluvia) {
    const anteriores = Object.fromEntries((await todos(ctx)).map((p) => [p.id, {
      fechaHora: p.fechaHora?.toISOString() || null, canchaNumero: p.canchaNumero, sinHorarioAsignado: p.sinHorarioAsignado,
    }]));
    await overrides.setOverrideDia(torneo.id, VIE, 1, fecha(VIE, '18:00'), {}, null, anteriores);
  }
  return ctx;
}

async function invariantes(ctx, nuevos) {
  const ps = await todos(ctx);
  const agendados = ps.filter((p) => !p.esBye && conHorario(p));
  for (let i = 0; i < agendados.length; i++) {
    const p = agendados[i];
    const dia = getDiaCalendarioConTrasnoche(p.fechaHora, ctx.org).key;
    assert.ok(p.canchaNumero <= overrides.getCanchasDia(ctx.torneo.id, dia, 3).canchas, 'Solo se usan canchas abiertas en su jornada');
    for (const q of agendados.slice(i + 1)) {
      if (+p.fechaHora < +q.fechaHora + D && +q.fechaHora < +p.fechaHora + D) {
        assert.notEqual(p.canchaNumero, q.canchaNumero, 'No hay canchas superpuestas');
        for (const parejaId of [p.pareja1Id, p.pareja2Id].filter(Boolean)) {
          assert.ok(parejaId !== q.pareja1Id && parejaId !== q.pareja2Id, 'No hay parejas superpuestas');
        }
      }
    }
  }
  for (const p of ps.filter((p) => nuevos.has(p.id))) {
    if (!conHorario(p)) {
      assert.equal(p.fechaHora, null);
      assert.equal(p.canchaNumero, null);
      assert.equal(p.sinHorarioAsignado, true);
      continue;
    }
    const dia = getDiaCalendarioConTrasnoche(p.fechaHora, ctx.org).key;
    const slot = `${dia === VIE ? 'Viernes' : 'Sabado'}-${String(p.fechaHora.getHours()).padStart(2, '0')}:${String(p.fechaHora.getMinutes()).padStart(2, '0')}`;
    for (const pareja of [p.pareja1, p.pareja2].filter(Boolean)) {
      if (pareja.slotsSeleccionados.length) assert.ok(pareja.slotsSeleccionados.some((s) => s.slotId === slot), 'Se conserva la disponibilidad');
    }
  }
  return ps;
}

async function caso(operacion, opciones) {
  const ctx = await escenario(opciones);
  const afectadas = operacion === 'mover' ? [ctx.origen.id, ctx.destino.id] : [ctx.destino.id];
  const antes = await todos(ctx);
  const intactos = antes.filter((p) => !afectadas.includes(p.zonaId));
  const idsAntes = new Set(antes.map((p) => p.id));
  if (operacion === 'mover') {
    await http(ctx, 'POST', `/categorias/${ctx.categoria.id}/zonas/mover-pareja`, {
      parejaId: ctx.origen.parejas[0].id, zonaOrigenId: ctx.origen.id, zonaDestinoId: ctx.destino.id,
    });
  } else {
    await http(ctx, 'POST', `/categorias/${ctx.categoria.id}/zonas/agregar-pareja`, {
      zonaDestinoId: ctx.destino.id, jugador1: 'Nueva', jugador2: 'Pareja', slotIds: ctx.slotIds,
    });
  }
  const despues = await todos(ctx);
  assert.deepEqual(despues.filter((p) => !afectadas.includes(p.zonaId)), intactos, 'No se modifican otras zonas ni categorías, tampoco las pendientes sin horario');
  const nuevos = new Set(despues.filter((p) => !idsAntes.has(p.id)).map((p) => p.id));
  assert.equal(nuevos.size, operacion === 'mover' ? (opciones.sinLugar ? 4 : 5) : (opciones.sinLugar ? 3 : 4));
  await invariantes(ctx, nuevos);
  const nuevosPs = despues.filter((p) => nuevos.has(p.id));
  if (opciones.sinLugar) {
    assert.ok(nuevosPs.some((p) => !conHorario(p)), 'La lluvia deja nuevos partidos sin horario cuando no hay lugar');
    if (!opciones.trasnoche) assert.ok(nuevosPs.every((p) => !conHorario(p)), 'El viernes ocupado y sin disponibilidad el sábado no tienen alternativa');
    else assert.ok(nuevosPs.some((p) => conHorario(p) && getDiaCalendarioConTrasnoche(p.fechaHora, ctx.org).key === VIE && p.fechaHora.getDate() === 9), 'La madrugada usa el override del viernes');
  } else if (opciones.lluvia) {
    assert.ok(nuevosPs.every((p) => conHorario(p) && getDiaCalendarioConTrasnoche(p.fechaHora, ctx.org).key === SAB));
    assert.ok(nuevosPs.some((p) => p.canchaNumero > 1), 'El sábado conserva sus tres canchas abiertas');
  } else {
    assert.ok(nuevosPs.every((p) => conHorario(p) && getDiaCalendarioConTrasnoche(p.fechaHora, ctx.org).key === VIE));
    const resumen = nuevosPs.map((p) => `${p.posicionEnRonda}:${p.fechaHora.getHours()}:${p.fechaHora.getMinutes()}:${p.canchaNumero}`).sort();
    assert.deepEqual(resumen, operacion === 'mover'
      ? ['1:18:0:2', '1:18:0:3', '2:19:15:2', '3:20:30:2', '4:20:30:3'].sort()
      : ['1:18:0:2', '2:18:0:3', '3:19:15:2', '4:19:15:3'].sort(), 'Sin lluvia se mantienen los turnos y canchas habituales');
  }
  if (opciones.lluvia) {
    const ids = despues.map((p) => p.id).sort();
    const agendadosAntes = nuevosPs.filter(conHorario).length;
    await http(ctx, 'POST', `/torneos/${ctx.torneo.id}/canchas-override`, { canchasDisponiblesOverride: 3, diaKey: VIE });
    const restaurados = await invariantes(ctx, nuevos);
    assert.deepEqual(restaurados.map((p) => p.id).sort(), ids, 'Restaurar no pierde partidos nuevos ni existentes');
    assert.ok(restaurados.filter((p) => nuevos.has(p.id) && conHorario(p)).length >= agendadosAntes, 'Restaurar no deja nuevos partidos sin horario que antes tenían');
    assert.equal(await prisma.overrideCanchasDia.count({ where: { torneoId: ctx.torneo.id } }), 0);
  }
  console.log(`PASS ${operacion}: ${JSON.stringify(opciones)}; nuevas canchas válidas, disponibilidad, otras zonas intactas y restauración sin solapes`);
}

async function run() {
  await ensureTestDb();
  resetTestDb();
  const { server, baseUrl: url } = await startTestServer();
  baseUrl = url;
  try {
    for (const operacion of ['mover', 'agregar']) {
      for (const lluvia of [true, false]) for (const sinSlots of [false, true]) await caso(operacion, { lluvia, sinLugar: false, sinSlots });
      await caso(operacion, { lluvia: true, sinLugar: true, sinSlots: false });
    }
    await caso('mover', { lluvia: true, sinLugar: true, sinSlots: false, trasnoche: true });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
  }
}
run().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
