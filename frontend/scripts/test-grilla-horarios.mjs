import assert from 'node:assert/strict';
import { agruparInicios, describirAmpliacion, esSecundario, filasVisibles, describirHorarioPareja, detallePorPareja, moverCelda } from '../src/components/grillaHorarios.js';

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

// Detalle por pareja: antes, después, día nuevo y horario de cada una
const nombresDetalle = new Map([['c', 'Coria / Giuliani'], ['m', 'Mendoza / Ávalos']]);
const ampliar = (slotId, ampliacionPorPareja) => ({ slotId, parejasAAmpliar: ampliacionPorPareja.map((a) => a.parejaId), ampliacionPorPareja });
assert.deepEqual(detallePorPareja(ampliar('Viernes-16:00', [
  { parejaId: 'c', diaNuevo: false, minutosAntes: 120, minutosDespues: 0 },
  { parejaId: 'm', diaNuevo: false, minutosAntes: 120, minutosDespues: 0 },
]), nombresDetalle).map((d) => `${d.nombre}: ${d.texto}`), ['Coria / Giuliani: 2 h antes', 'Mendoza / Ávalos: 2 h antes'], 'Antes');
assert.equal(describirAmpliacion({ diaNuevo: false, minutosAntes: 0, minutosDespues: 45 }, 'Viernes'), '45 min después', 'Después');
assert.equal(describirAmpliacion({ diaNuevo: false, minutosAntes: 0, minutosDespues: 75 }, 'Viernes'), '1 h 15 min después');
assert.equal(describirAmpliacion({ diaNuevo: true, minutosAntes: 0, minutosDespues: 0 }, 'Sabado'), 'el sáb, que no tenía cargado', 'Día nuevo');
assert.deepEqual(detallePorPareja({ slotId: 'Viernes-16:00', parejasAAmpliar: ['x'] }).map((d) => d.texto), ['sumar este horario'],
  'Sin el detalle del backend no inventa minutos');
assert.equal(describirHorarioPareja({ cargado: true, ventanas: [{ dia: 'Viernes', desde: '18:00', hasta: '21:30' }] }), 'vie de 18 a 21:30 h');
assert.equal(describirHorarioPareja({ cargado: true, ventanas: [{ dia: 'Viernes', desde: '13:00', hasta: '15:00' },
  { dia: 'Viernes', desde: '18:00', hasta: '00:30' }, { dia: 'Sabado', desde: '10:00', hasta: '13:15' }] }),
  'vie de 13 a 15 h, de 18 a 0:30 h y sáb de 10 a 13:15 h', 'Varios bloques y trasnoche');
assert.equal(describirHorarioPareja({ cargado: false, ventanas: [{ dia: 'Viernes', desde: '09:00', hasta: '23:00' }] }), null,
  'Sin horario cargado');

// Grilla sin huecos: los horarios de cada hora quedan juntos a la izquierda
const sueltos = [opcion('Viernes-18:15', '2026-11-06T21:15:00Z'), opcion('Viernes-18:30', '2026-11-06T21:30:00Z', 'NO_DISPONIBLE'),
  opcion('Viernes-18:45', '2026-11-06T21:45:00Z', 'PEDIR_VARIAS'), opcion('Viernes-19:00', '2026-11-06T22:00:00Z', 'PEDIR_VARIAS'),
  opcion('Viernes-22:30', '2026-11-07T01:30:00Z', 'PEDIR_1'), opcion('Viernes-23:00', '2026-11-07T02:00:00Z'),
  opcion('Viernes-00:15', '2026-11-07T03:15:00Z')];
const [conHuecos] = agruparInicios(sueltos);
const filasTodas = filasVisibles(conHuecos.filas);
assert.deepEqual(filasTodas.map((f) => [f.hora, f.celdas.map((c) => c?.slotId.split('-')[1] ?? null), f.salto]), [
  ['18', ['18:15', '18:45', null, null], false],
  ['19', ['19:00', null, null, null], false],
  ['22', ['22:30', null, null, null], true],
  ['23', ['23:00', null, null, null], false],
  ['00', ['00:15', null, null, null], false],
], 'Sin huecos ni horas vacías; marca el salto de 19 a 22 y la trasnoche sigue a las 23');
assert.deepEqual(filasVisibles(conHuecos.filas, { conSecundarios: false }).map((f) => [f.hora, f.salto]),
  [['18', false], ['22', true], ['23', false], ['00', false]], 'Plegados los que piden a varias, el salto se calcula sobre lo visible');
assert.ok(esSecundario({ estado: 'PEDIR_VARIAS' }) && !esSecundario({ estado: 'PEDIR_1' }) && !esSecundario({ estado: 'ENTRA' }));
assert.equal(moverCelda(filasTodas, 0, 0, 'ArrowRight').slotId, 'Viernes-18:45', 'Las flechas siguen funcionando');
assert.equal(moverCelda(filasTodas, 1, 0, 'ArrowDown').slotId, 'Viernes-22:30', 'Bajan por encima del salto');
console.log('PASS: cronología, trasnoche, jornadas, huecos, navegación por teclado, por qué no entra, detalle por pareja y filas visibles');
