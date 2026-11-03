import { useId, useRef, useState } from 'react';
import { Check, ChevronRight, Star, UserRound, UsersRound } from 'lucide-react';
import { formatSlotCorto } from '../utils/dateUtils';
import { agruparInicios, moverCelda } from './grillaHorarios';

const ESTADOS = [
  { estado: 'ENTRA', texto: 'Entra', Icono: Check },
  { estado: 'PEDIR_1', texto: 'Pedirle a 1 pareja', Icono: UserRound },
  { estado: 'PEDIR_VARIAS', texto: 'Pedirle a 2 o más', Icono: UsersRound },
];

export default function GrillaHorariosPartido({ opciones, seleccion, onSeleccion, describir, fijando, onCambioDia, nombres = new Map(), esDefinicion = false }) {
  const id = useId();
  const raiz = useRef(null);
  const dias = agruparInicios(opciones);
  const [diaActivo, setDiaActivo] = useState(() => dias.find((d) => d.filas.length)?.dia || 'Viernes');
  const [foco, setFoco] = useState({});
  const [desplegados, setDesplegados] = useState({});
  const cambiarDia = (dia) => { setDiaActivo(dia); onCambioDia(); };
  const enfocar = (opcion) => raiz.current?.querySelector(`[data-clave="${opcion.clave}"]`)?.focus();
  const recomendado = opciones.filter((o) => o.estado !== 'NO_DISPONIBLE').sort((a, b) =>
    Number(b.estado === 'ENTRA') - Number(a.estado === 'ENTRA') ||
    (a.diasNuevos ?? 0) - (b.diasNuevos ?? 0) ||
    (a.minutosAmpliacion ?? 0) - (b.minutosAmpliacion ?? 0) ||
    new Date(a.fechaHora) - new Date(b.fechaHora))[0];

  if (opciones.length > 0 && opciones.every((o) => o.motivo === 'ESPERA_BASES')) {
    return <p className="pc-manual-copy" role="status">Se habilita cuando los dos primeros partidos tengan horario.</p>;
  }
  if (!recomendado) {
    return <p className="pc-manual-copy" role="status">No hay horarios posibles para este partido con las canchas libres.</p>;
  }
  const minutos = recomendado.minutosAmpliacion ?? 0;
  const duracion = [Math.floor(minutos / 60) > 0 && `${Math.floor(minutos / 60)} h`, minutos % 60 > 0 && `${minutos % 60} min`].filter(Boolean).join(' ');
  const detalle = recomendado.estado === 'ENTRA'
    ? `entra en el horario de las ${esDefinicion ? 'cuatro' : 'dos'} parejas`
    : describir(recomendado).replace(/^Pedile a /, 'pedirle a ') +
      (duracion ? ` ${duracion} más${recomendado.parejasAAmpliar.length > 1 ? ' en total' : ''}` : '');

  return (
    <div className="pc-horarios" ref={raiz}>
      <ul className="pc-horarios-leyenda" aria-label="Estados de los horarios">
        {ESTADOS.map(({ estado, texto, Icono }) => (
          <li key={estado}><span className={`pc-horarios-marca is-${estado.toLowerCase()}`}><Icono size={14} aria-hidden="true" /></span>{texto} ({opciones.filter((o) => o.estado === estado).length})</li>
        ))}
      </ul>
      <button type="button" className="pc-horarios-recomendado" disabled={fijando} onClick={() => {
        const dia = recomendado.slotId.split('-')[0];
        setDiaActivo(dia);
        setFoco((prev) => ({ ...prev, [dia]: recomendado.clave }));
        onSeleccion(recomendado);
      }}>
        <Star size={16} aria-hidden="true" />
        <span><strong>Recomendado:</strong> {formatSlotCorto(recomendado.slotId)} · {detalle}</span>
      </button>
      <p className="pc-horarios-ayuda" id={`${id}-ayuda`}>Recorré los horarios con las flechas.</p>
      <div className="pc-horarios-tabs" role="tablist" aria-label="Jornadas del club">
        {dias.map(({ dia, etiqueta }, i) => (
          <button key={dia} id={`${id}-tab-${dia}`} type="button" role="tab" className="pc-manual-button"
            aria-selected={diaActivo === dia} aria-controls={`${id}-${dia}`} tabIndex={diaActivo === dia ? 0 : -1}
            disabled={fijando} onClick={() => cambiarDia(dia)} onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const otro = dias[event.key === 'Home' ? 0 : event.key === 'End' ? dias.length - 1 : (i + 1) % dias.length].dia;
              cambiarDia(otro); raiz.current.querySelector(`#${CSS.escape(`${id}-tab-${otro}`)}`).focus();
            }}>{etiqueta}</button>
        ))}
      </div>
      <div className="pc-horarios-dias">
        {dias.map(({ dia, etiqueta, filas: originales }) => {
          const filas = originales.map((f) => ({ ...f, celdas: f.celdas.map((o) => o?.estado === 'NO_DISPONIBLE' ? null : o) }));
          const esUtil = (fila) => fila.celdas.some((o) => o?.estado === 'ENTRA' || o?.estado === 'PEDIR_1');
          const sinHorarios = (fila) => !fila.celdas.some(Boolean);
          const parejasDeUna = (celdas) => [...new Set(celdas.filter((o) => o?.estado === 'PEDIR_1').flatMap((o) => o.parejasAAmpliar))];
          const hayUtiles = filas.some(esUtil);
          const crearBloque = (tipo, grupo) => ({ tipo, filas: grupo, clave: `${dia}-${grupo[0].hora}` });
          const consecutivas = (anterior, siguiente) => (Number(anterior.hora) + 1) % 24 === Number(siguiente.hora);
          const bloques = filas.reduce((lista, fila) => {
            const tipo = hayUtiles && !esUtil(fila) ? 'secundario' : sinHorarios(fila) ? 'sin' : 'visible';
            const firma = tipo === 'visible' ? JSON.stringify(parejasDeUna(fila.celdas).sort()) : tipo;
            const anterior = lista.at(-1);
            if (anterior?.firma === firma && consecutivas(anterior.filas.at(-1), fila)) {
              anterior.filas.push(fila);
            } else lista.push({ ...crearBloque(tipo, [fila]), firma });
            return lista;
          }, []);
          const sePliega = (bloque) => bloque.tipo === 'secundario' && bloque.filas.some((f) => !sinHorarios(f));
          const estaAbierto = (bloque) => Boolean(desplegados[bloque.clave] ||
            (seleccion?.clave === recomendado.clave && bloque.filas.some((f) => f.celdas.some((o) => o?.clave === recomendado.clave))));
          const visibles = bloques.flatMap((b) => sePliega(b) && !estaAbierto(b) ? [] : b.filas).filter((f) => !sinHorarios(f));
          const primera = visibles.flatMap((f) => f.celdas).find(Boolean);
          const claveFoco = visibles.some((f) => f.celdas.some((o) => o?.clave === foco[dia])) ? foco[dia] : primera?.clave;
          const rango = (grupo) => grupo.length === 1 ? `${grupo[0].hora} h` : `${grupo[0].hora} a ${grupo.at(-1).hora} h`;
          const renderizarSinHorarios = (grupo) => (
            <div key={`sin-${grupo[0].hora}`} role="row" className="pc-horarios-resumen">
              <div role="gridcell" aria-colspan={5}><p className="pc-horarios-tramo"><span><strong>{rango(grupo)}</strong> · sin horarios</span></p></div>
            </div>
          );
          const renderizarFila = ({ hora, celdas }) => (
            <div key={hora} role="row" className="pc-horarios-fila">
              <span className="pc-horarios-hora" role="rowheader">{hora} h</span>
              {celdas.map((opcion, columna) => {
                if (!opcion) return <div key={columna} className="pc-horarios-hueco" aria-hidden="true" />;
                const { Icono } = ESTADOS.find((e) => e.estado === opcion.estado);
                return (
                  <div key={columna} role="gridcell" aria-colindex={columna + 2} aria-selected={seleccion?.clave === opcion.clave}>
                    <button type="button" data-clave={opcion.clave}
                      className={`pc-horarios-inicio is-${opcion.estado.toLowerCase()}${seleccion?.clave === opcion.clave ? ' is-selected' : ''}`}
                      tabIndex={claveFoco === opcion.clave ? 0 : -1} disabled={fijando}
                      aria-label={`${formatSlotCorto(opcion.slotId)} · ${describir(opcion)}${opcion.clave === recomendado.clave ? ' · recomendado' : ''}`}
                      onFocus={() => setFoco((prev) => ({ ...prev, [dia]: opcion.clave }))}
                      onClick={() => onSeleccion(opcion)} onKeyDown={(event) => {
                        const fila = visibles.findIndex((f) => f.hora === hora);
                        const siguiente = moverCelda(visibles, fila, columna, event.key);
                        if (siguiente) { event.preventDefault(); enfocar(siguiente); }
                        else if (event.key.startsWith('Arrow')) event.preventDefault();
                      }}>
                      <span>:{String(columna * 15).padStart(2, '0')}</span><Icono size={13} aria-hidden="true" />
                      {opcion.clave === recomendado.clave && <Star size={10} className="pc-horarios-estrella" aria-hidden="true" />}
                    </button>
                  </div>
                );
              })}
            </div>
          );
          const renderizarFilas = (grupo) => grupo.reduce((lista, fila) => {
            const anterior = lista.at(-1);
            if (sinHorarios(fila) && anterior?.sin) anterior.filas.push(fila);
            else lista.push({ sin: sinHorarios(fila), filas: [fila] });
            return lista;
          }, []).map((g) => g.sin ? renderizarSinHorarios(g.filas) : g.filas.map(renderizarFila));
          return (
            <section key={dia} id={`${id}-${dia}`} role="tabpanel" aria-labelledby={`${id}-tab-${dia}`}
              className={`pc-horarios-dia${diaActivo === dia ? ' is-active' : ''}`}>
              <h5 className="pc-horarios-dia-titulo">{etiqueta}</h5>
              {!filas.length ? <p className="pc-manual-copy">El club no tiene inicios para esta jornada.</p> : (
                <div role="grid" aria-label={`Inicios del ${dia === 'Viernes' ? 'viernes' : 'sábado'}`} aria-colcount={5} aria-describedby={`${id}-ayuda`}>
                  {bloques.map((bloque) => {
                    if (bloque.filas.every(sinHorarios)) return renderizarSinHorarios(bloque.filas);
                    const inicios = bloque.filas.flatMap((f) => f.celdas).filter(Boolean);
                    const pedirUna = parejasDeUna(inicios);
                    const resumen = pedirUna.length
                      ? `pedirle a ${pedirUna.map((parejaId) => nombres.get(parejaId) || 'la pareja').join(' o a ')}`
                      : inicios.some((o) => o.estado === 'ENTRA')
                        ? `entra en el horario de las ${esDefinicion ? 'cuatro' : 'dos'} parejas`
                        : new Set(inicios.flatMap((o) => o.parejasAAmpliar)).size === 2 ? 'hay que pedirle a las dos parejas' : 'hay que pedirle a varias parejas';
                    const plegable = sePliega(bloque);
                    const abierto = estaAbierto(bloque);
                    return (
                      <div key={bloque.clave} role="rowgroup">
                        <div role="row" className="pc-horarios-resumen">
                          <div role="gridcell" aria-colspan={5}>
                            {plegable ? <button type="button" className="pc-horarios-plegar" aria-expanded={abierto}
                              aria-controls={`${id}-grupo-${bloque.clave}`} disabled={fijando} onClick={() => {
                                setDesplegados((prev) => ({ ...prev, [bloque.clave]: !abierto }));
                                onSeleccion(null);
                                if (!abierto) setFoco((prev) => ({ ...prev, [dia]: inicios[0].clave }));
                              }}>
                              <ChevronRight size={14} aria-hidden="true" className={abierto ? 'is-open' : ''} />
                              <span><strong>{rango(bloque.filas)}</strong> · {resumen}</span>
                            </button> : <p className="pc-horarios-tramo"><span><strong>{rango(bloque.filas)}</strong> · {resumen}</span></p>}
                          </div>
                        </div>
                        <div role="rowgroup" id={`${id}-grupo-${bloque.clave}`}>
                          {(!plegable || abierto) && renderizarFilas(bloque.filas)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
