import PartidoCard from './PartidoCard';

export default function MiniBracketView({ zona, partidos, onPartidoClick, onUpdateFechaHora }) {
  // Partidos vienen ordenados por posicionEnRonda
  const p1 = partidos.find(p => p.posicionEnRonda === 1);
  const p2 = partidos.find(p => p.posicionEnRonda === 2);
  const pGanadores = partidos.find(p => p.posicionEnRonda === 3);
  const pPerdedores = partidos.find(p => p.posicionEnRonda === 4);

  return (
    <div className="torneo-card" style={{ marginBottom: '1.5rem' }}>
      <div className="flex-header" style={{ marginBottom: '1rem' }}>
        <h3>{zona.nombre} (Mini-Bracket)</h3>
        <span className="badge badge-en_curso">
          Clasifican {zona.clasifican}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', alignItems: 'center' }}>
        {/* Ronda 1 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginBottom: '0.25rem' }}>Partido 1</div>
            <PartidoCard partido={p1} onClick={() => onPartidoClick(p1)} onUpdateFechaHora={onUpdateFechaHora} />
          </div>
          <div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginBottom: '0.25rem' }}>Partido 2</div>
            <PartidoCard partido={p2} onClick={() => onPartidoClick(p2)} onUpdateFechaHora={onUpdateFechaHora} />
          </div>
        </div>

        {/* Ronda 2 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginBottom: '0.25rem' }}>1ro y 2do Puesto</div>
            <PartidoCard partido={pGanadores} onClick={pGanadores?.pareja1Id && pGanadores?.pareja2Id ? () => onPartidoClick(pGanadores) : undefined} onUpdateFechaHora={onUpdateFechaHora} />
          </div>
          <div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginBottom: '0.25rem' }}>3ro y 4to Puesto (Clasificación)</div>
            <PartidoCard partido={pPerdedores} onClick={pPerdedores?.pareja1Id && pPerdedores?.pareja2Id ? () => onPartidoClick(pPerdedores) : undefined} onUpdateFechaHora={onUpdateFechaHora} />
          </div>
        </div>
      </div>
    </div>
  );
}
