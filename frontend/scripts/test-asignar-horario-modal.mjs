import assert from 'node:assert/strict';
// Modal "Asignar horario" de Día de torneo: se ve y se lee como el pre-check, sin cancha (jsdom).
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { JSDOM } = createRequire(import.meta.url)(process.env.FIXI_JSDOM_MODULE || 'jsdom');
import { createServer } from 'vite';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost:5175' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
  HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: class { observe() {} disconnect() {} } });
const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true }, appType: 'custom' });
try {
  const { default: Modal } = await server.ssrLoadModule('/src/components/AsignarHorarioModal.jsx');
  const inicios = (dia, desde, hasta) => {
    const lista = [];
    for (let m = desde; m <= hasta; m += 15) lista.push({ slotId: `${dia}-${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` });
    return lista;
  };
  const p1 = { id: 'p1', jugador1: 'Coria', jugador2: 'Giuliani', slotsSeleccionados: inicios('Viernes', 18 * 60, 20 * 60 + 15) };
  const p2 = { id: 'p2', jugador1: 'Mendoza', jugador2: 'Ávalos', slotsSeleccionados: inicios('Viernes', 18 * 60, 19 * 60 + 45) };
  const p3 = { id: 'p3', jugador1: 'Pellegrini', jugador2: 'Cepeda' };
  const zona = { id: 'zf', nombre: 'Zona F', partidos: [
    { id: 'm1', posicionEnRonda: 1, fechaHora: '2026-11-06T21:00:00.000Z', canchaNumero: 3, sinHorarioAsignado: false, esBye: false, pareja1: p2, pareja2: p3 },
    { id: 'm2', posicionEnRonda: 2, fechaHora: '2026-11-06T22:45:00.000Z', canchaNumero: 6, sinHorarioAsignado: false, esBye: false, pareja1: p1, pareja2: p3 },
    { id: 'm3', posicionEnRonda: 3, fechaHora: null, canchaNumero: null, sinHorarioAsignado: true, esBye: false, pareja1: p1, pareja2: p2 },
  ] };
  const partido = { id: 'm3', categoria: { id: 'c', nombre: '7ma' }, categoriaId: 'c', zonaId: 'zf', zona,
    pareja1Id: 'p1', pareja2Id: 'p2', pareja1: p1, pareja2: p2, fechaHora: null, canchaNumero: null };
  const slot = (slotId, iso) => ({ slotId, dia: slotId.split('-')[0], hora: slotId.split('-')[1], fechaIso: iso, canchasLibres: [3, 5], parejasOcupadasIds: [] });
  const slots = [slot('Viernes-16:00', '2026-11-06T19:00:00.000Z'), slot('Viernes-22:45', '2026-11-07T01:45:00.000Z'),
    slot('Sabado-21:00', '2026-11-08T00:00:00.000Z'), slot('Domingo-10:00', '2026-11-08T13:00:00.000Z')];
  const asignaciones = [];
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).includes('/canchas-disponibles')) return new Response(JSON.stringify({ slots }));
    if (String(url).endsWith('/asignar-horario-manual')) {
      asignaciones.push(JSON.parse(opts.body));
      return new Response(JSON.stringify({ partido: { categoria: { nombre: '7ma' } }, advertencias: [], dieciseisavosProgramados: 6 }));
    }
    throw Error(`Petición no interceptada ${url}`);
  };
  const root = createRoot(document.querySelector('#root'));
  let asignado = null, cerrado = 0;
  const render = (p) => act(async () => root.render(React.createElement(MemoryRouter, null,
    React.createElement(Modal, { isOpen: true, partido: p, torneoId: 't', onClose: () => { cerrado++; }, onAssigned: (r) => { asignado = r; } }))));
  const esperar = async (cond) => { for (let i = 0; i < 50 && !cond(); i++) await act(async () => new Promise((r) => setTimeout(r, 20))); };
  const boton = (texto) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(texto));

  await render(partido);
  await esperar(() => boton('Asignar este horario'));
  const texto = () => document.body.textContent;
  assert.equal(document.querySelector('#pm-schedule-title').textContent, 'Asignar horario');
  assert.match(texto(), /7ma · Zona F/);
  assert.equal(document.querySelector('.pc-horarios-parejas').textContent,
    'Coria / Giuliani pueden viernes de 18 a 21:30 h · Mendoza / Ávalos pueden viernes de 18 a 21 h');
  const filas = [...document.querySelectorAll('.pc-propuesta-partidos li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim());
  assert.deepEqual(filas, ['Mendoza / Ávalos vs Pellegrini / Cepeda · viernes 18:00', 'Coria / Giuliani vs Pellegrini / Cepeda · viernes 19:45']);
  assert.match(document.querySelector('.pm-asignar-recomendado').textContent,
    /Recomendado: viernes 16:00Coria \/ Giuliani: 2 h antes · Mendoza \/ Ávalos: 2 h antes/);
  assert.ok(!/cancha/i.test(texto()), 'No se muestra la cancha en ningún lado');
  assert.ok(!/Coincidían|Mejor opción|alternativas|-2h/.test(texto()), 'Sin los textos del diseño viejo');
  assert.equal(document.querySelectorAll('.pm-primary').length, 1, 'Un solo botón principal');
  assert.equal(document.querySelector('[role="grid"]'), null, 'La grilla arranca plegada');

  // Grilla plegada: los horarios de zona (viernes y sábado), con la estrella en el recomendado
  await act(async () => boton('Ver todos los horarios (3)').click());
  assert.ok(document.querySelector('[data-clave="Viernes-16:00"] .pc-horarios-estrella'));
  assert.equal(document.querySelector('[data-clave="Viernes-22:45"]').textContent, '22:45');
  assert.equal(document.querySelector('[data-clave="Domingo-10:00"]'), null, 'Partidos de zona: solo viernes y sábado');
  assert.deepEqual([...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent), ['viernes', 'sábado']);
  await act(async () => document.querySelector('[data-clave="Viernes-22:45"]').click());
  assert.match(document.querySelector('.pm-asignar-confirmacion').textContent, /viernes 22:45 · Coria \/ Giuliani: 2 h 30 min después · Mendoza \/ Ávalos: 3 h después/);
  await act(async () => boton('Confirmar').click());
  assert.deepEqual(asignaciones.at(-1), { slotId: 'Viernes-22:45', canchaNumero: 3 }, 'Asigna la primera cancha libre, como hoy');
  assert.equal(asignado.dieciseisavosProgramados, 6, 'La respuesta llega a quien abrió el modal');
  assert.equal(cerrado, 1);

  // Recomendado en un clic
  await render({ ...partido });
  await esperar(() => boton('Asignar este horario'));
  await act(async () => boton('Asignar este horario').click());
  assert.deepEqual(asignaciones.at(-1), { slotId: 'Viernes-16:00', canchaNumero: 3 });

  // Partido del cuadro sin parejas: solo recomendado y grilla
  await render({ id: 'r', categoria: { id: 'c', nombre: '7ma' }, faseEliminatoriaId: 'f', faseEliminatoria: { id: 'f', nombre: 'Dieciseisavos de Final', ronda: 32 },
    pareja1Id: null, pareja2Id: null, origenPareja1: '2º Zona J', origenPareja2: '2º Zona K', fechaHora: null });
  await esperar(() => boton('Asignar este horario'));
  assert.match(texto(), /7ma · Dieciseisavos/);
  assert.match(texto(), /2º Zona J vs 2º Zona K/);
  assert.equal(document.querySelector('.pc-horarios-parejas'), null);
  assert.equal(document.querySelector('.pc-propuesta-partidos'), null);
  assert.match(document.querySelector('.pm-asignar-recomendado').textContent, /Recomendado: sábado 21:00/);
  await act(async () => boton('Ver todos los horarios (1)').click());
  assert.equal(document.querySelectorAll('[role="tab"]').length, 1, 'Solo las jornadas con horarios');
  await act(async () => root.unmount());
} finally {
  await server.close();
}
