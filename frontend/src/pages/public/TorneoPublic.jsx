import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../api/client';
import BracketLines from '../../components/BracketLines';
import { Award, AlertTriangle, Users, Trophy, Calendar, RefreshCw, Layers } from 'lucide-react';

const POLL_INTERVAL = 15000; // 15 seconds

export default function TorneoPublic() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [activeCatId, setActiveCatId] = useState(null);

  const intervalRef = useRef(null);
  const publicBracketRef = useRef(null);

  const fetchData = async () => {
    try {
      const result = await api.get(`/public/${slug}`);
      setData(result);
      setLastUpdate(new Date());
      setError(null);

      // Si no hay categoría seleccionada, seleccionar la primera
      if (result?.categorias?.length > 0) {
        setActiveCatId((prev) => {
          const exists = result.categorias.some((c) => c.id === prev);
          return exists ? prev : result.categorias[0].id;
        });
      }
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
        <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'center' }}>
          <Award size={36} strokeWidth={2} style={{ color: 'var(--color-primary)' }} />
        </div>
        <p style={{ color: 'var(--color-text-secondary)' }}>Cargando torneo...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="public-page" style={{ textAlign: 'center', paddingTop: '4rem' }}>
        <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'center' }}>
          <AlertTriangle size={36} strokeWidth={2} style={{ color: 'var(--color-danger)' }} />
        </div>
        <p style={{ color: 'var(--color-danger)' }}>{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const { torneo, categorias = [] } = data;
  const activeCategoria = categorias.find((c) => c.id === activeCatId) || categorias[0];
  const zonas = activeCategoria?.zonas || [];
  const eliminatoria = activeCategoria?.eliminatoria || [];

  return (
    <div className="public-page">
      {/* Header del Torneo */}
      <div
        style={{
          textAlign: 'center',
          marginBottom: '2rem',
          paddingBottom: '1.5rem',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <h1
          style={{
            fontSize: 'var(--font-size-3xl)',
            marginBottom: '0.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
          }}
        >
          <Award size={30} strokeWidth={2} style={{ color: 'var(--color-primary)' }} />
          {torneo.nombre}
        </h1>

        <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <span className={`badge badge-${torneo.estado.toLowerCase()}`}>{torneo.estado}</span>
          <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
            Club: <strong style={{ color: 'var(--color-text)' }}>{torneo.organizador}</strong>
          </span>
          {torneo.fecha && (
            <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <Calendar size={14} />
              {new Date(torneo.fecha).toLocaleDateString('es-AR', {
                day: '2-digit',
                month: 'long',
                year: 'numeric',
              })}
            </span>
          )}
        </div>

        {/* Selector de Categorías (Pestañas superiores) */}
        {categorias.length > 0 && (
          <div style={{ marginTop: '1.5rem' }}>
            <div
              style={{
                fontSize: 'var(--font-size-xs)',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                color: 'var(--color-text-secondary)',
                marginBottom: '0.6rem',
                fontWeight: 'bold',
              }}
            >
              Categorías
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                gap: '0.5rem',
                flexWrap: 'wrap',
                alignItems: 'center',
              }}
            >
              {categorias.map((c) => {
                const isActive = activeCategoria?.id === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setActiveCatId(c.id)}
                    style={{
                      padding: '0.5rem 1.15rem',
                      borderRadius: 'var(--radius-md)',
                      fontSize: 'var(--font-size-sm)',
                      fontWeight: isActive ? '700' : '500',
                      background: isActive ? 'var(--color-primary)' : 'var(--color-surface)',
                      color: isActive ? '#000000' : 'var(--color-text)',
                      border: isActive
                        ? '1px solid var(--color-primary)'
                        : '1px solid var(--color-border)',
                      boxShadow: isActive ? '0 0 15px rgba(34, 197, 94, 0.4)' : 'none',
                      cursor: 'pointer',
                      transition: 'all var(--transition-fast)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      width: 'auto',
                    }}
                  >
                    <span>{c.nombre}</span>
                    <span
                      style={{
                        fontSize: '0.7rem',
                        opacity: isActive ? 0.9 : 0.6,
                        background: isActive ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.08)',
                        padding: '0.1rem 0.35rem',
                        borderRadius: '10px',
                      }}
                    >
                      {c.totalParejas}p
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Navegación rápida entre zonas de la categoría activa */}
        {zonas.length > 1 && (
          <div
            style={{
              marginTop: '1.25rem',
              display: 'flex',
              justifyContent: 'center',
              gap: '0.5rem',
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            {zonas.map((z, idx) => (
              <span key={z.id} style={{ display: 'flex', alignItems: 'center' }}>
                <a
                  href={`#zona-${z.id}`}
                  style={{
                    fontSize: 'var(--font-size-xs)',
                    fontWeight: 'bold',
                    padding: '0.25rem 0.5rem',
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(255,255,255,0.05)',
                    color: 'var(--color-primary)',
                    textDecoration: 'none',
                  }}
                >
                  {z.nombre}
                </a>
                {idx < zonas.length - 1 && (
                  <span style={{ color: 'var(--color-text-muted)', margin: '0 0.4rem' }}>·</span>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Contenido de la Categoría Activa */}
      {!activeCategoria ? (
        <div style={{ textAlign: 'center', color: 'var(--color-text-secondary)', padding: '2rem' }}>
          No hay información disponible para este torneo aún.
        </div>
      ) : activeCategoria.estado === 'BORRADOR' && zonas.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
          <Users size={40} style={{ color: 'var(--color-primary)', marginBottom: '0.75rem', opacity: 0.8 }} />
          <h3>Categoría {activeCategoria.nombre} — En Preparación</h3>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
            El organizador está configurando las parejas y zonas para esta categoría. ¡Pronto estará disponible el fixture!
          </p>
        </div>
      ) : (
        <>
          {/* Zonas de la categoría */}
          {zonas.length > 0 && (
            <section style={{ marginBottom: '3rem' }}>
              <h2
                style={{
                  marginBottom: '1.5rem',
                  fontSize: 'var(--font-size-2xl)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                <Users size={22} strokeWidth={2} />
                Fase de Grupos — Categoría {activeCategoria.nombre}
              </h2>
              {zonas.map((zona) => (
                <div id={`zona-${zona.id}`} key={zona.id} className="torneo-card" style={{ marginBottom: '2rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <h3 style={{ margin: 0 }}>{zona.nombre}</h3>
                    <span className="badge badge-en_curso">Clasifican {zona.clasifican}</span>
                  </div>

                  {/* Tabla de posiciones */}
                  <div className="table-responsive" style={{ marginBottom: '1.5rem' }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Pos</th>
                          <th>Pareja</th>
                          <th className="text-center" title="Puntos">Pts</th>
                          <th className="text-center hide-on-mobile" title="Partidos Jugados">PJ</th>
                          <th className="text-center" title="Partidos Ganados">PG</th>
                          <th className="text-center hide-on-mobile" title="Partidos Perdidos">PP</th>
                          <th className="text-center" title="Sets a Favor / En Contra">Sets</th>
                          <th className="text-center" title="Games a Favor / En Contra">Games</th>
                        </tr>
                      </thead>
                      <tbody>
                        {zona.tabla.map((row, idx) => {
                          const clasifica = idx < zona.clasifican;
                          return (
                            <tr
                              key={idx}
                              style={{
                                backgroundColor: clasifica ? 'var(--color-primary-light)' : 'transparent',
                                borderLeft: clasifica ? '4px solid var(--color-primary)' : '4px solid transparent',
                              }}
                            >
                              <td><span className="pos-number">{idx + 1}</span></td>
                              <td className="team-name">
                                {clasifica && (
                                  <span style={{ color: 'var(--color-primary)', marginRight: '0.25rem', textShadow: '0 0 5px var(--color-accent-glow)' }}>
                                    ▲
                                  </span>
                                )}
                                {row.pareja}
                              </td>
                              <td className="text-center stat-pts">{row.puntos}</td>
                              <td className="text-center hide-on-mobile">{row.pj}</td>
                              <td className="text-center stat-highlight">{row.pg}</td>
                              <td className="text-center hide-on-mobile">{row.pp}</td>
                              <td className="text-center">{row.sf} - {row.sc}</td>
                              <td className="text-center">{row.gf} - {row.gc}</td>
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
                      <div className="partidos-public-grid">
                        {zona.partidos.map((p) => {
                          let partidoLabel = '';
                          if (zona.formato === 'MINI_BRACKET') {
                            if (p.posicionEnRonda === 1) partidoLabel = 'Ronda 1 — Partido 1';
                            if (p.posicionEnRonda === 2) partidoLabel = 'Ronda 1 — Partido 2';
                            if (p.posicionEnRonda === 3) partidoLabel = '1° y 2° Puesto (Ganador vs Ganador)';
                            if (p.posicionEnRonda === 4) partidoLabel = '3° y 4° Puesto (Perdedor vs Perdedor · Clasificación)';
                          }
                          return (
                            <div
                              key={p.id}
                              style={{
                                background: 'var(--color-bg-input)',
                                border: `1px solid ${
                                  p.estado === 'FINALIZADO'
                                    ? 'var(--color-primary)'
                                    : p.estado === 'EN_CURSO'
                                    ? 'var(--color-success)'
                                    : 'var(--color-border)'
                                }`,
                                borderRadius: 'var(--radius-md)',
                                padding: '0.75rem',
                                position: 'relative',
                                animation: p.estado === 'EN_CURSO' ? 'pulse-border 2s infinite' : 'none',
                              }}
                            >
                              {partidoLabel && (
                                <div
                                  style={{
                                    fontSize: 'var(--font-size-xs)',
                                    fontWeight: 'bold',
                                    color: p.posicionEnRonda === 4 ? 'var(--color-accent)' : 'var(--color-primary)',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.5px',
                                    textAlign: 'center',
                                    marginBottom: '0.5rem',
                                  }}
                                >
                                  {partidoLabel}
                                </div>
                              )}
                              {p.fechaHora && (
                                <div
                                  style={{
                                    textAlign: 'center',
                                    fontSize: '0.7rem',
                                    color: 'var(--color-text-secondary)',
                                    fontWeight: 'bold',
                                    marginBottom: '0.4rem',
                                    borderBottom: '1px solid var(--color-border)',
                                    paddingBottom: '0.2rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '4px',
                                  }}
                                >
                                  <Calendar size={11} strokeWidth={2} />
                                  {new Date(p.fechaHora).toLocaleString([], {
                                    weekday: 'short',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                  {p.canchaNumero && ` · Cancha ${p.canchaNumero}`}
                                </div>
                              )}
                              <div
                                style={{
                                  fontSize: 'var(--font-size-sm)',
                                  textAlign: 'center',
                                  fontWeight: p.ganador === p.pareja1 && p.ganador ? 'bold' : 'normal',
                                  color:
                                    p.ganador === p.pareja1 && p.ganador
                                      ? 'var(--color-primary)'
                                      : p.pareja1
                                      ? 'var(--color-text)'
                                      : 'var(--color-text-muted)',
                                  fontStyle: p.pareja1 ? 'normal' : 'italic',
                                }}
                              >
                                {p.pareja1 || p.origenPareja1 || 'Por definirse'}
                              </div>

                              {(p.estado === 'FINALIZADO' || p.estado === 'EN_CURSO') && p.sets && p.sets.length > 0 ? (
                                <div
                                  style={{
                                    display: 'flex',
                                    justifyContent: 'center',
                                    gap: '0.35rem',
                                    margin: '0.35rem 0',
                                    flexWrap: 'wrap',
                                  }}
                                >
                                  {p.estado === 'EN_CURSO' && (
                                    <span
                                      style={{
                                        width: '100%',
                                        textAlign: 'center',
                                        fontSize: '0.65rem',
                                        color: 'var(--color-success)',
                                        fontWeight: 'bold',
                                        marginBottom: '0.1rem',
                                      }}
                                    >
                                      ● En juego
                                    </span>
                                  )}
                                  {p.sets.map((s, i) => {
                                    const p1Won = s.gamesPareja1 > s.gamesPareja2;
                                    const p2Won = s.gamesPareja2 > s.gamesPareja1;
                                    return (
                                      <span
                                        key={i}
                                        style={{
                                          background: 'var(--color-bg)',
                                          border: '1px solid var(--color-border)',
                                          padding: '0.1rem 0.4rem',
                                          borderRadius: '3px',
                                          fontSize: 'var(--font-size-xs)',
                                        }}
                                      >
                                        <span
                                          style={{
                                            fontWeight: p1Won ? 'bold' : 'normal',
                                            color: p1Won ? 'var(--color-primary)' : 'inherit',
                                          }}
                                        >
                                          {s.gamesPareja1}
                                        </span>
                                        {'-'}
                                        <span
                                          style={{
                                            fontWeight: p2Won ? 'bold' : 'normal',
                                            color: p2Won ? 'var(--color-primary)' : 'inherit',
                                          }}
                                        >
                                          {s.gamesPareja2}
                                        </span>
                                      </span>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div
                                  style={{
                                    textAlign: 'center',
                                    color: 'var(--color-text-secondary)',
                                    fontSize: 'var(--font-size-xs)',
                                    margin: '0.25rem 0',
                                  }}
                                >
                                  vs
                                </div>
                              )}

                              <div
                                style={{
                                  fontSize: 'var(--font-size-sm)',
                                  textAlign: 'center',
                                  fontWeight: p.ganador === p.pareja2 && p.ganador ? 'bold' : 'normal',
                                  color:
                                    p.ganador === p.pareja2 && p.ganador
                                      ? 'var(--color-primary)'
                                      : p.pareja2
                                      ? 'var(--color-text)'
                                      : 'var(--color-text-muted)',
                                  fontStyle: p.pareja2 ? 'normal' : 'italic',
                                }}
                              >
                                {p.pareja2 || p.origenPareja2 || 'Por definirse'}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </section>
          )}

          {/* Fase Eliminatoria de la categoría */}
          {eliminatoria.length > 0 && (
            <section style={{ marginBottom: '3rem' }}>
              <h2
                style={{
                  marginBottom: '1.5rem',
                  fontSize: 'var(--font-size-2xl)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                <Trophy size={22} strokeWidth={2} />
                Cuadro Eliminatorio — Categoría {activeCategoria.nombre}
              </h2>
              <div className="bracket-container" style={{ padding: '1rem', background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
                <div className="bracket-scroll" ref={publicBracketRef} style={{ position: 'relative' }}>
                  {eliminatoria.map((fase) => (
                    <div key={fase.id} className="ronda-section bracket-section">
                      <h3 className="ronda-title">{fase.nombre}</h3>
                      <div className="ronda-matches bracket-matches-column">
                        {fase.partidos.map((partido) => {
                          const isFinalizado = partido.estado === 'FINALIZADO';
                          const isJugable = !!(partido.pareja1 && partido.pareja2);
                          const p1esGanador = isFinalizado && partido.ganador === partido.pareja1;
                          const p2esGanador = isFinalizado && partido.ganador === partido.pareja2;

                          return (
                            <div key={partido.id} className="bracket-match-wrapper">
                              <div className="match-card-wrapper" style={{ display: 'flex', alignItems: 'center' }}>
                                <div className={`match-card ${isFinalizado ? 'finalizado' : ''} ${isJugable && !isFinalizado ? 'jugable' : ''}`} style={{ cursor: 'default' }}>
                                  <div className="match-card-header">
                                    <span className={`match-status-badge ${isFinalizado ? 'finalizado' : isJugable ? 'pendiente' : 'esperando'}`}>
                                      {isFinalizado ? 'Finalizado' : isJugable ? 'Pendiente' : 'Esperando...'}
                                    </span>
                                    {partido.canchaNumero && (
                                      <span style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary)' }}>
                                        Cancha {partido.canchaNumero}
                                      </span>
                                    )}
                                  </div>

                                  {partido.fechaHora && (
                                    <div
                                      style={{
                                        fontSize: '0.7rem',
                                        color: 'var(--color-text-secondary)',
                                        textAlign: 'center',
                                        marginBottom: '0.4rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '4px',
                                      }}
                                    >
                                      <Calendar size={11} strokeWidth={2} />
                                      {new Date(partido.fechaHora).toLocaleString([], {
                                        weekday: 'short',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                      })}
                                    </div>
                                  )}

                                  <div className="parejas-list">
                                    <div className={`pareja-row ${p1esGanador ? 'ganador' : ''}`}>
                                      <div className="pareja-info">
                                        {partido.pareja1 ? (
                                          <span className="pareja-nombre">{partido.pareja1}</span>
                                        ) : (
                                          <span className="pareja-esperando">
                                            {partido.origenPareja1 ? `Esperando ${partido.origenPareja1}` : 'Esperando...'}
                                          </span>
                                        )}
                                      </div>
                                      {partido.sets && partido.sets.length > 0 && (
                                        <div className="sets-container">
                                          {partido.sets.map((set, idx) => (
                                            <span key={idx} className="set-score">
                                              {set.gamesPareja1}
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                    </div>

                                    <div className={`pareja-row ${p2esGanador ? 'ganador' : ''}`}>
                                      <div className="pareja-info">
                                        {partido.pareja2 ? (
                                          <span className="pareja-nombre">{partido.pareja2}</span>
                                        ) : (
                                          <span className="pareja-esperando">
                                            {partido.origenPareja2 ? `Esperando ${partido.origenPareja2}` : 'Esperando...'}
                                          </span>
                                        )}
                                      </div>
                                      {partido.sets && partido.sets.length > 0 && (
                                        <div className="sets-container">
                                          {partido.sets.map((set, idx) => (
                                            <span key={idx} className="set-score">
                                              {set.gamesPareja2}
                                            </span>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  <BracketLines scrollContainerRef={publicBracketRef} fases={eliminatoria} />
                </div>
              </div>
            </section>
          )}
        </>
      )}

      {/* Footer con indicador de actualización en vivo */}
      <div
        style={{
          textAlign: 'center',
          color: 'var(--color-text-muted)',
          fontSize: 'var(--font-size-xs)',
          paddingTop: '2rem',
          borderTop: '1px solid var(--color-border)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '0.5rem',
        }}
      >
        <RefreshCw size={12} className="spin" />
        <span>
          Actualización en vivo cada 15s
          {lastUpdate && ` · Última: ${lastUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`}
        </span>
      </div>
    </div>
  );
}
