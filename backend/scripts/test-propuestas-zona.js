'use strict';

const { ensureTestDb } = require('./utils/testEnvGuard');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const prisma = require('../src/lib/prisma');
const { JWT_SECRET } = require('../src/config/env');
const { generarPropuestasZona, minutosFuera, calcularAmpliacion, compararCosto, sonPropuestasEquivalentes, seleccionarGrupos } = require('../src/utils/propuestasZona');
let generaciones = 0;
require('../src/utils/propuestasZona').generarPropuestasZona = (...args) => { generaciones++; return generarPropuestasZona(...args); };
const { startTestServer } = require('./utils/testServer');
const svc = require('../src/services/organizador.service');
const { verificarProgramacionZona } = require('../src/utils/programacionZona');
const { fusionarSlotsEnVentanas, slotIdToMsWindow } = require('../src/services/zona.service');
const { generarSlotsDia } = require('../src/services/slots.service');
const FECHA = new Date('2026-11-06T15:00:00Z');
const viernes = (a, b) => generarSlotsDia('Viernes', a, b);
const sabado = (a, b) => generarSlotsDia('Sabado', a, b);
const ventana = (slotId) => ({ slotId, ...slotIdToMsWindow(slotId, FECHA) });

function entrada(slots, { formato = 'ROUND_ROBIN', club = viernes('09:00', '23:00'), canchas = 2 } = {}) {
  const parejas = slots.map((s, i) => ({ id: `id-${i}`, orden: i + 1, ventanas: fusionarSlotsEnVentanas(s, FECHA) }));
  const cruces = [];
  if (formato === 'MINI_BRACKET') cruces.push([0, 1], [2, 3], [null, null], [null, null]);
  else for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) cruces.push([i, j]);
  return { formato, parejas, grilla: club.map(ventana), ventanasClub: fusionarSlotsEnVentanas(club, FECHA), cantidadCanchas: canchas,
    partidos: cruces.map(([a, b], i) => ({ posicionEnRonda: i + 1, pareja1Id: parejas[a]?.id, pareja2Id: parejas[b]?.id, sinHorarioAsignado: true })) };
}
function traducirIdsPropuesta(propuesta, ids) {
  return { ...propuesta, cambios: propuesta.cambios.map((c) => ({ ...c, parejaId: ids.get(c.parejaId) || c.parejaId })),
    partidosPropuestos: propuesta.partidosPropuestos.map((p) => ({ ...p,
      pareja1Id: ids.get(p.pareja1Id) || p.pareja1Id, pareja2Id: ids.get(p.pareja2Id) || p.pareja2Id })) };
}
function verificarPropuestas(e, resultado) {
  assert.ok(resultado.propuestas.length <= 3);
  const firmas = new Set();
  for (const p of resultado.propuestas) {
    for (const q of resultado.propuestas) if (p !== q) assert.equal(sonPropuestasEquivalentes(p, q), false, 'El top no contiene dos variantes del mismo grupo');
    assert.ok(p.cambios.length >= 1 && p.cambios.length <= 2);
    const firma = JSON.stringify(p.cambios);
    assert.ok(!firmas.has(firma)); firmas.add(firma);
    let minutos = 0, ampliacion = 0, dias = 0;
    const parejas = e.parejas.map((par) => {
      const nuevos = p.cambios.find((c) => c.parejaId === par.id)?.slotsToAdd || [];
      const ws = nuevos.map((s) => { assert.ok(e.grilla.some((g) => g.slotId === s)); return ventana(s); });
      minutos += minutosFuera(ws, par.ventanas);
      const costo = calcularAmpliacion(ws, par.ventanas);
      ampliacion += costo.minutosAmpliacion; dias += costo.diasNuevos;
      return { ...par, ventanas: [...par.ventanas, ...ws] };
    });
    assert.equal(p.minutosAgregados, minutos);
    assert.equal(p.minutosAmpliacion, ampliacion);
    assert.equal(p.diasNuevos, dias);
    for (const partido of p.partidosPropuestos) {
      const original = e.partidos.find((q) => q.posicionEnRonda === partido.posicionEnRonda);
      if (e.formato === 'MINI_BRACKET' && partido.posicionEnRonda >= 3) {
        assert.equal(partido.pareja1Id, null); assert.equal(partido.pareja2Id, null);
        assert.equal(typeof partido.origen, 'string'); assert.ok(partido.origen.length);
      } else {
        assert.equal(partido.pareja1Id, original.pareja1Id, 'Conserva pareja 1 para mostrarla a la izquierda');
        assert.equal(partido.pareja2Id, original.pareja2Id);
      }
    }
    assert.equal(verificarProgramacionZona({ ...e, parejas, partidos: e.partidos.map((q, i) => ({
      ...q, ...p.partidosPropuestos[i], sinHorarioAsignado: false,
    })) }).estado, 'FACTIBLE');
  }
}
function testGenerador() {
  const propuesta = (id, slots) => ({ cambios: [{ parejaId: id, slotsToAdd: slots }] });
  assert.ok(sonPropuestasEquivalentes(propuesta('a', ['Viernes-09:00']), propuesta('a', ['Viernes-10:00'])));
  assert.ok(sonPropuestasEquivalentes(propuesta('a', ['Viernes-09:00']), propuesta('a', ['Viernes-22:45'])), 'Cualquier inicio del mismo día pertenece al mismo grupo');
  assert.equal(sonPropuestasEquivalentes(propuesta('a', ['Viernes-09:00']), propuesta('b', ['Viernes-09:00'])), false);
  assert.equal(sonPropuestasEquivalentes(propuesta('a', ['Viernes-09:00']), propuesta('a', ['Sabado-09:00'])), false);
  assert.ok(sonPropuestasEquivalentes(propuesta('a', ['Viernes-09:00', 'Viernes-10:00']), propuesta('a', ['Viernes-15:00'])), 'El grupo usa el conjunto de días, sin contar inicios');
  assert.ok(sonPropuestasEquivalentes(propuesta('a', ['Sabado-23:45']), propuesta('a', ['Sabado-00:15'])), 'La trasnoche del sábado sigue siendo sábado lógico');
  assert.equal(sonPropuestasEquivalentes(propuesta('a', ['Viernes-09:00', 'Sabado-10:00']), propuesta('a', ['Viernes-09:15'])), false, 'Un día adicional cambia el grupo');
  const dosParejas = { cambios: [propuesta('a', ['Viernes-09:00']).cambios[0], propuesta('b', ['Sabado-10:00']).cambios[0]] };
  assert.ok(sonPropuestasEquivalentes(dosParejas, { cambios: [propuesta('b', ['Sabado-00:15']).cambios[0], propuesta('a', ['Viernes-15:00']).cambios[0]] }), 'No depende del orden de parejas ni de horarios');
  assert.equal(sonPropuestasEquivalentes(dosParejas, { cambios: [propuesta('a', ['Sabado-10:00']).cambios[0], propuesta('b', ['Viernes-09:00']).cambios[0]] }), false, 'Conserva los días asociados a cada pareja');
  const representadas = ['09:15', '10:15', '09:00', '09:30', '11:30'].map((h) => ({
    grupo: 'a-viernes', conjunto: '[1]', costo: { parejas: 1, diasNuevos: 0, minutosAmpliacion: 75, horas: [1] }, natural: h, propuesta: propuesta('a', [`Viernes-${h}`]),
  }));
  assert.deepEqual(seleccionarGrupos(representadas).map((s) => s.natural), ['09:00'], 'Las variantes del mismo día ocupan un solo lugar y queda el inicio más temprano');
  assert.deepEqual(seleccionarGrupos([...representadas].reverse()), seleccionarGrupos(representadas), 'Agrupar por clave no depende de la inserción');
  const mejor = { ...representadas[0], costo: { parejas: 1, diasNuevos: 0, minutosAmpliacion: 15, horas: [1] } };
  assert.equal(seleccionarGrupos([...representadas, mejor])[0], mejor, 'El representante es el de menor costo antes que el más temprano');
  const opcion = (conjunto, grupo, minutos, natural = grupo) => ({ conjunto, grupo, natural,
    costo: { parejas: 2, diasNuevos: 0, minutosAmpliacion: minutos, horas: [1, 2] }, propuesta: {} });
  const diversidad = [opcion('[1,3]', 'a-vie-sab', 420), opcion('[1,3]', 'a-vie', 525), opcion('[1,3]', 'a-sab', 555), opcion('[2,3]', 'b-vie-sab', 630)];
  assert.deepEqual(seleccionarGrupos(diversidad).map((s) => s.grupo), ['a-vie-sab', 'b-vie-sab', 'a-vie'], 'Un segundo conjunto precede a variantes más baratas del primero');
  assert.deepEqual(seleccionarGrupos(diversidad.slice(0, 3)).map((s) => s.grupo), ['a-vie-sab', 'a-vie', 'a-sab'], 'Un solo conjunto completa el top con variantes');
  assert.deepEqual(seleccionarGrupos([...diversidad].reverse()), seleccionarGrupos(diversidad), 'La diversidad no depende del orden de entrada');
  assert.deepEqual(seleccionarGrupos([...diversidad, opcion('[1,2]', 'c-vie', 700)]).map((s) => s.grupo), ['a-vie-sab', 'b-vie-sab', 'c-vie'], 'Tres conjuntos distintos desplazan todas las variantes');
  assert.equal(minutosFuera([ventana('Viernes-10:00'), ventana('Viernes-10:15')], [ventana('Viernes-09:00')]), 75);
  assert.ok(compararCosto({ parejas: 1, diasNuevos: 1, minutosAmpliacion: 150, horas: [10] }, { parejas: 2, diasNuevos: 0, minutosAmpliacion: 15, horas: [1, 2] }) < 0);
  assert.ok(compararCosto({ parejas: 1, diasNuevos: 0, minutosAmpliacion: 15, horas: [10] }, { parejas: 1, diasNuevos: 0, minutosAmpliacion: 30, horas: [1] }) < 0);
  assert.ok(compararCosto({ parejas: 1, diasNuevos: 0, minutosAmpliacion: 600, horas: [10] }, { parejas: 1, diasNuevos: 1, minutosAmpliacion: 0, horas: [1] }) < 0, 'Una ampliación larga sale antes que un día nuevo');
  const bloques = (dia, desde, hasta) => fusionarSlotsEnVentanas(generarSlotsDia(dia, desde, hasta), FECHA);
  const originales = bloques('Viernes', '13:00', '17:00');
  assert.deepEqual(calcularAmpliacion([ventana('Viernes-17:15')], originales), { diasNuevos: 0, minutosAmpliacion: 90 });
  assert.deepEqual(calcularAmpliacion([ventana('Viernes-22:45')], originales), { diasNuevos: 0, minutosAmpliacion: 420 });
  assert.equal(calcularAmpliacion([ventana('Viernes-17:15'), ventana('Viernes-18:30')], originales).minutosAmpliacion, 165, 'Dos partidos del mismo día amplían una sola vez hasta el extremo final');
  assert.equal(calcularAmpliacion([ventana('Viernes-18:30')], originales).minutosAmpliacion, 165);
  assert.equal(calcularAmpliacion([ventana('Viernes-12:30')], originales).minutosAmpliacion, 30, 'Ampliación hacia atrás hasta el comienzo del partido');
  assert.equal(calcularAmpliacion([ventana('Viernes-22:45')], bloques('Viernes', '18:00', '03:00')).minutosAmpliacion, 0, 'La madrugada forma un único bloque continuo con el viernes');
  assert.equal(calcularAmpliacion([ventana('Viernes-02:30')], bloques('Viernes', '18:00', '03:00')).minutosAmpliacion, 45);
  assert.deepEqual(calcularAmpliacion([ventana('Sabado-01:00'), ventana('Sabado-02:15')], originales), { diasNuevos: 1, minutosAmpliacion: 0 }, 'La trasnoche del sábado es otra jornada lógica, contada una sola vez');
  const separados = [...bloques('Viernes', '13:00', '17:00'), ...bloques('Viernes', '22:00', '03:00')];
  assert.equal(calcularAmpliacion([ventana('Viernes-20:00')], separados).minutosAmpliacion, 120, 'Entre bloques elige ampliar hacia atrás el más cercano');
  assert.equal(calcularAmpliacion([ventana('Viernes-18:00'), ventana('Viernes-20:00')], separados).minutosAmpliacion, 240, 'Optimiza la ampliación conjunta entre dos bloques sin duplicar tramos');
  const candidatos = ['Viernes-12:30', 'Viernes-18:00', 'Viernes-20:00', 'Viernes-02:30', 'Sabado-14:00'].map(ventana);
  for (let mask = 0; mask < 1 << candidatos.length; mask++) {
    const elegidas = candidatos.filter((_, i) => mask & 1 << i);
    const parcial = calcularAmpliacion(elegidas, separados);
    for (let i = 0; i < candidatos.length; i++) if (!(mask & 1 << i)) {
      const completo = calcularAmpliacion([...elegidas, candidatos[i]], separados);
      assert.ok(completo.diasNuevos >= parcial.diasNuevos && completo.minutosAmpliacion >= parcial.minutosAmpliacion, 'La cota parcial nunca baja al agregar partidos, incluso entre bloques o en días nuevos');
    }
  }
  const ampliacion = entrada([viernes('13:00', '17:00'), ['Viernes-17:15', 'Viernes-22:45']], { club: ['Viernes-17:15', 'Viernes-22:45'] });
  const ra = generarPropuestasZona(ampliacion); verificarPropuestas(ampliacion, ra);
  assert.deepEqual(ra.propuestas[0].cambios, [{ parejaId: 'id-0', slotsToAdd: ['Viernes-17:15'] }], 'Elige 17:15 antes que 22:45 dentro del mismo grupo');
  assert.equal(ra.propuestas[0].minutosAmpliacion, 90);
  const diaNuevo = entrada([viernes('13:00', '17:00'), ['Viernes-22:45', 'Sabado-09:00']], { club: ['Viernes-22:45', 'Sabado-09:00'] });
  const rn = generarPropuestasZona(diaNuevo); verificarPropuestas(diaNuevo, rn);
  assert.deepEqual(rn.propuestas.map((p) => [p.diasNuevos, p.minutosAmpliacion]), [[0, 420], [1, 0]], 'Un día nuevo queda detrás aun con menos minutos de ampliación');
  const orden = entrada([viernes('09:00', '10:30'), ['Viernes-11:30']], { club: ['Viernes-09:00', 'Viernes-09:15', 'Viernes-11:30'] });
  const rOrden = generarPropuestasZona(orden);
  verificarPropuestas(orden, rOrden);
  assert.deepEqual(rOrden.propuestas.map((p) => p.cambios[0].parejaId), ['id-1', 'id-0'], 'Menor disponibilidad original primero; la variante 09:15 no ocupa un tercer lugar');
  const dias = entrada([['Viernes-09:00'], ['Sabado-09:00']], { club: ['Viernes-09:00', 'Sabado-09:00'] });
  const rd = generarPropuestasZona(dias); verificarPropuestas(dias, rd);
  assert.equal(rd.propuestas.length, 2);
  assert.deepEqual(new Set(rd.propuestas.map((p) => p.cambios[0].slotsToAdd[0].split('-')[0])), new Set(['Viernes', 'Sabado']), 'Salen las dos alternativas de verdad');

  const aislada = entrada([viernes('18:00', '23:00'), viernes('18:00', '23:00'), ['Sabado-09:00']], { club: viernes('18:00', '23:00') });
  const r = generarPropuestasZona(aislada);
  verificarPropuestas(aislada, r);
  assert.deepEqual(r.combinaciones.map((c) => c.ordenes), [[1], [2], [3], [1, 2], [1, 3], [2, 3]], 'Recorre las seis combinaciones por orden natural, primero las individuales');
  assert.equal(r.busquedaIncompleta, r.combinaciones.some((c) => c.busquedaIncompleta));
  assert.equal(r.nodos, r.combinaciones.reduce((n, c) => n + c.nodos, 0));
  assert.ok(r.propuestas.some((p) => p.cambios.length === 1 && p.cambios[0].parejaId === 'id-2' && p.cambios[0].slotsToAdd.length === 2), 'La aislada necesita dos inicios distintos');
  assert.deepEqual(generarPropuestasZona(aislada), r, 'Dos corridas idénticas');
  const permutado = structuredClone(aislada), ids = new Map(permutado.parejas.map((p, i) => [p.id, `uuid-${3 - i}`]));
  permutado.parejas = permutado.parejas.reverse().map((p) => ({ ...p, id: ids.get(p.id) }));
  permutado.partidos = permutado.partidos.reverse().map((p) => ({ ...p, pareja1Id: ids.get(p.pareja1Id), pareja2Id: ids.get(p.pareja2Id) }));
  permutado.grilla.reverse();
  const rp = generarPropuestasZona(permutado);
  assert.deepEqual(rp.combinaciones, r.combinaciones, 'Presupuestos y recorridos por combinación no dependen de UUID ni del orden de inserción');
  assert.deepEqual(rp.propuestas.map((p) => p.clave), r.propuestas.map((p) => p.clave));
  const idsAntes = new Map([...ids].map(([antes, despues]) => [despues, antes]));
  assert.deepEqual(rp.propuestas.map((p) => traducirIdsPropuesta(p, idsAntes).partidosPropuestos), r.propuestas.map((p) => p.partidosPropuestos));
  assert.deepEqual(rp.propuestas.map((p) => p.cambios.map((c) => c.slotsToAdd)), r.propuestas.map((p) => p.cambios.map((c) => c.slotsToAdd)));

  const dos = entrada([['Viernes-09:00'], ['Viernes-12:00']]);
  const rDos = generarPropuestasZona(dos); assert.ok(rDos.propuestas.length); verificarPropuestas(dos, rDos);
  assert.deepEqual(rDos.propuestas.map((p) => p.cambios.length), [1, 1, 2], 'Busca también las dobles aun después de resolver con una sola pareja, y las ordena después');
  const variosDias = entrada([['Viernes-09:00', 'Sabado-09:00'], ['Viernes-12:00', 'Sabado-12:00']], {
    club: ['Viernes-09:00', 'Viernes-10:30', 'Viernes-12:00', 'Sabado-09:00', 'Sabado-12:00'],
  });
  const rv = generarPropuestasZona(variosDias); verificarPropuestas(variosDias, rv);
  assert.deepEqual(rv.propuestas.map((p) => p.cambios.map((c) => c.parejaId)), [['id-0'], ['id-1'], ['id-0', 'id-1']], 'Las cotas de variantes individuales no podan el conjunto doble, aunque ya haya tres grupos baratos');
  const mezcla = structuredClone(variosDias), nuevosIds = new Map(mezcla.parejas.map((p, i) => [p.id, `uuid-diverso-${9 - i}`]));
  mezcla.parejas = mezcla.parejas.reverse().map((p) => ({ ...p, id: nuevosIds.get(p.id) }));
  mezcla.partidos.reverse().forEach((p) => { p.pareja1Id = nuevosIds.get(p.pareja1Id); p.pareja2Id = nuevosIds.get(p.pareja2Id); });
  mezcla.grilla.reverse();
  const rMezcla = generarPropuestasZona(mezcla), idsOriginales = new Map([...nuevosIds].map(([antes, despues]) => [despues, antes]));
  assert.deepEqual({ ...rMezcla, propuestas: rMezcla.propuestas.map((p) => traducirIdsPropuesta(p, idsOriginales)) }, rv,
    'Representantes, variantes, testigos y presupuestos idénticos con varios conjuntos, UUID permutados y entradas invertidas');
  const acotada = generarPropuestasZona({ ...dos, maxNodos: 1 });
  assert.ok(acotada.busquedaIncompleta);
  assert.ok(acotada.combinaciones.every((c) => c.nodos === 1 && c.busquedaIncompleta), 'Agotar una combinación no consume el presupuesto de las otras');
  const rr4 = entrada([viernes('18:00', '23:00'), viernes('18:00', '23:00'), viernes('18:00', '23:00'), ['Sabado-09:00']], { club: viernes('18:00', '23:00'), canchas: 2 });
  const r4 = generarPropuestasZona(rr4); assert.ok(r4.propuestas.length); verificarPropuestas(rr4, r4);
  assert.deepEqual(r4.combinaciones.map((c) => c.ordenes), [[1], [2], [3], [4], [1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4]], 'Diez combinaciones en zonas de cuatro');
  const mini = entrada([['Viernes-18:00'], ['Viernes-18:00', 'Viernes-20:30'], ['Viernes-18:00', 'Viernes-20:30'], ['Viernes-18:00', 'Viernes-20:30']], { formato: 'MINI_BRACKET', club: viernes('18:00', '23:00') });
  mini.partidos[0] = { ...mini.partidos[0], fechaHora: new Date(ventana('Viernes-18:00').startMs), canchaNumero: 1, sinHorarioAsignado: false };
  mini.partidos[1] = { ...mini.partidos[1], fechaHora: new Date(ventana('Viernes-18:00').startMs), canchaNumero: 2, sinHorarioAsignado: false };
  mini.partidos[2] = { ...mini.partidos[2], origenPareja1: 'Ganador Partido 1', origenPareja2: 'Ganador Partido 2' };
  const rm = generarPropuestasZona(mini); assert.ok(rm.propuestas.length); verificarPropuestas(mini, rm);
  for (const p of rm.propuestas) {
    assert.deepEqual(p.partidosPropuestos.slice(0, 2), [1, 2].map((canchaNumero, i) => ({ posicionEnRonda: i + 1,
      fechaHora: '2026-11-06T21:00:00.000Z', canchaNumero, pareja1Id: `id-${i * 2}`, pareja2Id: `id-${i * 2 + 1}` })));
    assert.equal(p.partidosPropuestos[2].origen, 'Ganador Partido 1 vs Ganador Partido 2', 'Reutiliza los orígenes existentes del panel');
    assert.equal(p.partidosPropuestos[3].origen, 'Perdedor P1 vs Perdedor P2', 'Sin textos previos usa el criterio P1/P2 del pre-check');
  }
  const imposible = entrada(Array.from({ length: 4 }, () => ['Sabado-09:00']), { formato: 'MINI_BRACKET', club: viernes('18:00', '23:00') });
  assert.deepEqual(generarPropuestasZona(imposible).propuestas, [], 'Cuatro parejas a modificar exceden el límite');
  assert.equal(generarPropuestasZona({ ...dos, maxNodos: 0 }).busquedaIncompleta, true);
  const noche = entrada([['Viernes-09:00'], ['Sabado-00:00']], { club: sabado('23:45', '02:00') });
  verificarPropuestas(noche, generarPropuestasZona(noche));
  const domingo = entrada([['Viernes-09:00'], ['Viernes-10:00']], { club: generarSlotsDia('Domingo', '09:00', '12:00') });
  const sinDominio = generarPropuestasZona({ ...domingo, maxNodos: 0 });
  assert.deepEqual(sinDominio.propuestas, []);
  assert.equal(sinDominio.busquedaIncompleta, false, 'Dominios vacíos prueban imposibilidad sin agotar ningún límite');
  console.log('PASS: generador RR2/3/4, mini, costo/unión, límite, trasnoche, domingo y determinismo sin UUID');
}

async function crearCaso(nombre, slots, canchas = 2) {
  const org = await prisma.organizador.create({ data: { nombre, email: `${nombre}@propuestas.test`, passwordHash: 'test', cantidadCanchas: canchas,
    viernesInicio: '09:00', viernesFin: '03:00', sabadoInicio: '08:00', sabadoFin: '03:00' } });
  const torneo = await prisma.torneo.create({ data: { nombre, slug: nombre, fecha: FECHA, organizadorId: org.id } });
  const cat = await prisma.categoria.create({ data: { nombre: '7ma Damas', torneoId: torneo.id } });
  const parejas = [];
  for (let i = 0; i < slots.length; i++) parejas.push(await prisma.pareja.create({ data: { categoriaId: cat.id, orden: i + 1,
    jugador1: `Pareja ${i + 1}`, jugador2: nombre, slotsSeleccionados: { create: slots[i].map((slotId) => ({ slotId })) } } }));
  return { org, torneo, cat, parejas };
}
async function leerParejas(caso) {
  return prisma.pareja.findMany({ where: { categoriaId: caso.cat.id }, orderBy: { orden: 'asc' },
    select: { id: true, resolucionManual: true, slotsSeleccionados: { orderBy: { slotId: 'asc' }, select: { slotId: true } } } });
}
function sinPropuestas(pre) {
  assert.equal(Object.hasOwn(pre, 'propuestasZona'), false);
  for (const c of pre.conflictos || []) for (const p of c.partidosSinHorario) {
    assert.equal(Object.hasOwn(p, 'propuestasZona'), false);
    assert.equal(Object.hasOwn(p, 'busquedaPropuestasIncompleta'), false);
  }
}
function zonaPendiente(pre) {
  const categoria = pre.conflictos.find((c) => c.partidosSinHorario.length);
  return { categoriaId: categoria.categoriaId, zonaId: categoria.partidosSinHorario[0].zonaId, revision: pre.revision };
}
async function pedirPropuestas(caso, pre) {
  return svc.getPropuestasZona(caso.org.id, caso.torneo.id, zonaPendiente(pre));
}

async function testApi(baseUrl) {
  async function post(caso, action, data = {}, token = jwt.sign({ id: caso.org.id, email: caso.org.email }, JWT_SECRET)) {
    const response = await fetch(`${baseUrl}/torneos/${caso.torneo.id}/pre-check-inicio${action}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    return { status: response.status, body: await response.json() };
  }
  const caso = await crearCaso('api-propuesta', [viernes('18:00', '23:00'), viernes('18:00', '23:00'), ['Sabado-09:00']]);
  const generacionesAntes = generaciones;
  const first = await post(caso, ''); assert.equal(first.status, 200);
  const pre = first.body; sinPropuestas(pre); assert.ok(pre.revision);
  const sesion = svc.preCheckSessions.get(caso.torneo.id);
  assert.equal(sesion.propuestasPorZona.size, 0, 'El pre-check no genera propuestas');
  assert.equal(sesion.propuestasCache.size, 0);
  const sinPedir = await post(caso, '/propuestas/aplicar', { clave: 'no-pedida', revision: pre.revision });
  assert.equal(sinPedir.status, 409); assert.equal(sinPedir.body.codigo, 'PROPUESTA_VENCIDA');
  sinPropuestas(sinPedir.body.preCheck);
  const request = zonaPendiente(pre);
  const pedido = await post(caso, '/propuestas', request); assert.equal(pedido.status, 200);
  assert.equal(generaciones, generacionesAntes + 1, 'Solo se genera la zona pedida; ni pre-check ni el 409 generan propuestas');
  assert.deepEqual(Object.keys(pedido.body).sort(), ['busquedaIncompleta', 'propuestasZona', 'revision']);
  const p = pedido.body.propuestasZona.find((p) => p.cambios.length === 1 && p.cambios[0].slotsToAdd.length === 2);
  assert.ok(p); assert.ok(pre.revision);
  const cache = sesion.propuestasPorZona.get(`${request.categoriaId}:${request.zonaId}`);
  const pedidoDos = await post(caso, '/propuestas', request);
  assert.deepEqual(pedidoDos.body, pedido.body);
  assert.equal(generaciones, generacionesAntes + 1, 'Dos pedidos iguales ejecutan el generador una sola vez');
  assert.equal(sesion.propuestasPorZona.get(`${request.categoriaId}:${request.zonaId}`), cache, 'Reutiliza el mismo resultado sin regenerar');
  const again = await post(caso, '', { isReCheck: true });
  assert.equal(again.body.revision, pre.revision, 'Lectura idéntica conserva revisión');
  sinPropuestas(again.body);
  assert.equal(sesion.propuestasPorZona.get(`${request.categoriaId}:${request.zonaId}`), cache, 'Un re-check sin cambios conserva el caché');
  assert.equal(generaciones, generacionesAntes + 1, 'El re-check no genera propuestas');
  const antes = await leerParejas(caso);
  const applied = await post(caso, '/propuestas/aplicar', { clave: p.clave, revision: pre.revision });
  assert.equal(applied.status, 200); assert.equal(applied.body.bloqueado, false);
  assert.equal(generaciones, generacionesAntes + 1, 'Aplicar no genera propuestas');
  sinPropuestas(applied.body);
  assert.equal(sesion.propuestasPorZona.size, 0, 'Aplicar invalida el caché sin generar otras propuestas');
  const resuelta = await post(caso, '/propuestas', { ...request, revision: applied.body.revision });
  assert.deepEqual(resuelta.body, { revision: applied.body.revision, propuestasZona: [], busquedaIncompleta: false });
  assert.equal(generaciones, generacionesAntes + 1, 'Una zona resuelta no ejecuta el generador');
  const pedidoViejo = await post(caso, '/propuestas', request);
  assert.equal(pedidoViejo.status, 409); assert.equal(pedidoViejo.body.codigo, 'REVISION_PRECHECK_VIEJA');
  sinPropuestas(pedidoViejo.body.preCheck);
  const despues = await leerParejas(caso);
  for (let i = 0; i < antes.length; i++) {
    const cambio = p.cambios.find((c) => c.parejaId === antes[i].id);
    if (!cambio) assert.deepEqual(despues[i], antes[i], 'No modifica parejas fuera de la propuesta');
    else {
      assert.equal(despues[i].resolucionManual, true);
      assert.deepEqual(despues[i].slotsSeleccionados.map((s) => s.slotId), [...new Set([...antes[i].slotsSeleccionados.map((s) => s.slotId), ...cambio.slotsToAdd])].sort());
    }
  }
  const plan = svc.preCheckSessions.get(caso.torneo.id).categoriasPlan[0].zonas[0];
  assert.ok(plan.partidos.every((p) => p.fijadoManual), 'La propuesta aplicada queda fija');
  const horariosFijos = structuredClone(plan.partidos);
  await svc.preCheckInicioTorneo(caso.org.id, caso.torneo.id, { isReCheck: true });
  assert.deepEqual(plan.partidos, horariosFijos);
  assert.deepEqual(plan.partidos.map((q) => ({ posicionEnRonda: q.posicionEnRonda, fechaHora: new Date(q.fechaHora).toISOString(), canchaNumero: q.canchaNumero })),
    p.partidosPropuestos.map(({ posicionEnRonda, fechaHora, canchaNumero }) => ({ posicionEnRonda, fechaHora, canchaNumero })));
  const vieja = await post(caso, '/propuestas/aplicar', { clave: p.clave, revision: pre.revision });
  assert.equal(vieja.status, 409); assert.equal(vieja.body.codigo, 'REVISION_PRECHECK_VIEJA'); assert.ok(vieja.body.preCheck.revision);
  assert.deepEqual(await leerParejas(caso), despues);
  assert.equal((await post(caso, '/propuestas/aplicar', {})).status, 400);
  assert.equal((await post(caso, '/propuestas', {})).status, 400);
  const otro = await crearCaso('otro-club', [['Viernes-18:00'], ['Sabado-09:00']]);
  assert.equal((await post(caso, '/propuestas/aplicar', { clave: p.clave, revision: applied.body.revision }, jwt.sign({ id: otro.org.id }, JWT_SECRET))).status, 403);
  assert.equal((await post(caso, '/propuestas', { ...request, revision: applied.body.revision }, jwt.sign({ id: otro.org.id }, JWT_SECRET))).status, 403);

  const noFactible = await crearCaso('estado-no-factible', [['Viernes-09:00'], ['Viernes-12:00']]);
  const noPre = (await post(noFactible, '')).body, noProp = (await post(noFactible, '/propuestas', zonaPendiente(noPre))).body.propuestasZona[0]; assert.ok(noProp);
  const catAjena = await prisma.categoria.create({ data: { nombre: 'Ocupación', torneoId: noFactible.torneo.id } });
  // Se ocupan ambas canchas en el único inicio común de esta propuesta, sin re-check intermedio.
  await prisma.partido.createMany({ data: [1, 2].map((canchaNumero) => ({ categoriaId: catAjena.id, posicionEnRonda: canchaNumero,
    fechaHora: new Date(noProp.partidosPropuestos[0].fechaHora), canchaNumero })) });
  const prev = await leerParejas(noFactible);
  const noRes = await post(noFactible, '/propuestas/aplicar', { clave: noProp.clave, revision: noPre.revision });
  assert.equal(noRes.status, 409); assert.equal(noRes.body.codigo, 'PROPUESTA_NO_FACTIBLE'); assert.ok(noRes.body.preCheck);
  assert.deepEqual(await leerParejas(noFactible), prev, '409 no agrega disponibilidad');

  const concurrente = await crearCaso('aplicar-dos-veces', [['Viernes-09:00'], ['Viernes-12:00']]);
  const cp = (await post(concurrente, '')).body, propuesta = (await post(concurrente, '/propuestas', zonaPendiente(cp))).body.propuestasZona[0]; assert.ok(propuesta);
  const respuestas = await Promise.all([post(concurrente, '/propuestas/aplicar', { clave: propuesta.clave, revision: cp.revision }),
    post(concurrente, '/propuestas/aplicar', { clave: propuesta.clave, revision: cp.revision })]);
  assert.deepEqual(respuestas.map((r) => r.status).sort(), [200, 409]);

  const mini = await crearCaso('api-mini', [['Viernes-18:00'], ['Viernes-18:00', 'Viernes-20:30'],
    ['Viernes-18:00', 'Viernes-20:30'], ['Viernes-18:00', 'Viernes-20:30']]);
  const mp = (await post(mini, '')).body, opt = (await post(mini, '/propuestas', zonaPendiente(mp))).body.propuestasZona[0]; assert.ok(opt);
  const miniPlan = svc.preCheckSessions.get(mini.torneo.id).categoriasPlan[0].zonas[0];
  const fijos = miniPlan.partidos.slice(0, 2).map((p) => [p.fechaHora.getTime(), p.canchaNumero]);
  const miniAplicado = await post(mini, '/propuestas/aplicar', { clave: opt.clave, revision: mp.revision });
  assert.equal(miniAplicado.status, 200); assert.equal(miniAplicado.body.bloqueado, false);
  assert.deepEqual(miniPlan.partidos.slice(0, 2).map((p) => [p.fechaHora.getTime(), p.canchaNumero]), fijos);

  const duplicado = await crearCaso('claves-duplicadas', [viernes('18:00', '23:00'), viernes('18:00', '23:00'), ['Sabado-09:00']]);
  const catDuplicada = await prisma.categoria.create({ data: { nombre: '7ma Damas', torneoId: duplicado.torneo.id } });
  for (let i = 0; i < 3; i++) await prisma.pareja.create({ data: { categoriaId: catDuplicada.id, orden: i + 1,
    jugador1: `Pareja ${i + 1}`, jugador2: 'claves-duplicadas',
    slotsSeleccionados: { create: (i === 2 ? ['Sabado-09:00'] : viernes('18:00', '23:00')).map((slotId) => ({ slotId })) } } });
  const ambigua = (await post(duplicado, '')).body;
  assert.ok(ambigua.conflictos.length === 2);
  for (const c of ambigua.conflictos) {
    const r = await post(duplicado, '/propuestas', { categoriaId: c.categoriaId, zonaId: c.partidosSinHorario[0].zonaId, revision: ambigua.revision });
    assert.deepEqual(r.body.propuestasZona, [], 'Una clave ambigua nunca aplica en otra categoría, aunque se pida una sola zona');
    assert.equal(r.body.busquedaIncompleta, true);
  }
  const vencida = await crearCaso('sesion-vencida', [['Viernes-09:00'], ['Viernes-12:00']]);
  const vp = (await post(vencida, '')).body;
  svc.preCheckSessions.get(vencida.torneo.id).expiresAt = Date.now() - 1;
  const vencio = await post(vencida, '/propuestas', zonaPendiente(vp));
  assert.equal(vencio.status, 409); assert.equal(vencio.body.codigo, 'REVISION_PRECHECK_VIEJA');
  assert.notEqual(vencio.body.preCheck.revision, vp.revision); sinPropuestas(vencio.body.preCheck);
  const cambio = await crearCaso('pedido-estado-cambio', [['Viernes-09:00'], ['Viernes-12:00']]);
  const cambioPre = (await post(cambio, '')).body;
  await prisma.slotPareja.create({ data: { parejaId: cambio.parejas[0].id, slotId: 'Viernes-15:00' } });
  const cambioRes = await post(cambio, '/propuestas', zonaPendiente(cambioPre));
  assert.equal(cambioRes.status, 409); assert.equal(cambioRes.body.codigo, 'ESTADO_PRECHECK_CAMBIO');
  assert.notEqual(cambioRes.body.preCheck.revision, cambioPre.revision); sinPropuestas(cambioRes.body.preCheck);
  console.log('PASS: API aplica testigo, atomicidad visible, revisión vieja, estado no factible, permisos y concurrencia');
}

async function testZonaE() {
  const caso = await crearCaso('zona-e-real', [[...viernes('18:00', '03:00'), ...sabado('15:00', '03:00')], viernes('13:00', '17:00'),
    [...viernes('19:00', '22:00'), ...sabado('15:00', '20:00')]], 6);
  const otro = await prisma.torneo.create({ data: { nombre: 'Ocupación del club', slug: 'ocupacion-zona-e', fecha: FECHA, organizadorId: caso.org.id } });
  const cat = await prisma.categoria.create({ data: { nombre: 'Agenda', torneoId: otro.id } });
  const agenda = [];
  for (let canchaNumero = 1; canchaNumero <= 6; canchaNumero++) for (const slot of ['Viernes-18:00', 'Viernes-19:30', 'Viernes-21:30', 'Sabado-16:00', 'Sabado-17:45']) {
    agenda.push({ categoriaId: cat.id, posicionEnRonda: agenda.length + 1, canchaNumero, fechaHora: new Date(ventana(slot).startMs) });
  }
  await prisma.partido.createMany({ data: agenda });
  const pre = await svc.preCheckInicioTorneo(caso.org.id, caso.torneo.id);
  sinPropuestas(pre);
  const ps = (await pedirPropuestas(caso, pre)).propuestasZona; assert.ok(ps.length, 'Zona E trae al menos una propuesta');
  assert.equal(ps.length, 3, 'La zona E reproducida conserva tres grupos distintos de parejas y días');
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) assert.equal(sonPropuestasEquivalentes(ps[i], ps[j]), false, 'Zona E no repite las mismas parejas y días');
  console.log(`Zona E reproducida: ${ps.length} propuestas agrupadas por día`);
  assert.ok(ps.every((p) => p.cambios.length <= 2));
  assert.equal(ps[0].cambios.length, 2, 'El caso E con canchas ocupadas requiere dos parejas');
  const alternativa = ps.find((p) => p.cambios.some((c) => c.parejaId === caso.parejas[0].id) &&
    p.cambios.some((c) => c.parejaId === caso.parejas[2].id && c.slotsToAdd.includes('Sabado-19:00')));
  assert.ok(alternativa, 'Devuelve la alternativa factible Caruso + Medrano, sin ampliar a Dávila');
  assert.equal(alternativa.minutosAgregados, 165);
  assert.equal(ps[0], alternativa, 'Caruso + Medrano sale primero por menor ampliación, aun con más horas originales');
  assert.deepEqual(ps[1].cambios.map((c) => c.parejaId), [caso.parejas[1].id, caso.parejas[2].id], 'La segunda propone Dávila + Medrano como alternativa a Caruso + Medrano');
  assert.deepEqual(ps.map((p) => [p.diasNuevos, p.minutosAmpliacion]), [[0, 420], [0, 570], [0, 435]], 'Los conjuntos distintos van antes que las variantes más baratas');
  const antes = await leerParejas(caso), agendaAntes = await prisma.partido.findMany({ where: { categoriaId: cat.id }, orderBy: { posicionEnRonda: 'asc' } });
  const snapshotAntes = structuredClone(svc.preCheckSessions.get(caso.torneo.id).categoriasPlan);
  const transaction = prisma.$transaction;
  prisma.$transaction = (fn, opts) => transaction.call(prisma, async (tx) => {
    const create = tx.slotPareja.createMany.bind(tx.slotPareja); let escrituras = 0;
    tx.slotPareja.createMany = (q) => { if (++escrituras === 2) throw new Error('Fallo simulado en segunda pareja'); return create(q); };
    return fn(tx);
  }, opts);
  try { await assert.rejects(svc.aplicarPropuestaZona(caso.org.id, caso.torneo.id, { clave: alternativa.clave, revision: pre.revision }), /Fallo simulado/); }
  finally { prisma.$transaction = transaction; }
  assert.deepEqual(await leerParejas(caso), antes, 'Rollback de ambas disponibilidades');
  assert.deepEqual(svc.preCheckSessions.get(caso.torneo.id).categoriasPlan, snapshotAntes, 'El testigo no se adopta antes del commit');
  const after = await svc.aplicarPropuestaZona(caso.org.id, caso.torneo.id, { clave: alternativa.clave, revision: pre.revision });
  assert.equal(after.bloqueado, false);
  assert.deepEqual(await prisma.partido.findMany({ where: { categoriaId: cat.id }, orderBy: { posicionEnRonda: 'asc' } }), agendaAntes);
  const despues = await leerParejas(caso);
  for (let i = 0; i < antes.length; i++) if (!alternativa.cambios.some((c) => c.parejaId === antes[i].id)) assert.deepEqual(antes[i], despues[i]);
  const recheck = await svc.preCheckInicioTorneo(caso.org.id, caso.torneo.id, { isReCheck: true }); assert.equal(recheck.bloqueado, false);
  console.log('PASS: zona E, ocupación de seis canchas, propuesta aplicada y re-check resuelto');
}

async function main() {
  await ensureTestDb(); testGenerador();
  const { server, baseUrl } = await startTestServer();
  try { await testApi(baseUrl); await testZonaE(); }
  finally { await new Promise((r) => server.close(r)); await prisma.$disconnect(); }
}
main().then(() => process.exit(0)).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
