'use strict';

require('./utils/testEnvGuard');
const { ensureTestDb } = require('./utils/testEnvGuard');
const { resetTestDb } = require('./reset-test-db');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { Prisma } = require('@prisma/client');
const prisma = require('../src/lib/prisma');
const { JWT_SECRET } = require('../src/config/env');
const { startTestServer } = require('./utils/testServer');
const zonas = require('../src/services/zona.service');
const categorias = require('../src/services/categoria.service');

async function run() {
  await ensureTestDb();
  resetTestDb();
  const org = await prisma.organizador.create({ data: { nombre: 'Club textos', email: 'textos-panel@example.com', passwordHash: 'test', cantidadCanchas: 3,
    viernesInicio: '18:00', viernesFin: '23:00', sabadoInicio: '09:00', sabadoFin: '23:00', domingoInicio: '09:00', domingoFin: '23:00' } });
  const torneo = await prisma.torneo.create({ data: { organizadorId: org.id, nombre: 'Torneo base', slug: 'textos-borrador', fecha: new Date('2027-01-08T12:00:00-03:00') } });
  const cat = await prisma.categoria.create({ data: { torneoId: torneo.id, nombre: 'Categoría base' } });
  const pareja = await prisma.pareja.create({ data: { categoriaId: cat.id, orden: 1, jugador1: 'Inicial Uno', jugador2: 'Inicial Dos' } });
  const activo = await prisma.torneo.create({ data: { organizadorId: org.id, nombre: 'Torneo activo', slug: 'textos-activo', estado: 'EN_CURSO', fecha: torneo.fecha } });
  const catActiva = await prisma.categoria.create({ data: { torneoId: activo.id, nombre: 'Activa', estado: 'EN_CURSO' } });
  const zona = await prisma.zona.create({ data: { categoriaId: catActiva.id, nombre: 'Zona A' } });
  const parejas = [];
  for (let i = 1; i <= 2; i++) {
    const p = await prisma.pareja.create({ data: { categoriaId: catActiva.id, orden: i, jugador1: `Base ${i}`, jugador2: 'Pareja' } });
    parejas.push(p);
    await prisma.zonaPareja.create({ data: { zonaId: zona.id, parejaId: p.id } });
  }
  await zonas.generarPartidosZonaHelper(prisma, catActiva.id, zona.id, 'ROUND_ROBIN', 2, parejas);
  const { server, baseUrl } = await startTestServer();
  const http = async (method, ruta, body) => {
    const res = await fetch(`${baseUrl}${ruta}`, { method, headers: { 'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt.sign({ id: org.id }, JWT_SECRET, { expiresIn: '1h' })}` }, body: JSON.stringify(body) });
    return { status: res.status, json: await res.json() };
  };
  const foto = () => Promise.all(Prisma.dmmf.datamodel.models.map(async ({ name }) => {
    const filas = await prisma[name[0].toLowerCase() + name.slice(1)].findMany();
    return [name, filas.map(fila => JSON.stringify(fila)).sort()];
  }));
  const aceptar = async (method, ruta, body, status) => {
    const res = await http(method, ruta, body);
    assert.equal(res.status, status, JSON.stringify(res.json));
    return res.json;
  };
  const rechazar = async (method, ruta, body, status, mensaje) => {
    const antes = await foto();
    const res = await http(method, ruta, body);
    assert.equal(res.status, status, JSON.stringify(res.json));
    assert.equal(res.json.error, mensaje);
    assert.deepEqual(await foto(), antes, 'El rechazo no guarda ni cambia datos en ninguna tabla');
  };
  const altaZona = { zonaDestinoId: zona.id, jugador1: 'Válido Uno', jugador2: 'Válido Dos', slotIds: ['Viernes-18:00', 'Viernes-19:15', 'Viernes-20:30', 'Viernes-21:45'] };
  try {
    const operaciones = [
      { method: 'POST', ruta: '/torneos', body: { nombre: 'Válido', fecha: '2027-01-08' }, campo: 'nombre', etiqueta: 'del torneo', max: 80 },
      { method: 'PATCH', ruta: `/torneos/${torneo.id}`, body: { nombre: 'Válido', fecha: '2027-01-15' }, campo: 'nombre', etiqueta: 'del torneo', max: 80 },
      { method: 'POST', ruta: `/torneos/${torneo.id}/categorias`, body: { nombre: 'Válido' }, campo: 'nombre', etiqueta: 'de la categoría', max: 40 },
      { method: 'PATCH', ruta: `/categorias/${cat.id}`, body: { nombre: 'Válido', estado: 'BORRADOR' }, campo: 'nombre', etiqueta: 'de la categoría', max: 40 },
    ];
    for (const [campo, etiqueta] of [['jugador1', 'del jugador 1'], ['jugador2', 'del jugador 2']]) {
      operaciones.push(
        { method: 'POST', ruta: `/categorias/${cat.id}/parejas`, body: { jugador1: 'Válido Uno', jugador2: 'Válido Dos' }, campo, etiqueta, max: 60 },
        { method: 'PATCH', ruta: `/parejas/${pareja.id}`, body: { jugador1: 'Válido Uno', jugador2: 'Válido Dos' }, campo, etiqueta, max: 60 },
        { method: 'POST', ruta: `/categorias/${catActiva.id}/zonas/agregar-pareja`, body: altaZona, campo, etiqueta, max: 60 },
      );
    }
    for (const op of operaciones) {
      for (const valor of [undefined, null, '', '  \t\n ', 123, {}, 'x'.repeat(op.max + 1)]) {
        // En las ediciones, undefined significa campo ausente y se prueba más abajo.
        if (valor === undefined && op.method === 'PATCH') continue;
        const mensaje = typeof valor === 'string' && valor.length > op.max
          ? `El nombre ${op.etiqueta} puede tener hasta ${op.max} caracteres.`
          : valor !== undefined && valor !== null && typeof valor !== 'string'
            ? `El nombre ${op.etiqueta} debe ser un texto.` : `El nombre ${op.etiqueta} es obligatorio.`;
        await rechazar(op.method, op.ruta, { ...op.body, [op.campo]: valor }, 400, mensaje);
      }
    }
    console.log('PASS todos los servicios y ambos jugadores: vacíos, espacios, ausentes en altas, tipos inválidos y largos excesivos; 400 sin escrituras');

    const creado = await aceptar('POST', '/torneos', { nombre: '  Torneo\t  del   Club  ', fecha: '2027-01-08' }, 201);
    assert.equal(creado.nombre, 'Torneo del Club');
    assert.equal((await aceptar('PUT', `/torneos/${torneo.id}`, { nombre: '  Torneo  editado  ' }, 200)).nombre, 'Torneo editado');
    await aceptar('PATCH', `/torneos/${torneo.id}`, {}, 200);
    assert.equal((await prisma.torneo.findUnique({ where: { id: torneo.id } })).nombre, 'Torneo editado');
    const nuevaCat = await aceptar('POST', `/torneos/${torneo.id}/categorias`, { nombre: '  Séptima   Damas  ' }, 201);
    assert.equal(nuevaCat.nombre, 'Séptima Damas');
    assert.equal((await aceptar('PATCH', `/categorias/${cat.id}`, { nombre: '  Otra   categoría  ' }, 200)).nombre, 'Otra categoría');
    await aceptar('PATCH', `/categorias/${cat.id}`, { estado: 'BORRADOR' }, 200);
    assert.equal((await prisma.categoria.findUnique({ where: { id: cat.id } })).nombre, 'Otra categoría');
    const nuevaPareja = await aceptar('POST', `/categorias/${cat.id}/parejas`, { jugador1: '  Ana   María ', jugador2: '  Juana\t López  ' }, 201);
    assert.equal(nuevaPareja.jugador1, 'Ana María'); assert.equal(nuevaPareja.jugador2, 'Juana López');
    const editada = await aceptar('PATCH', `/parejas/${pareja.id}`, { jugador1: '  Luz   del  Sur ', jugador2: '  Otra  Jugadora  ' }, 200);
    assert.equal(editada.jugador1, 'Luz del Sur'); assert.equal(editada.jugador2, 'Otra Jugadora');
    await aceptar('PATCH', `/parejas/${pareja.id}`, {}, 200);
    const sinCambios = await prisma.pareja.findUnique({ where: { id: pareja.id } });
    assert.equal(sinCambios.jugador1, editada.jugador1); assert.equal(sinCambios.jugador2, editada.jugador2);
    const agregada = await aceptar('POST', `/categorias/${catActiva.id}/zonas/agregar-pareja`, { ...altaZona, jugador1: '  Nueva   Jugadora ', jugador2: ' Otra\t Pareja ' }, 201);
    assert.equal(agregada.pareja.jugador1, 'Nueva Jugadora'); assert.equal(agregada.pareja.jugador2, 'Otra Pareja');

    for (const nombre of ['SEPTIMA DAMAS', '  séPTIMA    DAMÁS  ']) {
      await rechazar('POST', `/torneos/${torneo.id}/categorias`, { nombre }, 409, 'Ya hay una categoría con ese nombre en este torneo.');
      await rechazar('PATCH', `/categorias/${cat.id}`, { nombre }, 409, 'Ya hay una categoría con ese nombre en este torneo.');
    }
    for (const nombre of ['Séptima Damas', 'SÉPTIMA DAMAS', 'septima damas']) assert.equal((await aceptar('PATCH', `/categorias/${nuevaCat.id}`, { nombre }, 200)).nombre, nombre);
    await aceptar('POST', `/torneos/${activo.id}/categorias`, { nombre: 'SEPTIMA DAMAS' }, 201);
    console.log('PASS normalización, ediciones sin nombre, duplicados con mayúsculas/tildes/espacios, mismo nombre y nombres iguales en otro torneo');

    assert.equal((await aceptar('POST', '/torneos', { nombre: 'T'.repeat(80), fecha: '2027-01-08' }, 201)).nombre.length, 80);
    assert.equal((await aceptar('PUT', `/torneos/${torneo.id}`, { nombre: 'U'.repeat(80) }, 200)).nombre.length, 80);
    const limiteCat = await aceptar('POST', `/torneos/${torneo.id}/categorias`, { nombre: 'C'.repeat(40) }, 201);
    assert.equal(limiteCat.nombre.length, 40);
    assert.equal((await aceptar('PATCH', `/categorias/${limiteCat.id}`, { nombre: 'D'.repeat(40) }, 200)).nombre.length, 40);
    const limitePareja = await aceptar('POST', `/categorias/${cat.id}/parejas`, { jugador1: 'A'.repeat(60), jugador2: 'B'.repeat(60) }, 201);
    assert.equal(limitePareja.jugador1.length, 60); assert.equal(limitePareja.jugador2.length, 60);
    assert.equal((await aceptar('PATCH', `/parejas/${pareja.id}`, { jugador1: 'C'.repeat(60) }, 200)).jugador1.length, 60);
    const limiteZona = await aceptar('POST', `/categorias/${catActiva.id}/zonas/agregar-pareja`, { ...altaZona, jugador1: 'E'.repeat(60), jugador2: 'F'.repeat(60) }, 201);
    assert.equal(limiteZona.pareja.jugador1.length, 60); assert.equal(limiteZona.pareja.jugador2.length, 60);

    const transaccion = prisma.$transaction;
    const antes = await foto();
    prisma.$transaction = (fn, opts) => transaccion.call(prisma, async tx => { await fn(tx); throw new Error('Rollback de nombres'); }, opts);
    try {
      await assert.rejects(() => categorias.createCategoria(org.id, torneo.id, { nombre: 'Alta revertida' }), /Rollback de nombres/);
      await assert.rejects(() => categorias.updateCategoria(org.id, cat.id, { nombre: 'Edición revertida' }), /Rollback de nombres/);
    } finally { prisma.$transaction = transaccion; }
    assert.deepEqual(await foto(), antes);
    console.log('PASS límites exactos 60/80/40 y rollback de alta/renombre de categoría con validación en la misma transacción');
  } finally { await new Promise(resolve => server.close(resolve)); await prisma.$disconnect(); }
}
run().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
