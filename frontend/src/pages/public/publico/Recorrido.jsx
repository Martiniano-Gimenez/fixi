import { etapasDe } from './utilidades';

/**
 * Recorrido de fases: una barra por etapa (zonas y cada ronda del cuadro).
 * Celeste lo jugado: las etapas hechas llenas, la actual en proporción, las futuras vacías.
 * Al entrar, las barras se llenan una tras otra (ver .pv-recorrido en publico.css).
 */
export default function Recorrido({ categoria, activa, onCambiar, idBase }) {
  const etapas = etapasDe(categoria);
  if (!etapas.length) return null;
  const navegable = Boolean(onCambiar);
  const Contenedor = navegable ? 'div' : 'ol';
  const Item = navegable ? 'button' : 'li';
  return (
    <Contenedor className={`pv-recorrido${navegable ? ' pv-recorrido-tabs' : ''}`} role={navegable ? 'tablist' : undefined}
      aria-label={navegable ? 'Fases de la categoría' : 'Recorrido de fases'}>
      {etapas.map((e, n) => {
        const p = e.estado === 'hecha' ? 1 : e.estado === 'actual' ? Math.max(e.total ? e.jugados / e.total : 0, 0.04) : 0;
        const texto = e.estado === 'hecha' ? 'terminada' : e.estado === 'actual' ? `en curso, ${e.jugados} de ${e.total} jugados` : 'por jugar';
        return (
          <Item key={e.key} className={e.estado} style={{ '--n': n }}
            {...(navegable ? {
              type: 'button', role: 'tab', id: `${idBase}-tab-${e.key}`,
              'aria-controls': `${idBase}-panel-${e.key}`, 'aria-selected': activa === e.key,
              tabIndex: activa === e.key ? 0 : -1,
              onClick: () => onCambiar(e.key),
              onKeyDown: (event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const i = event.key === 'Home' ? 0 : event.key === 'End' ? etapas.length - 1
                  : (n + (event.key === 'ArrowRight' ? 1 : -1) + etapas.length) % etapas.length;
                onCambiar(etapas[i].key);
                document.getElementById(`${idBase}-tab-${etapas[i].key}`)?.focus({ preventScroll: true });
              },
            } : {})}>
            <span className="pv-tramo" aria-hidden="true">
              <i style={{ '--p': p.toFixed(3) }} />
            </span>
            <span className="pv-etapa" aria-hidden="true">{e.corta}</span>
            <span className="pv-sr">{e.larga}: {texto}</span>
          </Item>
        );
      })}
    </Contenedor>
  );
}
