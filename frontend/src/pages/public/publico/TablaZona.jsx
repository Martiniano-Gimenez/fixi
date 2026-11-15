import { useId } from 'react';
import { Estrella, Numero } from './TarjetaPartido';
import { normalizar } from './utilidades';

const ALTO_FILA = 52;

/**
 * Tabla de posiciones de una zona. El orden viene del backend (tabla[]).
 * Cada fila se ubica con translateY: cuando cambia el orden, se desliza a su nueva posición.
 * children: lo que va al pie de la tarjeta (por ejemplo, "Ver partidos").
 */
export default function TablaZona({ zona, seguidaId, busqueda, children, mostrarClasifican = true, onAbrirPareja }) {
  const id = useId();
  const filas = zona.tabla || [];
  const q = normalizar(busqueda);
  return (
    <section className="pv-tabla" aria-label={`Posiciones de la ${zona.nombre}`}>
      <div className="pv-tabla-cab">
        <h3>{zona.nombre}</h3>
        {mostrarClasifican && <span className="pv-clasif-ref">
          <i aria-hidden="true" />
          Clasifican {zona.clasifican}
        </span>}
      </div>
      <div className="pv-t-grid pv-t-head" aria-hidden="true">
        <span>#</span>
        <span>Pareja</span>
        <span>PJ</span>
        <span>Sets</span>
        <span>Games</span>
        <span>Pts</span>
      </div>
      <div className="pv-t-filas" role="list" style={{ height: filas.length * ALTO_FILA }}>
        {zona.clasifican > 0 && zona.clasifican < filas.length && (
          <span className="pv-corte" style={{ top: zona.clasifican * ALTO_FILA }} aria-hidden="true" />
        )}
        {/* Orden estable en el DOM (por id) para que la transición de transform funcione */}
        {[...filas]
          .map((row, i) => ({ row, i }))
          .sort((a, b) => String(a.row.parejaId).localeCompare(String(b.row.parejaId)))
          .map(({ row, i }) => {
            const clasifica = i < zona.clasifican;
            const seguida = seguidaId && row.parejaId === seguidaId;
            const coincide = q && normalizar(row.pareja).includes(q);
            const puedeAbrir = Boolean(onAbrirPareja && row.parejaId && row.pareja);
            return (
              <div
                key={row.parejaId || row.pareja}
                role="listitem"
                className={`pv-t-grid pv-t-fila ${clasifica ? 'clasifica' : ''} ${seguida ? 'seguida' : ''} ${coincide ? 'coincide' : ''}`}
                style={{ transform: `translateY(${i * ALTO_FILA}px)`, zIndex: filas.length - i }}
                aria-label={`${i + 1}°, ${row.pareja}: ${row.puntos} puntos, ${row.pj} jugados, sets ${row.sf} a ${row.sc}, games ${row.gf} a ${row.gc}`}
              >
                <span className="pv-t-pos num" aria-hidden="true">{i + 1}</span>
                <span className="pv-t-nombre" translate="no" title={row.pareja} aria-hidden="true">
                  {row.pareja}{seguida && <Estrella decorativa />}
                </span>
                <span className="pv-t-dato" aria-hidden="true"><Numero valor={row.pj} /></span>
                <span className="pv-t-dato" aria-hidden="true"><Numero valor={`${row.sf}-${row.sc}`} /></span>
                <span className="pv-t-dato" aria-hidden="true"><Numero valor={`${row.gf}-${row.gc}`} /></span>
                <span className="pv-t-ptos" aria-hidden="true"><Numero valor={row.puntos} /></span>
                {puedeAbrir && (
                  <button
                    type="button"
                    id={`${id}-pareja-${row.parejaId}`}
                    className="pv-t-abrir"
                    aria-label={`Ver partidos de ${row.pareja}`}
                    onClick={(event) => onAbrirPareja({ parejaId: row.parejaId, nombre: row.pareja }, event.currentTarget)}
                  />
                )}
              </div>
            );
          })}
      </div>
      {children}
    </section>
  );
}
