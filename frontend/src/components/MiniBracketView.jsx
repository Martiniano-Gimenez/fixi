import PartidoCard from './PartidoCard';
import ZonaTable from './ZonaTable';

export default function MiniBracketView({ zona, partidos, onPartidoClick, onReprogramar }) {
  const p1 = partidos.find((p) => p.posicionEnRonda === 1);
  const p2 = partidos.find((p) => p.posicionEnRonda === 2);
  const pGanadores = partidos.find((p) => p.posicionEnRonda === 3);
  const pPerdedores = partidos.find((p) => p.posicionEnRonda === 4);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      {/* Grid del Mini-Bracket */}
      <div className="torneo-card">
        <div className="flex-header" style={{ marginBottom: '1.25rem' }}>
          <div>
            <h3 style={{ margin: 0 }}>{zona.nombre} — Cuadro Mini-Bracket (4 Parejas)</h3>
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
              2 partidos iniciales + 2 partidos definitorios (1°/2° y 3°/4° puesto)
            </span>
          </div>
          <span className="badge badge-en_curso">Clasifican {zona.clasifican}</span>
        </div>

        <div className="mini-bracket-grid">
          {/* Ronda 1 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div>
              <div
                style={{
                  fontSize: 'var(--font-size-xs)',
                  color: 'var(--color-primary)',
                  fontWeight: 'bold',
                  marginBottom: '0.4rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                Ronda 1 — Partido 1
              </div>
              <PartidoCard
                partido={p1}
                onClick={p1 ? () => onPartidoClick(p1) : undefined}
                onCargarResultado={onPartidoClick}
                onReprogramar={onReprogramar}
              />
            </div>

            <div>
              <div
                style={{
                  fontSize: 'var(--font-size-xs)',
                  color: 'var(--color-primary)',
                  fontWeight: 'bold',
                  marginBottom: '0.4rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                Ronda 1 — Partido 2
              </div>
              <PartidoCard
                partido={p2}
                onClick={p2 ? () => onPartidoClick(p2) : undefined}
                onCargarResultado={onPartidoClick}
                onReprogramar={onReprogramar}
              />
            </div>
          </div>

          {/* Ronda 2 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div>
              <div
                style={{
                  fontSize: 'var(--font-size-xs)',
                  color: 'var(--color-primary)',
                  fontWeight: 'bold',
                  marginBottom: '0.4rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                1° y 2° Puesto (Ganador vs Ganador)
              </div>
              <PartidoCard
                partido={pGanadores}
                onClick={
                  pGanadores?.pareja1Id && pGanadores?.pareja2Id
                    ? () => onPartidoClick(pGanadores)
                    : undefined
                }
                onCargarResultado={onPartidoClick}
                onReprogramar={onReprogramar}
              />
            </div>

            <div>
              <div
                style={{
                  fontSize: 'var(--font-size-xs)',
                  color: 'var(--color-accent)',
                  fontWeight: 'bold',
                  marginBottom: '0.4rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                3° y 4° Puesto (Perdedor vs Perdedor · Clasificación)
              </div>
              <PartidoCard
                partido={pPerdedores}
                onClick={
                  pPerdedores?.pareja1Id && pPerdedores?.pareja2Id
                    ? () => onPartidoClick(pPerdedores)
                    : undefined
                }
                onCargarResultado={onPartidoClick}
                onReprogramar={onReprogramar}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Tabla de posiciones de la zona */}
      <div>
        <h3 style={{ marginBottom: '1rem', fontSize: 'var(--font-size-lg)' }}>
          Posiciones Finales — {zona.nombre}
        </h3>
        <ZonaTable zona={zona} />
      </div>
    </div>
  );
}
