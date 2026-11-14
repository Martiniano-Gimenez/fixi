import { useState, useEffect, useRef, useMemo } from 'react';
import { flushSync } from 'react-dom';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { AlertTriangle } from 'lucide-react';
import { APP_NAME, APP_TAGLINE } from '../../constants/app';
import './publico/publico.css';
import Barra from './publico/Barra';
import Inicio from './publico/Inicio';
import Categoria from './publico/Categoria';
import Busqueda from './publico/Busqueda';
import useAvisoResultados from './publico/useAvisoResultados';
import { diasDelTorneo, rangoFechas } from './publico/utilidades';

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

// Nombre de una pareja según la tabla de su zona (o sus partidos)
function nombreDePareja(cat, parejaId) {
  for (const z of cat.zonas || []) {
    const row = z.tabla?.find((r) => r.parejaId === parejaId);
    if (row?.pareja) return row.pareja;
  }
  for (const f of [...(cat.zonas || []), ...(cat.eliminatoria || [])]) {
    for (const p of f.partidos || []) {
      if (p.pareja1Id === parejaId && p.pareja1) return p.pareja1;
      if (p.pareja2Id === parejaId && p.pareja2) return p.pareja2;
    }
  }
  return null;
}

function TorneoPublicSkeleton() {
  return (
    <div className="publico" role="status" aria-busy="true">
      <span className="pv-sr">Cargando torneo…</span>
      <div aria-hidden="true">
        <div className="pv-envolver pv-barra-fila">
          <div className="pv-sk" style={{ width: 84, height: 28 }} />
        </div>
        <div className="pv-envolver" style={{ paddingTop: 12 }}>
          <div className="pv-sk" style={{ width: 110, height: 16 }} />
          <div className="pv-sk" style={{ width: '64%', height: 30, marginTop: 10 }} />
          <div className="pv-sk" style={{ width: '52%', height: 16, marginTop: 10 }} />
          {[1, 2, 3].map((n) => (
            <div key={n} className="pv-sk" style={{ height: 150, marginTop: n === 1 ? 28 : 12, borderRadius: 18 }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function formatTiempoTranscurrido(diffSec) {
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

// Aviso de datos viejos: aparece solo si la última actualización tiene más de 35 s (falla de conexión)
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
  if (diffSec < 35) return null;

  return (
    <p className="pv-actualizado" role="status">
      <i aria-hidden="true" />
      {formatTiempoTranscurrido(diffSec)}
    </p>
  );
}

export default function TorneoPublic() {
  const { slug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [busquedaInmediata, setBusquedaInmediata] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [favs, setFavs] = useState({}); // pareja seguida de cada categoría: { [catId]: parejaId }
  // Link viejo con ?sec=zonas|cuadro|horarios: se usa una sola vez, al abrir la página
  const seccionInicial = useRef(searchParams.get('sec'));

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

  // Favoritos guardados de cada categoría (al llegar los datos o cambiar de torneo)
  const idsCategorias = (data?.categorias || []).map((c) => c.id).join('|');
  useEffect(() => {
    if (!slug || !idsCategorias) return;
    const leidos = {};
    idsCategorias.split('|').forEach((id) => {
      const f = getFavPareja(slug, id);
      if (f) leidos[id] = f;
    });
    setFavs(leidos);
  }, [slug, idsCategorias]);

  // Limpieza segura de favoritos huérfanos: la pareja ya no está en su categoría.
  // No limpia categorías vacías o en preparación.
  useEffect(() => {
    if (!data || !slug) return;
    Object.entries(favs).forEach(([catId, favParejaId]) => {
      const cat = data.categorias?.find((c) => c.id === catId);
      if (!cat) return;
      const elimFases = cat.eliminatoria || cat.fasesEliminatorias || [];
      const tieneZonas = Array.isArray(cat.zonas) && cat.zonas.length > 0;
      const tieneElim = Array.isArray(elimFases) && elimFases.length > 0;
      if (!tieneZonas && !tieneElim) return;
      const enZonas = cat.zonas?.some(
        (z) =>
          z.tabla?.some((row) => row.parejaId === favParejaId) ||
          z.partidos?.some((p) => p.pareja1Id === favParejaId || p.pareja2Id === favParejaId)
      );
      const enElim = elimFases.some((f) =>
        f.partidos?.some((p) => p.pareja1Id === favParejaId || p.pareja2Id === favParejaId)
      );
      if (!enZonas && !enElim) {
        setFavPareja(slug, catId, null);
        setFavs((prev) => {
          const sig = { ...prev };
          delete sig[catId];
          return sig;
        });
      }
    });
  }, [data, favs, slug]);

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

  const fetchData = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const result = await api.get(`/public/${slug}`);
      dataRef.current = result;
      setData(result);
      setError(null);
      setLastUpdated(Date.now());
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

  // Página actual según la URL: ?cat=<nombre> es la página de esa categoría; sin cat, el inicio
  const categorias = useMemo(() => data?.categorias || [], [data]);
  const catNombre = searchParams.get('cat');
  const categoria = categorias.find((c) => c.nombre === catNombre) || null;
  const rondaParam = Number(searchParams.get('ronda'));
  const rondaId = categoria && rondaParam > 0 ? categoria.eliminatoria?.[rondaParam - 1]?.id || null : null;

  // ?sec= solo vale para la primera categoría que se abre
  useEffect(() => {
    if (categoria) seccionInicial.current = null;
  }, [categoria]);

  // Cada página arranca arriba
  const pagina = categoria ? categoria.id : 'inicio';
  const paginaPrevia = useRef(pagina);
  useEffect(() => {
    if (paginaPrevia.current !== pagina) {
      paginaPrevia.current = pagina;
      window.scrollTo(0, 0);
    }
  }, [pagina]);

  // Entrada en cascada al llegar a cada página (no en las actualizaciones periódicas)
  const [animar, setAnimar] = useState(true);
  const [paginaAnimada, setPaginaAnimada] = useState(pagina);
  if (paginaAnimada !== pagina) {
    setPaginaAnimada(pagina);
    setAnimar(true);
  }
  const hayDatos = Boolean(data);
  useEffect(() => {
    if (!hayDatos || !animar) return undefined;
    const t = setTimeout(() => setAnimar(false), 1400);
    return () => clearTimeout(t);
  }, [hayDatos, animar, pagina]);

  // Ctrl/Cmd + clic o clic del medio: dejar que el navegador abra otra pestaña
  const conModificador = (e) => e && (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0);
  const hrefCategoria = (cat) => `?${new URLSearchParams({ cat: cat.nombre })}`;
  const abrirCategoria = (cat, e) => {
    if (conModificador(e)) return;
    e?.preventDefault();
    setSearchParams({ cat: cat.nombre }, { state: { desdeInicio: true } });
  };
  const volverAlInicio = (e) => {
    if (conModificador(e)) return;
    e?.preventDefault();
    if (location.state?.desdeInicio) navigate(-1);
    else setSearchParams({});
  };
  const cambiarRonda = (id) => {
    const i = (categoria?.eliminatoria || []).findIndex((f) => f.id === id);
    if (i < 0) return;
    setSearchParams({ cat: categoria.nombre, ronda: String(i + 1) }, { replace: true, state: location.state });
  };

  // Búsqueda en la URL: ?buscar=<texto>
  const buscarParam = searchParams.get('buscar');
  const busquedaEnUrl = searchParams.has('buscar');
  const busquedaAbierta = busquedaEnUrl || busquedaInmediata;

  useEffect(() => {
    if (busquedaEnUrl) setBusquedaInmediata(false);
  }, [busquedaEnUrl]);

  const abrirBusqueda = () => {
    // El teclado móvil necesita el campo y su foco dentro del gesto de la lupa.
    flushSync(() => setBusquedaInmediata(true));
    document.querySelector('.pv-busqueda-input')?.focus({ preventScroll: true });
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('buscar', '');
        return next;
      },
      { state: { ...location.state, busquedaDesdeApp: true } }
    );
  };

  const actualizarBusqueda = (nuevaQuery) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (nuevaQuery) {
          next.set('buscar', nuevaQuery);
        } else {
          next.set('buscar', '');
        }
        return next;
      },
      { replace: true, state: location.state }
    );
  };

  const cerrarBusqueda = () => {
    setBusquedaInmediata(false);
    if (location.state?.busquedaDesdeApp) {
      navigate(-1);
    } else {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('buscar');
          return next;
        },
        { replace: true }
      );
    }
  };

  const toggleSeguir = (catId, parejaId) => {
    if (!slug || !catId || !parejaId) return;
    const esActual = favs[catId] === parejaId;
    const nuevoId = esActual ? null : parejaId;
    setFavPareja(slug, catId, nuevoId);
    setFavs((prev) => {
      const next = { ...prev };
      if (nuevoId) next[catId] = nuevoId;
      else delete next[catId];
      return next;
    });
  };

  const abrirCategoriaDesdeBusqueda = (cat, e) => {
    if (conModificador(e)) return;
    e?.preventDefault();
    setSearchParams({ cat: cat.nombre }, { replace: true });
  };

  // Parejas seguidas, para la línea del inicio
  const seguidas = categorias
    .filter((c) => favs[c.id])
    .map((c) => ({ cat: c, parejaId: favs[c.id], nombre: nombreDePareja(c, favs[c.id]) }))
    .filter((s) => s.nombre);

  // Aviso de resultados nuevos: en una categoría, sus partidos (o los de su pareja seguida);
  // en el inicio, solo los de la pareja seguida
  const avisoCat = categoria || seguidas[0]?.cat || null;
  const avisoPareja = categoria ? favs[categoria.id] || null : seguidas[0]?.parejaId || null;
  const aviso = useAvisoResultados(data, avisoCat, avisoPareja);

  if (loading) {
    return <TorneoPublicSkeleton />;
  }

  if (error) {
    return (
      <div className="publico">
        <div className="pv-envolver" style={{ paddingTop: 64, textAlign: 'center' }}>
          <AlertTriangle size={32} strokeWidth={2} style={{ color: 'var(--alerta)', marginBottom: 12 }} aria-hidden="true" />
          <p style={{ color: 'var(--tinta-2)' }}>{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { torneo } = data;
  const actualizacion = <UltimaActualizacion timestamp={lastUpdated} />;

  return (
    <div className={`publico ${categoria ? 'pv-pagina-cat' : ''}`}>
      <a className="pv-saltar" href="#contenido">Saltar al contenido</a>
      <Barra volver={categoria ? { href: '?', onClick: volverAlInicio } : null} onBuscar={abrirBusqueda} />

      <div id="contenido" tabIndex={-1} className="pv-contenido">
        {categoria ? (
          <Categoria
            key={categoria.id}
            categoria={categoria}
            torneoNombre={torneo.nombre}
            torneoEstado={torneo.estado}
            seguidaId={favs[categoria.id] || null}
            isMobile={isMobile}
            rondaId={rondaId}
            onCambiarRonda={cambiarRonda}
            animar={animar}
            actualizacion={actualizacion}
            seccionInicial={seccionInicial.current}
          />
        ) : (
          <Inicio
            torneo={torneo}
            categorias={categorias}
            fechas={rangoFechas(diasDelTorneo(categorias))}
            seguidas={seguidas}
            hrefCategoria={hrefCategoria}
            onAbrirCategoria={abrirCategoria}
            animar={animar}
            actualizacion={actualizacion}
          />
        )}
      </div>

      {busquedaAbierta && (
        <Busqueda
          categorias={categorias}
          queryInicial={buscarParam || ''}
          onCerrar={cerrarBusqueda}
          onCambiarQuery={actualizarBusqueda}
          favs={favs}
          onToggleSeguir={toggleSeguir}
          hrefCategoria={hrefCategoria}
          onAbrirCategoria={abrirCategoriaDesdeBusqueda}
        />
      )}

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
