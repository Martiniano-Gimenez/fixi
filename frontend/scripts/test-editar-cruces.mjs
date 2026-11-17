import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { JSDOM } = createRequire(import.meta.url)(process.env.FIXI_JSDOM_MODULE || 'jsdom');
import { createServer } from 'vite';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const dom = new JSDOM('<!doctype html><div id="root" class="panel"></div>', { url: 'http://localhost:5175' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
  HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: class { observe() {} disconnect() {} } });
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true }, appType: 'custom' });
const root = createRoot(document.querySelector('#root'));
try {
  const { default: EliminatoriaView } = await server.ssrLoadModule('/src/pages/admin/EliminatoriaView.jsx');
  const { default: Modal } = await server.ssrLoadModule('/src/components/EditBracketMatchModal.jsx');
  const primera = { id: 'f8', ronda: 8, nombre: 'Cuartos de Final', partidos: Array.from({ length: 4 }, (_, i) => ({
    id: `p${i + 1}`, faseEliminatoriaId: 'f8', posicionEnRonda: i + 1, estado: ['PENDIENTE', 'PENDIENTE', 'EN_CURSO', 'FINALIZADO'][i],
    origenPareja1: `1° Zona ${String.fromCharCode(65 + i)}`, origenPareja2: `2° Zona ${String.fromCharCode(65 + i)}`, sets: [],
  })) };
  const segunda = { id: 'f4', ronda: 4, nombre: 'Semifinal', partidos: [{ id: 's1', faseEliminatoriaId: 'f4', posicionEnRonda: 1,
    estado: 'PENDIENTE', origenPareja1: 'Ganador Partido #1', origenPareja2: 'Ganador Partido #2', sets: [] }] };
  const final = { id: 'f2', ronda: 2, nombre: 'Final', partidos: [] };
  const fases = [final, primera, segunda]; // La primera ronda se identifica por ronda, no por el orden del array.
  const guardados = [];
  const mensaje = 'Cada clasificado tiene que seguir en el cuadro.';
  let resolverPatch, cerrados = 0;
  globalThis.fetch = async (url, opciones = {}) => {
    if (opciones.method === 'PATCH') {
      assert.equal(url, '/api/partidos/p1/bracket');
      guardados.push(JSON.parse(opciones.body));
      return new Promise(resolve => { resolverPatch = resolve; });
    }
    assert.ok(!opciones.method, `Escritura inesperada: ${url}`);
    const data = {
      '/api/categorias/c': { id: 'c', nombre: '5ta', torneo: { nombre: 'Torneo de prueba', estado: 'EN_CURSO' }, estado: 'EN_CURSO' },
      '/api/categorias/c/fases-eliminatorias': fases,
      '/api/categorias/c/zonas': [{ id: 'z', nombre: 'Zona inventada en el armado', clasifican: 9 }],
      '/api/categorias/c/cuadro-estado': {},
    };
    assert.ok(url in data, `Petición no interceptada: ${url}`);
    return new Response(JSON.stringify(data[url]));
  };
  await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: ['/admin/torneos/t/categorias/c/cuadro'] },
    React.createElement(Routes, null, React.createElement(Route, { path: '/admin/torneos/:torneoId/categorias/:id/cuadro', element: React.createElement(EliminatoriaView) })))));
  const editar = [...document.querySelectorAll('[aria-label="Editar cruce"]')];
  assert.equal(editar.length, 2, 'Solo los pendientes de la primera ronda ofrecen Editar cruce');
  assert.ok(editar.every(b => b.closest('.cb-round').querySelector('h3').textContent === 'Cuartos de final'));
  assert.equal([...document.querySelectorAll('.cb-round')].find(el => el.querySelector('h3').textContent === 'Semifinal').querySelector('[aria-label="Editar cruce"]'), null);
  await act(async () => editar[0].click());
  const select = document.querySelector('#cb-origen-1');
  assert.equal(document.querySelectorAll('[role="dialog"] option[value=""]').length, 0, 'Los lugares ocupados no ofrecen Sin definir');
  assert.deepEqual([...select.options].map(o => o.value), primera.partidos.flatMap(p => [p.origenPareja1, p.origenPareja2]));
  assert.match([...select.options].find(o => o.value === '1° Zona B').textContent, /en uso en Partido #2/);
  assert.equal([...select.options].find(o => o.value === '1° Zona C').disabled, true);
  await act(async () => { select.value = '1° Zona B'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
  assert.match(document.querySelector('[role="dialog"]').textContent, /Intercambio de cruces/);
  await act(async () => document.querySelector('form.pm-edit-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
  assert.deepEqual(guardados, [{ origenPareja1: '1° Zona B', origenPareja2: '2° Zona A', liberarEnOtros: true }]);
  assert.equal(document.querySelector('button[type="submit"]').textContent.trim(), 'Guardando…');
  await act(async () => resolverPatch(new Response(JSON.stringify({ error: mensaje }), { status: 400 })));
  assert.equal(document.querySelector('[role="dialog"] [role="alert"]').textContent, mensaje);
  assert.ok(document.querySelector('[role="dialog"]'), 'Un 400 conserva el modal abierto');
  assert.equal(select.value, '1° Zona B');

  const partidoVacio = { ...primera.partidos[0], origenPareja2: null };
  const rondaVacia = [partidoVacio, primera.partidos[1]];
  await act(async () => root.render(React.createElement(Modal, { partido: partidoVacio, partidosRonda: rondaVacia, onClose: () => cerrados++ })));
  assert.equal(document.querySelector('#cb-origen-1 option[value=""]'), null);
  assert.ok(document.querySelector('#cb-origen-2 option[value=""]'), 'Solo el lugar originalmente vacío ofrece Sin definir');
  assert.deepEqual([...document.querySelector('#cb-origen-2').options].map(o => o.value), ['', '1° Zona A', '1° Zona B', '2° Zona B']);
  await act(async () => document.querySelector('[aria-label="Cerrar modal"]').click());
  assert.equal(cerrados, 1);
  console.log('PASS editar cruces: primera ronda pendiente, orígenes actuales, aviso en uso, vacío y 400 interceptado dentro del modal');
} finally {
  await act(async () => root.unmount());
  await server.close();
  dom.window.close();
}
