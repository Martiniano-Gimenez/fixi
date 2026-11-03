import assert from 'node:assert/strict';
import { agruparInicios, moverCelda } from '../src/components/grillaHorarios.js';

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
console.log('PASS: cronología, trasnoche, jornadas, huecos y navegación por teclado');
