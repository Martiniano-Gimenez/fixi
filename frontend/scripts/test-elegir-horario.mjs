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
for (let i = 0; i < 50 && !cell('k3'); i++) {
  await act(async () => new Promise((r) => setTimeout(r, 20)));
}
assert.equal(document.querySelectorAll('[role="grid"]').length,2);
assert.deepEqual([...document.querySelectorAll('.pc-horarios-leyenda li')].map(e=>e.textContent),['Entra (2)','Pedirle a 1 pareja (1)','Pedirle a 2 o m\u00e1s (1)','No disponible (2)']);
assert.ok(!document.body.textContent.includes('Viabilidad por verificar'));
await click(cell('k3'));assert.match(document.querySelector('[role="status"]').textContent,/Caruso \/ Vallejos ya juega/);assert.ok(!confirmar());assert.equal(cell('k3').getAttribute('aria-disabled'),'true');
await click(cell('k4'));assert.match(document.querySelector('[role="status"]').textContent,/Primero tienen que tener horario/);assert.ok(!confirmar());
await click(cell('k1'));assert.match(document.querySelector('[role="status"]').textContent,/vie 15:15 \u00b7 Pedile a Caruso/);assert.ok(confirmar());
assert.match(document.querySelector('.pc-horarios-feedback').textContent,/Al confirmar, vie 15:15 se agrega a la disponibilidad de Caruso \/ Vallejos\. Hacelo solo si ya lo hablaste con ellas\./);
assert.ok(!document.querySelector('.pc-horarios-feedback').textContent.includes('Confirmá cuando'));
await act(async()=>{cell('k1').focus();cell('k1').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));});assert.equal(document.activeElement.dataset.clave,'k2');
await act(async()=>document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'End',bubbles:true})));assert.equal(document.activeElement.dataset.clave,'k3');
await click(cancelar());assert.equal(document.activeElement.dataset.clave,'k1');assert.ok(!document.querySelector('.pc-horarios-feedback'));
await click(cell('k2'));assert.match(document.querySelector('[role="status"]').textContent,/Dávila/);
await act(async()=>{const b=confirmar();b.click();b.click();});assert.equal(fijaciones,1);assert.equal(guardado.revision,'r2');
await click([...document.querySelectorAll('button')].find(b=>b.textContent==='Elegir horario'));
fallar=true;await click(cell('k0'));await click(confirmar());assert.equal(rechecks,1);assert.match(document.querySelector('[role="alert"]').textContent,/revisi\u00f3n cambi\u00f3/);assert.ok(document.querySelector('[aria-expanded="true"]'));
await act(async()=>root.unmount());
console.log('PASS DOM: leyenda, estados sin color, pedidos, motivos, teclado, foco, trasnoche, carga sin cursor, doble envio y 409; fijaciones interceptadas');
}finally{await server.close();dom.window.close();}
