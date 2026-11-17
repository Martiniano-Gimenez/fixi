'use strict';

require('./utils/testEnvGuard');
const { ensureTestDb } = require('./utils/testEnvGuard');
const { resetTestDb } = require('./reset-test-db');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const prisma = require('../src/lib/prisma');
const { JWT_SECRET } = require('../src/config/env');
const { startTestServer } = require('./utils/testServer');
const partidos = require('../src/services/partido.service');
const organizadores = require('../src/services/organizador.service');
const overrides = require('../src/services/canchasOverrides.service');

async function run() {
  await ensureTestDb();
  resetTestDb();
  const org = await prisma.organizador.create({ data: { email: 'mensajes-cancha@example.com', nombre: 'Club mensajes', passwordHash: 'test', cantidadCanchas: 3,
    viernesInicio: '18:00', viernesFin: '23:00', sabadoInicio: '09:00', sabadoFin: '23:00', domingoInicio: '09:00', domingoFin: '23:00' } });
  const torneo = await prisma.torneo.create({ data: { organizadorId: org.id, nombre: 'Mensajes', slug: 'mensajes-sin-cancha',
    estado: 'EN_CURSO', fecha: new Date('2027-01-08T12:00:00-03:00') } });
  const cat = await prisma.categoria.create({ data: { torneoId: torneo.id, nombre: '5ta', estado: 'EN_CURSO' } });
  const parejas = [];
  for (const [i, nombres] of [['Ana', 'Belén'], ['Carla', 'Dora'], ['Elena', 'Flora'], ['Gina', 'Hilda']].entries()) {
    parejas.push(await prisma.pareja.create({ data: { categoriaId: cat.id, jugador1: nombres[0], jugador2: nombres[1], orden: i + 1 } }));
  }
  const zona = await prisma.zona.create({ data: { categoriaId: cat.id, nombre: 'Zona A' } });
  const pendiente = await prisma.partido.create({ data: { categoriaId: cat.id, zonaId: zona.id, pareja1Id: parejas[0].id, pareja2Id: parejas[1].id } });
  const ocupado = await prisma.partido.create({ data: { categoriaId: cat.id, zonaId: zona.id, pareja1Id: parejas[2].id, pareja2Id: parejas[3].id,
    posicionEnRonda: 2, fechaHora: new Date('2027-01-08T18:00:00-03:00'), canchaNumero: 1 } });
  const { server, baseUrl } = await startTestServer();
  const foto = async () => ({
    partidos: await prisma.partido.findMany({ where: { categoriaId: cat.id }, orderBy: { id: 'asc' } }),
    torneo: await prisma.torneo.findUnique({ where: { id: torneo.id } }),
    categoria: await prisma.categoria.findUnique({ where: { id: cat.id } }),
    registros: await prisma.overrideCanchasDia.findMany({ where: { torneoId: torneo.id } }),
    cache: structuredClone(overrides.getOverridesTorneo(torneo.id)),
  });
  const comprobar = async ({ accion, ruta, method, body, statusCode, mensaje }) => {
    const antes = await foto();
    await assert.rejects(accion, error => {
      assert.equal(error.statusCode, statusCode);
      assert.equal(error.message, mensaje);
      assert.equal(error.codigo, undefined, 'Estos errores mantienen su contrato sin código adicional');
      assert.equal(error.code, undefined);
      assert.doesNotMatch(error.message, /cancha\s*#?\s*\d/iu);
      return true;
    });
    const r = await fetch(`${baseUrl}${ruta}`, { method, headers: { 'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt.sign({ id: org.id }, JWT_SECRET, { expiresIn: '1h' })}` }, body: JSON.stringify(body) });
    assert.equal(r.status, statusCode);
    const json = await r.json();
    assert.deepEqual(json, { error: mensaje }, 'El mensaje llega al panel con el mismo status y sin cambiar el código de error');
    assert.doesNotMatch(json.error, /cancha\s*#?\s*\d/iu);
    assert.deepEqual(await foto(), antes, 'El rechazo conserva partidos, estados, registros y caché');
  };
  const asignar = async (canchaNumero, mensaje, statusCode) => {
    const body = { slotId: 'Viernes-18:00', canchaNumero };
    await comprobar({ accion: () => partidos.asignarHorarioManual(org.id, pendiente.id, body),
      ruta: `/partidos/${pendiente.id}/asignar-horario-manual`, method: 'PUT', body, mensaje, statusCode });
  };
  try {
    await overrides.setOverrideDia(torneo.id, '2027-01-08', 1, new Date('2027-01-08T18:00:00-03:00'));
    await asignar(3, 'Ese horario ya no tiene canchas libres: la lluvia cerró canchas el viernes. Elegí otro horario.', 400);
    await asignar(1, 'Ese horario se ocupó con otro partido. Elegí otro horario.', 409);
    await asignar(0, 'No se pudo asignar una cancha válida. Elegí otro horario.', 400);
    await overrides.removeOverrideDia(torneo.id, '2027-01-08');
    await prisma.partido.update({ where: { id: ocupado.id }, data: { canchaNumero: 3, estado: 'EN_CURSO' } });
    const body = { canchasDisponiblesOverride: 1, diaKey: '2027-01-08' };
    await comprobar({ accion: () => organizadores.reprogramarPorReduccionCanchas(org.id, torneo.id, 1, null, body.diaKey),
      ruta: `/torneos/${torneo.id}/canchas-override`, method: 'POST', body, statusCode: 400,
      mensaje: 'No podés reducir a 1 canchas mientras se juega Elena/Flora vs Gina/Hilda. Esperá a que termine o cargá su resultado antes de reducir.' });
    console.log('PASS mensajes sin número de cancha: lluvia 400, ocupado 409, cancha inválida 400 y reducción en juego 400; códigos y datos intactos');
  } finally { await new Promise(resolve => server.close(resolve)); await prisma.$disconnect(); }
}
run().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
