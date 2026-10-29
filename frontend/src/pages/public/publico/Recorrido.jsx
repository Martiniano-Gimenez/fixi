import { etapasDe } from './utilidades';

/**
 * Recorrido de fases: una barra por etapa (zonas y cada ronda del cuadro).
 * Celeste lo jugado: las etapas hechas llenas, la actual en proporción, las futuras vacías.
 * Al entrar, las barras se llenan una tras otra (ver .pv-recorrido en publico.css).
 */
export default function Recorrido({ categoria }) {
  const etapas = etapasDe(categoria);
  if (!etapas.length) return null;
  return (
    <ol className="pv-recorrido" aria-label="Recorrido de fases">
      {etapas.map((e, n) => {
        const p = e.estado === 'hecha' ? 1 : e.estado === 'actual' ? Math.max(e.total ? e.jugados / e.total : 0, 0.04) : 0;
        const texto = e.estado === 'hecha' ? 'terminada' : e.estado === 'actual' ? `en curso, ${e.jugados} de ${e.total} jugados` : 'por jugar';
        return (
          <li key={e.key} className={e.estado} style={{ '--n': n }}>
            <span className="pv-tramo" aria-hidden="true">
              <i style={{ '--p': p.toFixed(3) }} />
            </span>
            <span className="pv-etapa" aria-hidden="true">{e.corta}</span>
            <span className="pv-sr">{e.larga}: {texto}</span>
          </li>
        );
      })}
    </ol>
  );
}
