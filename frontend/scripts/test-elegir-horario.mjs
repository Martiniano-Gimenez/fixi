import assert from 'node:assert/strict';
// jsdom 26.1.0 es una dependencia de pruebas opcional. FIXI_JSDOM_MODULE acepta su ruta absoluta.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const { JSDOM } = createRequire(import.meta.url)(process.env.FIXI_JSDOM_MODULE || 'jsdom');
import { createServer } from 'vite';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url:'http://localhost:5175' });
Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true,
ResizeObserver:class{observe(){}disconnect(){}}});
const server=await createServer({root:fileURLToPath(new URL('../',import.meta.url)),server:{middlewareMode:true},appType:'custom'});
try {
const {default:Elegir}=await server.ssrLoadModule('/src/components/ElegirHorarioPartido.jsx');
const amp=(parejaId,minutosAntes,minutosDespues,diaNuevo=false)=>({parejaId,diaNuevo,minutosAntes,minutosDespues});
const opciones=['15:00','15:15','15:30','15:45','16:00'].map((hora,i)=>({clave:`k${i}`,slotId:`Viernes-${hora}`,fechaHora:`2026-11-06T${hora}:00Z`,estado:['ENTRA','PEDIR_1','PEDIR_VARIAS','NO_DISPONIBLE','NO_DISPONIBLE'][i],parejasAAmpliar:i===1?['p1']:i===2?['p1','p2']:[],ampliacionPorPareja:i===1?[amp('p1',0,15)]:i===2?[amp('p1',0,30),amp('p2',60,0)]:[],parejasOcupadas:i===3?['p1']:[],motivo:i===3?'PAREJA_OCUPADA':i===4?'ESPERA_BASES':null,verificada:false}));
opciones.push({...opciones[0],clave:'sab',slotId:'Sabado-00:00',fechaHora:'2026-11-08T03:00:00Z'});
const horariosParejas=[{parejaId:'p1',cargado:true,ventanas:[{dia:'Viernes',desde:'15:00',hasta:'16:15'}]},{parejaId:'p2',cargado:false,ventanas:[{dia:'Viernes',desde:'09:00',hasta:'23:00'}]}];
let fijaciones=0,guardado=null,rechecks=0,fallar=false;
globalThis.fetch=async(url,opts)=>{if(String(url).endsWith('/partidos/opciones')) {assert.ok(!('cursor' in JSON.parse(opts.body)));return new Response(JSON.stringify({revision:'r1',opciones,horariosParejas}));}if(String(url).endsWith('/partidos/fijar')){fijaciones++;return new Response(JSON.stringify(fallar?{error:'La revisión cambió'}:{revision:'r2'}),{status:fallar?409:200});}throw Error(`Petición no interceptada ${url}`);};
const parejas=[{id:'p1',nombre:'Caruso / Vallejos',slotIds:['Viernes-15:00']},{id:'p2',nombre:'Dávila / Arrieta',slotIds:[]}];
function App(){const[abierto,setAbierto]=React.useState({categoriaId:'c',zonaId:'z',posicionEnRonda:1});return React.createElement(Elegir,{torneoId:'fixture',categoriaId:'c',zonaId:'z',revision:'r1',partido:{posicionEnRonda:1,pareja1Id:'p1',pareja2Id:'p2'},parejas,abierto,onAbiertoChange:setAbierto,onSaved:r=>{guardado=r;},onRecheck:()=>{rechecks++;}});}
const root=createRoot(document.querySelector('#root'));
const click=async(el)=>{assert.ok(el);await act(async()=>el.click());};
const cell=k=>document.querySelector(`[data-clave="${k}"]`);
const confirmar=()=>[...document.querySelectorAll('.pc-horarios-feedback button')].find(b=>b.textContent==='Confirmar');
const cancelar=()=>[...document.querySelectorAll('.pc-horarios-feedback button')].find(b=>b.textContent==='Cancelar');
const tecla=async(el,key)=>act(async()=>{el.focus();el.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key,bubbles:true}));});
await act(async()=>root.render(React.createElement(App)));
for (let i = 0; i < 50 && !cell('k1'); i++) {
  await act(async () => new Promise((r) => setTimeout(r, 20)));
}
assert.equal(document.querySelectorAll('[role="grid"]').length,2);
// Horario de cada pareja debajo del partido, con la que no cargó horario
assert.equal(document.querySelector('.pc-horarios-parejas').textContent,'Caruso / Vallejos pueden vie de 15 a 16:15 h · Dávila / Arrieta, sin horario cargado');
assert.ok(!document.querySelector('.pc-horarios-leyenda'));
assert.ok(!document.body.textContent.includes('Viabilidad por verificar'));
assert.equal(cell('k3'), null); assert.equal(cell('k4'), null);
assert.equal(document.querySelector('.pc-horarios-hueco'), null, 'Sin huecos en la grilla');
assert.equal(cell('k1').parentElement.getAttribute('aria-colindex'),'2','Una fila por hora, seguidos desde la izquierda');
assert.match(document.querySelector('.pc-horarios-recomendado').textContent, /Recomendado: vie 15:00 · entra en el horario de las dos parejas/);
assert.match(cell('k0').getAttribute('aria-label'), /recomendado$/);
assert.equal(document.querySelectorAll('.pc-horarios-estrella').length, 1);
await click(document.querySelector('.pc-horarios-recomendado'));
assert.ok(cell('k0').classList.contains('is-selected')); assert.ok(confirmar());
await click(cancelar());
// Confirmación con el detalle por pareja en lugar de la suma
await click(cell('k1'));assert.equal(document.querySelector('.pc-horarios-feedback [role="status"]').textContent,'vie 15:15 · Caruso / Vallejos: 15 min después');assert.ok(confirmar());
assert.match(cell('k1').getAttribute('aria-label'),/Caruso \/ Vallejos: 15 min después/);
assert.match(document.querySelector('.pc-horarios-feedback').textContent,/Al confirmar, vie 15:15 se agrega a la disponibilidad de Caruso \/ Vallejos\. Hacelo solo si ya lo hablaste con ellas\./);
await tecla(cell('k1'),'ArrowLeft');assert.equal(document.activeElement.dataset.clave,'k0','La flecha recorre la fila sin huecos');
await click(cancelar());assert.ok(!document.querySelector('.pc-horarios-feedback'));
await click(document.querySelector('.pc-horarios-ver-mas'));
await click(cell('k2'));assert.equal(document.querySelector('.pc-horarios-feedback [role="status"]').textContent,'vie 15:30 · Caruso / Vallejos: 30 min después · Dávila / Arrieta: 1 h antes');
await act(async()=>{const b=confirmar();b.click();b.click();});assert.equal(fijaciones,1);assert.equal(guardado.revision,'r2');
await click([...document.querySelectorAll('button')].find(b=>b.textContent==='Elegir horario'));
fallar=true;await click(cell('k0'));await click(confirmar());assert.equal(rechecks,1);assert.match(document.querySelector('[role="alert"]').textContent,/revisión cambió/);assert.ok(document.querySelector('[aria-expanded="true"]'));

const { default: Grilla } = await server.ssrLoadModule('/src/components/GrillaHorariosPartido.jsx');
const tramos = [];
const fila = (hora, estados, pedir = 'b') => estados.forEach((estado, i) => {
  const slotId = `Viernes-${hora}:${String(i * 15).padStart(2, '0')}`;
  tramos.push({ clave: slotId, slotId, fechaHora: `2026-11-0${Number(hora) < 6 ? 7 : 6}T${hora}:${String(i * 15).padStart(2, '0')}:00Z`, estado,
    parejasAAmpliar: estado === 'PEDIR_1' ? [pedir] : estado === 'PEDIR_VARIAS' ? ['a', 'b'] : [] });
});
fila('13', ['PEDIR_1', 'NO_DISPONIBLE', 'PEDIR_1', 'ENTRA']);
fila('14', ['NO_DISPONIBLE', 'ENTRA', 'NO_DISPONIBLE', 'ENTRA']);
fila('15', Array(4).fill('PEDIR_VARIAS'));
fila('16', Array(4).fill('NO_DISPONIBLE'));
fila('00', ['ENTRA', 'NO_DISPONIBLE', 'NO_DISPONIBLE', 'NO_DISPONIBLE']);
const propsGrilla = { opciones: tramos, seleccion: null, onSeleccion: () => {}, describir: (o) => o.estado,
  nombres: new Map([['a', 'Caruso / Vallejos'], ['b', 'Dávila / Arrieta']]), fijando: false, onCambioDia: () => {} };
await act(async () => root.render(React.createElement(Grilla, propsGrilla)));
assert.equal(document.querySelector('.pc-horarios-tramo'), null, 'Sin títulos de tramo');
assert.equal(document.querySelector('[role="rowheader"]'), null);
const verMas = document.querySelector('.pc-horarios-ver-mas');
assert.equal(verMas.textContent.trim(), 'Ver más horarios (4)', 'Un único plegado por día con los que piden a varias');
assert.equal(document.querySelectorAll('.pc-horarios-dia.is-active .pc-horarios-plegar').length, 1);
assert.equal(document.querySelector('.pc-horarios-dia.is-active [role="grid"]').nextElementSibling, verMas, 'Al final del día');
const inicio = (hora, minutos = '00') => document.querySelector(`[data-clave="Viernes-${hora}:${minutos}"]`);
const columna = (el) => el.parentElement.getAttribute('aria-colindex');
const filaDe = (el) => el.closest('[role="row"]');
assert.equal(inicio('16'), null);
assert.equal(document.querySelector('.pc-horarios-hueco'), null);
assert.deepEqual([inicio('13'), inicio('13', '30'), inicio('13', '45'), inicio('14', '15'), inicio('14', '45'), inicio('00')].map(columna),
  ['1', '2', '3', '4', '1', '2'], 'Lista corrida de a 4, sin agrupar por hora');
assert.equal(filaDe(inicio('13')).children.length, 4, 'Filas completas de a 4');
assert.equal(filaDe(inicio('14', '45')), filaDe(inicio('00')), 'Sin cortar la fila al cambiar de hora');
assert.ok(inicio('13').classList.contains('is-pedir_1') && inicio('13', '45').classList.contains('is-entra'), 'El estilo distingue el estado');
assert.equal(document.querySelector('.is-salto'), null, 'Sin espacio extra entre saltos de hora');
assert.match(inicio('00').getAttribute('aria-label'), /^sáb 00:00 · ENTRA/);
await tecla(inicio('13'), 'ArrowRight'); assert.equal(document.activeElement.dataset.clave, 'Viernes-13:30');
await tecla(inicio('14', '15'), 'ArrowRight'); assert.equal(document.activeElement.dataset.clave, 'Viernes-14:45', 'Sigue en la fila siguiente');
await tecla(inicio('13'), 'ArrowDown'); assert.equal(document.activeElement.dataset.clave, 'Viernes-14:45', 'Abajo, de a 4');
await tecla(inicio('00'), 'ArrowUp'); assert.equal(document.activeElement.dataset.clave, 'Viernes-13:30', 'Arriba, de a 4');
await tecla(inicio('14', '45'), 'ArrowRight'); assert.equal(document.activeElement.dataset.clave, 'Viernes-00:00', 'Salta los plegados');
assert.equal(inicio('15'), null);
await click(verMas); assert.ok(inicio('15')); assert.equal(verMas.getAttribute('aria-expanded'), 'true');
assert.ok(inicio('15').classList.contains('is-pedir_varias'));
await tecla(inicio('14', '45'), 'ArrowRight'); assert.equal(document.activeElement.dataset.clave, 'Viernes-15:00', 'Desplegados, quedan en orden en la lista corrida');
await click(verMas); assert.equal(inicio('15'), null);
await act(async () => root.render(React.createElement(Grilla, { ...propsGrilla, esDefinicion: true })));
assert.match(document.querySelector('.pc-horarios-recomendado').textContent, /entra en el horario de las cuatro parejas/);

const nombresRec = new Map([['orellana', 'Orellana / Peralta'], ['davila', 'Dávila / Arrieta']]);
const opcionRec = (clave, slotId, estado, diasNuevos, minutosAmpliacion, parejasAAmpliar = ['orellana'], ampliacionPorPareja) => {
  const [dia, hora] = slotId.split('-'), [h, m] = hora.split(':').map(Number);
  return { clave, slotId, estado, diasNuevos, minutosAmpliacion, parejasAAmpliar,
    ampliacionPorPareja: ampliacionPorPareja || parejasAAmpliar.map((parejaId, i) => amp(parejaId, 0, i < diasNuevos ? 0 : minutosAmpliacion, i < diasNuevos)),
    fechaHora: new Date(Date.UTC(2026, 10, dia === 'Viernes' ? 6 : 7, h + 3 + (h < 6 ? 24 : 0), m)).toISOString() };
};
let recomendadoSeleccionado;
function ProbarRecomendado({ opciones: opcionesRec, fijando = false }) {
  const [seleccionRec, setSeleccionRec] = React.useState(null);
  return React.createElement(Grilla, { ...propsGrilla, opciones: opcionesRec, nombres: nombresRec, fijando, seleccion: seleccionRec,
    describir: (o) => o.estado, onSeleccion: (o) => { recomendadoSeleccionado = o; setSeleccionRec(o); } });
}
const casosRec = [
  { nombre: 'entra primero', esperado: 'entra', texto: 'entra en el horario de las dos parejas', opciones: [
    opcionRec('pedir', 'Viernes-22:00', 'PEDIR_1', 0, 0), opcionRec('entra', 'Sabado-09:00', 'ENTRA', 1, 120, []),
  ] },
  { nombre: 'menos días antes que minutos o cantidad de parejas', esperado: 'dias',
    texto: 'Orellana / Peralta: 15 min antes · Dávila / Arrieta: 15 min después', opciones: [
    opcionRec('no', 'Viernes-07:00', 'NO_DISPONIBLE', 0, 0), opcionRec('nuevo', 'Viernes-08:00', 'PEDIR_1', 1, 0),
    opcionRec('dias', 'Viernes-09:00', 'PEDIR_VARIAS', 0, 30, ['orellana', 'davila'], [amp('orellana', 15, 0), amp('davila', 0, 15)]),
  ] },
  { nombre: 'menos minutos', esperado: 'minutos', texto: 'Orellana / Peralta: 1 h 15 min después', opciones: [
    opcionRec('caro', 'Viernes-20:00', 'PEDIR_1', 0, 120), opcionRec('minutos', 'Viernes-22:45', 'PEDIR_1', 0, 75),
  ] },
  { nombre: 'inicio más temprano con trasnoche', esperado: 'hora', texto: 'Orellana / Peralta: 2 h después', primera: 'Recomendado: vie 22:45', opciones: [
    opcionRec('madrugada', 'Viernes-00:00', 'PEDIR_1', 0, 120), opcionRec('tarde', 'Viernes-23:00', 'PEDIR_1', 0, 120),
    opcionRec('hora', 'Viernes-22:45', 'PEDIR_1', 0, 120),
  ] },
  { nombre: 'día nuevo', esperado: 'nuevo', texto: 'Orellana / Peralta: el sáb, que no tenía cargado', opciones: [
    opcionRec('nuevo', 'Sabado-22:45', 'PEDIR_1', 1, 0), opcionRec('dos', 'Viernes-20:00', 'PEDIR_VARIAS', 2, 0, ['orellana', 'davila']),
  ] },
];
for (const caso of casosRec) {
  const originales = structuredClone(caso.opciones);
  recomendadoSeleccionado = undefined;
  await act(async () => root.render(React.createElement(ProbarRecomendado, { key: caso.nombre, opciones: caso.opciones })));
  const botonRec = document.querySelector('.pc-horarios-recomendado');
  assert.ok(botonRec.textContent.includes(caso.texto), `${caso.nombre}: ${botonRec.textContent}`);
  assert.ok(!/en total|más$/.test(botonRec.textContent), 'Sin la suma de minutos');
  if (caso.primera) assert.equal(botonRec.querySelector('.pc-horarios-recomendado-cuerpo > span').textContent, caso.primera);
  await click(botonRec);
  assert.equal(recomendadoSeleccionado, caso.opciones.find((o) => o.clave === caso.esperado), caso.nombre);
  const estrella = document.querySelector('.pc-horarios-estrella');
  assert.equal(estrella.closest('button').dataset.clave, caso.esperado);
  assert.match(estrella.closest('button').getAttribute('aria-label'), /recomendado$/);
  assert.equal(document.querySelectorAll('.pc-horarios-estrella').length, 1);
  assert.deepEqual(caso.opciones, originales, 'No muta los datos del endpoint');
}
const plegadoRec = [opcionRec('viernes', 'Viernes-07:00', 'PEDIR_1', 2, 0),
  opcionRec('recomendado', 'Sabado-09:00', 'PEDIR_VARIAS', 0, 15, ['orellana', 'davila']),
  opcionRec('otro', 'Sabado-10:00', 'PEDIR_VARIAS', 0, 30, ['orellana', 'davila']),
  opcionRec('sabado', 'Sabado-11:00', 'PEDIR_1', 1, 0)];
await act(async () => root.render(React.createElement(ProbarRecomendado, { key: 'plegado', opciones: plegadoRec })));
assert.ok(document.querySelector('.pc-horarios-dia.is-active').id.endsWith('Viernes'));
assert.equal(document.querySelector('[data-clave="recomendado"]'), null);
await click(document.querySelector('.pc-horarios-recomendado'));
assert.ok(document.querySelector('.pc-horarios-dia.is-active').id.endsWith('Sabado'));
assert.ok(document.querySelector('[data-clave="recomendado"]').classList.contains('is-selected'));
const plegableSabado = () => document.querySelector('.pc-horarios-dia.is-active .pc-horarios-plegar');
assert.equal(plegableSabado().getAttribute('aria-expanded'), 'true');
await click(plegableSabado());
assert.equal(document.querySelector('[data-clave="recomendado"]'), null, 'Se puede volver a plegar el tramo');
await click(document.querySelector('.pc-horarios-recomendado'));
assert.ok(document.querySelector('[data-clave="recomendado"]'));
recomendadoSeleccionado = undefined;
await act(async () => root.render(React.createElement(ProbarRecomendado, { key: 'bloqueado', opciones: plegadoRec, fijando: true })));
assert.ok(document.querySelector('.pc-horarios-recomendado').disabled);
await click(document.querySelector('.pc-horarios-recomendado')); assert.equal(recomendadoSeleccionado, undefined);

for (const vacias of [[], tramos.map((o) => ({ ...o, estado: 'NO_DISPONIBLE' }))]) {
  await act(async () => root.render(React.createElement(Grilla, { ...propsGrilla, opciones: vacias })));
  assert.equal(document.querySelector('[role="status"]').textContent, 'No hay horarios posibles para este partido con las canchas libres.');
  assert.equal(document.querySelector('[role="grid"]'), null);
  assert.equal(document.querySelector('.pc-horarios-leyenda'), null);
  assert.equal(document.querySelector('.pc-horarios-recomendado'), null);
}
await act(async () => root.render(React.createElement(Grilla, { ...propsGrilla, opciones: tramos.map((o) => ({ ...o, estado: 'NO_DISPONIBLE', motivo: 'ESPERA_BASES' })) })));
assert.equal(document.querySelector('[role="status"]').textContent, 'Se habilita cuando los dos primeros partidos tengan horario.');
assert.equal(document.querySelector('[role="grid"]'), null);
await act(async()=>root.unmount());
console.log('PASS DOM: horario de cada pareja, recomendado y confirmación con detalle por pareja, estrella, grilla corrida de a 4 sin títulos ni huecos, ver más por día, teclado, doble envío y 409; peticiones interceptadas');
}finally{await server.close();dom.window.close();}
