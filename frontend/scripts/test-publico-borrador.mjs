import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { JSDOM } = createRequire(import.meta.url)(process.env.FIXI_JSDOM_MODULE || 'jsdom');
import { createServer } from 'vite';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost:5175' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
  HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: class { observe() {} disconnect() {} } });
window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
window.scrollTo = () => {};
Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true }, appType: 'custom' });
const root = createRoot(document.querySelector('#root'));
const mensaje = 'La lista de parejas y los partidos se publican cuando empiece el torneo.';
const favorita = 'miPareja:privado:c';
try {
  const { default: TorneoPublic } = await server.ssrLoadModule('/src/pages/public/TorneoPublic.jsx');
  const torneo = { id: 't', slug: 'privado', nombre: 'Torneo reservado', fecha: '2027-01-08T15:00:00.000Z', organizador: 'Club de prueba', estado: 'BORRADOR', inscripcionAbierta: true };
  const resumen = [{ id: 'c', nombre: '5ta', estado: 'BORRADOR', totalParejas: 4 }, { id: 'd', nombre: '7ma', estado: 'BORRADOR', totalParejas: 1 }];
  let respuesta = { torneo, categorias: resumen }, lecturas = 0;
  globalThis.fetch = async (url, opciones = {}) => {
    assert.equal(url, '/api/public/privado', 'Toda petición debe estar interceptada');
    assert.ok(!opciones.method, 'La vista solo lee datos');
    lecturas++;
    return new Response(JSON.stringify(respuesta));
  };
  localStorage.setItem(favorita, 'p1');
  const render = async (key, ruta) => act(async () => root.render(React.createElement(MemoryRouter, { key, initialEntries: [ruta] },
    React.createElement(Routes, null, React.createElement(Route, { path: '/torneo/:slug', element: React.createElement(TorneoPublic) })))));
  const privado = () => {
    assert.ok(document.body.textContent.includes(mensaje));
    assert.equal(document.querySelector('[aria-label="Buscar pareja o jugador"]'), null);
    assert.equal(document.querySelector('.pv-busqueda-input'), null);
    assert.equal(document.querySelector('.pv-estrella'), null);
    assert.equal(document.querySelector('.pv-seguida'), null);
    assert.ok(!document.body.textContent.includes('Jugador reservado'));
    assert.equal(localStorage.getItem(favorita), 'p1', 'La favorita guardada se conserva durante el borrador');
  };
  await render('inicio', '/torneo/privado');
  privado();
  assert.ok(document.body.textContent.includes('Torneo reservado'));
  assert.ok(document.body.textContent.includes('Club de prueba'));
  assert.equal(document.querySelectorAll('.pv-cat').length, 2);
  assert.ok(document.querySelector('.pv-cat').textContent.includes('4 parejas inscriptas'));
  assert.ok(document.querySelectorAll('.pv-cat')[1].textContent.includes('1 pareja inscripta'));
  assert.equal(document.querySelector('.pv-inscribite').getAttribute('href'), '/torneo/privado/inscripcion');
  await act(async () => document.querySelector('.pv-cat').click());
  privado();
  assert.equal(document.querySelector('h1').textContent, '5ta');
  await render('directo', '/torneo/privado?cat=5ta#zonas');
  privado();
  await render('busqueda-directa', '/torneo/privado?cat=5ta&buscar=Jugador#final');
  privado();
  respuesta = { torneo: { ...torneo, inscripcionAbierta: false }, categorias: resumen };
  await render('cerrado', '/torneo/privado');
  privado();
  assert.equal(document.querySelector('.pv-inscribite'), null);

  const publicada = { ...resumen[0], estado: 'EN_CURSO', parejas: [{ id: 'p1', jugador1: 'Jugador reservado', jugador2: 'Compañero reservado' }],
    zonas: [{ id: 'z', nombre: 'Zona A', clasifican: 2, tabla: [{ parejaId: 'p1', pareja: 'Jugador reservado / Compañero reservado', puntos: 0 }],
      partidos: [{ id: 'm', pareja1Id: 'p1', pareja2Id: 'p2', pareja1: 'Jugador reservado / Compañero reservado', pareja2: 'Otra pareja', estado: 'PENDIENTE', sets: [] }] }], eliminatoria: [] };
  // Una respuesta antigua con nombres tampoco debe mostrarlos si el torneo sigue en borrador.
  respuesta = { torneo, categorias: [publicada] };
  await render('datos-viejos', '/torneo/privado?cat=5ta&buscar=Jugador#zonas');
  privado();
  await render('transicion', '/torneo/privado');
  privado();
  respuesta = { torneo: { ...torneo, estado: 'EN_CURSO', inscripcionAbierta: false }, categorias: [publicada] };
  const antes = lecturas;
  await act(async () => document.dispatchEvent(new dom.window.Event('visibilitychange')));
  assert.equal(lecturas, antes + 1, 'Se actualiza la misma página al empezar el torneo');
  assert.ok(document.querySelector('[aria-label="Buscar pareja o jugador"]'));
  assert.ok(document.querySelector('.pv-seguida').textContent.includes('Jugador reservado'));
  assert.ok(document.querySelector('.pv-estrella'), 'La favorita vuelve a mostrarse al empezar');
  assert.equal(localStorage.getItem(favorita), 'p1');
  assert.ok(!document.body.textContent.includes(mensaje));
  console.log('PASS público en borrador: inicio, categoría/hash, búsqueda directa, inscripción, respuesta vieja y favorita conservada al empezar');
} finally {
  await act(async () => root.unmount());
  await server.close();
  dom.window.close();
}
