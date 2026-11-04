import assert from 'node:assert/strict';
// Partidos de la zona en cada partido sin horario del pre-check (jsdom, como las demás pruebas de pantalla).
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { JSDOM } = createRequire(import.meta.url)(process.env.FIXI_JSDOM_MODULE || 'jsdom');
import { createServer } from 'vite';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { listarPendientes } from '../src/pages/admin/recorridoPartidos.js';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost:5175' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
  HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: class { observe() {} disconnect() {} } });
const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { middlewareMode: true }, appType: 'custom' });
try {
  const { default: Elegir } = await server.ssrLoadModule('/src/components/ElegirHorarioPartido.jsx');
  const parejasZona = [
    { id: 'p1', nombre: 'Coria / Giuliani' }, { id: 'p2', nombre: 'Mendoza / Ávalos' }, { id: 'p3', nombre: 'Pellegrini / Cepeda' },
  ];
  const partidosZona = [
    { posicionEnRonda: 1, pareja1Id: 'p1', pareja2Id: 'p3', fechaHora: '2026-11-06T22:45:00.000Z', canchaNumero: 6, estado: 'FIJO' },
    { posicionEnRonda: 2, pareja1Id: 'p2', pareja2Id: 'p3', fechaHora: '2026-11-06T21:00:00.000Z', canchaNumero: 3, estado: 'FIJO' },
    { posicionEnRonda: 3, pareja1Id: 'p1', pareja2Id: 'p2', fechaHora: null, canchaNumero: null, estado: 'PENDIENTE' },
  ];
  // Opciones que antes armaban "Coinciden el vie de 18 a 21 h, pero en ese horario ya juegan…"
  const opciones = ['18:00', '18:15'].map((hora, i) => ({ clave: `k${i}`, slotId: `Viernes-${hora}`, fechaHora: `2026-11-06T${hora}:00Z`,
    estado: 'NO_DISPONIBLE', motivo: 'PAREJA_OCUPADA', parejasAAmpliar: [], ampliacionPorPareja: [], parejasOcupadas: ['p2'] }));
  const horariosParejas = [
    { parejaId: 'p1', cargado: true, ventanas: [{ dia: 'Viernes', desde: '18:00', hasta: '21:30' }] },
    { parejaId: 'p2', cargado: true, ventanas: [{ dia: 'Viernes', desde: '18:00', hasta: '21:00' }] },
  ];
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/partidos/opciones')) return new Response(JSON.stringify({ revision: 'r1', opciones, horariosParejas }));
    throw Error(`Petición no interceptada ${url}`);
  };
  const parejas = [{ id: 'p1', nombre: 'Coria / Giuliani', slotIds: [] }, { id: 'p2', nombre: 'Mendoza / Ávalos', slotIds: [] }];
  const root = createRoot(document.querySelector('#root'));
  const render = (motivo) => act(async () => root.render(React.createElement(Elegir, {
    key: motivo, torneoId: 't', categoriaId: 'c', zonaId: 'z', revision: 'r1', mostrarPartido: false,
    partido: { posicionEnRonda: 3, pareja1Id: 'p1', pareja2Id: 'p2', motivo, estado: 'PENDIENTE' },
    parejas, partidosZona, parejasZona, abierto: null, onAbiertoChange: () => {}, onSaved: () => {}, onRecheck: () => {},
  })));
  const filas = () => [...document.querySelectorAll('.pc-propuesta-partidos li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim());

  // "No entra en su horario": lista de la zona sin abrir la grilla, y sin la frase vieja
  await render('SIN_CANCHA_DISPONIBLE');
  for (let i = 0; i < 50 && !document.querySelector('.pc-horarios-parejas'); i++) {
    await act(async () => new Promise((r) => setTimeout(r, 20)));
  }
  assert.equal(document.querySelector('.pc-propuesta-partidos-title').textContent, 'Partidos de la zona');
  const lista = filas();
  assert.equal(lista.length, 2, 'Solo los otros partidos de la zona');
  assert.match(lista[0], /^Mendoza \/ Ávalos vs Pellegrini \/ Cepeda · vie 18:00 · Cancha 3$/, 'Ordenados por horario, con la tercera pareja');
  assert.match(lista[1], /^Coria \/ Giuliani vs Pellegrini \/ Cepeda · vie 19:45 · Cancha 6$/);
  assert.ok(document.querySelector('.pc-horarios-parejas'), 'El horario de cada pareja se queda');
  assert.ok(!document.body.textContent.includes('Coinciden'), 'Sin la frase de por qué no entra');
  assert.ok(!document.body.textContent.includes('canchas están ocupadas'));

  // Sin horario en común: la misma lista, sin pedir nada al servidor
  globalThis.fetch = async (url) => { throw Error(`No debería pedir nada: ${url}`); };
  await render('SIN_FRANJA_COMUN');
  assert.equal(filas().length, 2);
  assert.ok(!document.body.textContent.includes('Coinciden'));

  // Un partido de la zona sin horario muestra "sin horario"
  partidosZona[1] = { ...partidosZona[1], fechaHora: null, canchaNumero: null, estado: 'PENDIENTE' };
  await render('SIN_FRANJA_COMUN');
  assert.match(filas()[1], /^Mendoza \/ Ávalos vs Pellegrini \/ Cepeda sin horario$/, 'Los que no tienen horario van al final');
  await act(async () => root.unmount());

  // "Resolver de a uno" recibe los partidos y las parejas de la zona
  const [pendiente] = listarPendientes([{ categoriaId: 'c', nombreCategoria: '7ma', partidosSinHorario: [{
    zonaId: 'z', zona: 'Zona F', posicionEnRonda: 3, motivo: 'SIN_CANCHA_DISPONIBLE', pareja1Id: 'p1', pareja2Id: 'p2',
    pareja1: 'Coria / Giuliani', pareja2: 'Mendoza / Ávalos', partidosZona, parejasZona,
  }] }]);
  assert.equal(pendiente.partidosZona, partidosZona);
  assert.equal(pendiente.parejasZona, parejasZona);
} finally {
  await server.close();
}
