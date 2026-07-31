import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../api/client';

const POLL_INTERVAL = 15000; // 15 seconds

export default function TorneoPublic() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const intervalRef = useRef(null);

  const fetchData = async () => {
    try {
      const result = await api.get(`/public/${slug}`);
      setData(result);
      setLastUpdate(new Date());
      setError(null);
    } catch (err) {
      if (!data) setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(fetchData, POLL_INTERVAL);
    return () => clearInterval(intervalRef.current);
  }, [slug]);

  if (loading) {
    return (
      <div className="public-page" style={{ textAlign: 'center', paddingTop: '4rem' }}>
        <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>🏸</div>
        <p style={{ color: 'var(--color-text-secondary)' }}>Cargando torneo...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="public-page" style={{ textAlign: 'center', paddingTop: '4rem' }}>
        <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>😕</div>
        <p style={{ color: 'var(--color-danger)' }}>{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const { torneo, zonas, eliminatoria } = data;

  return (
    <div className="public-page">
      {/* Header */}
      <div style={{
        textAlign: 'center',
        marginBottom: '2.5rem',
        paddingBottom: '1.5rem',
        borderBottom: '1px solid var(--color-border)',
      }}>
        <h1 style={{ fontSize: 'var(--font-size-3xl)', marginBottom: '0.5rem' }}>
          🏸 {torneo.nombre}
        </h1>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <span className={`badge badge-${torneo.estado.toLowerCase()}`}>{torneo.estado}</span>
          <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
            Organiza: {torneo.organizador}
          </span>
          <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
            {torneo.totalParejas} parejas
          </span>
        </div>
        {lastUpdate && (
          <p style={{ marginTop: '0.75rem', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
            🔄 Actualizado: {lastUpdate.toLocaleTimeString()} (auto cada 15s)
          </p>
        )}
      </div>

      {/* Zonas */}
      {zonas.length > 0 && (
        <section style={{ marginBottom: '3rem' }}>
          <h2 style={{ marginBottom: '1.5rem', fontSize: 'var(--font-size-2xl)' }}>📊 Fase de Grupos</h2>
          {zonas.map((zona) => (
            <div key={zona.id} className="torneo-card" style={{ marginBottom: '2rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3>{zona.nombre}</h3>
                <span className="badge badge-en_curso">Clasifican {zona.clasifican}</span>
              </div>

              {/* Tabla de posiciones */}
              <div style={{ overflowX: 'auto', marginBottom: '1.5rem' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
                      <th style={{ textAlign: 'left', padding: '0.5rem' }}>Pareja</th>
                      <th style={{ padding: '0.5rem' }}>Pts</th>
                      <th style={{ padding: '0.5rem' }}>PJ</th>
                      <th style={{ padding: '0.5rem' }}>PG</th>
                      <th style={{ padding: '0.5rem' }}>PP</th>
                      <th style={{ padding: '0.5rem' }}>Sets</th>
                      <th style={{ padding: '0.5rem' }}>Games</th>
                    </tr>
                  </thead>
                  <tbody>
                    {zona.tabla.map((row, idx) => {
                      const clasifica = idx < zona.clasifican;
                      return (
                        <tr key={idx} style={{
                          borderBottom: '1px solid var(--color-border)',
                          backgroundColor: clasifica ? 'rgba(16, 185, 129, 0.05)' : 'transparent',
                        }}>
                          <td style={{ textAlign: 'left', padding: '0.75rem 0.5rem', fontWeight: 500 }}>
                            {clasifica && <span style={{ color: 'var(--color-success)', marginRight: '0.25rem' }}>▲</span>}
                            {row.pareja}
                          </td>
                          <td style={{ padding: '0.75rem 0.5rem', fontWeight: 'bold', color: 'var(--color-primary)' }}>{row.puntos}</td>
                          <td style={{ padding: '0.75rem 0.5rem' }}>{row.pj}</td>
                          <td style={{ padding: '0.75rem 0.5rem' }}>{row.pg}</td>
                          <td style={{ padding: '0.75rem 0.5rem' }}>{row.pp}</td>
                          <td style={{ padding: '0.75rem 0.5rem' }}>{row.sf} - {row.sc}</td>
                          <td style={{ padding: '0.75rem 0.5rem' }}>{row.gf} - {row.gc}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Partidos de la zona */}
              {zona.partidos.length > 0 && (
                <div>
                  <h4 style={{ color: 'var(--color-text-secondary)', marginBottom: '0.75rem', fontSize: 'var(--font-size-sm)' }}>
                    Partidos
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.75rem' }}>
                    {zona.partidos.map((p) => (
                      <div key={p.id} style={{
                        background: 'var(--color-bg-input)',
                        border: `1px solid ${p.estado === 'FINALIZADO' ? 'var(--color-primary)' : 'var(--color-border)'}`,
                        borderRadius: 'var(--radius-md)',
                        padding: '0.75rem',
                        position: 'relative'
                      }}>
                        {p.fechaHora && (
                          <div style={{
                            textAlign: 'center',
                            fontSize: '0.7rem',
                            color: 'var(--color-text-secondary)',
                            fontWeight: 'bold',
                            marginBottom: '0.4rem',
                            borderBottom: '1px solid var(--color-border)',
                            paddingBottom: '0.2rem'
                          }}>
                            {new Date(p.fechaHora).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
                          </div>
                        )}
                        <div style={{ fontSize: 'var(--font-size-sm)', textAlign: 'center', fontWeight: p.ganador === p.pareja1 && p.ganador ? 'bold' : 'normal', color: p.ganador === p.pareja1 && p.ganador ? 'var(--color-primary)' : 'var(--color-text)' }}>
                          {p.pareja1 || 'TBD'}
                        </div>
                        {p.estado === 'FINALIZADO' && p.sets.length > 0 ? (
                          <div style={{ display: 'flex', justifyContent: 'center', gap: '0.35rem', margin: '0.35rem 0' }}>
                            {p.sets.map((s, i) => (
                              <span key={i} style={{
                                background: 'var(--color-bg)',
                                border: '1px solid var(--color-border)',
                                padding: '0.1rem 0.4rem',
                                borderRadius: '3px',
                                fontSize: 'var(--font-size-xs)',
                                fontWeight: 'bold',
                              }}>
                                {s.gamesPareja1}-{s.gamesPareja2}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)', fontWeight: 'bold', margin: '0.35rem 0' }}>vs</div>
                        )}
                        <div style={{ fontSize: 'var(--font-size-sm)', textAlign: 'center', fontWeight: p.ganador === p.pareja2 && p.ganador ? 'bold' : 'normal', color: p.ganador === p.pareja2 && p.ganador ? 'var(--color-primary)' : 'var(--color-text)' }}>
                          {p.pareja2 || 'TBD'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {/* Eliminatoria */}
      {eliminatoria.length > 0 && (
        <section>
          <h2 style={{ marginBottom: '1.5rem', fontSize: 'var(--font-size-2xl)' }}>🏆 Fase Eliminatoria</h2>
          <div style={{ overflowX: 'auto', paddingBottom: '1rem' }}>
            <div style={{ display: 'flex', gap: '2.5rem', minWidth: 'min-content', padding: '1rem 0' }}>
              {eliminatoria.map((fase) => (
                <div key={fase.id} className="bracket-section" style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <h4 style={{
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 'bold',
                    color: 'var(--color-text-secondary)',
                    textAlign: 'center',
                    textTransform: 'uppercase',
                    marginBottom: '0.5rem',
                  }}>
                    {fase.nombre}
                  </h4>
                  <div className="bracket-matches-column">
                    {fase.partidos.map((p) => (
                      <div key={p.id} className="bracket-match-wrapper" style={{ padding: '8px 0' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          {p.fechaHora && (
                        <div style={{
                          fontSize: '0.7rem',
                          color: 'var(--color-text-secondary)',
                          fontWeight: 'bold',
                          minWidth: '55px',
                          textAlign: 'right'
                        }}>
                          {new Date(p.fechaHora).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      )}
                      <div style={{
                        background: 'var(--color-bg-card)',
                        border: `1px solid ${p.estado === 'FINALIZADO' ? 'var(--color-primary)' : 'var(--color-border)'}`,
                        borderRadius: 'var(--radius-md)',
                        padding: '0.75rem 1rem',
                        minWidth: '200px',
                        flex: 1
                      }}>
                      <div style={{
                        fontSize: 'var(--font-size-sm)',
                        textAlign: 'center',
                        fontWeight: p.ganador === p.pareja1 && p.ganador ? 'bold' : 'normal',
                        color: p.ganador === p.pareja1 && p.ganador ? 'var(--color-primary)' : 'var(--color-text)',
                      }}>
                        {p.origenPareja1 && (
                          <div style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)', fontWeight: 'bold' }}>
                            {p.origenPareja1}
                          </div>
                        )}
                        {p.ganador === p.pareja1 && p.ganador ? '🏆 ' : ''}{p.pareja1 || <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>Por definirse</span>}
                      </div>
                      {p.estado === 'FINALIZADO' && p.sets.length > 0 ? (
                        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.35rem', margin: '0.35rem 0' }}>
                          {p.sets.map((s, i) => (
                            <span key={i} style={{
                              background: 'var(--color-bg-input)',
                              border: '1px solid var(--color-border)',
                              padding: '0.1rem 0.4rem',
                              borderRadius: '3px',
                              fontSize: 'var(--font-size-xs)',
                              fontWeight: 'bold',
                            }}>
                              {s.gamesPareja1}-{s.gamesPareja2}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div style={{ textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)', fontWeight: 'bold', margin: '0.35rem 0' }}>vs</div>
                      )}
                      <div style={{
                        fontSize: 'var(--font-size-sm)',
                        textAlign: 'center',
                        fontWeight: p.ganador === p.pareja2 && p.ganador ? 'bold' : 'normal',
                        color: p.ganador === p.pareja2 && p.ganador ? 'var(--color-primary)' : 'var(--color-text)',
                      }}>
                        {p.origenPareja2 && (
                          <div style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)', fontWeight: 'bold' }}>
                            {p.origenPareja2}
                          </div>
                        )}
                        {p.ganador === p.pareja2 && p.ganador ? '🏆 ' : ''}{p.pareja2 || <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>Por definirse</span>}
                      </div>
                    </div>
                  </div>
                </div>
                ))}
                </div>
              </div>
            ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
