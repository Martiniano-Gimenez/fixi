import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { JSDOM } = createRequire(import.meta.url)(process.env.FIXI_JSDOM_MODULE || 'jsdom');
import { createServer } from 'vite';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Integración de la página real con peticiones interceptadas: nunca conecta con dev.db.
const dom = new JSDOM('<!doctype html><div id="root" class="panel"></div>', { url: 'http://localhost:5175' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
  HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: class { observe() {} disconnect() {} } });
const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true }, appType: 'custom' });
const root = createRoot(document.querySelector('#root'));
try {
  const { default: CategoriaDetail } = await server.ssrLoadModule('/src/pages/admin/CategoriaDetail.jsx');
  const parejas = ['Caruso / Vallejos', 'Dávila / Arrieta', 'Medrano / Palavecino'].map((nombre, i) => ({
    id: `p${i + 1}`, jugador1: nombre.split(' / ')[0], jugador2: nombre.split(' / ')[1], orden: i + 1,
  }));
  let empate = true, finalizado = false, resolverPut;
  const guardados = [], lecturas = [];
  const zona = () => ({ id: 'z', nombre: 'Zona A', clasifican: 2, formato: 'ROUND_ROBIN', empatePendiente: empate ? parejas.map(p => p.id) : [],
    zonaParejas: parejas.map((pareja, i) => ({ id: `zp${i}`, parejaId: pareja.id, pareja, puntos: 3, pj: 2, pg: 1, pp: 1, sf: 2, sc: 2, gf: 20, gc: 20 })) });
  globalThis.fetch = async (url, opciones = {}) => {
    if (opciones.method === 'PUT') {
      assert.equal(url, '/api/categorias/c/zonas/z/desempate');
      guardados.push(JSON.parse(opciones.body));
      return new Promise(resolve => { resolverPut = resolve; });
    }
    assert.ok(!opciones.method, `Escritura inesperada: ${url}`);
    lecturas.push(url);
    let data;
    if (url === '/api/categorias/c') data = { id: 'c', nombre: '7ma', estado: finalizado ? 'FINALIZADO' : 'EN_CURSO', torneoId: 't', torneo: { nombre: 'Torneo de prueba', estado: finalizado ? 'FINALIZADO' : 'EN_CURSO' } };
    else if (url === '/api/categorias/c/parejas') data = parejas;
    else if (/^\/api\/parejas\/p\d\/disponibilidad$/.test(url)) data = [];
    else if (url === '/api/categorias/c/zonas') data = [zona()];
    else if (['/api/categorias/c/partidos', '/api/categorias/c/fases-eliminatorias'].includes(url)) data = [];
    else throw new Error(`Petición no interceptada: ${url}`);
    return new Response(JSON.stringify(data));
  };
  const render = async (key) => act(async () => root.render(React.createElement(MemoryRouter, { key, initialEntries: ['/admin/torneos/t/categorias/c'] },
    React.createElement(Routes, null, React.createElement(Route, { path: '/admin/torneos/:torneoId/categorias/:id', element: React.createElement(CategoriaDetail) })))));
  const boton = texto => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === texto);
  const click = async el => { assert.ok(el); await act(async () => el.click()); };
  const key = async (elemento, tecla, shiftKey = false) => act(async () => elemento.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: tecla, shiftKey, bubbles: true, cancelable: true })));
  const filaIds = () => [...document.querySelectorAll('[data-pareja-id]')].map(li => li.dataset.parejaId);

  await render('pendiente');
  assert.match(document.querySelector('.cd-tie-notice').textContent, /Hay un empate entre 3 parejas\. Definí el orden para completar el cuadro\./);
  assert.equal(document.querySelectorAll('.cd-qualifies').length, 0);
  const abrir = boton('Definir orden');
  assert.equal(abrir.classList.contains('pm-primary'), false);
  await click(abrir);
  assert.equal(document.querySelector('[role="dialog"]').getAttribute('aria-modal'), 'true');
  assert.ok(document.activeElement === boton('Cancelar'), 'Foco inicial en Cancelar');
  assert.equal(document.querySelector('.cd-screen').hasAttribute('inert'), true);
  assert.match(document.querySelector('.cd-tie-explanation').textContent, /Si después corregís un resultado de la zona, vas a tener que definirlo de nuevo/);
  const cerrar = document.querySelector('[aria-label="Cerrar diálogo"]');
  await act(async () => cerrar.focus());
  await key(cerrar, 'Tab', true);
  assert.ok(document.activeElement === boton('Guardar orden'), 'Shift+Tab vuelve al último control');
  await key(document.activeElement, 'Tab');
  assert.ok(document.activeElement === cerrar, 'Tab queda contenido en el diálogo');
  await act(async () => document.querySelector('.cd-zone-tab').focus());
  assert.ok(document.activeElement === boton('Cancelar'), 'El foco externo vuelve al diálogo');
  await key(document.activeElement, 'Escape');
  assert.ok(!document.querySelector('[role="dialog"]'), 'El diálogo se cerró');
  assert.ok(document.activeElement === abrir, 'Foco devuelto al disparador');
  assert.equal(document.body.style.overflow, '');
  await click(abrir); await click(boton('Cancelar'));
  assert.ok(document.activeElement === abrir, 'Foco devuelto al disparador');
  assert.equal(guardados.length, 0);

  await click(abrir);
  assert.equal(document.querySelector('[aria-label="Subir a Caruso / Vallejos"]').disabled, true);
  assert.equal(document.querySelector('[aria-label="Bajar a Medrano / Palavecino"]').disabled, true);
  await click(document.querySelector('[aria-label="Subir a Dávila / Arrieta"]'));
  assert.deepEqual(filaIds(), ['p2', 'p1', 'p3']);
  assert.ok(document.querySelector('[role="dialog"]').contains(document.activeElement));
  await click(document.querySelector('[aria-label="Bajar a Caruso / Vallejos"]'));
  assert.deepEqual(filaIds(), ['p2', 'p3', 'p1']);
  await click(boton('Guardar orden'));
  assert.deepEqual(guardados, [{ orden: ['p2', 'p3', 'p1'] }]);
  assert.equal(boton('Guardando…').disabled, true);
  assert.ok(document.querySelector('[role="dialog"]').contains(document.activeElement), 'El foco sigue dentro mientras guarda');
  await act(async () => document.querySelector('[role="dialog"]').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
  assert.equal(guardados.length, 1, 'No se duplica el envío mientras guarda');
  const mensaje = 'No se puede cambiar la clasificación: la final ya está en juego. Volvelo a pendiente primero.';
  await act(async () => resolverPut(new Response(JSON.stringify({ error: mensaje }), { status: 400 })));
  assert.equal(document.querySelector('[role="dialog"] [role="alert"]').textContent, mensaje);
  assert.ok(document.activeElement === document.querySelector('[role="dialog"] [role="alert"]'), 'El error queda visible y recibe foco');
  assert.deepEqual(filaIds(), ['p2', 'p3', 'p1']);
  assert.equal(boton('Guardar orden').disabled, false);
  const zonasAntes = lecturas.filter(url => url.endsWith('/zonas')).length;
  const cuadroAntes = lecturas.filter(url => url.endsWith('/fases-eliminatorias')).length;
  await click(boton('Guardar orden'));
  empate = false;
  await act(async () => resolverPut(new Response(JSON.stringify({ message: 'Desempate guardado.', zonaId: 'z', orden: ['p2', 'p3', 'p1'], empatePendiente: [] }))));
  assert.ok(!document.querySelector('[role="dialog"]'), 'El diálogo se cerró');
  assert.ok(!document.querySelector('.cd-tie-notice'), 'No hay aviso sin empate');
  assert.equal(lecturas.filter(url => url.endsWith('/zonas')).length, zonasAntes + 1);
  assert.equal(lecturas.filter(url => url.endsWith('/fases-eliminatorias')).length, cuadroAntes + 1);
  assert.equal(document.querySelectorAll('.cd-qualifies').length, 2);
  assert.ok(document.activeElement === document.querySelector('.cd-zone-tab'), 'Sin aviso, el foco vuelve a la zona');

  empate = true; finalizado = true;
  await render('cerrado');
  assert.equal(boton('Definir orden'), undefined);
  assert.equal(document.querySelectorAll('.cd-qualifies').length, 0);
  empate = false;
  await render('sin-empate');
  assert.ok(!document.querySelector('.cd-tie-notice'), 'No hay aviso sin empate');
  assert.equal(document.querySelectorAll('.cd-qualifies').length, 2);
  assert.equal(guardados.length, 2);
  console.log('PASS: aviso, filas sin clasificar, orden, foco y Escape, cancelación, 400, doble envío, recarga de zonas/cuadro y torneo finalizado; fetch interceptado');
} finally {
  await act(async () => root.unmount()); await server.close(); dom.window.close();
}
