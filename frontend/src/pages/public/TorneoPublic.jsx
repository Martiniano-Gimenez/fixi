import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../api/client';
import BracketLines from '../../components/BracketLines';
import { Award, AlertTriangle, Users, Trophy, Calendar, Layers, Clock, Search, X } from 'lucide-react';
import { formatDiaHorario } from '../../utils/dateUtils';
import { estadoLabel } from '../../utils/estadoLabels';
import '../admin/EliminatoriaView.css';

const POLL_INTERVAL = 15000; // 15 seconds

function PublicMatchCard({ partido, isMobile = false }) {
  const isFinalizado = partido.estado === 'FINALIZADO';
  const isJugable = !!(partido.pareja1 && partido.pareja2);
  const isVacio = !partido.pareja1 && !partido.pareja2 && !isFinalizado;
  const p1esGanador = isFinalizado && partido.ganador === partido.pareja1;
  const p2esGanador = isFinalizado && partido.ganador === partido.pareja2;

  return (
    <div key={partido.id} className={`bracket-match-wrapper ${isMobile ? 'mobile-full' : ''}`}>
      <div className="match-card-wrapper" style={{ display: 'flex', alignItems: 'center', width: isMobile ? '100%' : undefined }}>
        <div
          className={`match-card ${isFinalizado ? 'finalizado' : ''} ${isJugable && !isFinalizado ? 'jugable' : ''} ${isVacio ? 'match-card-empty' : ''}`}
          style={{ cursor: 'default', width: isMobile ? '100%' : undefined }}
        >
          <div className="match-card-header">
            <span className={`match-status-badge ${isFinalizado ? 'finalizado' : isJugable ? 'pendiente' : 'esperando'}`}>
              {isFinalizado ? 'Finalizado' : isJugable ? 'Pendiente' : 'Esperando...'}
            </span>
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
              <Clock size={11} strokeWidth={2} style={{ color: 'var(--color-primary)' }} />
              {formatDiaHorario(partido.fechaHora)}
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
}

export default function TorneoPublic() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeCatId, setActiveCatId] = useState(null);
  const [activeZoneId, setActiveZoneId] = useState(null); // null = "Todas"
  const [activePhase, setActivePhase] = useState('zonas'); // 'zonas' | 'eliminatoria'
  const [activeRoundId, setActiveRoundId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 768px)').matches;
  });

  useEffect(() => {
    const mql = window.matchMedia('(max-width: 768px)');
    const onChange = (e) => setIsMobile(e.matches);
    if (mql.addEventListener) {
      mql.addEventListener('change', onChange);
    } else {
      mql.addListener(onChange);
    }
    return () => {
      if (mql.removeEventListener) {
        mql.removeEventListener('change', onChange);
      } else {
        mql.removeListener(onChange);
      }
    };
  }, []);

  const intervalRef = useRef(null);
  const publicBracketRef = useRef(null);

  const fetchData = async () => {
    try {
      const result = await api.get(`/public/${slug}`);
      setData(result);
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

  // Categoría activa y colecciones derivadas
  const activeCategoria = data?.categorias?.find((c) => c.id === activeCatId) || data?.categorias?.[0];
  const zonas = activeCategoria?.zonas || [];
  const activeZona = activeZoneId ? zonas.find((z) => z.id === activeZoneId) : null;
  const zonasAMostrar = activeZoneId ? (activeZona ? [activeZona] : zonas) : zonas;
  const eliminatoria = activeCategoria?.eliminatoria || [];

  // Resetear filtros al cambiar de categoría
  useEffect(() => {
    setSearchTerm('');
    setActiveRoundId(null);
    setActiveZoneId(null); // "Todas" por defecto al cambiar de categoría
  }, [activeCatId]);

  // Si la zona seleccionada deja de existir en una actualización por polling, volver a "Todas" (null)
  useEffect(() => {
    if (activeZoneId !== null && !zonas.some((z) => z.id === activeZoneId)) {
      setActiveZoneId(null);
    }
  }, [zonas, activeZoneId]);

  // Inicializar activePhase según la fase en disputa al cambiar categoría o cargar datos
  useEffect(() => {
    if (!activeCategoria) return;

    const catZonas = activeCategoria.zonas || [];
    const catElim = activeCategoria.eliminatoria || [];

    if (catZonas.length > 0 && catElim.length > 0) {
      const todosGrupos = catZonas.flatMap((z) => z.partidos || []);
      const gCompletados =
        todosGrupos.length > 0 && todosGrupos.every((p) => p.estado === 'FINALIZADO');
      const todosElim = catElim.flatMap((f) => f.partidos || []);
      const eIniciada = todosElim.some(
        (p) => p.estado === 'FINALIZADO' || p.estado === 'EN_CURSO' || Boolean(p.pareja1 && p.pareja2)
      );

      // Pestaña inicial según la fase actual del torneo
      setActivePhase(eIniciada || gCompletados ? 'eliminatoria' : 'zonas');
    } else if (catElim.length > 0) {
      setActivePhase('eliminatoria');
    } else {
      setActivePhase('zonas');
    }
  }, [activeCatId]);

  const handleCategorySelect = (catId, e) => {
    setActiveCatId(catId);
    e?.currentTarget?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  };

  const handleZoneSelect = (zoneId, e) => {
    setActiveZoneId(zoneId);
    e?.currentTarget?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  };

  const handleSearchResultClick = (res) => {
    setActivePhase('zonas');
    setActiveZoneId(res.zonaId);
    setSearchTerm('');
    setTimeout(() => {
      const chip = document.querySelector(`[data-zone-id="${res.zonaId}"]`);
      chip?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }, 60);
  };

  // Ronda más avanzada con al menos 1 cruce definido por defecto
  const rondaMasAvanzadaConParejas = useMemo(() => {
    if (!eliminatoria || eliminatoria.length === 0) return null;
    for (let i = eliminatoria.length - 1; i >= 0; i--) {
      const fase = eliminatoria[i];
      const tieneDefinido = fase.partidos.some(
        (p) => Boolean(p.pareja1 && p.pareja2) || p.estado === 'FINALIZADO'
      );
      if (tieneDefinido) return fase.id;
    }
    return eliminatoria[0].id;
  }, [eliminatoria]);

  const activeFaseMobile =
    eliminatoria.find((f) => f.id === activeRoundId) ||
    eliminatoria.find((f) => f.id === rondaMasAvanzadaConParejas) ||
    eliminatoria[0];

  // Lista deduplicada de parejas en todas las zonas de la categoría activa
  const parejasPorZona = useMemo(() => {
    if (!zonas || zonas.length === 0) return [];
    const seen = new Set();
    const list = [];

    zonas.forEach((z) => {
      // 1. De la tabla de posiciones de la zona
      z.tabla?.forEach((row) => {
        const nombre = row.pareja?.trim();
        if (nombre) {
          const key = `${nombre.toLowerCase()}_${z.id}`;
          if (!seen.has(key)) {
            seen.add(key);
            list.push({ parejaNombre: nombre, zonaId: z.id, zonaNombre: z.nombre });
          }
        }
      });

      // 2. De los partidos por si hubiera parejas no listadas aún en tabla
      z.partidos?.forEach((p) => {
        [p.pareja1, p.pareja2].forEach((pNombre) => {
          const nombre = pNombre?.trim();
          if (nombre) {
            const key = `${nombre.toLowerCase()}_${z.id}`;
            if (!seen.has(key)) {
              seen.add(key);
              list.push({ parejaNombre: nombre, zonaId: z.id, zonaNombre: z.nombre });
            }
          }
        });
      });
    });

    return list;
  }, [zonas]);

  // Normalización sin acentos y case-insensitive
  const normalize = (text) =>
    (text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

  // Coincidencias de búsqueda en tiempo real
  const resultadosBusqueda = useMemo(() => {
    const q = normalize(searchTerm.trim());
    if (!q) return [];
    return parejasPorZona.filter((item) => normalize(item.parejaNombre).includes(q));
  }, [parejasPorZona, searchTerm]);

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

  const todosPartidosGrupos = zonas.flatMap((z) => z.partidos || []);
  const gruposCompletados =
    todosPartidosGrupos.length > 0 &&
    todosPartidosGrupos.every((p) => p.estado === 'FINALIZADO');
  const gruposEnCurso = todosPartidosGrupos.some((p) => p.estado === 'EN_CURSO');

  const todosPartidosElim = eliminatoria.flatMap((f) => f.partidos || []);
  const eliminatoriaFinalizada =
    todosPartidosElim.length > 0 &&
    todosPartidosElim.every((p) => p.estado === 'FINALIZADO');
  const eliminatoriaIniciada = todosPartidosElim.some(
    (p) => p.estado === 'FINALIZADO' || p.estado === 'EN_CURSO' || (p.pareja1 && p.pareja2)
  );

  return (
    <div className="public-page">
      {/* Header del Torneo (no sticky) */}
      <header className="public-tournament-header">
        <h1 className="public-tournament-title">
          <Award size={24} strokeWidth={2} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
          <span>{torneo.nombre}</span>
        </h1>

        <div className="public-tournament-meta">
          <span className={`badge badge-${torneo.estado.toLowerCase()}`}>{estadoLabel(torneo.estado)}</span>
          <span className="public-meta-item">
            Club: <strong>{torneo.organizador}</strong>
          </span>
          {torneo.fecha && (
            <span className="public-meta-item">
              <Calendar size={13} />
              {new Date(torneo.fecha).toLocaleDateString('es-AR', {
                day: '2-digit',
                month: 'long',
                year: 'numeric',
              })}
            </span>
          )}
        </div>
      </header>

      {/* Barra Sticky: Categorías + Control Segmentado */}
      {(categorias.length > 0 || (zonas.length > 0 && eliminatoria.length > 0)) && (
        <div className="public-sticky-nav">
          {/* Selector de Categorías (Pestañas horizontales con scroll, sin wrap, con degradé) */}
          {categorias.length > 0 && (
            <div className="public-cat-chips" role="tablist" aria-label="Categorías">
              {categorias.map((c) => {
                const isActive = activeCategoria?.id === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    className={`public-cat-chip ${isActive ? 'active' : ''}`}
                    onClick={(e) => handleCategorySelect(c.id, e)}
                  >
                    <span>{c.nombre}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Control Segmentado (Tabs reales: Zonas / Eliminatoria) */}
          {zonas.length > 0 && eliminatoria.length > 0 && (
            <div className="public-segmented-control" role="tablist" aria-label="Fase del torneo">
              <button
                type="button"
                role="tab"
                aria-selected={activePhase === 'zonas'}
                className={`public-segment-btn ${activePhase === 'zonas' ? 'active' : ''}`}
                onClick={() => setActivePhase('zonas')}
              >
                <span>Zonas</span>
                <span className="public-segment-subtext">
                  {gruposCompletados ? '· Completada' : gruposEnCurso ? '· En juego' : '· En disputa'}
                </span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activePhase === 'eliminatoria'}
                className={`public-segment-btn ${activePhase === 'eliminatoria' ? 'active' : ''}`}
                onClick={() => setActivePhase('eliminatoria')}
              >
                <span>Eliminatoria</span>
                <span className="public-segment-subtext">
                  {eliminatoriaFinalizada ? '· Finalizado' : eliminatoriaIniciada ? '· En disputa' : '· Por comenzar'}
                </span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Navegación rápida entre zonas (Solo en pestaña Zonas, no sticky, alto táctil min 40px, con "Todas") */}
      {activePhase === 'zonas' && zonas.length > 1 && (
        <div className="public-zone-chips" role="navigation" aria-label="Navegación entre zonas">
          <button
            type="button"
            className={`public-zone-chip ${activeZoneId === null ? 'active' : ''}`}
            onClick={(e) => handleZoneSelect(null, e)}
            aria-label="Ver todas las zonas"
            aria-current={activeZoneId === null ? 'true' : undefined}
            data-zone-id="all"
          >
            Todas
          </button>
          {zonas.map((z) => {
            const isActive = activeZoneId === z.id;
            return (
              <button
                key={z.id}
                type="button"
                className={`public-zone-chip ${isActive ? 'active' : ''}`}
                onClick={(e) => handleZoneSelect(z.id, e)}
                aria-label={`Ver ${z.nombre}`}
                aria-current={isActive ? 'true' : undefined}
                data-zone-id={z.id}
              >
                {z.nombre}
              </button>
            );
          })}
        </div>
      )}

      {/* Buscador de parejas de la categoría activa (No sticky, en ambas pestañas) */}
      {zonas.length > 0 && (
        <div className="public-search-wrap">
          <div className="public-search-box">
            <Search size={16} className="public-search-icon" aria-hidden="true" />
            <input
              type="text"
              className="public-search-input"
              placeholder="Buscar pareja o jugador..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              aria-label="Buscar pareja o jugador en esta categoría"
            />
            {searchTerm && (
              <button
                type="button"
                className="public-search-clear"
                onClick={() => setSearchTerm('')}
                aria-label="Limpiar búsqueda"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Lista de resultados desplegable */}
          {searchTerm.trim() && (
            <div className="public-search-results" role="listbox" aria-label="Resultados de búsqueda">
              {resultadosBusqueda.length > 0 ? (
                resultadosBusqueda.map((res) => (
                  <button
                    key={`${res.parejaNombre}-${res.zonaId}`}
                    type="button"
                    className="public-search-item"
                    onClick={() => handleSearchResultClick(res)}
                    aria-label={`Ver ${res.parejaNombre} en ${res.zonaNombre}`}
                  >
                    <span className="public-search-team">{res.parejaNombre}</span>
                    <span className="public-search-badge">{res.zonaNombre}</span>
                  </button>
                ))
              ) : (
                <div className="public-search-empty">
                  No se encontraron parejas con ese nombre
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Contenido de la Categoría Activa */}
      {!activeCategoria ? (
        <div style={{ textAlign: 'center', color: 'var(--color-text-secondary)', padding: '2rem' }}>
          No hay información disponible para este torneo aún.
        </div>
      ) : zonas.length === 0 && eliminatoria.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
          <Users size={40} style={{ color: 'var(--color-primary)', marginBottom: '0.75rem', opacity: 0.8 }} />
          <h3>Categoría {activeCategoria.nombre} — En Preparación</h3>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
            El organizador está configurando las parejas y zonas para esta categoría. ¡Pronto estará disponible el fixture!
          </p>
        </div>
      ) : (
        <>
          {/* Zonas de la categoría (Solo en pestaña Zonas) */}
          {activePhase === 'zonas' && zonas.length > 0 && (
            <section className="public-zonas-section" style={{ marginBottom: '3rem' }}>
              <h2
                style={{
                  marginBottom: '1rem',
                  fontSize: 'var(--font-size-xl)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                <Users size={20} strokeWidth={2} />
                Zonas
              </h2>
              {zonasAMostrar.map((zona) => (
                <div id={`zona-${zona.id}`} key={zona.id} className="torneo-card" style={{ marginBottom: '2rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <h3 style={{ margin: 0 }}>{zona.nombre}</h3>
                    <span className="badge badge-en_curso">Clasifican {zona.clasifican}</span>
                  </div>

                  {/* Posiciones de la zona: Mobile (filas sin scroll) vs Desktop (tabla tradicional) */}
                  {isMobile ? (
                    <div className="public-posiciones-list" style={{ marginBottom: '1.5rem' }}>
                      {zona.tabla.map((row, idx) => {
                        const clasifica = idx < zona.clasifican;
                        return (
                          <div
                            key={idx}
                            className={`public-pos-card ${clasifica ? 'clasifica' : ''}`}
                          >
                            <div className="public-pos-rank">
                              <span className="public-pos-num">{idx + 1}</span>
                              {clasifica && (
                                <span className="public-pos-arrow" title="Zona de clasificación">
                                  ▲
                                </span>
                              )}
                            </div>

                            <div className="public-pos-info">
                              <div className="public-pos-name" title={row.pareja}>
                                {row.pareja}
                              </div>
                              <div className="public-pos-stats">
                                <span>{row.pj} PJ</span>
                                <span className="public-pos-dot">·</span>
                                <span>{row.pg} PG</span>
                                <span className="public-pos-dot">·</span>
                                <span>Sets {row.sf}-{row.sc}</span>
                                <span className="public-pos-dot">·</span>
                                <span>Games {row.gf}-{row.gc}</span>
                              </div>
                            </div>

                            <div className="public-pos-pts">
                              <span className="public-pos-pts-val">{row.puntos}</span>
                              <span className="public-pos-pts-lbl">PTS</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="table-responsive" style={{ marginBottom: '1.5rem' }}>
                      <table className="zona-table">
                        <thead>
                          <tr>
                            <th className="col-pos" title="Posición">
                              <span className="sr-only">Pos</span>
                              <span aria-hidden="true" className="th-short">#</span>
                            </th>
                            <th className="col-pareja">Pareja</th>
                            <th className="col-pts text-center" title="Puntos">
                              <span className="sr-only">Pts</span>
                              <span aria-hidden="true" className="th-short">P</span>
                            </th>
                            <th className="col-pj text-center hide-on-mobile" title="Partidos Jugados">PJ</th>
                            <th className="col-pg text-center" title="Partidos Ganados">
                              <span className="sr-only">PG</span>
                              <span aria-hidden="true" className="th-short">G</span>
                            </th>
                            <th className="col-pp text-center hide-on-mobile" title="Partidos Perdidos">PP</th>
                            <th className="col-sets text-center" title="Sets a Favor / En Contra">
                              <span className="sr-only">Sets</span>
                              <span aria-hidden="true" className="th-short">S</span>
                            </th>
                            <th className="col-games text-center" title="Games a Favor / En Contra">
                              <span className="sr-only">Games</span>
                              <span aria-hidden="true" className="th-short">Gm</span>
                            </th>
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
                                <td className="col-pos"><span className="pos-number">{idx + 1}</span></td>
                                <td className="col-pareja team-name" title={row.pareja}>
                                  {clasifica && (
                                    <span style={{ color: 'var(--color-primary)', marginRight: '0.25rem', textShadow: '0 0 5px var(--color-accent-glow)' }}>
                                      ▲
                                    </span>
                                  )}
                                  {row.pareja}
                                </td>
                                <td className="col-pts text-center stat-pts">{row.puntos}</td>
                                <td className="col-pj text-center hide-on-mobile">{row.pj}</td>
                                <td className="col-pg text-center stat-highlight">{row.pg}</td>
                                <td className="col-pp text-center hide-on-mobile">{row.pp}</td>
                                <td className="col-sets text-center">{row.sf} - {row.sc}</td>
                                <td className="col-games text-center">{row.gf} - {row.gc}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

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
                                  <Clock size={11} strokeWidth={2} style={{ color: 'var(--color-primary)' }} />
                                  {formatDiaHorario(p.fechaHora)}
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

          {/* Fase Eliminatoria de la categoría (Solo en pestaña Eliminatoria) */}
          {activePhase === 'eliminatoria' && eliminatoria.length > 0 && (
            <section className="public-eliminatoria-section" style={{ marginBottom: '3rem' }}>
              <h2
                style={{
                  marginBottom: '1rem',
                  fontSize: 'var(--font-size-xl)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                <Trophy size={20} strokeWidth={2} />
                Eliminatoria
              </h2>
              {isMobile ? (
                /* MODO MOBILE: Tabs horizontales por ronda + stack vertical 100% ancho */
                <div className="public-bracket-mobile">
                  {/* Selector de tabs de ronda */}
                  <div className="public-bracket-tabs" role="tablist" aria-label="Rondas eliminatorias">
                    {eliminatoria.map((fase) => {
                      const isActive = (activeFaseMobile ? activeFaseMobile.id : activeRoundId) === fase.id;

                      return (
                        <button
                          key={fase.id}
                          type="button"
                          role="tab"
                          aria-selected={isActive}
                          className={`public-bracket-tab ${isActive ? 'active' : ''}`}
                          onClick={() => setActiveRoundId(fase.id)}
                        >
                          <span className="public-bracket-tab-name">{fase.nombre}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Partidos de la ronda activa en stack vertical */}
                  {activeFaseMobile && (
                    <div className="public-bracket-mobile-content">
                      <div className="public-bracket-mobile-matches">
                        {activeFaseMobile.partidos.map((partido) => (
                          <PublicMatchCard key={partido.id} partido={partido} isMobile={true} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* MODO DESKTOP: Bracket horizontal con scroll tradicional y BracketLines */
                <div className="bracket-container public-bracket-desktop" style={{ padding: '1rem', background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
                  <div className="bracket-scroll" ref={publicBracketRef} style={{ position: 'relative' }}>
                    {eliminatoria.map((fase, faseIdx) => {
                      const tieneData = fase.partidos.some(
                        (p) => Boolean(p.pareja1 || p.pareja2 || p.estado === 'FINALIZADO' || p.estado === 'EN_CURSO')
                      );

                      let roundClass = 'ronda-con-datos';
                      if (!tieneData) {
                        if (faseIdx === 0) {
                          roundClass = 'ronda-parcial';
                        } else {
                          const prevFase = eliminatoria[faseIdx - 1];
                          const prevTieneData = prevFase?.partidos.some(
                            (p) => Boolean(p.pareja1 || p.pareja2 || p.estado === 'FINALIZADO' || p.estado === 'EN_CURSO')
                          );
                          roundClass = prevTieneData ? 'ronda-parcial' : 'ronda-vacia';
                        }
                      }

                      return (
                        <div key={fase.id} className={`ronda-section bracket-section ${roundClass}`}>
                          <div className="ronda-header-row">
                            <h3 className="ronda-title">{fase.nombre}</h3>
                          </div>
                          <div className="ronda-matches bracket-matches-column">
                            {fase.partidos.map((partido) => (
                              <PublicMatchCard key={partido.id} partido={partido} isMobile={false} />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    <BracketLines scrollContainerRef={publicBracketRef} fases={eliminatoria} />
                  </div>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
