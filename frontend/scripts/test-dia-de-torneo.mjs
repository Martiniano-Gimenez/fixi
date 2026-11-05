import assert from 'node:assert/strict';
// Día de torneo compacto: resumen en una línea, sin número de cancha, próximos agrupados por hora (jsdom).
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
const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true }, appType: 'custom' });
try {
  const { default: TorneoEnVivo } = await server.ssrLoadModule('/src/pages/admin/TorneoEnVivo.jsx');
  // Viernes 6/11/2026 (hora argentina = UTC-3)
  const base = { categoria: '7ma Damas', zona: 'Zona C', pareja1Id: 'a', pareja2Id: 'b', canchaNumero: 4, sets: [] };
  const datos = {
    torneo: { id: 't', nombre: 'Impares Noviembre', estado: 'EN_CURSO', fecha: '2026-11-06T03:00:00.000Z',
      horariosClub: { viernesInicio: '09:00', viernesFin: '03:00', sabadoInicio: '08:00', sabadoFin: '03:00', domingoInicio: '08:00', domingoFin: '23:00' } },
    canchasClub: 6, canchasPorDia: {}, categorias: [], categoriasListasParaEliminatoria: [], partidosEnCanchaFantasma: [],
    partidosEnCurso: [{ ...base, id: 'v', pareja1: 'Caruso / Vallejos', pareja2: 'Alcaraz / Lombardi', fechaHora: '2026-11-06T17:00:00.000Z', horaInicio: '2026-11-06T17:05:00.000Z', sets: [{ gamesPareja1: 3, gamesPareja2: 2 }] }],
    proximosPartidos: [
      { ...base, id: 'p1', pareja1: 'Dávila / Arrieta', pareja2: 'Tapia / Nieva', fechaHora: '2026-11-06T18:00:00.000Z' },
      { ...base, id: 'p2', categoria: '7ma', zona: 'Zona F', pareja1: 'Coria / Giuliani', pareja2: 'Mendoza / Ávalos', fechaHora: '2026-11-06T18:00:00.000Z' },
      { ...base, id: 'p3', categoria: '7ma', zona: null, fase: 'Dieciseisavos de Final', pareja1: 'Monti / Lugones', pareja2: 'Monzón / Bazán', fechaHora: '2026-11-07T04:30:00.000Z' },
    ],
    partidosFinalizados: [{ ...base, id: 'f', pareja1: 'Maidana / Valentini', pareja2: 'Albornoz / Ponce', ganadorId: 'a', fechaHora: '2026-11-06T16:00:00.000Z', sets: [{ gamesPareja1: 6, gamesPareja2: 2 }, { gamesPareja1: 6, gamesPareja2: 3 }] }],
    resumenEstado: { totalPartidos: 5, enCurso: 1, pendientesConHorario: 3, finalizados: 1, pendientesSinHorario: 0 },
  };
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/en-vivo')) return new Response(JSON.stringify(datos));
    if (String(url).endsWith('/partidos-sin-horario')) return new Response(JSON.stringify([]));
    throw Error(`Petición no interceptada ${url}`);
  };
  const root = createRoot(document.querySelector('#root'));
  await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: ['/admin/torneos/t/en-vivo'] },
    React.createElement(Routes, null, React.createElement(Route, { path: '/admin/torneos/:id/en-vivo', element: React.createElement(TorneoEnVivo) })))));
  for (let i = 0; i < 50 && !document.querySelector('.dt-resumen'); i++) await act(async () => new Promise((r) => setTimeout(r, 20)));
  const texto = (sel) => document.querySelector(sel)?.textContent.replace(/\s+/g, ' ').trim();

  // Pestaña del viernes (tiene el partido en juego)
  assert.equal(texto('.dt-resumen'), '5 partidos · 1 en juego · 1 finalizado');
  assert.equal(texto('.dt-resumen-vivo'), '1 en juego');
  assert.ok(!document.querySelector('.dt-stats'), 'Sin los recuadros de antes');
  assert.ok(!/Cancha \d|C4\b/.test(document.querySelector('.dt-match-columns').textContent), 'Sin número de cancha');
  const enJuego = document.querySelector('.dt-current-match');
  assert.equal(texto('.dt-current-match .dt-pair-names'), 'Caruso / Vallejos vs Alcaraz / Lombardi');
  assert.ok([...enJuego.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Quitar de en juego'));
  assert.ok(document.querySelector('.dt-current-match').compareDocumentPosition(document.querySelector('.dt-upcoming-match')) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
    'En juego va antes que próximos');
  const titulos = [...document.querySelectorAll('.dt-hour-title')].map((h) => h.textContent);
  assert.deepEqual(titulos, ['15:00', '01:30 · madrugada del sábado'], 'Un título por horario; la madrugada cuenta para el viernes');
  const primerGrupo = document.querySelector('.dt-hour-group');
  assert.equal(primerGrupo.querySelectorAll('.dt-upcoming-match').length, 2);
  assert.equal(texto('.dt-upcoming-match .dt-pair-names'), 'Dávila / Arrieta vs Tapia / Nieva');
  assert.equal(texto('.dt-upcoming-match .dt-muted'), '7ma Damas · Zona C');
  assert.ok(!primerGrupo.textContent.includes('15:00 ') || primerGrupo.querySelectorAll('.dt-match-time').length === 0, 'Sin repetir la hora en cada tarjeta');

  // Finalizados del viernes
  const toggle = document.querySelector('.dt-finished-toggle');
  assert.equal(toggle.textContent.trim(), 'Finalizados del viernes (1)');
  await act(async () => toggle.click());
  const fin = document.querySelector('.dt-finished-match');
  assert.ok(!/\bC4\b|Cancha/.test(fin.textContent), 'Finalizados sin cancha');
  assert.ok(fin.querySelector('.is-winner').textContent === 'Maidana / Valentini');
  assert.ok([...fin.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Editar'));

  // Todo el torneo: los títulos llevan el día
  const todo = [...document.querySelectorAll('button')].find((b) => /todo/i.test(b.textContent));
  assert.ok(todo, 'Hay pestaña de todo el torneo');
  await act(async () => todo.click());
  const titulosTodo = [...document.querySelectorAll('.dt-hour-title')].map((h) => h.textContent);
  assert.deepEqual(titulosTodo, ['vie 15:00', 'sáb 01:30']);

  // Sin partidos en juego, la sección no se muestra
  datos.partidosEnCurso = [];
  await act(async () => root.unmount());
  const root2 = createRoot(document.querySelector('#root'));
  await act(async () => root2.render(React.createElement(MemoryRouter, { initialEntries: ['/admin/torneos/t/en-vivo'] },
    React.createElement(Routes, null, React.createElement(Route, { path: '/admin/torneos/:id/en-vivo', element: React.createElement(TorneoEnVivo) })))));
  for (let i = 0; i < 50 && !document.querySelector('.dt-resumen'); i++) await act(async () => new Promise((r) => setTimeout(r, 20)));
  assert.equal(document.querySelector('.dt-live-title'), null);
  assert.ok(!document.body.textContent.includes('Partidos en juego'));
  await act(async () => root2.unmount());
} finally {
  await server.close();
}
process.exit(0); // la página deja un intervalo de actualización
