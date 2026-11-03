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
const opciones=['15:00','15:15','15:30','15:45','16:00'].map((hora,i)=>({clave:`k${i}`,slotId:`Viernes-${hora}`,fechaHora:`2026-11-06T${hora}:00Z`,estado:['ENTRA','PEDIR_1','PEDIR_VARIAS','NO_DISPONIBLE','NO_DISPONIBLE'][i],parejasAAmpliar:i===1?['p1']:i===2?['p1','p2']:[],parejasOcupadas:i===3?['p1']:[],motivo:i===3?'PAREJA_OCUPADA':i===4?'ESPERA_BASES':null,verificada:false}));
opciones.push({...opciones[0],clave:'sab',slotId:'Sabado-00:00',fechaHora:'2026-11-08T03:00:00Z'});
let fijaciones=0,guardado=null,rechecks=0,fallar=false;
globalThis.fetch=async(url,opts)=>{if(String(url).endsWith('/partidos/opciones')) {assert.ok(!('cursor' in JSON.parse(opts.body)));return new Response(JSON.stringify({revision:'r1',opciones}));}if(String(url).endsWith('/partidos/fijar')){fijaciones++;return new Response(JSON.stringify(fallar?{error:'La revisi\u00f3n cambi\u00f3'}:{revision:'r2'}),{status:fallar?409:200});}throw Error(`Petici?n no interceptada ${url}`);};
const parejas=[{id:'p1',nombre:'Caruso / Vallejos',slotIds:['Viernes-15:00']},{id:'p2',nombre:'Dávila / Arrieta',slotIds:['Viernes-15:00']}];
function App(){const[abierto,setAbierto]=React.useState({categoriaId:'c',zonaId:'z',posicionEnRonda:1});return React.createElement(Elegir,{torneoId:'fixture',categoriaId:'c',zonaId:'z',revision:'r1',partido:{posicionEnRonda:1,pareja1Id:'p1',pareja2Id:'p2'},parejas,abierto,onAbiertoChange:setAbierto,onSaved:r=>{guardado=r;},onRecheck:()=>{rechecks++;}});}
const root=createRoot(document.querySelector('#root'));
const click=async(el)=>{assert.ok(el);await act(async()=>el.click());};
const cell=k=>document.querySelector(`[data-clave="${k}"]`);
const confirmar=()=>[...document.querySelectorAll('.pc-horarios-feedback button')].find(b=>b.textContent==='Confirmar');
const cancelar=()=>[...document.querySelectorAll('.pc-horarios-feedback button')].find(b=>b.textContent==='Cancelar');
await act(async()=>root.render(React.createElement(App)));
for (let i = 0; i < 50 && !cell('k1'); i++) {
  await act(async () => new Promise((r) => setTimeout(r, 20)));
}
assert.equal(document.querySelectorAll('[role="grid"]').length,2);
assert.deepEqual([...document.querySelectorAll('.pc-horarios-leyenda li')].map(e=>e.textContent),['Entra (2)','Pedirle a 1 pareja (1)','Pedirle a 2 o m\u00e1s (1)']);
assert.ok(!document.body.textContent.includes('Viabilidad por verificar'));
assert.equal(cell('k3'), null); assert.equal(cell('k4'), null);
assert.ok([...document.querySelectorAll('.pc-horarios-hueco')].every(e=>e.getAttribute('aria-hidden')==='true' && e.textContent===''));
assert.match(document.querySelector('.pc-horarios-recomendado').textContent, /Recomendado: vie 15:00 · entra en el horario de las dos parejas/);
assert.match(cell('k0').getAttribute('aria-label'), /recomendado$/);
assert.equal(document.querySelectorAll('.pc-horarios-estrella').length, 1);
await click(document.querySelector('.pc-horarios-recomendado'));
assert.ok(cell('k0').classList.contains('is-selected')); assert.ok(confirmar());
await click(cancelar());
await click(cell('k1'));assert.match(document.querySelector('[role="status"]').textContent,/vie 15:15 \u00b7 Pedile a Caruso/);assert.ok(confirmar());
assert.match(document.querySelector('.pc-horarios-feedback').textContent,/Al confirmar, vie 15:15 se agrega a la disponibilidad de Caruso \/ Vallejos\. Hacelo solo si ya lo hablaste con ellas\./);
assert.ok(!document.querySelector('.pc-horarios-feedback').textContent.includes('Confirmá cuando'));
await act(async()=>{cell('k1').focus();cell('k1').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));});assert.equal(document.activeElement.dataset.clave,'k2');
await act(async()=>document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'End',bubbles:true})));assert.equal(document.activeElement.dataset.clave,'k2');
await click(cancelar());assert.equal(document.activeElement.dataset.clave,'k1');assert.ok(!document.querySelector('.pc-horarios-feedback'));
await click(cell('k2'));assert.match(document.querySelector('[role="status"]').textContent,/Dávila/);
await act(async()=>{const b=confirmar();b.click();b.click();});assert.equal(fijaciones,1);assert.equal(guardado.revision,'r2');
await click([...document.querySelectorAll('button')].find(b=>b.textContent==='Elegir horario'));
fallar=true;await click(cell('k0'));await click(confirmar());assert.equal(rechecks,1);assert.match(document.querySelector('[role="alert"]').textContent,/revisi\u00f3n cambi\u00f3/);assert.ok(document.querySelector('[aria-expanded="true"]'));

const { default: Grilla } = await server.ssrLoadModule('/src/components/GrillaHorariosPartido.jsx');
const tramos = [];
const fila = (hora, estados, pedir = 'b') => estados.forEach((estado, i) => {
  const slotId = `Viernes-${hora}:${String(i * 15).padStart(2, '0')}`;
  tramos.push({ clave: slotId, slotId, fechaHora: `2026-11-0${Number(hora) < 6 ? 7 : 6}T${hora}:${String(i * 15).padStart(2, '0')}:00Z`, estado,
    parejasAAmpliar: estado === 'PEDIR_1' ? [Array.isArray(pedir) ? pedir[i] : pedir] : estado === 'PEDIR_VARIAS' ? ['a', 'b'] : [] });
});
fila('07', Array(4).fill('ENTRA'));
fila('08', Array(4).fill('NO_DISPONIBLE'));
for (const hora of ['09', '11', '12']) fila(hora, Array(4).fill('PEDIR_VARIAS'));
fila('10', Array(4).fill('NO_DISPONIBLE'));
for (const hora of ['13', '14', '15']) fila(hora, ['PEDIR_1', 'NO_DISPONIBLE', 'ENTRA', 'PEDIR_VARIAS']);
for (const hora of ['16', '17', '18', '19', '20', '21']) fila(hora, Array(4).fill('NO_DISPONIBLE'));
fila('22', ['PEDIR_1', 'NO_DISPONIBLE', 'ENTRA', 'PEDIR_VARIAS'], 'a');
fila('23', ['PEDIR_1', 'PEDIR_1', 'ENTRA', 'NO_DISPONIBLE'], ['a', 'b']);
fila('00', ['ENTRA', 'NO_DISPONIBLE', 'NO_DISPONIBLE', 'NO_DISPONIBLE']);
fila('01', Array(4).fill('PEDIR_VARIAS'));
fila('02', Array(4).fill('ENTRA'));
tramos.push({ clave: 'sabado', slotId: 'Sabado-09:00', fechaHora: '2026-11-07T12:00:00Z', estado: 'PEDIR_VARIAS', parejasAAmpliar: ['a', 'b', 'c', 'd'] });
const propsGrilla = { opciones: tramos, seleccion: null, onSeleccion: () => {}, describir: (o) => o.estado,
  nombres: new Map([['a', 'Caruso / Vallejos'], ['b', 'Dávila / Arrieta']]), fijando: false, onCambioDia: () => {} };
await act(async () => root.render(React.createElement(Grilla, propsGrilla)));
const titulos = [...document.querySelectorAll('.pc-horarios-tramo')].map((e) => e.textContent);
assert.ok(titulos.includes('13 a 15 h · pedirle a Dávila / Arrieta'), 'PEDIR_VARIAS no cambia el título del tramo visible');
assert.ok(titulos.includes('22 h · pedirle a Caruso / Vallejos'));
assert.ok(titulos.includes('23 h · pedirle a Caruso / Vallejos o a Dávila / Arrieta'));
assert.ok(titulos.includes('00 h · entra en el horario de las dos parejas'));
assert.ok(titulos.includes('16 a 21 h · sin horarios'));
assert.ok(titulos.includes('09 h · hay que pedirle a varias parejas'), 'La jornada sin ENTRA/PEDIR_1 queda completa');
const plegar = document.querySelector('.pc-horarios-plegar');
assert.equal(plegar.textContent.trim(), '08 a 12 h · hay que pedirle a las dos parejas', 'El tramo secundario conserva los extremos sin horarios');
assert.ok(!titulos.includes('08 h · sin horarios'), 'No agrega una línea para el extremo de un tramo cerrado');
const unaHora = [...document.querySelectorAll('.pc-horarios-plegar')].find((e) => e.textContent.trim() === '01 h · hay que pedirle a las dos parejas');
assert.ok(unaHora, 'Una sola hora secundaria también se pliega');
assert.equal(document.querySelector('[data-clave="Viernes-01:00"]'), null);
await click(unaHora); assert.ok(document.querySelector('[data-clave="Viernes-01:00"]'));
await click(unaHora); assert.equal(document.querySelector('[data-clave="Viernes-01:00"]'), null);
const inicio = (hora, minutos = '00') => document.querySelector(`[data-clave="Viernes-${hora}:${minutos}"]`);
const flecha = async (elemento, key) => act(async () => {
  elemento.focus(); elemento.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true }));
});
assert.equal(inicio('16'), null);
assert.equal(inicio('13', '15'), null);
assert.equal(inicio('13').closest('[role="row"]').children[2].getAttribute('aria-hidden'), 'true');
assert.equal(inicio('13').closest('[role="row"]').children[2].textContent, '');
assert.equal(inicio('13', '30').parentElement.getAttribute('aria-colindex'), '4');
assert.match(inicio('00').getAttribute('aria-label'), /^sáb 00:00/);
assert.ok([...document.querySelectorAll('[role="rowheader"]')].every((e) => !/sáb|dom/.test(e.textContent)));
await flecha(inicio('07'), 'ArrowDown'); assert.equal(document.activeElement.dataset.clave, 'Viernes-13:00');
await flecha(inicio('13'), 'ArrowRight'); assert.equal(document.activeElement.dataset.clave, 'Viernes-13:30');
await flecha(inicio('15'), 'ArrowDown'); assert.equal(document.activeElement.dataset.clave, 'Viernes-22:00');
await click(plegar);
assert.ok([...document.querySelectorAll('.pc-horarios-tramo')].some((e) => e.textContent === '08 h · sin horarios'));
assert.ok([...document.querySelectorAll('.pc-horarios-tramo')].some((e) => e.textContent === '10 h · sin horarios'));
assert.equal(inicio('10'), null);
await flecha(inicio('09'), 'ArrowDown'); assert.equal(document.activeElement.dataset.clave, 'Viernes-11:00');
await click(plegar); assert.equal(inicio('09'), null);
const mixto = tramos.map((o) => o.slotId === 'Viernes-16:00' ? { ...o, estado: 'PEDIR_VARIAS', parejasAAmpliar: ['a', 'b'] } : o);
await act(async () => root.render(React.createElement(Grilla, { ...propsGrilla, opciones: mixto })));
const conExtremo = [...document.querySelectorAll('.pc-horarios-plegar')].find((e) => e.textContent.trim() === '16 a 21 h · hay que pedirle a las dos parejas');
assert.ok(conExtremo, 'Un inicio elegible incluye todas las horas secundarias contiguas');
assert.ok(!document.body.textContent.includes('17 a 21 h · sin horarios'));
await click(conExtremo);
assert.ok([...document.querySelectorAll('.pc-horarios-tramo')].some((e) => e.textContent === '17 a 21 h · sin horarios'));
await click(conExtremo);
await act(async () => root.render(React.createElement(Grilla, { ...propsGrilla, esDefinicion: true })));
assert.ok(document.body.textContent.includes('00 h · entra en el horario de las cuatro parejas'));

const nombresRec = new Map([['orellana', 'Orellana / Peralta'], ['davila', 'Dávila / Arrieta']]);
const opcionRec = (clave, slotId, estado, diasNuevos, minutosAmpliacion, parejasAAmpliar = ['orellana']) => {
  const [dia, hora] = slotId.split('-'), [h, m] = hora.split(':').map(Number);
  return { clave, slotId, estado, diasNuevos, minutosAmpliacion, parejasAAmpliar,
    fechaHora: new Date(Date.UTC(2026, 10, dia === 'Viernes' ? 6 : 7, h + 3 + (h < 6 ? 24 : 0), m)).toISOString() };
};
let recomendadoSeleccionado;
function ProbarRecomendado({ opciones: opcionesRec, fijando = false }) {
  const [seleccionRec, setSeleccionRec] = React.useState(null);
  return React.createElement(Grilla, { ...propsGrilla, opciones: opcionesRec, nombres: nombresRec, fijando, seleccion: seleccionRec,
    describir: (o) => `Pedile a ${o.parejasAAmpliar.map((parejaId) => nombresRec.get(parejaId)).join(' y a ')}${o.diasNuevos ? ' (no cargó ese día)' : ''}`,
    onSeleccion: (o) => { recomendadoSeleccionado = o; setSeleccionRec(o); } });
}
const casosRec = [
  { nombre: 'entra primero', esperado: 'entra', texto: 'entra en el horario de las dos parejas', opciones: [
    opcionRec('pedir', 'Viernes-22:00', 'PEDIR_1', 0, 0), opcionRec('entra', 'Sabado-09:00', 'ENTRA', 1, 120, []),
  ] },
  { nombre: 'menos días antes que minutos o cantidad de parejas', esperado: 'dias', texto: '15 min más en total', opciones: [
    opcionRec('no', 'Viernes-07:00', 'NO_DISPONIBLE', 0, 0), opcionRec('nuevo', 'Viernes-08:00', 'PEDIR_1', 1, 0),
    opcionRec('dias', 'Viernes-09:00', 'PEDIR_VARIAS', 0, 15, ['orellana', 'davila']),
  ] },
  { nombre: 'menos minutos', esperado: 'minutos', texto: '1 h 15 min más', opciones: [
    opcionRec('caro', 'Viernes-20:00', 'PEDIR_1', 0, 120), opcionRec('minutos', 'Viernes-22:45', 'PEDIR_1', 0, 75),
  ] },
  { nombre: 'inicio más temprano con trasnoche', esperado: 'hora', texto: 'Recomendado: vie 22:45 · pedirle a Orellana / Peralta 2 h más', opciones: [
    opcionRec('madrugada', 'Viernes-00:00', 'PEDIR_1', 0, 120), opcionRec('tarde', 'Viernes-23:00', 'PEDIR_1', 0, 120),
    opcionRec('hora', 'Viernes-22:45', 'PEDIR_1', 0, 120),
  ] },
  { nombre: 'día nuevo', esperado: 'nuevo', texto: 'Orellana / Peralta (no cargó ese día)', opciones: [
    opcionRec('nuevo', 'Sabado-22:45', 'PEDIR_1', 1, 0), opcionRec('dos', 'Viernes-20:00', 'PEDIR_VARIAS', 2, 0),
  ] },
];
for (const caso of casosRec) {
  const originales = structuredClone(caso.opciones);
  recomendadoSeleccionado = undefined;
  await act(async () => root.render(React.createElement(ProbarRecomendado, { key: caso.nombre, opciones: caso.opciones })));
  const botonRec = document.querySelector('.pc-horarios-recomendado');
  assert.ok(botonRec.textContent.includes(caso.texto), caso.nombre);
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
assert.equal(document.querySelector('.pc-horarios-plegar').getAttribute('aria-expanded'), 'true');
await click(document.querySelector('.pc-horarios-plegar'));
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
console.log('PASS DOM: recomendado por costo, estrella, selección, jornada y tramo plegado, tramos por pareja, teclado, doble envío y 409; fijaciones interceptadas');
}finally{await server.close();dom.window.close();}
