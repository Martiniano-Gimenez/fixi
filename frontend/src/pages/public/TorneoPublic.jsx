import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import BracketLines from '../../components/BracketLines';
import { AlertTriangle, Users, Trophy, Clock, Search, X, Play } from 'lucide-react';
import { formatPartidoHorario, getDiaCalendarioCordoba } from '../../utils/dateUtils';
import { APP_NAME, APP_TAGLINE } from '../../constants/app';
import '../admin/EliminatoriaView.css';
import './publico/publico.css';
import Encabezado from './publico/Encabezado';
import NavSecciones from './publico/NavSecciones';
import Segmentado from './publico/Segmentado';
import TarjetaPartido, { Estrella } from './publico/TarjetaPartido';
import TablaZona from './publico/TablaZona';
import ListaAnimada from './publico/ListaAnimada';
import useAvisoResultados from './publico/useAvisoResultados';
import {
  DIAS_LARGOS,
  campeones,
  cifrasTorneo,
  diaDe,
  diaDeHoy,
  diasDelTorneo,
  horaPartido,
  normalizar,
  partidoCoincide,
  partidosDeCategoria,
  parejasQueCoinciden,
  porHorario,
  sinResultado,
  fraseFase,
} from './publico/utilidades';

const SECCIONES = [
  { key: 'hoy', label: 'Hoy' },
  { key: 'zonas', label: 'Zonas' },
  { key: 'cuadro', label: 'Cuadro' },
  { key: 'horarios', label: 'Horarios' },
];
const letraZona = (z) => z.nombre.replace(/^Zona\s+/i, '');
const claveTarjeta = (p) => p.id;

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

function partidoPerteneceAPareja(p, filtro) {
  if (!filtro) return true;
  const p1Match = p.pareja1Id != null
    ? p.pareja1Id === filtro.id
    : Boolean(filtro.nombre && p.pareja1 === filtro.nombre);

  const p2Match = p.pareja2Id != null
    ? p.pareja2Id === filtro.id
    : Boolean(filtro.nombre && p.pareja2 === filtro.nombre);

  return p1Match || p2Match;
}

function PublicMatchCard({ partido, label = '', isMobile = false, isFav = false }) {
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
  const origenP1 = partido.origenPareja1 || partido.displayOrigenPareja1;
  const origenP2 = partido.origenPareja2 || partido.displayOrigenPareja2;
  const nombreP1 = partido.pareja1 || partido.displayPareja1 || origenP1 || 'Esperando...';
  const nombreP2 = partido.pareja2 || partido.displayPareja2 || origenP2 || 'Esperando...';

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
  const favClass = isFav ? 'fav-match' : '';

  return (
    <div key={partido.id} className={`bracket-match-wrapper pub-match-card-wrapper ${isMobile ? 'mobile-full' : ''}`}>
      <div className="match-card-wrapper" style={{ display: 'flex', alignItems: 'center', width: isMobile ? '100%' : undefined }}>
        <div className={`match-card pub-match-card ${cardStateClass} ${favClass}`}>
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

            {statusText && statusText !== 'Esperando' && !partido.esBye && (
              <span className={`pub-match-status ${statusClass}`}>
                {isEnCurso && <span className="pub-match-dot" aria-hidden="true" />}
                {statusText}
              </span>
            )}
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

function TorneoPublicSkeleton() {
  return (
    <div className="publico" role="status" aria-busy="true">
      <span className="pv-sr">Cargando torneo…</span>
      <header className="pv-cab" aria-hidden="true">
        <div className="pv-envolver">
          <div className="pv-cab-fila">
            <div className="pv-sk" style={{ width: 120, height: 26 }} />
            <div className="pv-sk" style={{ width: 80, height: 28, borderRadius: 99 }} />
          </div>
          <div className="pv-sk" style={{ width: '62%', height: 30, marginTop: 18 }} />
          <div className="pv-sk" style={{ width: '48%', height: 16, marginTop: 10 }} />
          <div className="pv-sk" style={{ width: '70%', height: 16, marginTop: 14 }} />
        </div>
      </header>
      <div className="pv-envolver" aria-hidden="true">
        <div className="pv-buscador">
          <div className="pv-sk" style={{ width: 150, height: 18 }} />
          <div className="pv-sk" style={{ height: 48, marginTop: 10 }} />
        </div>
        <div className="pv-cats">
          {[72, 64, 84, 104].map((w) => (
            <div key={w} className="pv-sk" style={{ flex: 'none', width: w, height: 38, borderRadius: 99 }} />
          ))}
        </div>
        <div style={{ paddingTop: 20 }}>
          <div className="pv-sk" style={{ width: 120, height: 22 }} />
          {[1, 2, 3].map((n) => (
            <div key={n} className="pv-sk" style={{ height: 112, marginTop: 10, borderRadius: 14 }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function formatTiempoTranscurrido(diffSec) {
  if (diffSec < 5) {
    return 'Actualizado ahora';
  }
  if (diffSec < 35) {
    return `Actualizado hace ${diffSec} s`;
  }
  if (diffSec < 60) {
    return `Sin actualizar hace ${diffSec} s`;
  }
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `Sin actualizar hace ${diffMin} min`;
  }
  const diffHoras = Math.floor(diffSec / 3600);
  return `Sin actualizar hace ${diffHoras} h`;
}

function UltimaActualizacion({ timestamp }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let timerId = null;

    const startTimer = () => {
      if (!timerId) {
        setNow(Date.now());
        timerId = setInterval(() => {
          setNow(Date.now());
        }, 1000);
      }
    };

    const stopTimer = () => {
      if (timerId) {
        clearInterval(timerId);
        timerId = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        startTimer();
      } else {
        stopTimer();
      }
    };

    if (document.visibilityState === 'visible') {
      startTimer();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stopTimer();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  if (!timestamp) return null;

  const diffSec = Math.max(0, Math.floor((now - timestamp) / 1000));
  const isDesactualizado = diffSec >= 35;
  const texto = formatTiempoTranscurrido(diffSec);

  return (
    <span className={`pv-actualizado ${isDesactualizado ? 'atrasado' : ''}`}>
      <i aria-hidden="true" />
      {texto}
    </span>
  );
}

export default function TorneoPublic() {
  const { slug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  // Estado inicial desde la URL (categoría, sección, zona, ronda, día y búsqueda): el link se puede compartir
  const urlInicial = useRef({
    cat: searchParams.get('cat'),
    zona: searchParams.get('zona'),
    ronda: searchParams.get('ronda'),
    dia: searchParams.get('dia'),
  });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [activeCatId, setActiveCatId] = useState(null);
  const [activeZoneId, setActiveZoneId] = useState(null); // null = "Todas"
  const [seccion, setSeccion] = useState(() =>
    SECCIONES.some((s) => s.key === searchParams.get('sec')) ? searchParams.get('sec') : 'hoy'
  );
  const [showFinalizados, setShowFinalizados] = useState(false);
  const [filtroParejaHorarios, setFiltroParejaHorarios] = useState(null); // { id, nombre } | null
  const [activeRoundId, setActiveRoundId] = useState(null);
  const [busqueda, setBusqueda] = useState(() => searchParams.get('pareja') || ''); // lo que se escribe
  const [searchTerm, setSearchTerm] = useState(() => (searchParams.get('pareja') || '').trim()); // búsqueda aplicada
  const [favParejaId, setFavParejaId] = useState(null);
  const [animarEntrada, setAnimarEntrada] = useState(true);
  const [estrellaPop, setEstrellaPop] = useState(0);

  // Título de la pestaña: "{torneo} · Fixi" con datos, o "Fixi" cargando/error; restaura al desmontar
  useEffect(() => {
    if (data?.torneo?.nombre) {
      document.title = `${data.torneo.nombre} · ${APP_NAME}`;
    } else {
      document.title = APP_NAME;
    }
    return () => {
      document.title = `${APP_NAME} — ${APP_TAGLINE}`;
    };
  }, [data?.torneo?.nombre]);

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

    const elimFases = cat.eliminatoria || cat.fasesEliminatorias || [];
    const tieneZonas = Array.isArray(cat.zonas) && cat.zonas.length > 0;
    const tieneElim = Array.isArray(elimFases) && elimFases.length > 0;
    if (!tieneZonas && !tieneElim) return; // Categoría vacía / en preparación: no limpiar

    const enZonas = cat.zonas?.some(
      (z) =>
        z.tabla?.some((row) => row.parejaId === favParejaId) ||
        z.partidos?.some((p) => p.pareja1Id === favParejaId || p.pareja2Id === favParejaId)
    );
    const enElim = elimFases.some((f) =>
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

  const dataRef = useRef(null);
  const inFlightRef = useRef(false);
  const intervalRef = useRef(null);
  const publicBracketRef = useRef(null);

  const fetchData = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const result = await api.get(`/public/${slug}`);
      dataRef.current = result;
      setData(result);
      setError(null);
      setLastUpdated(Date.now());

      // Si no hay categoría seleccionada, la de la URL o la primera
      if (result?.categorias?.length > 0) {
        setActiveCatId((prev) => {
          const exists = result.categorias.some((c) => c.id === prev);
          if (exists) return prev;
          const deUrl = result.categorias.find((c) => c.nombre === urlInicial.current.cat);
          if (deUrl) {
            const z = deUrl.zonas?.find((x) => letraZona(x) === urlInicial.current.zona);
            if (z) setActiveZoneId(z.id);
            const r = Number(urlInicial.current.ronda);
            if (r > 0 && deUrl.eliminatoria?.[r - 1]) setActiveRoundId(deUrl.eliminatoria[r - 1].id);
            return deUrl.id;
          }
          return result.categorias[0].id;
        });
      }
    } catch (err) {
      if (!dataRef.current) setError(err.message);
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  };

  useEffect(() => {
    dataRef.current = null;
    fetchData();
    intervalRef.current = setInterval(fetchData, POLL_INTERVAL);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchData();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [slug]);

  // Categoría activa y colecciones derivadas
  const activeCategoria = data?.categorias?.find((c) => c.id === activeCatId) || data?.categorias?.[0];
  const zonas = useMemo(() => activeCategoria?.zonas || [], [activeCategoria]);
  const zonasAMostrar = activeZoneId ? zonas.filter((z) => z.id === activeZoneId) : zonas;
  const eliminatoria = useMemo(() => activeCategoria?.eliminatoria || [], [activeCategoria]);

  // Si la zona seleccionada deja de existir en una actualización por polling, volver a "Todas" (null)
  useEffect(() => {
    if (activeZoneId !== null && !zonas.some((z) => z.id === activeZoneId)) {
      setActiveZoneId(null);
    }
  }, [zonas, activeZoneId]);

  // Cambio de categoría a mano: zonas en "Todas" y ronda por defecto.
  // La búsqueda se mantiene: busca en todo el torneo.
  const handleCategorySelect = (catId, e) => {
    if (catId === activeCatId) return;
    setActiveCatId(catId);
    setActiveZoneId(null);
    setActiveRoundId(null);
    setFiltroParejaHorarios(null);
    e?.currentTarget?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  };

  // La búsqueda se aplica 140 ms después de dejar de escribir
  useEffect(() => {
    const t = setTimeout(() => setSearchTerm(busqueda.trim()), 140);
    return () => clearTimeout(t);
  }, [busqueda]);

  // Parejas de todo el torneo que coinciden con la búsqueda
  const coincidencias = useMemo(() => parejasQueCoinciden(data?.categorias || [], searchTerm), [data, searchTerm]);

  // Adónde llevar al usuario: la categoría (y la zona) si la búsqueda apunta a un solo lugar
  const destinoBusqueda = useMemo(() => {
    if (!coincidencias.length) return null;
    if (new Set(coincidencias.map((x) => x.catId)).size > 1) return null;
    const unaZona = new Set(coincidencias.map((x) => x.zonaId)).size === 1;
    return { catId: coincidencias[0].catId, zonaId: unaZona ? coincidencias[0].zonaId : null };
  }, [coincidencias]);

  // Al buscar (o al pasar a Zonas con una búsqueda), ir a la categoría y a la zona de la pareja.
  // Solo reacciona a la búsqueda y a la sección: si después se elige otra zona a mano, se respeta.
  const seleccionRef = useRef({ catId: activeCatId, zonaId: activeZoneId });
  seleccionRef.current = { catId: activeCatId, zonaId: activeZoneId };
  useEffect(() => {
    if (!destinoBusqueda) return;
    const { catId, zonaId } = seleccionRef.current;
    if (destinoBusqueda.catId !== catId) {
      setActiveCatId(destinoBusqueda.catId);
      setActiveRoundId(null);
      setFiltroParejaHorarios(null);
      setActiveZoneId(seccion === 'zonas' ? destinoBusqueda.zonaId : null);
    } else if (seccion === 'zonas' && destinoBusqueda.zonaId && destinoBusqueda.zonaId !== zonaId) {
      setActiveZoneId(destinoBusqueda.zonaId);
    }
  }, [destinoBusqueda, seccion]);

  // Link de cada sección con el estado actual (para abrir en otra pestaña o compartir)
  const construirURL = useCallback(
    (sec) => {
      if (!activeCategoria) return '';
      const p = new URLSearchParams();
      p.set('cat', activeCategoria.nombre);
      p.set('sec', sec);
      const z = zonas.find((x) => x.id === activeZoneId);
      if (sec === 'zonas' && z) p.set('zona', letraZona(z));
      const ri = eliminatoria.findIndex((f) => f.id === activeRoundId);
      if (sec === 'cuadro' && ri >= 0) p.set('ronda', String(ri + 1));
      if (searchTerm) p.set('pareja', searchTerm);
      return p.toString();
    },
    [activeCategoria, zonas, eliminatoria, activeZoneId, activeRoundId, searchTerm]
  );
  const urlActual = construirURL(seccion);
  useEffect(() => {
    if (urlActual && urlActual !== window.location.search.slice(1)) setSearchParams(urlActual, { replace: true });
  }, [urlActual, setSearchParams]);

  // Aviso de resultados nuevos (nunca en la primera carga)
  const aviso = useAvisoResultados(data, activeCategoria, favParejaId);

  // Entrada en cascada solo la primera vez que llegan los datos
  const hayDatos = Boolean(data);
  useEffect(() => {
    if (!hayDatos) return undefined;
    const t = setTimeout(() => setAnimarEntrada(false), 1400);
    return () => clearTimeout(t);
  }, [hayDatos]);

  const toggleSeguir = (parejaId) => {
    if (parejaId !== favParejaId) setEstrellaPop((n) => n + 1);
    handleToggleFav(parejaId);
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

  // Nombre de la pareja favorita activa (para mostrar chip en buscador)
  const favParejaNombre = useMemo(() => {
    if (!favParejaId || !activeCategoria) return null;
    for (const z of zonas) {
      const row = z.tabla?.find((r) => r.parejaId === favParejaId);
      if (row?.pareja) return row.pareja;
    }
    const item = parejasPorZona.find((p) => p.parejaId === favParejaId);
    if (item?.parejaNombre) return item.parejaNombre;
    return null;
  }, [favParejaId, activeCategoria, zonas, parejasPorZona]);

  // Cómputo memoizado del próximo partido para la pareja favorita de la categoría
  const proximoPartidoInfo = useMemo(() => {
    if (!favParejaId || !activeCategoria) return null;

    // 1. Recolectar todos los partidos de la categoría activa
    const todosPartidos = [];
    zonas.forEach((z) => {
      z.partidos?.forEach((p) => {
        todosPartidos.push({
          ...p,
          faseTipo: 'zona',
          faseNombre: z.nombre,
          posicionEnRonda: p.posicionEnRonda ?? 0,
        });
      });
    });
    eliminatoria.forEach((f) => {
      f.partidos?.forEach((p) => {
        todosPartidos.push({
          ...p,
          faseTipo: 'eliminatoria',
          faseNombre: f.nombre,
          posicionEnRonda: p.posicion ?? p.posicionEnRonda ?? 0,
        });
      });
    });

    // 2. Partidos donde participa la pareja favorita
    const misPartidos = todosPartidos.filter(
      (p) => p.pareja1Id === favParejaId || p.pareja2Id === favParejaId
    );

    // Prioridad 1: Partido EN_CURSO (sin sets en vivo, solo a nivel partido)
    const enCurso = misPartidos.find((p) => p.estado === 'EN_CURSO');
    if (enCurso) {
      const esP1 = enCurso.pareja1Id === favParejaId;
      const rival = esP1 ? enCurso.pareja2 : enCurso.pareja1;
      const rivalTexto = rival || 'Rival por definirse';
      const meta = enCurso.faseNombre;

      return {
        tipo: 'en-curso',
        badge: 'Jugando ahora',
        rival: `vs. ${rivalTexto}`,
        meta,
        partidoId: enCurso.id,
      };
    }

    // Prioridad 2: Partido PENDIENTE
    const pendientes = misPartidos.filter((p) => p.estado === 'PENDIENTE');
    if (pendientes.length > 0) {
      // Ordenamiento determinístico:
      // Con fechaHora: menor fechaHora (más temprano cronológicamente). NO usar Date.now().
      // Sin fechaHora: después, menor posicionEnRonda.
      pendientes.sort((a, b) => {
        const hasA = Boolean(a.fechaHora);
        const hasB = Boolean(b.fechaHora);
        if (hasA && hasB) {
          return new Date(a.fechaHora) - new Date(b.fechaHora);
        }
        if (hasA) return -1;
        if (hasB) return 1;
        return (a.posicionEnRonda || 0) - (b.posicionEnRonda || 0);
      });

      const prox = pendientes[0];
      const esP1 = prox.pareja1Id === favParejaId;
      const rival = esP1 ? prox.pareja2 : prox.pareja1;
      const origenRival = esP1 ? prox.origenPareja2 : prox.origenPareja1;
      const rivalTexto = rival || origenRival || 'Rival por definirse';
      const horario = prox.fechaHora ? formatPartidoHorario(prox.fechaHora) : null;

      // Si el próximo partido pendiente es de fase eliminatoria -> ¡Clasificaste a eliminatorias!
      if (prox.faseTipo === 'eliminatoria') {
        const meta = [horario, prox.faseNombre].filter(Boolean).join(' · ');
        return {
          tipo: 'clasificado',
          badge: '¡Clasificaste a eliminatorias!',
          rival: `vs. ${rivalTexto}`,
          meta: meta || prox.faseNombre || 'Eliminatoria',
          partidoId: prox.id,
        };
      }

      if (rival) {
        // Ambas parejas definidas en zona
        if (prox.fechaHora) {
          return {
            tipo: 'programado',
            badge: horario,
            rival: `vs. ${rival}`,
            meta: prox.faseNombre,
            partidoId: prox.id,
          };
        } else {
          return {
            tipo: 'sin-horario',
            badge: 'Horario por confirmar',
            rival: `vs. ${rival}`,
            meta: prox.faseNombre,
            partidoId: prox.id,
          };
        }
      } else {
        // Falta rival en zona
        const meta = [horario, prox.faseNombre].filter(Boolean).join(' · ');
        return {
          tipo: 'esperando-rival',
          badge: horario || 'Esperando rival',
          rival: `vs. ${rivalTexto}`,
          meta: meta || prox.faseNombre,
          partidoId: prox.id,
        };
      }
    }

    // Prioridad 3: Zona finalizada / partidos jugados y clasificado -> Estado Clasificado
    const miZona = zonas.find((z) =>
      z.tabla?.some((row) => row.parejaId === favParejaId)
    );

    if (miZona && miZona.partidos?.length > 0) {
      const zonaTerminada = miZona.partidos.every((p) => p.estado === 'FINALIZADO');
      const misPartidosDeZona = miZona.partidos.filter(
        (p) => p.pareja1Id === favParejaId || p.pareja2Id === favParejaId
      );
      const termineMisPartidos =
        misPartidosDeZona.length > 0 &&
        misPartidosDeZona.every((p) => p.estado === 'FINALIZADO');
      const filaIdx = miZona.tabla?.findIndex((r) => r.parejaId === favParejaId);
      // REGLA CRÍTICA: usar posición de la fila dentro de tabla[] ya ordenada (idx + 1 <= zona.clasifican)
      const clasifico = filaIdx !== -1 && filaIdx + 1 <= miZona.clasifican;

      if ((zonaTerminada || termineMisPartidos) && clasifico) {
        // Etiqueta exacta de origen generada al inicio del torneo (ej: "1° Zona A")
        const miOrigen = `${filaIdx + 1}° ${miZona.nombre}`;

        // Buscar en las fases eliminatorias el partido no finalizado que tenga a mi pareja por id o por origen
        let cruceEncontrado = null;
        for (const f of eliminatoria) {
          const match = f.partidos?.find(
            (p) =>
              (p.pareja1Id === favParejaId ||
                p.pareja2Id === favParejaId ||
                p.origenPareja1 === miOrigen ||
                p.origenPareja2 === miOrigen) &&
              p.estado !== 'FINALIZADO'
          );
          if (match) {
            cruceEncontrado = { ...match, faseNombre: f.nombre };
            break;
          }
        }

        let rivalTexto = null;
        if (cruceEncontrado) {
          const esLado1 =
            cruceEncontrado.pareja1Id === favParejaId ||
            cruceEncontrado.origenPareja1 === miOrigen;
          const rivalNombre = esLado1 ? cruceEncontrado.pareja2 : cruceEncontrado.pareja1;
          const rivalOrigen = esLado1 ? cruceEncontrado.origenPareja2 : cruceEncontrado.origenPareja1;

          if (rivalNombre) {
            rivalTexto = rivalNombre;
          } else if (rivalOrigen) {
            // Intentar resolver si la zona del rival ya terminó sus partidos (ej: "2° Zona B")
            const originMatch = rivalOrigen.match(/^(\d+)°\s+(.+)$/);
            if (originMatch) {
              const rPos = parseInt(originMatch[1], 10);
              const rZonaNombre = originMatch[2];
              const rZona = zonas.find((z) => z.nombre === rZonaNombre);
              if (
                rZona &&
                rZona.partidos?.length > 0 &&
                rZona.partidos.every((p) => p.estado === 'FINALIZADO')
              ) {
                const filaRival = rZona.tabla?.[rPos - 1];
                if (filaRival?.pareja) {
                  rivalTexto = filaRival.pareja;
                }
              }
            }
            if (!rivalTexto) {
              rivalTexto = rivalOrigen; // Ej: "2° Zona B"
            }
          } else {
            rivalTexto = 'Rival por definirse';
          }
        }

        const horario = cruceEncontrado?.fechaHora
          ? formatPartidoHorario(cruceEncontrado.fechaHora)
          : null;
        const meta = [horario, cruceEncontrado?.faseNombre].filter(Boolean).join(' · ');

        return {
          tipo: 'clasificado',
          badge: '¡Clasificaste a eliminatorias!',
          rival: rivalTexto ? `vs. ${rivalTexto}` : 'Cruce por definirse',
          meta: meta || cruceEncontrado?.faseNombre || 'Esperando que se arme el cuadro de eliminatorias',
          partidoId: cruceEncontrado?.id,
        };
      }
    }

    return null;
  }, [favParejaId, activeCategoria, zonas, eliminatoria]);

  // Agrupamiento y ordenamiento de partidos para la pestaña Horarios
  const horariosData = useMemo(() => {
    const todos = [];

    // 1. Partidos de Zonas con etiqueta corta
    zonas.forEach((z) => {
      z.partidos?.forEach((p) => {
        let origenLabel = z.nombre;
        if (z.formato === 'MINI_BRACKET') {
          if (p.posicionEnRonda === 1 || p.posicionEnRonda === 2) {
            origenLabel = `${z.nombre} · Ronda 1`;
          } else if (p.posicionEnRonda === 3) {
            origenLabel = `${z.nombre} · 1° y 2° Puesto`;
          } else if (p.posicionEnRonda === 4) {
            origenLabel = `${z.nombre} · 3° y 4° Puesto`;
          }
        }
        todos.push({
          ...p,
          origenLabel,
          isFav: Boolean(favParejaId && (p.pareja1Id === favParejaId || p.pareja2Id === favParejaId)),
        });
      });
    });

    // 2. Partidos de Eliminatoria con etiqueta corta (nombre de fase)
    eliminatoria.forEach((f) => {
      f.partidos?.forEach((p) => {
        todos.push({
          ...p,
          origenLabel: f.nombre,
          isFav: Boolean(favParejaId && (p.pareja1Id === favParejaId || p.pareja2Id === favParejaId)),
        });
      });
    });

    const totalPartidos = todos.length;

    // 3. Si hay filtro de pareja, filtramos los partidos
    const partidosFiltradosPareja = filtroParejaHorarios
      ? todos.filter((p) => partidoPerteneceAPareja(p, filtroParejaHorarios))
      : todos;

    // 4. Filtrar finalizados si no hay filtro activo y showFinalizados es false.
    // Con filtro activo, se muestran TODOS sus partidos (finalizados incluidos).
    const filtrados = filtroParejaHorarios
      ? partidosFiltradosPareja
      : (showFinalizados ? partidosFiltradosPareja : partidosFiltradosPareja.filter((p) => p.estado !== 'FINALIZADO'));

    // 5. Separar partidos EN_CURSO (van SOLO a "En juego")
    const enJuego = filtrados.filter((p) => p.estado === 'EN_CURSO');
    enJuego.sort((a, b) => {
      if (a.fechaHora && b.fechaHora) {
        return new Date(a.fechaHora) - new Date(b.fechaHora);
      }
      if (a.fechaHora) return -1;
      if (b.fechaHora) return 1;
      return (a.posicionEnRonda ?? a.posicion ?? 0) - (b.posicionEnRonda ?? b.posicion ?? 0);
    });

    // 6. Partidos restantes (no EN_CURSO)
    const restantes = filtrados.filter((p) => p.estado !== 'EN_CURSO');

    const conFecha = restantes.filter((p) => Boolean(p.fechaHora));
    conFecha.sort((a, b) => new Date(a.fechaHora) - new Date(b.fechaHora));

    const sinFecha = restantes.filter((p) => !p.fechaHora);
    sinFecha.sort((a, b) => (a.posicionEnRonda ?? a.posicion ?? 0) - (b.posicionEnRonda ?? b.posicion ?? 0));

    // 7. Agrupar conFecha por día calendario en America/Argentina/Cordoba
    const diasMap = new Map();
    conFecha.forEach((p) => {
      const info = getDiaCalendarioCordoba(p.fechaHora);
      if (!info) return;
      if (!diasMap.has(info.key)) {
        diasMap.set(info.key, {
          key: info.key,
          diaNombre: info.diaNombre,
          partidos: [],
        });
      }
      diasMap.get(info.key).partidos.push(p);
    });

    return {
      totalPartidos,
      partidosFiltradosCount: filtrados.length,
      enJuego,
      gruposDias: Array.from(diasMap.values()),
      sinFecha,
    };
  }, [zonas, eliminatoria, showFinalizados, favParejaId, filtroParejaHorarios]);

  if (loading) {
    return <TorneoPublicSkeleton />;
  }

  if (error) {
    return (
      <div className="publico">
        <div className="pv-envolver" style={{ paddingTop: 64, textAlign: 'center' }}>
          <AlertTriangle size={32} strokeWidth={2} style={{ color: 'var(--aviso-texto)', marginBottom: 12 }} aria-hidden="true" />
          <p style={{ color: 'var(--tinta-2)' }}>{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { torneo, categorias = [] } = data;
  const q = searchTerm;
  const cifras = cifrasTorneo(categorias);
  const enVivo = categorias.some((c) => partidosDeCategoria(c).some((p) => p.estado === 'EN_CURSO'));
  const listaCampeones = torneo.estado === 'FINALIZADO' ? campeones(categorias) : [];
  const partidosCat = partidosDeCategoria(activeCategoria);
  const partidosFiltrados = partidosCat.filter((p) => partidoCoincide(p, q));
  const parejasCat = coincidencias.filter((x) => x.catId === activeCategoria?.id);
  const unaPareja = new Set(parejasCat.map((x) => x.nombre)).size === 1 ? parejasCat[0] : null;
  const cascada = (i) => (animarEntrada ? { className: 'pv-cascada', style: { '--i': i } } : {});
  const conCascada = (clase, i) => ({ className: `${clase}${animarEntrada ? ' pv-cascada' : ''}`, style: animarEntrada ? { '--i': i } : undefined });
  const tarjeta = (conDia) => (p) => (
    <TarjetaPartido partido={p} etiqueta={p.etiqueta} conDia={conDia} seguidaId={favParejaId} />
  );

  // ─── Línea de resultado del buscador ───
  let resultado = null;
  if (q) {
    const n = partidosFiltrados.length;
    if (n && unaPareja) {
      const siguiendo = favParejaId === unaPareja.parejaId;
      resultado = (
        <>
          <span>
            <b className="num">{n}</b> {n === 1 ? 'partido' : 'partidos'} de <b translate="no">{unaPareja.nombre}</b>
          </span>
          {unaPareja.parejaId && (
            <button type="button" className="pv-seguir" aria-pressed={siguiendo} onClick={() => toggleSeguir(unaPareja.parejaId)}>
              <Estrella contorno={!siguiendo} decorativa className={siguiendo && estrellaPop ? 'pv-estrella-pop' : ''} key={estrellaPop} />
              {siguiendo ? 'Siguiendo' : 'Seguir'}
            </button>
          )}
        </>
      );
    } else if (n) {
      resultado = (
        <span>
          <b className="num">{n}</b> {n === 1 ? 'partido coincide' : 'partidos coinciden'} con “{q}”
        </span>
      );
    } else {
      const otras = categorias.filter((c) => c.id !== activeCategoria?.id && partidosDeCategoria(c).some((p) => partidoCoincide(p, q)));
      resultado = otras.length ? (
        <>
          <span>No hay partidos con “{q}” en {activeCategoria?.nombre}. Está en otra categoría:</span>
          {otras.map((c) => (
            <button key={c.id} type="button" className="pv-btn pv-btn-texto" onClick={() => handleCategorySelect(c.id)}>
              Ver en {c.nombre}
            </button>
          ))}
        </>
      ) : (
        <span>No hay partidos con “{q}” en el torneo. Revisá cómo está escrito el apellido.</span>
      );
    }
  } else if (favParejaNombre) {
    resultado = (
      <>
        <span>Seguís a <b translate="no">{favParejaNombre}</b></span>
        <button type="button" className="pv-btn pv-btn-texto" onClick={() => setBusqueda(favParejaNombre.split(' / ')[0])}>
          Ver sus partidos
        </button>
      </>
    );
  }

  // ─── Mensaje cuando la búsqueda deja la vista vacía pero la pareja juega en otro lado ───
  const quien = unaPareja ? <b translate="no">{unaPareja.nombre}</b> : <>Ninguna pareja con “{q}”</>;
  const verbo = unaPareja ? 'no juega' : 'juega';
  const mensajeVacio = (texto, botones = null) => (
    <div className="pv-vacio-busqueda" role="status">
      <p>{texto}</p>
      {botones && <div>{botones}</div>}
    </div>
  );

  // ─── Hoy ───
  const vistaHoy = () => {
    const hoy = diaDeHoy(diasDelTorneo(categorias));
    if (!hoy) return <p className="pv-vacio">Todavía no hay partidos con horario en este torneo.</p>;
    const nombreDia = `${hoy.diaNombre.toLowerCase()} ${Number(hoy.key.slice(8))}`;
    const delDia = partidosFiltrados.filter((p) => diaDe(p) === hoy.key);
    const enJuego = partidosFiltrados.filter((p) => p.estado === 'EN_CURSO');
    const ahora = Date.now();
    const pendientesDelDia = delDia.filter((p) => p.estado === 'PENDIENTE').sort(porHorario);
    const atrasados = hoy.momento === 'durante' ? pendientesDelDia.filter((p) => sinResultado(p, ahora)) : [];
    const pendientes = pendientesDelDia.filter((p) => !atrasados.includes(p));
    const terminados = delDia.filter((p) => p.estado === 'FINALIZADO').sort((a, b) => porHorario(b, a));

    if (q && partidosFiltrados.length && !enJuego.length && !pendientes.length && !atrasados.length && !terminados.length) {
      const conHora = partidosFiltrados.filter((p) => p.estado !== 'FINALIZADO' && p.fechaHora).sort(porHorario);
      const prox = conHora.find((p) => diaDe(p) >= hoy.key) || conHora[0];
      const dia = prox ? DIAS_LARGOS[horaPartido(prox.fechaHora).slice(0, 3)] : null;
      const frase = !prox
        ? 'No tiene partidos pendientes con horario.'
        : diaDe(prox) >= hoy.key
          ? <>{unaPareja ? 'Su próximo partido es' : 'El próximo es'} el {dia} a las <b className="num">{horaPartido(prox.fechaHora, false)}</b>.</>
          : <>{unaPareja ? 'Tiene' : 'Hay'} un partido pendiente del {dia} a las <b className="num">{horaPartido(prox.fechaHora, false)}</b>.</>;
      return mensajeVacio(
        <>{quien} {verbo} {hoy.momento === 'durante' ? 'hoy' : `el ${nombreDia}`}. {frase}</>,
        <button type="button" className="pv-btn pv-btn-secundario" onClick={() => setSeccion('horarios')}>Ver horarios</button>
      );
    }

    if (hoy.momento === 'antes') {
      return (
        <>
          <h2 {...conCascada('pv-titulo-sec', 5)}>El torneo arranca el {nombreDia}</h2>
          <div {...cascada(6)}>
            {pendientes.length
              ? <ListaAnimada key="antes" items={pendientes} clave={claveTarjeta} render={tarjeta(false)} />
              : <p className="pv-vacio">Esta categoría no juega ese día.</p>}
          </div>
        </>
      );
    }
    if (hoy.momento === 'despues') {
      return (
        <>
          <h2 {...conCascada('pv-titulo-sec', 5)}>Resultados del {nombreDia}</h2>
          <div {...cascada(6)}>
            {terminados.length
              ? <ListaAnimada key="despues" items={terminados} clave={claveTarjeta} render={tarjeta(false)} />
              : <p className="pv-vacio">Esta categoría no jugó ese día.</p>}
          </div>
        </>
      );
    }
    return (
      <div className="pv-dos-col">
        <div>
          <h2 {...conCascada('pv-titulo-sec', 5)}>
            En juego <small>{enJuego.length ? `${enJuego.length} ${enJuego.length === 1 ? 'partido' : 'partidos'}` : ''}</small>
          </h2>
          <div {...cascada(6)}>
            {enJuego.length
              ? <ListaAnimada key="vivo" items={enJuego} clave={claveTarjeta} render={tarjeta(false)} />
              : <p className="pv-vacio">{q ? 'Ninguno.' : 'No hay partidos en juego en esta categoría.'}</p>}
          </div>
          <h2 {...conCascada('pv-titulo-sec', 7)}>Pendientes de hoy</h2>
          <div {...cascada(8)}>
            {pendientes.length
              ? <ListaAnimada key="pend" items={pendientes} clave={claveTarjeta} render={tarjeta(false)} />
              : <p className="pv-vacio">{q ? 'Ninguno.' : 'No quedan partidos para hoy en esta categoría.'}</p>}
          </div>
          {atrasados.length > 0 && (
            <>
              <h2 className="pv-titulo-sec">
                Sin resultado cargado <small>ya pasó su horario</small>
              </h2>
              <ListaAnimada
                key="atrasados"
                items={atrasados}
                clave={claveTarjeta}
                render={(pt) => <TarjetaPartido partido={pt} etiqueta={pt.etiqueta} conDia={false} seguidaId={favParejaId} atrasado />}
              />
            </>
          )}
        </div>
        <div>
          <h2 {...conCascada('pv-titulo-sec', 9)}>Terminados hoy</h2>
          <div {...cascada(10)}>
            {terminados.length
              ? <ListaAnimada key="fin" items={terminados} clave={claveTarjeta} render={tarjeta(false)} />
              : <p className="pv-vacio">{q ? 'Ninguno.' : 'Todavía no terminó ningún partido hoy.'}</p>}
          </div>
        </div>
      </div>
    );
  };

  // ─── Zonas ───
  const vistaZonas = () => {
    if (!zonas.length) return <p className="pv-vacio">Las zonas se arman cuando el organizador inicia el torneo.</p>;
    const items = [
      { key: 'todas', label: 'Todas', aria: 'Todas las zonas' },
      ...zonas.map((z) => ({ key: z.id, label: letraZona(z), aria: z.nombre })),
    ];
    const activo = activeZoneId ? zonas.findIndex((z) => z.id === activeZoneId) + 1 : 0;
    const zonaTieneMatch = (z) =>
      (z.tabla || []).some((r) => normalizar(r.pareja).includes(normalizar(q))) || (z.partidos || []).some((p) => partidoCoincide(p, q));
    let lista = zonasAMostrar;
    if (q && !activeZoneId) lista = lista.filter(zonaTieneMatch);

    let vacio = null;
    if (q && partidosFiltrados.length && (!lista.length || (activeZoneId && !zonaTieneMatch(lista[0])))) {
      const zonasPareja = zonas.filter(zonaTieneMatch);
      const actual = zonas.find((z) => z.id === activeZoneId);
      vacio = mensajeVacio(
        <>{quien} {verbo} en la zona {actual ? letraZona(actual) : ''}.</>,
        zonasPareja.map((z) => (
          <button key={z.id} type="button" className="pv-btn pv-btn-secundario" onClick={() => setActiveZoneId(z.id)}>
            Ir a la zona {letraZona(z)}
          </button>
        ))
      );
    }

    return (
      <>
        <div {...cascada(5)}>
          <Segmentado items={items} activo={activo} etiqueta="Zonas" onCambiar={(i) => setActiveZoneId(i === 0 ? null : zonas[i - 1].id)} />
        </div>
        <div key={activeZoneId || 'todas'} {...conCascada('pv-zonas pv-entra', 6)}>
          {vacio}
          {(vacio && activeZoneId ? [] : lista).map((z) => {
            const ps = (z.partidos || [])
              .filter((p) => partidoCoincide(p, q))
              .map((p) => {
                const r = z.formato === 'MINI_BRACKET' ? { 1: 'Partido 1', 2: 'Partido 2', 3: 'Final de zona', 4: 'Por el 3.er puesto' }[p.posicionEnRonda] : null;
                return { ...p, etiqueta: r };
              });
            return (
              <section key={z.id} className="pv-zona" aria-label={z.nombre}>
                <TablaZona zona={z} seguidaId={favParejaId} busqueda={q} />
                <div>
                  <h3 className="pv-titulo-sec">Partidos de la zona {letraZona(z)}</h3>
                  {ps.length
                    ? <ListaAnimada items={ps} clave={claveTarjeta} render={tarjeta(true)} />
                    : <p className="pv-vacio">{q ? 'Ninguno.' : 'Sin partidos.'}</p>}
                </div>
              </section>
            );
          })}
        </div>
      </>
    );
  };

  return (
    <div className="publico">
      <a className="pv-saltar" href="#contenido">Saltar a los partidos</a>
      <Encabezado
        torneo={torneo}
        cifras={cifras}
        enVivo={enVivo}
        animar={animarEntrada}
        actualizacion={<UltimaActualizacion timestamp={lastUpdated} />}
      />

      <div className="pv-envolver">
        <section {...conCascada('pv-buscador', 3)} aria-label="Buscar tu pareja">
          <label htmlFor="buscar-pareja">¿Cuál es tu pareja?</label>
          <div className="pv-campo">
            <Search size={20} strokeWidth={2} aria-hidden="true" />
            <input
              id="buscar-pareja"
              type="search"
              name="pareja"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="search"
              placeholder="Por ejemplo, Álvarez…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
            {busqueda && (
              <button type="button" className="pv-limpiar" aria-label="Borrar búsqueda" onClick={() => { setBusqueda(''); setSearchTerm(''); }}>
                <X size={18} aria-hidden="true" />
              </button>
            )}
          </div>
          <div className="pv-resultado" aria-live="polite">{resultado}</div>
          {proximoPartidoInfo && !q && (
            <div className="pv-proximo">
              <span className="pv-proximo-icono" aria-hidden="true">
                {proximoPartidoInfo.tipo === 'en-curso' ? <Play size={16} /> : proximoPartidoInfo.tipo === 'clasificado' ? <Trophy size={16} /> : <Clock size={16} />}
              </span>
              <div>
                <b>{fraseFase(proximoPartidoInfo.badge)}</b>
                <strong translate="no">{proximoPartidoInfo.rival}</strong>
                {proximoPartidoInfo.meta && <span className="pv-proximo-meta">{fraseFase(proximoPartidoInfo.meta)}</span>}
              </div>
            </div>
          )}
        </section>

        {listaCampeones.length > 0 && (
          <section {...conCascada('pv-campeones', 4)} aria-label="Campeones">
            <h2>
              <Trophy size={18} className="pv-estrella" aria-hidden="true" />
              Campeones
            </h2>
            {listaCampeones.map((c) => (
              <div key={c.categoria} className="pv-campeon">
                <span>{c.categoria}</span>
                <b translate="no">{c.pareja}</b>
              </div>
            ))}
          </section>
        )}

        {categorias.length > 0 && (
          <div
            className="pv-cats"
            role="tablist"
            aria-label="Categorías"
            onKeyDown={(e) => {
              if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
              const i = categorias.findIndex((c) => c.id === activeCategoria?.id);
              const sig = categorias[(i + (e.key === 'ArrowRight' ? 1 : -1) + categorias.length) % categorias.length];
              e.preventDefault();
              handleCategorySelect(sig.id);
              e.currentTarget.querySelector(`[data-cat="${sig.id}"]`)?.focus();
            }}
          >
            {categorias.map((c) => {
              const activa = activeCategoria?.id === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  data-cat={c.id}
                  aria-selected={activa}
                  tabIndex={activa ? 0 : -1}
                  {...conCascada('pv-cat', 4)}
                  onClick={(e) => handleCategorySelect(c.id, e)}
                >
                  {c.nombre}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <NavSecciones secciones={SECCIONES} activa={seccion} onCambiar={setSeccion} href={(k) => `?${construirURL(k)}`} />

      <main id="contenido" tabIndex={-1} className="pv-envolver pv-main">
        {!activeCategoria ? (
          <p className="pv-vacio">No hay información disponible para este torneo aún.</p>
        ) : zonas.length === 0 && eliminatoria.length === 0 ? (
          <div className="pv-preparacion">
            <Users size={36} aria-hidden="true" />
            <h2>{activeCategoria.nombre}: en preparación</h2>
            <p>El organizador está cargando las parejas y armando las zonas. El fixture aparece acá cuando arranque.</p>
          </div>
        ) : (
          <div key={seccion} className={animarEntrada ? undefined : 'pv-entra'}>
            {seccion === 'hoy' && vistaHoy()}
            {seccion === 'zonas' && vistaZonas()}
            {seccion === 'cuadro' && (
              <div className="pv-legado">
          {/* Fase Eliminatoria de la categoría (Solo en pestaña Eliminatoria) */}
          {seccion === 'cuadro' && eliminatoria.length > 0 && (
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
                          <PublicMatchCard
                            key={partido.id}
                            partido={partido}
                            isMobile={true}
                            isFav={Boolean(favParejaId && (partido.pareja1Id === favParejaId || partido.pareja2Id === favParejaId))}
                          />
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
                              <PublicMatchCard
                                key={partido.id}
                                partido={partido}
                                isMobile={false}
                                isFav={Boolean(favParejaId && (partido.pareja1Id === favParejaId || partido.pareja2Id === favParejaId))}
                              />
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
              </div>
            )}
            {seccion === 'horarios' && (
              <div className="pv-legado">
          {/* Cronograma Horarios (Solo en pestaña Horarios) */}
          {seccion === 'horarios' && (
            <section className="public-horarios-section" aria-label="Cronograma de partidos">
              {/* Barra de acciones: Chip de filtro activo o Toggle "Ver finalizados" */}
              {(horariosData.totalPartidos > 0 || filtroParejaHorarios) && (
                <div className="public-horarios-header">
                  {filtroParejaHorarios ? (
                    <div className="public-horarios-active-filter">
                      <span className="public-filter-active-chip">
                        <span className="public-filter-chip-text" title={filtroParejaHorarios.nombre}>
                          Mostrando: <strong>{filtroParejaHorarios.nombre}</strong>
                        </span>
                        <button
                          type="button"
                          className="public-filter-chip-remove"
                          onClick={() => setFiltroParejaHorarios(null)}
                          aria-label="Quitar filtro"
                          title="Quitar filtro"
                        >
                          <X size={14} aria-hidden="true" />
                        </button>
                      </span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={`public-filter-chip ${showFinalizados ? 'active' : ''}`}
                      onClick={() => setShowFinalizados((prev) => !prev)}
                      aria-pressed={showFinalizados}
                    >
                      Ver finalizados
                    </button>
                  )}
                </div>
              )}

              {/* Estados vacíos */}
              {filtroParejaHorarios && horariosData.partidosFiltradosCount === 0 ? (
                <div className="public-horarios-empty">
                  <Clock size={32} className="public-horarios-empty-icon" aria-hidden="true" />
                  <p>Esta pareja no tiene partidos programados.</p>
                </div>
              ) : horariosData.totalPartidos === 0 ? (
                <div className="public-horarios-empty">
                  <Clock size={32} className="public-horarios-empty-icon" aria-hidden="true" />
                  <p>No hay partidos programados.</p>
                </div>
              ) : horariosData.partidosFiltradosCount === 0 ? (
                <div className="public-horarios-empty">
                  <Clock size={32} className="public-horarios-empty-icon" aria-hidden="true" />
                  <p>No hay partidos pendientes.</p>
                </div>
              ) : (
                <>
                  {/* Sección "En juego" destacada al principio */}
                  {horariosData.enJuego.length > 0 && (
                    <div className="public-horarios-live-section">
                      <div className="public-horarios-live-badge">
                        <span className="pub-match-dot" aria-hidden="true" />
                        <span>En juego</span>
                      </div>
                      <div className="partidos-public-grid">
                        {horariosData.enJuego.map((p) => (
                          <PublicMatchCard
                            key={p.id}
                            partido={p}
                            label={p.origenLabel}
                            isMobile={isMobile}
                            isFav={p.isFav}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Grupos por día */}
                  {horariosData.gruposDias.map((grupo) => (
                    <div key={grupo.key} className="public-horarios-day-group">
                      <h3 className="public-horarios-day-title">{grupo.diaNombre}</h3>
                      <div className="partidos-public-grid">
                        {grupo.partidos.map((p) => (
                          <PublicMatchCard
                            key={p.id}
                            partido={p}
                            label={p.origenLabel}
                            isMobile={isMobile}
                            isFav={p.isFav}
                          />
                        ))}
                      </div>
                    </div>
                  ))}

                  {/* Partidos sin fechaHora: "Horario por confirmar" al final */}
                  {horariosData.sinFecha.length > 0 && (
                    <div className="public-horarios-tbd-section">
                      <h3 className="public-horarios-day-title public-horarios-tbd-title">
                        Horario por confirmar
                      </h3>
                      <div className="partidos-public-grid">
                        {horariosData.sinFecha.map((p) => (
                          <PublicMatchCard
                            key={p.id}
                            partido={p}
                            label={p.origenLabel}
                            isMobile={isMobile}
                            isFav={p.isFav}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </section>
          )}
              </div>
            )}
          </div>
        )}
      </main>

      <div className={`pv-aviso ${aviso ? 'on' : ''}`} role="status" aria-live="polite">
        <span className="pv-aviso-icono" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
        </span>
        <div>
          <b>{aviso?.titulo}</b>
          <span>{aviso?.texto}</span>
        </div>
      </div>
    </div>
  );
}
