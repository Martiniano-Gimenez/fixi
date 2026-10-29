import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { AlertTriangle, Users, Trophy, Clock, Search, X, Play } from 'lucide-react';
import { formatPartidoHorario } from '../../utils/dateUtils';
import { APP_NAME, APP_TAGLINE } from '../../constants/app';
import './publico/publico.css';
import Encabezado from './publico/Encabezado';
import NavSecciones from './publico/NavSecciones';
import Segmentado from './publico/Segmentado';
import TarjetaPartido, { Estrella } from './publico/TarjetaPartido';
import TablaZona from './publico/TablaZona';
import ListaAnimada from './publico/ListaAnimada';
import LlaveEscritorio from './publico/LlaveEscritorio';
import useAvisoResultados from './publico/useAvisoResultados';
import {
  DIAS_LARGOS,
  campeones,
  cifrasTorneo,
  diaDe,
  diaDeHoy,
  diasDelTorneo,
  horaPartido,
  clasificadosPorOrigen,
  ladoDe,
  normalizar,
  partidoCoincide,
  partidosDeCategoria,
  parejasQueCoinciden,
  porHorario,
  nombreJornada,
  rangoFechas,
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
  const [diaSel, setDiaSel] = useState(() => searchParams.get('dia')); // jornada elegida en Horarios (YYYY-MM-DD)
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
      if (sec === 'horarios' && diaSel) p.set('dia', diaSel);
      if (searchTerm) p.set('pareja', searchTerm);
      return p.toString();
    },
    [activeCategoria, zonas, eliminatoria, activeZoneId, activeRoundId, searchTerm, diaSel]
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
  const fechasTorneo = rangoFechas(diasDelTorneo(categorias)); // por jornadas; null si hay una sola
  const enVivo = categorias.some((c) => partidosDeCategoria(c).some((p) => p.estado === 'EN_CURSO'));
  const listaCampeones = torneo.estado === 'FINALIZADO' ? campeones(categorias) : [];
  const partidosCat = partidosDeCategoria(activeCategoria);
  const origenes = clasificadosPorOrigen(activeCategoria); // "1° Zona A" → pareja, si su zona ya terminó
  const partidosFiltrados = partidosCat.filter((p) => partidoCoincide(p, q, origenes));
  const parejasCat = coincidencias.filter((x) => x.catId === activeCategoria?.id);
  const unaPareja = new Set(parejasCat.map((x) => x.nombre)).size === 1 ? parejasCat[0] : null;
  const cascada = (i) => (animarEntrada ? { className: 'pv-cascada', style: { '--i': i } } : {});
  const conCascada = (clase, i) => ({ className: `${clase}${animarEntrada ? ' pv-cascada' : ''}`, style: animarEntrada ? { '--i': i } : undefined });
  const tarjeta = (conDia) => (p) => (
    <TarjetaPartido partido={p} etiqueta={p.etiqueta} conDia={conDia} seguidaId={favParejaId} origenes={origenes} />
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
        <button type="button" className="pv-btn pv-btn-secundario" onClick={() => { if (prox) setDiaSel(diaDe(prox)); setSeccion('horarios'); }}>Ver horarios</button>
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
                render={(pt) => <TarjetaPartido partido={pt} etiqueta={pt.etiqueta} conDia={false} seguidaId={favParejaId} origenes={origenes} atrasado />}
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

  // ─── Cuadro ───
  const RONDA_CORTA = { 32: '16avos', 16: 'Octavos', 8: 'Cuartos', 4: 'Semis', 2: 'Final', 1: 'Final' };
  const vistaCuadro = () => {
    if (!eliminatoria.length) return <p className="pv-vacio">El cuadro se arma cuando terminan las zonas.</p>;
    // La búsqueda también encuentra a la pareja por su lugar ("1° Zona A") cuando su zona ya terminó
    const coincideLlave = (p) => partidoCoincide(p, q, origenes);
    const enLlave = (f) => f.partidos.some((p) => !p.esBye && coincideLlave(p));
    const fasesConPareja = eliminatoria.filter(enLlave);

    // Mensaje cuando la búsqueda no aparece en el cuadro (o en la ronda elegida)
    const mensajeCuadro = (fase) => {
      if (!q || !partidosFiltrados.length) return null;
      if (fase ? enLlave(fase) : fasesConPareja.length) return null;
      const pasaDirecto = fase && fase.partidos.some((p) => p.esBye && coincideLlave(p));
      if (fase && fasesConPareja.length) {
        if (pasaDirecto) {
          const sig = fasesConPareja[0];
          return mensajeVacio(
            <>{quien} pasa directo a {fraseFase(sig.nombre).toLowerCase()}.</>,
            <button type="button" className="pv-btn pv-btn-secundario" onClick={() => setActiveRoundId(sig.id)}>
              Ver {fraseFase(sig.nombre).toLowerCase()}
            </button>
          );
        }
        return mensajeVacio(
          <>{quien} {verbo} en {fraseFase(fase.nombre).toLowerCase()}.</>,
          fasesConPareja.map((f) => (
            <button key={f.id} type="button" className="pv-btn pv-btn-secundario" onClick={() => setActiveRoundId(f.id)}>
              Ver {fraseFase(f.nombre).toLowerCase()}
            </button>
          ))
        );
      }
      if (!unaPareja) return mensajeVacio(<>Ninguna pareja con “{q}” está en el cuadro todavía.</>);
      const z = zonas.find((x) => x.id === unaPareja.zonaId);
      if (!z) return null;
      const pos = (z.tabla || []).findIndex((r) => r.parejaId === unaPareja.parejaId) + 1;
      const terminada = (z.partidos || []).length > 0 && z.partidos.every((p) => p.estado === 'FINALIZADO');
      const texto = terminada && pos > z.clasifican
        ? <>{quien} quedó afuera en la zona {letraZona(z)} (terminó {pos}.°).</>
        : <>{quien} todavía no está en el cuadro: los cruces se completan cuando termina la zona {letraZona(z)}.</>;
      return mensajeVacio(
        texto,
        <button type="button" className="pv-btn pv-btn-secundario" onClick={() => { setActiveZoneId(z.id); setSeccion('zonas'); }}>
          Ver la zona {letraZona(z)}
        </button>
      );
    };

    // Escritorio: la llave completa
    if (!isMobile) {
      return (
        <>
          {mensajeCuadro(null)}
          <div {...cascada(5)}>
            <LlaveEscritorio fases={eliminatoria} seguidaId={favParejaId} coincide={q ? coincideLlave : null} origenes={origenes} />
          </div>
        </>
      );
    }

    // Celular: una ronda por vez, con selector
    const fase = activeFaseMobile;
    const idx = Math.max(0, eliminatoria.findIndex((f) => f.id === fase.id));
    const reales = fase.partidos.filter((p) => !p.esBye);
    const visibles = reales.filter((p) => !q || coincideLlave(p));
    const byes = fase.partidos.filter((p) => p.esBye);
    const siguiente = eliminatoria[idx + 1];
    return (
      <>
        <div {...cascada(5)}>
          <Segmentado
            items={eliminatoria.map((f) => ({ key: f.id, label: RONDA_CORTA[f.ronda] || fraseFase(f.nombre), aria: fraseFase(f.nombre) }))}
            activo={idx}
            etiqueta="Rondas del cuadro"
            onCambiar={(i) => setActiveRoundId(eliminatoria[i].id)}
          />
        </div>
        <div key={fase.id} {...conCascada('pv-entra', 6)}>
          <h2 className="pv-titulo-sec" style={{ marginTop: 'var(--e-5)' }}>
            {fraseFase(fase.nombre)} <small>{reales.length} {reales.length === 1 ? 'partido' : 'partidos'}</small>
          </h2>
          {mensajeCuadro(fase)}
          {visibles.length > 0
            ? <ListaAnimada items={visibles} clave={claveTarjeta} render={(p) => <TarjetaPartido partido={p} seguidaId={favParejaId} origenes={origenes} clase={q ? 'destacada' : ''} />} />
            : !q && <p className="pv-vacio">Sin partidos en esta ronda.</p>}
          {byes.length > 0 && (
            <div className="pv-directo">
              <p>Pasan directo a {siguiente ? fraseFase(siguiente.nombre).toLowerCase() : 'la ronda siguiente'}:</p>
              <div className="pv-chips">
                {byes.map((p) => {
                  const lado = ladoDe(p, p.pareja2 && !p.pareja1 ? 2 : 1, origenes);
                  const seguida = favParejaId && lado.parejaId === favParejaId;
                  return (
                    <span key={p.id} className={`pv-chip ${lado.origen ? 'con-origen' : ''} ${q && coincideLlave(p) ? 'coincide' : ''} ${seguida ? 'seguida' : ''}`} translate="no">
                      {lado.nombre}
                      {lado.origen && <small>{lado.origen}</small>}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </>
    );
  };

  // ─── Horarios ───
  const vistaHorarios = () => {
    const dias = diasDelTorneo(categorias); // por jornada: la madrugada cuenta para el día anterior
    if (!dias.length) return <p className="pv-vacio">Todavía no hay partidos con horario en este torneo.</p>;
    const hoy = diaDeHoy(dias);
    const diaActivo = dias.find((d) => d.key === diaSel) || dias.find((d) => d.key === hoy?.key) || dias[0];
    const idx = dias.indexOf(diaActivo);
    const conteo = (d) => partidosCat.filter((p) => diaDe(p) === d.key).length;
    const items = dias.map((d) => ({
      key: d.key,
      label: <>{d.diaNombre}<small className="num">{conteo(d)}</small></>,
      aria: `${d.diaNombre}, ${conteo(d)} partidos`,
    }));
    const nombreDia = diaActivo.diaNombre.toLowerCase();
    const delDia = partidosFiltrados.filter((p) => diaDe(p) === diaActivo.key).sort(porHorario);
    const sinHora = partidosCat.filter((p) => !p.fechaHora).length;
    const ahora = Date.now();

    // Con una búsqueda: todos los partidos de la pareja juntos, por jornada, sin selector de días.
    // El día elegido (diaSel) no cambia, así que al borrar la búsqueda se vuelve a ese día.
    if (q) {
      if (!partidosFiltrados.length) return null; // el buscador ya explica que no hay coincidencias
      const grupos = dias
        .map((d) => ({ d, ps: partidosFiltrados.filter((p) => diaDe(p) === d.key).sort(porHorario) }))
        .filter((g) => g.ps.length);
      const sinHorario = partidosFiltrados.filter((p) => !p.fechaHora);
      const lista = (ps, clave) => (
        <ListaAnimada
          key={clave}
          items={ps}
          clave={claveTarjeta}
          className="pv-lista grilla"
          render={(p) => (
            <TarjetaPartido partido={p} etiqueta={p.etiqueta} conDia={false} seguidaId={favParejaId} origenes={origenes} atrasado={sinResultado(p, ahora)} />
          )}
        />
      );
      return (
        <div className="pv-entra">
          {grupos.map(({ d, ps }) => (
            <section key={d.key} aria-label={nombreJornada(d)}>
              <h2 className="pv-titulo-sec">
                {nombreJornada(d)} <small>{ps.length} {ps.length === 1 ? 'partido' : 'partidos'}</small>
              </h2>
              {lista(ps, d.key)}
            </section>
          ))}
          {sinHorario.length > 0 && (
            <section aria-label="A definir">
              <h2 className="pv-titulo-sec">
                A definir <small>sin horario todavía</small>
              </h2>
              {lista(sinHorario, 'sin-horario')}
            </section>
          )}
        </div>
      );
    }

    return (
      <>
        <div {...cascada(5)}>
          <Segmentado items={items} activo={idx} etiqueta="Días" onCambiar={(i) => setDiaSel(dias[i].key)} />
        </div>
        <div key={diaActivo.key} {...conCascada('pv-entra', 6)}>
          <div style={{ marginTop: 'var(--e-4)' }}>
            {delDia.length > 0 ? (
              <ListaAnimada
                items={delDia}
                clave={claveTarjeta}
                className="pv-lista grilla"
                render={(p) => (
                  <TarjetaPartido
                    partido={p}
                    etiqueta={p.etiqueta}
                    conDia={false}
                    seguidaId={favParejaId}
                    origenes={origenes}
                    atrasado={sinResultado(p, ahora)}
                  />
                )}
              />
            ) : (
              <p className="pv-vacio">No hay partidos el {nombreDia} en esta categoría.</p>
            )}
          </div>
          {sinHora > 0 && !q && (
            <p className="pv-nota">
              {sinHora} {sinHora === 1 ? 'partido del cuadro todavía no tiene' : 'partidos del cuadro todavía no tienen'} horario: se programan cuando terminan las zonas.
            </p>
          )}
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
        fechas={fechasTorneo}
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

      <main id="contenido" tabIndex={-1} className={`pv-envolver pv-main ${seccion === 'cuadro' && !isMobile ? 'pv-main-ancho' : ''}`}>
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
            {seccion === 'cuadro' && vistaCuadro()}
            {seccion === 'horarios' && vistaHorarios()}
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
