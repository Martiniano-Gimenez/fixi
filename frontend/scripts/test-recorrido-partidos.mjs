import assert from 'node:assert/strict';
import { listarPendientes, actualizarRecorrido } from '../src/pages/admin/recorridoPartidos.js';

const partido = (posicionEnRonda, extra = {}) => ({ posicionEnRonda, estado: 'PENDIENTE', ...extra });
const categorias = [{ categoriaId: 'c', nombreCategoria: '7ma Damas', partidosSinHorario: [
  { motivo: 'SIN_CANCHA_DISPONIBLE', zonaId: 'b', zona: 'Zona B', posicionEnRonda: 1, pareja1Id: 'p1', pareja1: 'Una', pareja2Id: 'p2', pareja2: 'Otra' },
  { motivo: 'ZONA_MANUAL_INCOMPLETA', zonaId: 'a', zona: 'Zona A', parejasManuales: [{ id: 'p1', nombre: 'Una' }],
    partidosZona: [partido(4), partido(2), partido(1), partido(3, { estado: 'FIJO' }), partido(5, { esBye: true }), partido(6, { fechaHora: '2026-11-06', canchaNumero: 2 })] },
  { motivo: 'PARTIDO_SIN_HORARIO', zonaId: 'a', zona: 'Zona A', posicionEnRonda: 4, pareja1: 'Ganador P1 vs Ganador P2' },
] }];
const lista = listarPendientes(categorias);
assert.deepEqual(lista.map((p) => [p.zona, p.partido.posicionEnRonda]), [['Zona A', 1], ['Zona A', 2], ['Zona A', 4], ['Zona B', 1]], 'Expande zonas, deduplica y excluye agendados/byes');
assert.equal(lista[0].parejas[0].nombre, 'Una');
assert.equal(lista[3].parejas[1].nombre, 'Otra');
assert.equal(listarPendientes([{ ...categorias[0], partidosSinHorario: [categorias[0].partidosSinHorario[2]] }])[0].partido.origen, 'Ganador P1 vs Ganador P2');
const quitado = { ...categorias[0].partidosSinHorario[0], motivo: 'HORARIO_QUITADO' };
const pendienteQuitado = listarPendientes([{ ...categorias[0], partidosSinHorario: [quitado] }])[0];
assert.equal(pendienteQuitado.partido.origen, undefined);
assert.deepEqual(pendienteQuitado.parejas.map((p) => p.nombre), ['Una', 'Otra']);
let recorrido = actualizarRecorrido(null, lista);
assert.equal(recorrido.actual, lista[0].clave);
assert.equal(actualizarRecorrido(recorrido, lista), recorrido, 'No produce un ciclo de renders');
recorrido = { ...recorrido, actual: lista[1].clave };
const agregado = { ...lista[3], clave: 'nuevo' };
const renovados = [agregado, { ...lista[3] }, { ...lista[2] }];
recorrido = actualizarRecorrido(recorrido, renovados);
assert.deepEqual(recorrido.lista.map((p) => p.clave), [lista[2].clave, lista[3].clave, agregado.clave], 'Mantiene orden previo y agrega nuevos al final');
assert.equal(recorrido.actual, lista[2].clave, 'Salta los resueltos automáticamente y actualiza contador');
const mismoActual = actualizarRecorrido(recorrido, [...renovados].reverse());
assert.equal(mismoActual.actual, recorrido.actual, 'Un re-check no cambia un actual que sigue pendiente');
recorrido = { ...recorrido, actual: agregado.clave };
const otro = { ...agregado, clave: 'otro' };
recorrido = actualizarRecorrido(recorrido, [lista[2], lista[3], otro]);
assert.equal(recorrido.actual, otro.clave, 'Después del último, atiende los nuevos antes de volver al principio');
recorrido = actualizarRecorrido(recorrido, [lista[2], lista[3]]);
assert.equal(recorrido.actual, lista[2].clave, 'Vuelve al primer pendiente si ya no hay siguientes');
recorrido = actualizarRecorrido(recorrido, []);
assert.equal(recorrido.actual, null); assert.equal(recorrido.lista.length, 0);
console.log('PASS: lista real de pendientes, orden, bases MINI, deduplicación, reconciliación, nuevos conflictos y fin del recorrido');
