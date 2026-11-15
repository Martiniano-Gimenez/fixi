import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const { JSDOM } = createRequire(import.meta.url)(process.env.FIXI_JSDOM_MODULE || 'jsdom');

const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true }, appType: 'custom' });
try {
  const { default: TablaZona } = await server.ssrLoadModule('/src/pages/public/publico/TablaZona.jsx');
  const { clasificadosPorOrigen, ladoDe } = await server.ssrLoadModule('/src/pages/public/publico/utilidades.js');
  const filas = ['Amaya / Godoy', 'Dávila / Arrieta', 'Medrano / Palavecino'].map((pareja, i) => ({
    parejaId: `p${i + 1}`, pareja, puntos: 3, pj: 2, pg: 1, sf: 2, sc: 2, gf: 20, gc: 20,
  }));
  const zona = { id: 'z', nombre: 'Zona A', formato: 'ROUND_ROBIN', clasifican: 2, tabla: filas,
    partidos: [1, 2, 3].map(id => ({ id: `m${id}`, estado: 'FINALIZADO' })) };
  const render = (z, comprobar) => {
    const dom = new JSDOM(renderToStaticMarkup(React.createElement(TablaZona, { zona: z, seguidaId: 'p2' }, React.createElement('span', { id: 'pie' }, 'Pie existente'))));
    try { comprobar(dom.window.document); } finally { dom.window.close(); }
  };
  const origenes = z => clasificadosPorOrigen({ zonas: [z] });
  const cruce = { origenPareja1: '1° Zona A', origenPareja2: '2° Zona A', pareja1Id: null, pareja2Id: null };

  const triple = { ...zona, empatePendiente: ['p1', 'p2', 'p3'] };
  const sinResolver = origenes(triple);
  assert.equal(sinResolver.size, 0);
  assert.equal(ladoDe(cruce, 1, sinResolver).definida, false);
  assert.equal(ladoDe(cruce, 2, sinResolver).definida, false);
  render(triple, doc => {
    assert.equal(doc.querySelectorAll('.clasifica').length, 0);
    const nota = doc.querySelector('.pv-t-empate');
    assert.equal(nota.textContent, 'Hay un empate exacto entre 3 parejas. El orden lo define la organización.');
    assert.equal(doc.querySelector('.pv-t-filas').nextElementSibling, nota, 'La línea va debajo de la tabla');
    assert.equal(nota.nextElementSibling.id, 'pie', 'Se conserva el pie existente');
    assert.ok(doc.querySelector('.seguida'), 'El seguimiento se conserva en una fila empatada');
  });

  // Dos empatadas en estadísticas: el orden ya resuelto por el backend es la fuente de verdad.
  const resuelto = { ...zona, empatePendiente: [], tabla: [filas[1], filas[0], { ...filas[2], puntos: 0, pg: 0 }] };
  const definidos = origenes(resuelto);
  assert.deepEqual(definidos.get('1° Zona A'), { nombre: filas[1].pareja, parejaId: 'p2' });
  assert.deepEqual(definidos.get('2° Zona A'), { nombre: filas[0].pareja, parejaId: 'p1' });
  assert.equal(ladoDe(cruce, 1, definidos).parejaId, 'p2');
  assert.equal(ladoDe(cruce, 2, definidos).definida, true);
  render(resuelto, doc => {
    assert.equal(doc.querySelectorAll('.clasifica').length, 2);
    assert.ok(!doc.querySelector('.pv-t-empate'));
    assert.ok([...doc.querySelectorAll('.clasifica')].every(row => /Amaya|Dávila/.test(row.getAttribute('aria-label'))));
  });

  // Datos viejos sin empatePendiente se interpretan igual que [], sin reconstruir empates.
  assert.equal(Object.hasOwn(zona, 'empatePendiente'), false);
  assert.equal(origenes(zona).size, 2);
  render(zona, doc => {
    assert.equal(doc.querySelectorAll('.clasifica').length, 2);
    assert.ok(!doc.querySelector('.pv-t-empate'));
  });

  const grupoPosterior = { ...zona, empatePendiente: ['p2', 'p3'] };
  assert.equal(origenes(grupoPosterior).size, 1);
  assert.equal(origenes(grupoPosterior).get('1° Zona A').parejaId, 'p1');
  render(grupoPosterior, doc => {
    assert.equal(doc.querySelectorAll('.clasifica').length, 1);
    assert.match(doc.querySelector('.clasifica').getAttribute('aria-label'), /Amaya/);
    assert.match(doc.querySelector('.pv-t-empate').textContent, /entre 2 parejas/);
  });

  assert.equal(origenes({ ...resuelto, partidos: [] }).size, 0);
  assert.equal(origenes({ ...resuelto, partidos: [{ estado: 'EN_CURSO' }] }).size, 0);
  assert.equal(origenes({ ...resuelto, formato: 'MINI_BRACKET' }).size, 2);
  console.log('PASS: triple pendiente, empate doble resuelto, campo ausente, posiciones anteriores, zona sin terminar y mini-bracket; se respeta el orden del backend');
} finally { await server.close(); }
