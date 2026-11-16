'use strict';

require('./utils/testEnvGuard');
const { ensureTestDb } = require('./utils/testEnvGuard');
const { resetTestDb } = require('./reset-test-db');
const assert = require('node:assert/strict');
const prisma = require('../src/lib/prisma');
const { startTestServer } = require('./utils/testServer');

function comprobarClaves(valor, prohibidas) {
  if (!valor || typeof valor !== 'object') return;
  for (const [clave, hijo] of Object.entries(valor)) {
    assert.ok(!prohibidas.includes(clave), `La respuesta expone ${clave}`);
    comprobarClaves(hijo, prohibidas);
  }
}

async function run() {
  await ensureTestDb();
  resetTestDb();
  const org = await prisma.organizador.create({ data: { nombre: 'Club público', email: 'privacidad@example.com', passwordHash: 'HASH_INTERNO' } });
  const torneo = await prisma.torneo.create({ data: { organizadorId: org.id, nombre: 'Torneo de privacidad', slug: 'publico-privacidad',
    fecha: new Date('2027-01-08T12:00:00-03:00'), estado: 'BORRADOR', inscripcionAbierta: true } });
  const categoria = await prisma.categoria.create({ data: { torneoId: torneo.id, nombre: '5ta', parejas: {
    create: Array.from({ length: 4 }, (_, i) => ({ orden: i + 1, jugador1: `JugadorPrivado${i}`, jugador2: `CompaneroPrivado${i}`,
      telefono: '3515554321', indicaciones: 'INDICACION_INTERNA' })),
  } }, include: { parejas: { orderBy: { orden: 'asc' } } } });
  const vacia = await prisma.categoria.create({ data: { torneoId: torneo.id, nombre: '7ma' } });
  const ps = categoria.parejas;
  const zona = await prisma.zona.create({ data: { categoriaId: categoria.id, nombre: 'Zona A',
    zonaParejas: { create: ps.map((p) => ({ parejaId: p.id })) } } });
  const partidoZona = await prisma.partido.create({ data: { categoriaId: categoria.id, zonaId: zona.id,
    pareja1Id: ps[0].id, pareja2Id: ps[1].id, ganadorId: ps[0].id, estado: 'FINALIZADO', canchaNumero: 2,
    fechaHora: new Date('2027-01-08T18:00:00-03:00'), sets: { create: [{ numero: 1, gamesPareja1: 6, gamesPareja2: 0 }] } } });
  const fase = await prisma.faseEliminatoria.create({ data: { categoriaId: categoria.id, ronda: 2, nombre: 'Final' } });
  const final = await prisma.partido.create({ data: { categoriaId: categoria.id, faseEliminatoriaId: fase.id,
    pareja1Id: ps[2].id, pareja2Id: ps[3].id, canchaNumero: 3, origenPareja1: '1° Zona A', origenPareja2: '2° Zona A',
    fechaHora: new Date('2027-01-10T18:00:00-03:00') } });
  const nombres = ps.flatMap(p => [p.jugador1, p.jugador2]);
  const { server, baseUrl } = await startTestServer();
  const leer = async () => {
    const r = await fetch(`${baseUrl}/public/${torneo.slug}`);
    assert.equal(r.status, 200);
    return r.json();
  };
  try {
    for (const inscripcionAbierta of [true, false]) {
      await prisma.torneo.update({ where: { id: torneo.id }, data: { inscripcionAbierta } });
      const data = await leer();
      assert.equal(data.torneo.nombre, torneo.nombre);
      assert.equal(data.torneo.fecha, torneo.fecha.toISOString());
      assert.equal(data.torneo.organizador, org.nombre);
      assert.equal(data.torneo.estado, 'BORRADOR');
      assert.equal(data.torneo.inscripcionAbierta, inscripcionAbierta);
      assert.deepEqual(data.categorias, [
        { id: categoria.id, nombre: '5ta', estado: 'BORRADOR', totalParejas: 4 },
        { id: vacia.id, nombre: '7ma', estado: 'BORRADOR', totalParejas: 0 },
      ]);
      comprobarClaves(data, ['jugador1', 'jugador2', 'parejas', 'zonas', 'partidos', 'eliminatoria', 'canchaNumero', 'orden']);
      for (const nombre of nombres) assert.ok(!JSON.stringify(data).includes(nombre), 'Ningún nombre aparece en el JSON completo');
    }
    console.log('PASS borrador con zonas y cuadro creados: solo resumen, conteos correctos y ningún nombre en todo el JSON');

    for (const estado of ['EN_CURSO', 'FINALIZADO']) {
      await prisma.torneo.update({ where: { id: torneo.id }, data: { estado } });
      const data = await leer();
      const cat = data.categorias.find(c => c.id === categoria.id);
      assert.equal(data.torneo.estado, estado);
      assert.equal(data.torneo.inscripcionAbierta, false);
      assert.deepEqual(cat.parejas, ps.map(p => ({ id: p.id, jugador1: p.jugador1, jugador2: p.jugador2 })));
      assert.equal(cat.totalParejas, 4);
      assert.equal(cat.zonas[0].tabla.length, 4);
      assert.equal(cat.zonas[0].partidos[0].id, partidoZona.id);
      assert.equal(cat.zonas[0].partidos[0].pareja1, `${ps[0].jugador1} / ${ps[0].jugador2}`);
      assert.deepEqual(cat.zonas[0].partidos[0].sets, [{ gamesPareja1: 6, gamesPareja2: 0 }]);
      assert.equal(cat.eliminatoria[0].partidos[0].id, final.id);
      for (const nombre of nombres) assert.ok(JSON.stringify(data).includes(nombre), 'Los nombres se publican al empezar');
      comprobarClaves(data, ['canchaNumero', 'orden', 'telefono', 'indicaciones', 'passwordHash', 'slotsSeleccionados']);
      assert.ok(!JSON.stringify(data).includes('INDICACION_INTERNA'));
    }
    console.log('PASS en curso y finalizado: parejas, tablas y partidos publicados, sin canchaNumero, orden ni datos privados');
  } finally { await new Promise(resolve => server.close(resolve)); await prisma.$disconnect(); }
}
run().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
