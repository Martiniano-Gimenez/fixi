import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
// jsdom es opcional, igual que en las otras pruebas DOM del pre-check.
const { JSDOM } = createRequire(import.meta.url)(process.env.FIXI_JSDOM_MODULE || 'jsdom');
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost:5175' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
  HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: class { observe() {} disconnect() {} } });
window.scrollTo = () => {};
globalThis.alert = (mensaje) => { throw new Error(mensaje); };
const servidor = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true }, appType: 'custom' });
const root = createRoot(document.querySelector('#root'));
try {
  const { default: TorneoInicio } = await servidor.ssrLoadModule('/src/pages/admin/TorneoInicio.jsx');
  const partido = { zonaId: 'z', zona: 'Zona A', posicionEnRonda: 1, motivo: 'HORARIO_QUITADO',
    pareja1Id: 'p1', pareja1: 'Caruso / Vallejos', pareja2Id: 'p2', pareja2: 'Dávila / Arrieta', opcionesResolucion: [{}] };
  const pre = { revision: 'r1', bloqueado: true, sesionReiniciada: false,
    planEmergenciaId: 'pe', conflictos: [{ categoriaId: 'c', nombreCategoria: '7ma Damas', juegaDieciseisavos: true, partidosSinHorario: [partido] }] };
  let prechecks = 0, cierres = 0, fallarCierre = true, liberarCierre;
  const eventos = [];
  globalThis.fetch = async (url, opts = {}) => {
    if (url === '/api/torneos/fixture' && !opts.method) return new Response(JSON.stringify({ inscripcionAbierta: true,
      nombre: 'Prueba', categorias: [{ estado: 'BORRADOR', parejas: [{}, {}] }] }));
    if (url.endsWith('/pre-check-inicio')) { prechecks++; eventos.push('verificar'); return new Response(JSON.stringify(pre)); }
    if (url.endsWith('/partidos/opciones')) return new Response(JSON.stringify({ opciones: [] }));
    if (url === '/api/torneos/fixture/inscripcion') {
      assert.equal(opts.method, 'PATCH'); assert.deepEqual(JSON.parse(opts.body), { abierta: false });
      cierres++; eventos.push('cerrar');
      if (fallarCierre) return new Response(JSON.stringify({ error: 'No se pudo cerrar' }), { status: 503 });
      await new Promise((r) => { liberarCierre = r; });
      return new Response(JSON.stringify({ id: 'fixture', inscripcionAbierta: false }));
    }
    throw new Error(`Petición no interceptada: ${url}`);
  };
  const arbol = React.createElement(MemoryRouter, { initialEntries: ['/admin/torneos/fixture/iniciar'] },
    React.createElement(Routes, null, React.createElement(Route, { path: '/admin/torneos/:id/iniciar', element: React.createElement(TorneoInicio) })));
  const boton = (texto) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === texto);
  const click = async (b) => { assert.ok(b); await act(async () => b.click()); };
  await act(async () => root.render(arbol));
  assert.equal(prechecks, 1);
  assert.equal(document.querySelector('.pc-match-names').textContent, 'Caruso / Vallejos vs Dávila / Arrieta');
  assert.ok([...document.querySelectorAll('.pc-badge')].some((b) => b.textContent === 'Horario quitado'));
  assert.ok(!document.querySelector('.pc-session-notice'), 'Recuperar el plan no anuncia una sesión rearmada');
  const aviso = document.querySelector('.pc-inscripcion-notice');
  assert.match(aviso.textContent, /La inscripción sigue abierta\. Si se anota otra pareja, vas a tener que rearmar las zonas y se pierden los horarios fijados\./);
  assert.ok(aviso.compareDocumentPosition(document.querySelector('.pc-conflict-list')) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(!boton('Cerrar inscripción').classList.contains('pm-primary'));
  // Celular: las acciones secundarias también están al final de la página, fuera de la barra fija (el CSS elige cuál se ve).
  const final = document.querySelector('.pc-page-secondary-final');
  assert.ok(final && !final.closest('.pc-page-bar'), 'Al final de la página, sin quedar fijas');
  assert.ok(final.compareDocumentPosition(document.querySelector('.pc-conflict-list')) & dom.window.Node.DOCUMENT_POSITION_PRECEDING, 'Debajo de las categorías');
  assert.ok([...final.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Rearmar zonas desde cero'));
  assert.ok(document.querySelector('.pc-page-bar .pc-page-secondary'), 'Desde 768 px siguen en la barra');
  assert.equal(document.querySelectorAll('.pc-page-bar .pm-primary').length, 1, 'Un solo botón principal');
  // Modal de iniciar con pendientes: avisa que los dieciseisavos se programan al asignar esos horarios
  await click(boton('Iniciar dejando 1 pendientes'));
  assert.match(document.querySelector('.pc-emergency-title, #pc-emergency-title').textContent, /¿Iniciar con 1 partido sin horario\?/);
  assert.equal(document.querySelector('.pc-emergency-nota').textContent, 'Sus dieciseisavos se programan cuando les asignes horario a este partido.');
  await click(boton('Seguir resolviendo'));
  assert.ok(!document.querySelector('.pc-emergency'));
  await click(boton('Resolver de a uno'));
  for (let i = 0; i < 50 && !document.querySelector('.pc-resolver .pc-zona-rivales'); i++) {
    await act(async () => new Promise((r) => setTimeout(r, 20)));
  }
  assert.equal(document.querySelector('.pc-resolver .pc-zona-rivales').textContent, 'Caruso / Vallejos vs Dávila / Arrieta');
  assert.equal(document.querySelector('.pc-resolver .pc-zona-badge').textContent, 'Horario quitado');
  for (let i = 0; i < 100 && !document.querySelector('.pc-resolver').textContent.includes('No hay horarios posibles'); i++) {
    await act(async () => new Promise((r) => setTimeout(r, 20)));
  }
  assert.match(document.querySelector('.pc-resolver').textContent, /No hay horarios posibles/);
  assert.ok(document.querySelector('.pc-inscripcion-notice'), 'Aviso también disponible en Resolver');
  await click(boton('Cerrar inscripción'));
  assert.match(document.querySelector('[role="alert"]').textContent, /No se pudo cerrar/);
  assert.equal(prechecks, 1, 'Un cierre fallido no vuelve a verificar');
  assert.ok(boton('Cerrar inscripción'));
  fallarCierre = false;
  await act(async () => { const b = boton('Cerrar inscripción'); b.click(); b.click(); });
  assert.equal(cierres, 2, 'Un intento fallido y uno en curso, sin doble envío');
  assert.ok(boton('Cerrando inscripción…').disabled); assert.equal(prechecks, 1);
  await act(async () => liberarCierre());
  assert.equal(prechecks, 2); assert.deepEqual(eventos.slice(-2), ['cerrar', 'verificar']);
  assert.ok(!document.querySelector('.pc-inscripcion-notice'));
  pre.sesionReiniciada = true;
  await click(boton('Volver a los conflictos'));
  await click(boton('Volver a verificar'));
  assert.equal(document.querySelector('.pc-session-notice').textContent.trim(), 'Pasó mucho tiempo sin cambios o se reinició el servidor, así que volvimos a armar los horarios. Los horarios que agregaste a las parejas siguen guardados, pero revisá los partidos que habías fijado: pueden haber cambiado.');
  pre.sesionReiniciada = false;
  await click(boton('Volver a verificar'));
  assert.ok(!document.querySelector('.pc-session-notice'));
  console.log('PASS DOM: horario quitado con dos parejas y badge en lista/recorrido, avisos de sesión y cierre de inscripción interceptado con re-check, error y doble envío');
} finally { await act(async () => root.unmount()); await servidor.close(); dom.window.close(); }
