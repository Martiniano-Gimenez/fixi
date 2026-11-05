import assert from 'node:assert/strict';
// Lista "Partidos pendientes de asignación de horario": los partidos del cuadro muestran la fase y de dónde
// vienen sus parejas (jsdom, como las demás pruebas de pantalla).
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { JSDOM } = createRequire(import.meta.url)(process.env.FIXI_JSDOM_MODULE || 'jsdom');
import { createServer } from 'vite';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost:5175' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
  HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true }, appType: 'custom' });
try {
  const { default: Pendientes } = await server.ssrLoadModule('/src/components/PartidosPendientesSection.jsx');
  const categoria = { id: 'c', nombre: '7ma' };
  const pendientes = [
    { id: 'z', categoria, zona: { id: 'zf', nombre: 'Zona F' }, faseEliminatoria: null, slotsViablesCount: 4,
      pareja1: { jugador1: 'Coria', jugador2: 'Giuliani' }, pareja2: { jugador1: 'Mendoza', jugador2: 'Ávalos' } },
    { id: 'r', categoria, zona: null, faseEliminatoria: { id: 'f', nombre: 'Dieciseisavos de Final', ronda: 32 }, slotsViablesCount: 4,
      pareja1: null, pareja2: null, origenPareja1: '2º Zona J', origenPareja2: '2º Zona K' },
    { id: 's', categoria, zona: null, faseEliminatoria: { id: 'g', nombre: 'Octavos de Final', ronda: 16 }, slotsViablesCount: 4,
      pareja1: null, pareja2: null, origenPareja1: null, origenPareja2: null },
  ];
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/partidos-sin-horario')) return new Response(JSON.stringify(pendientes));
    throw Error(`Petición no interceptada ${url}`);
  };
  const root = createRoot(document.querySelector('#root'));
  await act(async () => root.render(React.createElement(Pendientes, { torneoId: 't', torneoEstado: 'EN_CURSO' })));
  for (let i = 0; i < 50 && !document.querySelector('.pm-pending'); i++) await act(async () => new Promise((r) => setTimeout(r, 20)));
  const categoriaBoton = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('7ma'));
  await act(async () => categoriaBoton.click());
  const tarjetas = [...document.querySelectorAll('.pm-pending-match')].map((t) => ({
    fase: t.querySelector('.pm-badge').textContent.trim(),
    parejas: [...t.querySelector('.pm-pair-names').children].map((e) => e.textContent.trim()).join(' '),
  }));
  const zona = tarjetas.find((t) => t.fase === 'Zona F');
  assert.ok(zona, 'El partido de zona sigue mostrando su zona');
  assert.equal(zona.parejas, 'Coria / Giuliani vs Mendoza / Ávalos');
  const r32 = tarjetas.find((t) => t.fase === 'Dieciseisavos');
  assert.ok(r32, 'El partido del cuadro muestra su fase en lugar de "Zona"');
  assert.equal(r32.parejas, '2º Zona J vs 2º Zona K', 'Muestra de dónde vienen las parejas');
  const octavos = tarjetas.find((t) => t.fase === 'Octavos');
  assert.equal(octavos.parejas, 'Por definirse vs Por definirse', 'Sin origen, queda "Por definirse"');
  assert.ok(!tarjetas.some((t) => t.fase === 'Zona'), 'Ningún partido queda como "Zona" sin nombre');
  await act(async () => root.unmount());
} finally {
  await server.close();
}
