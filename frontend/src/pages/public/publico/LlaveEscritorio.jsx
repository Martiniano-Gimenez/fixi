import { useLayoutEffect, useRef } from 'react';
import BracketLines from '../../../components/BracketLines';
import TarjetaPartido from './TarjetaPartido';
import { fraseFase, ladoDe } from './utilidades';

/**
 * Llave completa en escritorio: una columna por ronda, con líneas que unen cada cruce.
 * Los "pasa directo" ocupan su lugar (si no, las líneas no coinciden con los cruces).
 * Con una búsqueda (coincide), la pareja (su lugar y su próximo cruce) se destaca en azul y el resto
 * se atenúa en vez de desaparecer. origenes resuelve "1° Zona A" → pareja cuando su zona ya terminó.
 */
export default function LlaveEscritorio({ fases, seguidaId, coincide, origenes, faseActivaId }) {
  const rondasRef = useRef(null);
  const scrollRef = useRef(null);
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    const ronda = [...(rondasRef.current?.children || [])].find((el) => el.dataset.fase === faseActivaId);
    if (!scroll || !ronda) return;
    const caja = scroll.getBoundingClientRect(), elegida = ronda.getBoundingClientRect();
    if (elegida.left < caja.left || elegida.right > caja.right) {
      scroll.scrollTo({ left: scroll.scrollLeft + elegida.left - caja.left - 20, behavior: 'instant' });
    }
  }, [faseActivaId]);
  return (
    <div className="pv-llave" ref={scrollRef}>
      <div className="pv-llave-rondas" ref={rondasRef}>
        {fases.map((f) => (
          <section key={f.id} data-fase={f.id} className={`pv-llave-ronda${f.id === faseActivaId ? ' is-active' : ''}`} aria-label={fraseFase(f.nombre)}>
            <h3>{fraseFase(f.nombre)}</h3>
            <div className="pv-llave-col">
              {f.partidos.map((p) => {
                const marca = coincide ? (coincide(p) ? 'destacado' : 'atenuado') : '';
                if (p.esBye) {
                  const lado = ladoDe(p, p.pareja2 && !p.pareja1 ? 2 : 1, origenes);
                  return (
                    <div key={p.id} className={`pv-llave-item ${marca}`}>
                      <div className="pv-llave-bye">
                        <span translate="no" className={lado.definida ? 'definida' : ''}>{lado.nombre}</span>
                        <small>{lado.origen ? `${lado.origen}, pasa directo` : 'Pasa directo'}</small>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={p.id} className={`pv-llave-item ${marca}`}>
                    <TarjetaPartido partido={p} seguidaId={seguidaId} clase="compacta" origenes={origenes} />
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        <BracketLines
          scrollContainerRef={rondasRef}
          fases={fases}
          selectorRonda=".pv-llave-ronda"
          selectorPartido=".pv-llave-item"
          color="var(--linea-fuerte)"
        />
      </div>
    </div>
  );
}
