import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { JSDOM } = createRequire(import.meta.url)(process.env.FIXI_JSDOM_MODULE || 'jsdom');
import { createServer } from 'vite';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost:5175' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
  HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: class { observe() {} disconnect() {} } });
const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true }, appType: 'custom' });
const root = createRoot(document.querySelector('#root'));
try {
  const { default: Elegir } = await server.ssrLoadModule('/src/components/ElegirHorarioPartido.jsx');
  const parejas = [{ id: 'p1', nombre: 'Caruso / Vallejos' }, { id: 'p2', nombre: 'Dávila / Arrieta' }];
  let peticiones = 0, rechecks = 0, fallar = false;
  globalThis.fetch = async (url, opts) => {
    assert.equal(url, '/api/torneos/fixture/pre-check-inicio/partidos/quitar');
    assert.deepEqual(JSON.parse(opts.body), { categoriaId: 'c', zonaId: 'z', posicionEnRonda: 1, revision: 'r1' });
    peticiones++;
    return new Response(JSON.stringify(fallar ? { error: 'Primero quitá las definiciones' } : { revision: 'r2' }), { status: fallar ? 409 : 200 });
  };
  function App() {
    const [abierto, setAbierto] = React.useState(null), [pendiente, setPendiente] = React.useState(false);
    const props = { torneoId: 'fixture', categoriaId: 'c', zonaId: 'z', revision: 'r1', parejas,
      partido: { posicionEnRonda: 1, pareja1Id: 'p1', pareja2Id: 'p2', fijadoManual: !pendiente,
        fechaHora: pendiente ? null : '2026-11-06T18:45:00Z', canchaNumero: pendiente ? null : 3 },
      abierto, onAbiertoChange: setAbierto, onSaved: () => setPendiente(true), onRecheck: () => { rechecks++; } };
    return React.createElement('div', null, React.createElement(Elegir, props), React.createElement(Elegir, props));
  }
  const buttons = (text) => [...document.querySelectorAll('button')].filter((b) => b.textContent === text);
  const click = async (el) => { assert.ok(el); await act(async () => el.click()); };
  await act(async () => root.render(React.createElement(App)));
  await click(buttons('Quitar horario')[0]);
  assert.equal(document.querySelectorAll('.pc-quitar-confirmacion').length, 1, 'Solo el editor tocado confirma, aunque haya dos copias del fijo');
  assert.match(document.querySelector('.pc-quitar-confirmacion').textContent, /¿Quitar el horario de vie 15:45\? La disponibilidad que agregaste a las parejas se mantiene\./);
  await click(buttons('Cancelar')[0]); assert.equal(peticiones, 0);
  await click(buttons('Quitar horario')[1]);
  fallar = true; await click(buttons('Confirmar')[0]);
  assert.equal(rechecks, 1); assert.match(document.querySelector('[role="alert"]').textContent, /Primero quitá/);
  fallar = false;
  await act(async () => { const b = buttons('Confirmar')[0]; b.click(); b.click(); });
  assert.equal(peticiones, 2, 'Un error y una confirmacion, sin doble envio');
  assert.equal(buttons('Quitar horario').length, 0);
  assert.equal(buttons('Elegir horario').length, 2);
  console.log('PASS: quitar con fetch interceptado, cancelar, error 409, duplicados y pendiente actualizado');
} finally { await act(async () => root.unmount()); await server.close(); dom.window.close(); }
