import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import React, { act } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
const { JSDOM } = createRequire(import.meta.url)(process.env.FIXI_JSDOM_MODULE || 'jsdom');
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost:5175' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
  HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
window.scrollTo = () => {};
const { createRoot } = await import('react-dom/client');
const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true }, appType: 'custom' });
const root = createRoot(document.querySelector('#root'));
const mensaje = 'Esta categoría ya está completa. Elegí otra o consultá con la organización.';
let categorias = [{ id: 'c1', nombre: '5ta', completa: true }, { id: 'c2', nombre: '6ta', completa: false }];
let respuestaPost = { status: 409, body: { error: mensaje, codigo: 'CATEGORIA_COMPLETA' } };
const envios = [];
globalThis.fetch = async (url, options = {}) => {
  assert.equal(url, '/api/public/cupo/inscripcion', 'Todas las peticiones están interceptadas');
  if (options.method === 'POST') {
    envios.push(JSON.parse(options.body));
    return new Response(JSON.stringify(respuestaPost.body), { status: respuestaPost.status });
  }
  return new Response(JSON.stringify({ torneo: { nombre: 'Torneo cupo', slug: 'cupo', estado: 'BORRADOR', inscripcionAbierta: true }, categorias,
    grilla: { viernes: ['Viernes-18:00', 'Viernes-18:15', 'Viernes-18:30'], sabado: [] } }));
};
try {
  const { default: InscripcionPublica } = await server.ssrLoadModule('/src/pages/public/InscripcionPublica.jsx');
  const render = async key => act(async () => root.render(React.createElement(MemoryRouter, { key, initialEntries: ['/torneo/cupo/inscripcion'] },
    React.createElement(Routes, null, React.createElement(Route, { path: '/torneo/:slug/inscripcion', element: React.createElement(InscripcionPublica) })))));
  const opcion = id => document.querySelector(`option[value="${id}"]`);
  const cambiar = async (id, valor) => act(async () => {
    const el = document.getElementById(id);
    const prototipo = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototipo, 'value').set.call(el, valor);
    el.dispatchEvent(new window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
  const click = async texto => act(async () => {
    const el = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === texto);
    assert.ok(el, texto); el.click();
  });
  const enviar = async () => act(async () => document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  await render('mixto');
  assert.equal(opcion('c1').disabled, true);
  assert.equal(opcion('c1').textContent, '5ta (completa)');
  assert.equal(opcion('c2').disabled, false);
  await cambiar('insc-categoria', 'c2');
  await cambiar('insc-j1', 'Ana Pérez');
  await cambiar('insc-j2', 'Luz Díaz');
  await cambiar('insc-tel', '3515551234');
  await cambiar('insc-indicaciones', 'Preferimos temprano');
  await click('Todo el día');
  await enviar();
  assert.equal(envios.length, 1);
  assert.equal(document.querySelector('#insc-categoria-error').textContent, mensaje);
  assert.equal(document.querySelector('#insc-categoria').getAttribute('aria-invalid'), 'true');
  assert.equal(opcion('c2').disabled, true);
  assert.ok(document.querySelector('form'), 'El 409 conserva el formulario aunque se complete la última categoría');
  for (const [id, valor] of [['insc-j1', 'Ana Pérez'], ['insc-j2', 'Luz Díaz'], ['insc-tel', '3515551234'], ['insc-indicaciones', 'Preferimos temprano']]) assert.equal(document.getElementById(id).value, valor);
  assert.deepEqual(envios[0].slotIds, ['Viernes-18:00', 'Viernes-18:15', 'Viernes-18:30']);
  assert.ok(document.body.textContent.includes('Limpiar horarios'), 'Conserva la disponibilidad elegida');
  await enviar();
  assert.equal(envios.length, 1, 'No vuelve a enviar la categoría completa');

  categorias = categorias.map(c => ({ ...c, completa: true }));
  await render('todas');
  assert.equal(document.querySelector('form'), null);
  assert.ok(document.body.textContent.includes('Todas las categorías están completas.'));

  categorias = [{ id: 'c1', nombre: '5ta', completa: false }];
  await render('reintentar');
  await cambiar('insc-j1', 'Ana Pérez'); await cambiar('insc-j2', 'Luz Díaz'); await cambiar('insc-tel', '3515551234');
  await click('Todo el día');
  respuestaPost = { status: 503, body: { codigo: 'REINTENTAR', error: 'Base ocupada' } };
  await enviar();
  assert.ok(document.body.textContent.includes('no se guardó la inscripción'));
  assert.equal(opcion('c1').disabled, false, 'El 503 no marca la categoría como completa');
  assert.equal(document.getElementById('insc-j1').value, 'Ana Pérez');
  respuestaPost = { status: 201, body: { inscripcion: { categoria: { nombre: '5ta' }, jugador1: 'Ana Pérez', jugador2: 'Luz Díaz', cualquierHorario: false, slotIds: envios.at(-1).slotIds } } };
  await enviar();
  assert.ok(document.body.textContent.includes('¡Listo, quedaron inscriptos!'));
  categorias = categorias.map(c => ({ ...c, completa: true }));
  await click('Inscribir otra pareja');
  assert.equal(document.querySelector('form'), null, 'Recarga el cupo después de confirmar el último lugar');
  assert.ok(document.body.textContent.includes('Todas las categorías están completas.'));
  console.log('PASS inscripción: opción completa, todas completas, 409 junto al campo, datos y horarios conservados, sin reenvío, 503 intacto y recarga tras confirmar');
} finally {
  await act(async () => root.unmount());
  await server.close();
  dom.window.close();
}
