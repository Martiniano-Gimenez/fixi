import { useId, useRef, useState } from 'react';
import { ChevronRight, Star } from 'lucide-react';
import { formatSlotCorto } from '../utils/dateUtils';
import { agruparInicios, detallePorPareja, esSecundario, filasVisibles, moverCelda } from './grillaHorarios';

export default function GrillaHorariosPartido({ opciones, seleccion, onSeleccion, describir, fijando, onCambioDia, nombres = new Map(), esDefinicion = false }) {
  const id = useId();
  const raiz = useRef(null);
  const dias = agruparInicios(opciones);
  const [diaActivo, setDiaActivo] = useState(() => dias.find((d) => d.filas.length)?.dia || 'Viernes');
  const [foco, setFoco] = useState({});
  const [desplegados, setDesplegados] = useState({});
  const [verTodos, setVerTodos] = useState(false);
  const cambiarDia = (dia) => { setDiaActivo(dia); onCambioDia(); };
  const enfocar = (opcion) => raiz.current?.querySelector(`[data-clave="${opcion.clave}"]`)?.focus();
  const disponibles = opciones.filter((o) => o.estado !== 'NO_DISPONIBLE');
  const recomendado = [...disponibles].sort((a, b) =>
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
  // Lo que hay que pedirle a cada pareja, por separado: cuánto antes o después de su horario, o un día nuevo.
  const textoRecomendado = (
    <span className="pc-horarios-recomendado-cuerpo">
      <span><strong>Recomendado:</strong> {formatSlotCorto(recomendado.slotId)}
        {recomendado.estado === 'ENTRA' && ` · entra en el horario de las ${esDefinicion ? 'cuatro' : 'dos'} parejas`}</span>
      {recomendado.estado !== 'ENTRA' && (
        <span className="pc-horarios-recomendado-detalle">
          {detallePorPareja(recomendado, nombres).map((d) => `${d.nombre}: ${d.texto}`).join(' · ')}
        </span>
      )}
    </span>
  );
  // Sin ningún horario que entre ni que pida a una sola pareja, la grilla no ayuda a decidir: queda plegada.
  const hayUtiles = disponibles.some((o) => o.estado === 'ENTRA' || o.estado === 'PEDIR_1');
  const grillaVisible = hayUtiles || verTodos;
  const elegirRecomendado = () => {
    const dia = recomendado.slotId.split('-')[0];
    setDiaActivo(dia);
    setFoco((prev) => ({ ...prev, [dia]: recomendado.clave }));
    onSeleccion(recomendado);
  };

  return (
    <div className="pc-horarios" ref={raiz}>
      {hayUtiles ? (
        <button type="button" className="pc-horarios-recomendado" disabled={fijando} onClick={elegirRecomendado}>
          <Star size={16} aria-hidden="true" />
          {textoRecomendado}
        </button>
      ) : (
        <div className="pc-horarios-solo-recomendado">
          <p className="pc-horarios-recomendado-texto">
            <Star size={16} aria-hidden="true" />
            {textoRecomendado}
          </p>
          <button type="button" className="pc-manual-button" disabled={fijando} onClick={elegirRecomendado}>Elegir este horario</button>
          <button type="button" className="pc-horarios-plegar pc-horarios-ver-todos" aria-expanded={verTodos} aria-controls={`${id}-todos`}
            disabled={fijando} onClick={() => setVerTodos((v) => !v)}>
            <ChevronRight size={14} aria-hidden="true" className={verTodos ? 'is-open' : ''} />
            <span>Ver todos los horarios ({disponibles.length})</span>
          </button>
        </div>
      )}
      {grillaVisible && <div id={`${id}-todos`}>
      <p className="pm-visually-hidden" id={`${id}-ayuda`}>Recorré los horarios con las flechas.</p>
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
          // Con horarios que entran o que piden a una sola pareja, los que piden a varias quedan plegados
          // en un único "Ver más horarios" al final del día.
          const secundarios = originales.flatMap((f) => f.celdas).filter((o) => o && o.estado !== 'NO_DISPONIBLE' && esSecundario(o));
          const pliega = hayUtiles && secundarios.length > 0;
          const abierto = Boolean(desplegados[dia] ||
            (seleccion?.clave === recomendado.clave && secundarios.some((o) => o.clave === recomendado.clave)));
          const visibles = filasVisibles(originales, { conSecundarios: !pliega || abierto });
          const hayHorarios = visibles.length > 0 || secundarios.length > 0;
          const primera = visibles.flatMap((f) => f.celdas).find(Boolean);
          const claveFoco = visibles.some((f) => f.celdas.some((o) => o?.clave === foco[dia])) ? foco[dia] : primera?.clave;
          const renderizarFila = (fila) => (
            <div key={fila.hora} role="row" className={`pc-horarios-fila${fila.salto ? ' is-salto' : ''}`}>
              {fila.celdas.map((opcion, columna) => {
                if (!opcion) return null; // los horarios van juntos a la izquierda: solo quedan lugares libres al final
                return (
                  <div key={columna} role="gridcell" aria-colindex={columna + 1} aria-selected={seleccion?.clave === opcion.clave}>
                    <button type="button" data-clave={opcion.clave}
                      className={`pc-horarios-inicio is-${opcion.estado.toLowerCase()}${seleccion?.clave === opcion.clave ? ' is-selected' : ''}`}
                      tabIndex={claveFoco === opcion.clave ? 0 : -1} disabled={fijando}
                      aria-label={`${formatSlotCorto(opcion.slotId)} · ${describir(opcion)}${opcion.clave === recomendado.clave ? ' · recomendado' : ''}`}
                      onFocus={() => setFoco((prev) => ({ ...prev, [dia]: opcion.clave }))}
                      onClick={() => onSeleccion(opcion)} onKeyDown={(event) => {
                        const fila_ = visibles.indexOf(fila);
                        const siguiente = moverCelda(visibles, fila_, columna, event.key);
                        if (siguiente) { event.preventDefault(); enfocar(siguiente); }
                        else if (event.key.startsWith('Arrow')) event.preventDefault();
                      }}>
                      <span>{opcion.slotId.split('-')[1]}</span>
                      {opcion.clave === recomendado.clave && <Star size={10} className="pc-horarios-estrella" aria-hidden="true" />}
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
              {!originales.length ? <p className="pc-manual-copy">El club no tiene inicios para esta jornada.</p>
                : !hayHorarios ? <p className="pc-manual-copy">Sin horarios posibles en esta jornada.</p> : (
                <>
                  {visibles.length > 0 && (
                    <div role="grid" id={`${id}-grilla-${dia}`} aria-label={`Inicios del ${dia === 'Viernes' ? 'viernes' : 'sábado'}`}
                      aria-colcount={4} aria-describedby={`${id}-ayuda`}>
                      {visibles.map(renderizarFila)}
                    </div>
                  )}
                  {pliega && (
                    <button type="button" className="pc-horarios-plegar pc-horarios-ver-mas" aria-expanded={abierto}
                      aria-controls={`${id}-grilla-${dia}`} disabled={fijando} onClick={() => {
                        setDesplegados((prev) => ({ ...prev, [dia]: !abierto }));
                        onSeleccion(null);
                        if (!abierto) setFoco((prev) => ({ ...prev, [dia]: secundarios[0].clave }));
                      }}>
                      <ChevronRight size={14} aria-hidden="true" className={abierto ? 'is-open' : ''} />
                      <span>Ver más horarios ({secundarios.length})</span>
                    </button>
                  )}
                </>
              )}
            </section>
          );
        })}
      </div>
      </div>}
    </div>
  );
}
