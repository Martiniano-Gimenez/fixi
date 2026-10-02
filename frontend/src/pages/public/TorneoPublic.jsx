import { useState, useEffect, useRef, useMemo, Fragment } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../api/client';
import BracketLines from '../../components/BracketLines';
import { Award, AlertTriangle, Users, Trophy, Calendar, Clock, Search, X, Star, Play } from 'lucide-react';
import { formatPartidoHorario } from '../../utils/dateUtils';
import { estadoLabel } from '../../utils/estadoLabels';
import '../admin/EliminatoriaView.css';

const POLL_INTERVAL = 15000; // 15 seconds

function getFavPareja(slug, catId) {
  if (!slug || !catId) return null;
  try {
    return localStorage.getItem(`miPareja:${slug}:${catId}`) || null;
  } catch {
    return null;
  }
}

function setFavPareja(slug, catId, parejaId) {
  if (!slug || !catId) return;
  try {
    const key = `miPareja:${slug}:${catId}`;
    if (parejaId) {
      localStorage.setItem(key, parejaId);
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // Degradación silenciosa (ej. cookies/storage bloqueado en modo privado)
  }
}

function formatDiff(val) {
  if (val > 0) return `+${val}`;
  if (val < 0) return `\u2212${Math.abs(val)}`;
  return '0';
}

function PublicMatchCard({ partido, label = '', isMobile = false }) {
  const isFinalizado = partido.estado === 'FINALIZADO';
  const isEnCurso = partido.estado === 'EN_CURSO';
  const hasBothPairs = Boolean(partido.pareja1 && partido.pareja2);
  const isVacio = !partido.pareja1 && !partido.pareja2 && !isFinalizado;

  // Verificación de ganador: id prioritario, fallback a nombre
  const p1esGanador = isFinalizado && (
    partido.ganadorId != null && partido.pareja1Id != null
      ? partido.ganadorId === partido.pareja1Id
      : Boolean(partido.ganador && partido.pareja1 && partido.ganador === partido.pareja1)
  );
  const p2esGanador = isFinalizado && (
    partido.ganadorId != null && partido.pareja2Id != null
      ? partido.ganadorId === partido.pareja2Id
      : Boolean(partido.ganador && partido.pareja2 && partido.ganador === partido.pareja2)
  );

  // Chip de estado: si falta cualquiera de las dos parejas y no está finalizado, "Esperando"
  let statusText = 'Pendiente';
  let statusClass = 'pendiente';
  if (isFinalizado) {
    statusText = 'Finalizado';
    statusClass = 'finalizado';
  } else if (isEnCurso) {
    statusText = 'En juego';
    statusClass = 'en-juego';
  } else if (!hasBothPairs) {
    statusText = 'Esperando';
    statusClass = 'esperando';
  } else {
    statusText = 'Pendiente';
    statusClass = 'pendiente';
  }

  // Horario formateado en America/Argentina/Cordoba (ej. "Vie · 19:30")
  const horario = formatPartidoHorario(partido.fechaHora);

  // Sets del partido (W.O. / retiro no muestra sets ni ceros)
  const tieneSets = Array.isArray(partido.sets) && partido.sets.length > 0;

  // Nombres con fallback "Esperando..."
  const nombreP1 = partido.pareja1 || (partido.origenPareja1 ? `Esperando ${partido.origenPareja1}` : 'Esperando...');
  const nombreP2 = partido.pareja2 || (partido.origenPareja2 ? `Esperando ${partido.origenPareja2}` : 'Esperando...');

  const row1Class = p1esGanador
    ? 'winner'
    : isFinalizado && p2esGanador
    ? 'loser'
    : !partido.pareja1
    ? 'esperando'
    : '';

  const row2Class = p2esGanador
    ? 'winner'
    : isFinalizado && p1esGanador
    ? 'loser'
    : !partido.pareja2
    ? 'esperando'
    : '';

  const cardStateClass = isFinalizado ? 'finalizado' : isEnCurso ? 'en-curso' : isVacio ? 'vacio' : '';

  return (
    <div key={partido.id} className={`bracket-match-wrapper pub-match-card-wrapper ${isMobile ? 'mobile-full' : ''}`}>
      <div className="match-card-wrapper" style={{ display: 'flex', alignItems: 'center', width: isMobile ? '100%' : undefined }}>
        <div className={`match-card pub-match-card ${cardStateClass}`}>
          {label && <span className="pub-match-label">{label}</span>}

          <div className="pub-match-header">
            {horario ? (
              <span className="pub-match-time">
                <Clock size={11} strokeWidth={2} className="pub-match-time-icon" aria-hidden="true" />
                {horario}
              </span>
            ) : (
              <span />
            )}

            <span className={`pub-match-status ${statusClass}`}>
              {isEnCurso && <span className="pub-match-dot" aria-hidden="true" />}
              {statusText}
            </span>
          </div>

          <div className="pub-match-body">
            <div className={`pub-match-row ${row1Class}`}>
              <span className="pub-match-name" title={nombreP1}>
                {nombreP1}
              </span>
              {tieneSets && (
                <div className="pub-match-sets" aria-label="Sets pareja 1">
                  {partido.sets.map((set, idx) => {
                    const isHigher = set.gamesPareja1 > set.gamesPareja2;
                    const isLower = set.gamesPareja1 < set.gamesPareja2;
                    return (
                      <span
                        key={idx}
                        className={`pub-match-set ${isHigher ? 'higher' : isLower ? 'lower' : ''}`}
                      >
                        {set.gamesPareja1}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>

            <div className={`pub-match-row ${row2Class}`}>
              <span className="pub-match-name" title={nombreP2}>
                {nombreP2}
              </span>
              {tieneSets && (
                <div className="pub-match-sets" aria-label="Sets pareja 2">
                  {partido.sets.map((set, idx) => {
                    const isHigher = set.gamesPareja2 > set.gamesPareja1;
                    const isLower = set.gamesPareja2 < set.gamesPareja1;
                    return (
                      <span
                        key={idx}
                        className={`pub-match-set ${isHigher ? 'higher' : isLower ? 'lower' : ''}`}
                      >
                        {set.gamesPareja2}
                      </span>
                    );
                  })}
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
  const [favParejaId, setFavParejaId] = useState(null);

  // Sincronizar favorito al cambiar de slug o categoría activa
  useEffect(() => {
    if (slug && activeCatId) {
      setFavParejaId(getFavPareja(slug, activeCatId));
    } else {
      setFavParejaId(null);
    }
  }, [slug, activeCatId]);

  const handleToggleFav = (parejaId) => {
    if (!parejaId || !activeCatId || !slug) return;
    const next = favParejaId === parejaId ? null : parejaId;
    setFavParejaId(next);
    setFavPareja(slug, activeCatId, next);
  };

  // Limpieza segura de favorito huérfano:
  // Solo tras fetch exitoso con payload de la categoría activa ya cargado con contenido
  useEffect(() => {
    if (!data || !activeCatId || !favParejaId || !slug) return;
    const cat = data.categorias?.find((c) => c.id === activeCatId);
    if (!cat) return; // No limpiar durante cambio de categoría

    const tieneZonas = Array.isArray(cat.zonas) && cat.zonas.length > 0;
    const tieneElim = Array.isArray(cat.fasesEliminatorias) && cat.fasesEliminatorias.length > 0;
    if (!tieneZonas && !tieneElim) return; // Categoría vacía / en preparación: no limpiar

    const enZonas = cat.zonas?.some(
      (z) =>
        z.tabla?.some((row) => row.parejaId === favParejaId) ||
        z.partidos?.some((p) => p.pareja1Id === favParejaId || p.pareja2Id === favParejaId)
    );
    const enElim = cat.fasesEliminatorias?.some((f) =>
      f.partidos?.some((p) => p.pareja1Id === favParejaId || p.pareja2Id === favParejaId)
    );

    if (!enZonas && !enElim) {
      setFavPareja(slug, activeCatId, null);
      setFavParejaId(null);
    }
  }, [data, activeCatId, favParejaId, slug]);

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
  const zonasAMostrar = activeZoneId ? zonas.filter((z) => z.id === activeZoneId) : zonas;
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
  }, [activeCategoria?.id]);

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
            list.push({ parejaId: row.parejaId, parejaNombre: nombre, zonaId: z.id, zonaNombre: z.nombre });
          }
        }
      });

      // 2. De los partidos por si hubiera parejas no listadas aún en tabla
      z.partidos?.forEach((p) => {
        if (p.pareja1?.trim()) {
          const key = `${p.pareja1.trim().toLowerCase()}_${z.id}`;
          if (!seen.has(key)) {
            seen.add(key);
            list.push({ parejaId: p.pareja1Id, parejaNombre: p.pareja1.trim(), zonaId: z.id, zonaNombre: z.nombre });
          }
        }
        if (p.pareja2?.trim()) {
          const key = `${p.pareja2.trim().toLowerCase()}_${z.id}`;
          if (!seen.has(key)) {
            seen.add(key);
            list.push({ parejaId: p.pareja2Id, parejaNombre: p.pareja2.trim(), zonaId: z.id, zonaNombre: z.nombre });
          }
        }
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
                    <span className="public-search-team">
                      {res.parejaNombre}
                      {res.parejaId && favParejaId === res.parejaId && (
                        <Star size={13} className="public-search-fav-icon" aria-label="Mi pareja favorita" />
                      )}
                    </span>
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
              {zonasAMostrar.map((zona, zIdx) => (
                <Fragment key={zona.id}>
                  {isMobile && activeZoneId === null && zIdx > 0 && (
                    <hr className="public-zona-separator" />
                  )}
                  <div
                    id={`zona-${zona.id}`}
                    className={isMobile ? 'public-zona-mobile' : 'torneo-card'}
                    style={{ marginBottom: '2rem' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                      <h3 style={{ margin: 0 }}>{zona.nombre}</h3>
                      {!isMobile && (
                        <span className="badge badge-en_curso">Clasifican {zona.clasifican}</span>
                      )}
                    </div>

                  {/* Posiciones de la zona: Mobile (mini tabla con encabezados alineados) vs Desktop (tabla tradicional) */}
                  {isMobile ? (
                    (() => {
                      const zonaSinJugar = Array.isArray(zona.tabla) && zona.tabla.length > 0 && zona.tabla.every((row) => (row.pj || 0) === 0);

                      return (
                        <div className="public-tabla-wrap" style={{ marginBottom: '1.5rem' }}>
                          <table className="public-tabla-mobile">
                            <thead>
                              <tr>
                                <th className="col-pos">#</th>
                                <th className="col-pareja">Pareja</th>
                                {zonaSinJugar ? (
                                  <th className="col-estado text-right" style={{ textAlign: 'right' }}>Estado</th>
                                ) : (
                                  <>
                                    <th className="col-stat text-center" title="Partidos Jugados">PJ</th>
                                    <th className="col-stat text-center" title="Partidos Ganados">PG</th>
                                    <th className="col-stat-diff text-center" title="Diferencia de Sets">DS</th>
                                    <th className="col-stat-diff text-center" title="Diferencia de Games">DG</th>
                                    <th className="col-pts text-center" title="Puntos">PTS</th>
                                  </>
                                )}
                              </tr>
                            </thead>
                            <tbody>
                              {zona.tabla.map((row, idx) => {
                                const clasifica = idx < zona.clasifican;
                                const ds = (row.sf || 0) - (row.sc || 0);
                                const dg = (row.gf || 0) - (row.gc || 0);

                                return (
                                  <tr key={idx} className={clasifica ? 'clasifica' : ''}>
                                    <td className="col-pos">{idx + 1}</td>
                                    <td className="col-pareja">
                                      <div className="public-tabla-pareja-wrap">
                                        {row.parejaId && (
                                          <button
                                            type="button"
                                            className={`public-fav-btn ${favParejaId === row.parejaId ? 'active' : ''}`}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleToggleFav(row.parejaId);
                                            }}
                                            aria-label={favParejaId === row.parejaId ? `Quitar a ${row.pareja} de mi pareja favorita` : `Marcar a ${row.pareja} como mi pareja favorita`}
                                            aria-pressed={favParejaId === row.parejaId}
                                          >
                                            <Star size={14} className="public-fav-icon" />
                                          </button>
                                        )}
                                        <span className="public-tabla-nombre" title={row.pareja}>
                                          {row.pareja}
                                        </span>
                                      </div>
                                    </td>
                                    {zonaSinJugar ? (
                                      <td className="col-estado text-right" style={{ textAlign: 'right' }}>
                                        <span className="public-tabla-sin-jugar">Sin jugar</span>
                                      </td>
                                    ) : (
                                      <>
                                        <td className="col-stat text-center">{row.pj}</td>
                                        <td className="col-stat text-center">{row.pg}</td>
                                        <td className="col-stat-diff text-center">{formatDiff(ds)}</td>
                                        <td className="col-stat-diff text-center">{formatDiff(dg)}</td>
                                        <td className="col-pts text-center">
                                          <span className="public-tabla-pts-val">{row.puntos}</span>
                                        </td>
                                      </>
                                    )}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                          <div className="public-clasifican-legend">
                            Clasifican {zona.clasifican}
                          </div>
                        </div>
                      );
                    })()
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
                                  <div className="public-tabla-pareja-wrap">
                                    {row.parejaId && (
                                      <button
                                        type="button"
                                        className={`public-fav-btn ${favParejaId === row.parejaId ? 'active' : ''}`}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleToggleFav(row.parejaId);
                                        }}
                                        aria-label={favParejaId === row.parejaId ? `Quitar a ${row.pareja} de mi pareja favorita` : `Marcar a ${row.pareja} como mi pareja favorita`}
                                        aria-pressed={favParejaId === row.parejaId}
                                      >
                                        <Star size={14} className="public-fav-icon" />
                                      </button>
                                    )}
                                    <span>{row.pareja}</span>
                                  </div>
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
                            <PublicMatchCard
                              key={p.id}
                              partido={p}
                              label={partidoLabel}
                            />
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </Fragment>
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
