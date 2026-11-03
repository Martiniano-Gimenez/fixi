// jsdom 26.1.0 es una dependencia de pruebas opcional. FIXI_JSDOM_MODULE acepta su ruta absoluta.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

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
  const parejas = [{ id: 'p1', nombre: 'Caruso / Vallejos', slotIds: [] }, { id: 'p2', nombre: 'Dávila / Arrieta', slotIds: [] }];
  const manual = (fijos = []) => ({ zonaId: 'manual', zona: 'Zona E', motivo: 'ZONA_MANUAL_INCOMPLETA', parejasManuales: parejas,
    partidosZona: [1, 2, 3].map((posicionEnRonda) => ({ posicionEnRonda, pareja1Id: 'p1', pareja2Id: 'p2',
      estado: fijos.includes(posicionEnRonda) ? 'FIJO' : 'PENDIENTE' })) });
  const suelto = (zonaId) => ({ zonaId, zona: 'Zona B', posicionEnRonda: 1, motivo: 'SIN_CANCHA_DISPONIBLE',
    pareja1Id: 'p1', pareja1: 'Caruso / Vallejos', pareja2Id: 'p2', pareja2: 'Dávila / Arrieta', opcionesResolucion: [{}] });
  const categoria = (categoriaId, nombreCategoria, partidosSinHorario) => ({ categoriaId, nombreCategoria, partidosSinHorario });
  const pre1 = { revision: 'r1', bloqueado: true, conflictos: [categoria('c', '7ma Damas', [manual()]), categoria('d', '5ta', [suelto('suelta')])],
    grillaOrganizador: { viernes: ['Viernes-15:00'], sabado: [], domingo: [] } };
  const pre2 = { ...pre1, revision: 'r2', conflictos: [categoria('n', '8va', [suelto('nueva')]), categoria('d', '5ta', [suelto('suelta')]), categoria('c', '7ma Damas', [manual([1, 2])])] };
  const completo = { ...pre1, revision: 'r3', bloqueado: false, conflictos: [], planId: 'plan' };
  let actual = pre1, prechecks = 0, fijaciones = 0, propuestas = 0, fallar = false;
  globalThis.fetch = async (url, opts = {}) => {
    const ruta = String(url);
    if (ruta.endsWith('/torneos/fixture') && !opts.method) return new Response(JSON.stringify({ nombre: 'Prueba', categorias: [{ estado: 'BORRADOR', parejas: [{}, {}] }] }));
    if (ruta.endsWith('/pre-check-inicio')) { prechecks++; return new Response(JSON.stringify(actual)); }
    if (ruta.endsWith('/propuestas')) { propuestas++; return new Response(JSON.stringify({ revision: actual.revision, propuestasZona: [] })); }
    if (ruta.endsWith('/partidos/opciones')) {
      const body = JSON.parse(opts.body);
      assert.equal(body.revision, actual.revision);
      return new Response(JSON.stringify({ revision: actual.revision, opciones: [{ clave: 'inicio', slotId: 'Viernes-15:00', fechaHora: '2026-11-06T18:00:00Z',
        estado: 'ENTRA', motivo: null, parejasAAmpliar: [], parejasOcupadas: [], verificada: false }] }));
    }
    if (ruta.endsWith('/partidos/fijar')) {
      fijaciones++;
      if (fallar) return new Response(JSON.stringify({ error: 'El horario venció', codigo: 'OPCION_VENCIDA' }), { status: 409 });
      actual = fijaciones === 1 ? pre2 : completo;
      return new Response(JSON.stringify(actual));
    }
    throw new Error(`Petición no interceptada: ${ruta}`);
  };
  const arbol = React.createElement(MemoryRouter, { initialEntries: ['/admin/torneos/fixture/iniciar'] },
    React.createElement(Routes, null, React.createElement(Route, { path: '/admin/torneos/:id/iniciar', element: React.createElement(TorneoInicio) })));
  const click = async (elemento) => { assert.ok(elemento); await act(async () => elemento.click()); };
  const boton = (texto) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === texto);
  const mover = (texto) => document.querySelector(`.pc-resolver [aria-label="${texto}"]`);
  const contador = () => document.querySelector('.pc-resolver [role="status"]').textContent;
  const contexto = () => document.querySelector('.pc-resolver-contexto').textContent;
  await act(async () => root.render(arbol));
  assert.equal(prechecks, 1);
  await click(boton('Resolver de a uno'));
  for (let i = 0; i < 50 && !document.querySelector('.pc-resolver [data-clave="inicio"]'); i++) {
    await act(async () => new Promise((r) => setTimeout(r, 20)));
  }
  assert.match(contador(), /1 de 4 pendientes/); assert.match(contexto(), /Partido 1/);
  assert.ok(!document.querySelector('.pc-conflict-list'), 'La lista no dispara búsquedas ocultas mientras se resuelve');
  await click(mover('Partido siguiente')); assert.match(contador(), /2 de 4/);
  await click(mover('Partido anterior')); assert.match(contador(), /1 de 4/);
  const propuestasAntes = propuestas;
  await click(document.querySelector('.pc-resolver [data-clave="inicio"]')); await click(boton('Confirmar'));
  assert.match(contexto(), /7ma Damas · Zona E · Partido 3/);
  assert.match(contador(), /Horario confirmado\. 1 de 3 pendientes/);
  assert.equal(prechecks, 1, 'Adopta el re-check devuelto por fijar, sin otra petición');
  assert.equal(propuestas, propuestasAntes, 'No recalcula propuestas automáticas en segundo plano');
  assert.equal(document.activeElement.className, 'pc-resolver-titulo');
  await click(mover('Partido siguiente')); assert.match(contexto(), /5ta/);
  await click(mover('Partido siguiente')); assert.match(contexto(), /8va/, 'Los nuevos se agregan al final');
  await click(mover('Partido anterior')); await click(mover('Partido anterior'));
  fallar = true;
  await click(document.querySelector('.pc-resolver [data-clave="inicio"]')); await click(boton('Confirmar'));
  assert.match(contexto(), /Partido 3/); assert.match(contador(), /1 de 3/);
  assert.match(document.querySelector('[role="alert"]').textContent, /venció/);
  assert.equal(prechecks, 2, 'Un 409 sí actualiza el pre-check');
  fallar = false;
  await click(document.querySelector('.pc-resolver [data-clave="inicio"]')); await click(boton('Confirmar'));
  assert.match(document.querySelector('.pc-resolver-titulo').textContent, /No quedan/);
  assert.equal(prechecks, 2); assert.equal(fijaciones, 3);
  await click(boton('Volver a los conflictos'));
  assert.ok(!document.querySelector('.pc-resolver')); assert.ok(document.querySelector('.pc-conflict-list'));
  assert.equal(document.activeElement.tagName, 'H1');
  console.log('PASS DOM: navegación, contador dinámico, resolución en cascada, nuevos conflictos, avance, revisión, foco, 409 y cierre; todas las peticiones interceptadas');
} finally {
  await act(async () => root.unmount()); await servidor.close(); dom.window.close();
}
