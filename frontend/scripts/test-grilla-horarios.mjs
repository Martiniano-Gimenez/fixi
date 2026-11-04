import assert from 'node:assert/strict';
import { agruparInicios, explicarPorQueNoEntra, moverCelda } from '../src/components/grillaHorarios.js';

const opcion = (slotId, fechaHora, estado = 'ENTRA') => ({ slotId, fechaHora, estado, clave: slotId });
const opciones = [
  opcion('Sabado-00:15', '2026-11-08T03:15:00Z'),
  opcion('Viernes-00:00', '2026-11-07T03:00:00Z'),
  opcion('Viernes-15:45', '2026-11-06T18:45:00Z', 'ENTRA'),
  opcion('Viernes-15:30', '2026-11-06T18:30:00Z', 'PEDIR_VARIAS'),
  opcion('Viernes-15:15', '2026-11-06T18:15:00Z', 'NO_DISPONIBLE'),
];
const original = structuredClone(opciones);
const [viernes, sabado] = agruparInicios(opciones);
assert.deepEqual(viernes.filas.map((f) => f.hora), ['15', '00'], 'Trasnoche al final de su jornada');
assert.equal(sabado.filas[0].celdas[1].slotId, 'Sabado-00:15');
assert.equal(viernes.filas[0].celdas[0], null, 'Los minutos fuera del club quedan vacíos');
assert.equal(viernes.filas[0].celdas[2].estado, 'PEDIR_VARIAS', 'La disponibilidad no cambia el orden');
assert.equal(moverCelda(viernes.filas, 0, 2, 'ArrowLeft').estado, 'NO_DISPONIBLE', 'Se puede explorar el motivo con teclado');
assert.equal(moverCelda(viernes.filas, 0, 1, 'Home').slotId, 'Viernes-15:15');
assert.equal(moverCelda(viernes.filas, 0, 1, 'End').slotId, 'Viernes-15:45');
assert.equal(moverCelda(viernes.filas, 0, 3, 'ArrowRight').slotId, 'Viernes-00:00', 'Sigue por la trasnoche');
assert.equal(moverCelda(viernes.filas, 1, 0, 'ArrowUp'), null, 'No enfoca celdas vacías');
assert.equal(moverCelda(viernes.filas, 1, 0, 'ArrowDown'), null, 'No sale de la grilla');
assert.equal(moverCelda(viernes.filas, 0, 1, 'Tab'), null, 'Tab sigue su navegación nativa');
assert.deepEqual(agruparInicios([]).map((d) => d.filas), [[], []]);
assert.deepEqual(opciones, original);

// Por qué no entra un partido (línea debajo de "No entra en su horario")
const bloqueada = (hora, motivo, parejasAAmpliar = []) => ({ slotId: `Viernes-${hora}`, estado: 'NO_DISPONIBLE', motivo, parejasAAmpliar });
const cuartos = (desde, hasta) => {
  const lista = [];
  for (let m = desde; m <= hasta; m += 15) lista.push(`${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`);
  return lista;
};
const minutos = (h, m = 0) => h * 60 + m;
assert.equal(explicarPorQueNoEntra(cuartos(minutos(19), minutos(19)).map((h) => bloqueada(h, 'SIN_CANCHA'))),
  'Pueden las dos el vie de 19 a 20:15 h, pero todas las canchas están ocupadas.', 'Solo cancha');
assert.equal(explicarPorQueNoEntra(cuartos(minutos(18), minutos(19, 45)).map((h) => bloqueada(h, 'PAREJA_OCUPADA'))),
  'Coinciden el vie de 18 a 21 h, pero en ese horario ya juegan sus otros partidos de la zona.', 'Solo pareja ocupada');
const mezcla = [bloqueada('19:00', 'SIN_CANCHA'), ...cuartos(minutos(19, 15), minutos(20, 45)).map((h) => bloqueada(h, 'PAREJA_OCUPADA')),
  bloqueada('22:00', 'SIN_CANCHA', ['p1']), { slotId: 'Viernes-17:00', estado: 'PEDIR_1', motivo: null, parejasAAmpliar: ['p1'] }];
assert.equal(explicarPorQueNoEntra(mezcla),
  'Coinciden el vie de 19 a 22 h. Libres las dos, solo de 19 a 20:15 h, y a esa hora todas las canchas están ocupadas.',
  'Las dos cosas; no cuenta los horarios que piden ampliar');
assert.equal(explicarPorQueNoEntra([bloqueada('19:00', 'SIN_CANCHA')], true),
  'Pueden las cuatro el vie de 19 a 20:15 h, pero todas las canchas están ocupadas.', 'Definición: las cuatro');
assert.equal(explicarPorQueNoEntra([bloqueada('19:00', 'SIN_CANCHA', ['p1']), bloqueada('20:00', 'ESPERA_BASES')]), null,
  'Sin horarios donde coincidan, no hay línea');
console.log('PASS: cronología, trasnoche, jornadas, huecos, navegación por teclado y por qué no entra');
