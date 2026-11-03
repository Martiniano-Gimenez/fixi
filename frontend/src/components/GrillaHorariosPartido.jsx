import { useId, useRef, useState } from 'react';
import { Ban, Check, UserRound, UsersRound } from 'lucide-react';
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
  const cambiarDia = (dia) => { setDiaActivo(dia); onCambioDia(); };
  const enfocar = (opcion) => raiz.current?.querySelector(`[data-clave="${opcion.clave}"]`)?.focus();

  return (
    <div className="pc-horarios" ref={raiz}>
      <ul className="pc-horarios-leyenda" aria-label="Estados de los horarios">
        {ESTADOS.map(({ estado, texto, Icono }) => (
          <li key={estado}><span className={`pc-horarios-marca is-${estado.toLowerCase()}`}><Icono size={14} aria-hidden="true" /></span>{texto}</li>
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
          const primera = filas.flatMap((f) => f.celdas).find(Boolean);
          const claveFoco = filas.some((f) => f.celdas.some((o) => o?.clave === foco[dia])) ? foco[dia] : primera?.clave;
          return (
            <section key={dia} id={`${id}-${dia}`} role="tabpanel" aria-labelledby={`${id}-tab-${dia}`}
              className={`pc-horarios-dia${diaActivo === dia ? ' is-active' : ''}`}>
              <h5 className="pc-horarios-dia-titulo">{etiqueta}</h5>
              {!filas.length ? <p className="pc-manual-copy">El club no tiene inicios para esta jornada.</p> : (
                <div role="grid" aria-label={`Inicios del ${dia === 'Viernes' ? 'viernes' : 'sábado'}`} aria-colcount={4} aria-describedby={`${id}-ayuda`}>
                  {filas.map(({ hora, celdas }, fila) => (
                    <div key={hora} role="row" className="pc-horarios-fila">
                      <span className="pc-horarios-hora" aria-hidden="true">{Number(hora) < 6 ? `${dia === 'Viernes' ? 'sáb' : 'dom'} ` : ''}{hora} h</span>
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
                                const siguiente = moverCelda(filas, fila, columna, event.key);
                                if (siguiente) { event.preventDefault(); enfocar(siguiente); }
                                else if (event.key.startsWith('Arrow')) event.preventDefault();
                              }}>
                              <span>:{String(columna * 15).padStart(2, '0')}</span><Icono size={13} aria-hidden="true" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
