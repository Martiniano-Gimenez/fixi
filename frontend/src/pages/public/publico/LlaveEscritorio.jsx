import { useRef } from 'react';
import BracketLines from '../../../components/BracketLines';
import TarjetaPartido from './TarjetaPartido';
import { fraseFase, nombrePareja1, nombrePareja2 } from './utilidades';

/**
 * Llave completa en escritorio: una columna por ronda, con líneas que unen cada cruce.
 * Los "pasa directo" ocupan su lugar (si no, las líneas no coinciden con los cruces).
 * Con una búsqueda (coincide), los partidos que no coinciden se atenúan en vez de desaparecer.
 */
export default function LlaveEscritorio({ fases, seguidaId, coincide }) {
  const rondasRef = useRef(null);
  return (
    <div className="pv-llave">
      <div className="pv-llave-rondas" ref={rondasRef}>
        {fases.map((f) => (
          <section key={f.id} className="pv-llave-ronda" aria-label={fraseFase(f.nombre)}>
            <h3>{fraseFase(f.nombre)}</h3>
            <div className="pv-llave-col">
              {f.partidos.map((p) => {
                const atenuado = Boolean(coincide) && !coincide(p);
                if (p.esBye) {
                  const quien = p.pareja1 || p.pareja2 ? (p.pareja1 ? nombrePareja1(p) : nombrePareja2(p)) : nombrePareja1(p);
                  return (
                    <div key={p.id} className={`pv-llave-item ${atenuado ? 'atenuado' : ''}`}>
                      <div className="pv-llave-bye">
                        <span translate="no">{quien}</span>
                        <small>Pasa directo</small>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={p.id} className={`pv-llave-item ${atenuado ? 'atenuado' : ''}`}>
                    <TarjetaPartido partido={p} seguidaId={seguidaId} clase="compacta" />
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
