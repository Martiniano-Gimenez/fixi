import { useId, useRef, useState } from 'react';
import { Ban, Check, ChevronRight, UserRound, UsersRound } from 'lucide-react';
import { formatSlotCorto } from '../utils/dateUtils';
import { agruparInicios, moverCelda } from './grillaHorarios';

const ESTADOS = [
  { estado: 'ENTRA', texto: 'Entra', Icono: Check },
  { estado: 'PEDIR_1', texto: 'Pedirle a 1 pareja', Icono: UserRound },
  { estado: 'PEDIR_VARIAS', texto: 'Pedirle a 2 o más', Icono: UsersRound },
  { estado: 'NO_DISPONIBLE', texto: 'No disponible', Icono: Ban },
];

export default function GrillaHorariosPartido({ opciones, seleccion, onSeleccion, describir, fijando, onCambioDia }) {
  const id = useId();
  const raiz = useRef(null);
  const dias = agruparInicios(opciones);
  const [diaActivo, setDiaActivo] = useState(() => dias.find((d) => d.filas.length)?.dia || 'Viernes');
  const [foco, setFoco] = useState({});
  const [desplegados, setDesplegados] = useState({});
  const cambiarDia = (dia) => { setDiaActivo(dia); onCambioDia(); };
  const enfocar = (opcion) => raiz.current?.querySelector(`[data-clave="${opcion.clave}"]`)?.focus();

  if (opciones.length > 0 && opciones.every((o) => o.motivo === 'ESPERA_BASES')) {
    return <p className="pc-manual-copy" role="status">Se habilita cuando los dos primeros partidos tengan horario.</p>;
  }

  return (
    <div className="pc-horarios" ref={raiz}>
      <ul className="pc-horarios-leyenda" aria-label="Estados de los horarios">
        {ESTADOS.map(({ estado, texto, Icono }) => (
          <li key={estado}><span className={`pc-horarios-marca is-${estado.toLowerCase()}`}><Icono size={14} aria-hidden="true" /></span>{texto} ({opciones.filter((o) => o.estado === estado).length})</li>
        ))}
      </ul>
      <p className="pc-horarios-ayuda" id={`${id}-ayuda`}>Recorré los horarios con las flechas. Tocá uno no disponible para ver el motivo.</p>
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
        {dias.map(({ dia, etiqueta, filas }) => {
          const esUtil = (fila) => fila.celdas.some((o) => o?.estado === 'ENTRA' || o?.estado === 'PEDIR_1');
          const hayUtiles = filas.some(esUtil);
          const bloques = filas.reduce((lista, fila) => {
            const plegable = hayUtiles && !esUtil(fila);
            const anterior = lista.at(-1);
            if (plegable && anterior?.plegable && (Number(anterior.filas.at(-1).hora) + 1) % 24 === Number(fila.hora)) {
              anterior.filas.push(fila);
            } else lista.push({ clave: `${dia}-${fila.hora}`, plegable, filas: [fila] });
            return lista;
          }, []);
          const sePliega = (bloque) => bloque.plegable && bloque.filas.length > 1;
          const visibles = bloques.flatMap((b) => sePliega(b) && !desplegados[b.clave] ? [] : b.filas);
          const primera = visibles.flatMap((f) => f.celdas).find(Boolean);
          const claveFoco = visibles.some((f) => f.celdas.some((o) => o?.clave === foco[dia])) ? foco[dia] : primera?.clave;
          const horaReal = (hora) => `${Number(hora) < 6 ? `${dia === 'Viernes' ? 'sáb' : 'dom'} ` : ''}${hora}`;
          const renderizarFila = ({ hora, celdas }) => (
            <div key={hora} role="row" className="pc-horarios-fila">
              <span className="pc-horarios-hora" role="rowheader">{horaReal(hora)} h</span>
              {celdas.map((opcion, columna) => {
                if (!opcion) return <div key={columna} role="gridcell" className="pc-horarios-hueco" aria-label="Fuera de los inicios del club">—</div>;
                const { Icono } = ESTADOS.find((e) => e.estado === opcion.estado);
                return (
                  <div key={columna} role="gridcell" aria-selected={seleccion?.clave === opcion.clave}>
                    <button type="button" data-clave={opcion.clave}
                      className={`pc-horarios-inicio is-${opcion.estado.toLowerCase()}${seleccion?.clave === opcion.clave ? ' is-selected' : ''}`}
                      tabIndex={claveFoco === opcion.clave ? 0 : -1} disabled={fijando}
                      aria-disabled={opcion.estado === 'NO_DISPONIBLE'}
                      aria-label={`${formatSlotCorto(opcion.slotId)} · ${describir(opcion)}`}
                      onFocus={() => setFoco((prev) => ({ ...prev, [dia]: opcion.clave }))}
                      onClick={() => onSeleccion(opcion)} onKeyDown={(event) => {
                        const fila = visibles.findIndex((f) => f.hora === hora);
                        const siguiente = moverCelda(visibles, fila, columna, event.key);
                        if (siguiente) { event.preventDefault(); enfocar(siguiente); }
                        else if (event.key.startsWith('Arrow')) event.preventDefault();
                      }}>
                      <span>:{String(columna * 15).padStart(2, '0')}</span><Icono size={13} aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </div>
          );
          return (
            <section key={dia} id={`${id}-${dia}`} role="tabpanel" aria-labelledby={`${id}-tab-${dia}`}
              className={`pc-horarios-dia${diaActivo === dia ? ' is-active' : ''}`}>
              <h5 className="pc-horarios-dia-titulo">{etiqueta}</h5>
              {!filas.length ? <p className="pc-manual-copy">El club no tiene inicios para esta jornada.</p> : (
                <div role="grid" aria-label={`Inicios del ${dia === 'Viernes' ? 'viernes' : 'sábado'}`} aria-colcount={5} aria-describedby={`${id}-ayuda`}>
                  {bloques.map((bloque) => {
                    if (!sePliega(bloque)) return bloque.filas.map(renderizarFila);
                    const inicios = bloque.filas.flatMap((f) => f.celdas).filter(Boolean);
                    const soloPedidos = inicios.every((o) => o.estado === 'PEDIR_VARIAS');
                    const resumen = soloPedidos
                      ? inicios.every((o) => o.parejasAAmpliar.length === 2) ? 'hay que pedirle a las dos parejas' : 'hay que pedirle a varias parejas'
                      : inicios.every((o) => o.estado === 'NO_DISPONIBLE') ? 'no disponible' : 'pedirle a varias o no disponible';
                    const abierto = Boolean(desplegados[bloque.clave]);
                    return (
                      <div key={bloque.clave} role="rowgroup">
                        <div role="row" className="pc-horarios-resumen">
                          <div role="gridcell" aria-colspan={5}>
                            <button type="button" className="pc-horarios-plegar" aria-expanded={abierto}
                              aria-controls={`${id}-grupo-${bloque.clave}`} disabled={fijando} onClick={() => {
                                setDesplegados((prev) => ({ ...prev, [bloque.clave]: !abierto }));
                                onSeleccion(null);
                                if (!abierto) setFoco((prev) => ({ ...prev, [dia]: inicios[0].clave }));
                              }}>
                              <ChevronRight size={14} aria-hidden="true" className={abierto ? 'is-open' : ''} />
                              <span><strong>{horaReal(bloque.filas[0].hora)} a {horaReal(bloque.filas.at(-1).hora)} h</strong> · {resumen}</span>
                            </button>
                          </div>
                        </div>
                        <div role="rowgroup" id={`${id}-grupo-${bloque.clave}`}>
                          {abierto && bloque.filas.map(renderizarFila)}
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
