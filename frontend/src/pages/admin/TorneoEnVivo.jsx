import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  CloudRain,
  Sun,
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  X,
  Flame,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  ClipboardList,
  Trophy,
  Play,
  RotateCcw,
  Zap,
  GitBranch,
  Calendar,
  Layers,
  Moon,
} from 'lucide-react';
import { api } from '../../api/client';
import ConfirmModal from '../../components/ConfirmModal';
import ResultadoModal from '../../components/ResultadoModal';
import PartidosPendientesSection from '../../components/PartidosPendientesSection';
import { formatDiaHorario, formatDiaNombre, formatHora, getDiaCalendarioConTrasnoche } from '../../utils/dateUtils';

export default function TorneoEnVivo() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  // Selector de canchas para override
  const [targetCanchas, setTargetCanchas] = useState(1);
  const [userTouchedTarget, setUserTouchedTarget] = useState(false);

  // Modales de confirmación
  const [confirmReducirOpen, setConfirmReducirOpen] = useState(false);
  const [confirmRestaurarOpen, setConfirmRestaurarOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Feedback post-reprogramación
  const [feedbackReprogramacion, setFeedbackReprogramacion] = useState(null);
  const [feedbackExpanded, setFeedbackExpanded] = useState(true);

  // Estado de carga por partido al alternar estado
  const [updatingPartidoId, setUpdatingPartidoId] = useState(null);

  // Toggle de canchas fantasma
  const [fantasmaExpanded, setFantasmaExpanded] = useState(true);

  // ResultadoModal
  const [partidoParaResultado, setPartidoParaResultado] = useState(null);

  // Sección de finalizados colapsada por default
  const [finalizadosExpanded, setFinalizadosExpanded] = useState(false);

  // Tab activo de Próximos Partidos (por día calendario)
  const [activeTabDay, setActiveTabDay] = useState(null);

  // Cruces
  const [generandoCrucesCatId, setGenerandoCrucesCatId] = useState(null);
  const [alertaEliminatoria, setAlertaEliminatoria] = useState(null);

  // Referencia al interval de polling — permite resetearlo tras un fetch manual
  const intervalRef = useRef(null);
  const POLLING_MS = 30000;

  const startPolling = useCallback((fetchFn) => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => fetchFn(true), POLLING_MS);
  }, []);

  // Cargar estado en vivo
  const fetchEnVivoData = useCallback(
    async (isSilent = false) => {
      if (!isSilent) setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const res = await api.get(`/torneos/${id}/en-vivo`);
        setData(res);
      } catch (err) {
        setError(err.message || 'Error al cargar el estado en vivo del torneo');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [id]
  );

  useEffect(() => {
    fetchEnVivoData();
    startPolling(fetchEnVivoData);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchEnVivoData, startPolling]);

  // Fetch manual que resetea el timer para evitar doble disparo
  const fetchAndResetPolling = useCallback(async () => {
    await fetchEnVivoData(true);
    startPolling(fetchEnVivoData);
  }, [fetchEnVivoData, startPolling]);

  const handleGenerarCruces = async (categoriaId, categoriaNombre) => {
    setGenerandoCrucesCatId(categoriaId);
    setAlertaEliminatoria(null);
    try {
      const res = await api.post(`/categorias/${categoriaId}/generar-eliminatoria`);
      if (res.esDieciseisavos) {
        setAlertaEliminatoria({
          tipo: 'warning',
          esDieciseisavos: true,
          mensaje: `Clasificados asignados al bracket de "${categoriaNombre}". Al jugarse el sábado a la noche, los dieciseisavos requieren asignación manual de horario en Partidos Pendientes.`,
        });
      } else {
        const cant = res.schedulingResult?.partidosAgendados ?? 0;
        setAlertaEliminatoria({
          tipo: 'success',
          esDieciseisavos: false,
          mensaje: `¡Clasificados asignados para "${categoriaNombre}"! ${cant > 0 ? `${cant} partidos de primera ronda fueron agendados automáticamente para el domingo.` : 'Cruces listos para el domingo.'}`,
        });
      }
      await fetchEnVivoData(true);
    } catch (err) {
      setAlertaEliminatoria({
        tipo: 'error',
        esDieciseisavos: false,
        mensaje: err.message || `Error al asignar clasificados para "${categoriaNombre}".`,
      });
    } finally {
      setGenerandoCrucesCatId(null);
    }
  };


  // Manejar reducción de canchas
  const handleReducir = async () => {
    setActionLoading(true);
    setError(null);
    try {
      const res = await api.post(`/torneos/${id}/canchas-override`, {
        canchasDisponiblesOverride: targetCanchas,
        diaKey: activeTabDay,
      });

      setConfirmReducirOpen(false);
      setUserTouchedTarget(false);
      if (res.reprogramacion && res.reprogramacion.ejecutada) {
        setFeedbackReprogramacion(res.reprogramacion);
        setFeedbackExpanded(true);
      }
      await fetchEnVivoData(true);
      startPolling(fetchEnVivoData);
    } catch (err) {
      setError(err.message || 'Error al reprogramar por reducción de canchas');
      setConfirmReducirOpen(false);
    } finally {
      setActionLoading(false);
    }
  };

  // Manejar restauración de canchas
  const handleRestaurar = async () => {
    setActionLoading(true);
    setError(null);
    try {
      await api.post(`/torneos/${id}/canchas-override`, {
        canchasDisponiblesOverride: null,
        diaKey: activeTabDay,
      });

      setConfirmRestaurarOpen(false);
      setTargetCanchas(canchasClub);
      setUserTouchedTarget(false);
      setFeedbackReprogramacion(null);
      await fetchAndResetPolling();
    } catch (err) {
      setError(err.message || 'Error al restaurar las canchas');
      setConfirmRestaurarOpen(false);
    } finally {
      setActionLoading(false);
    }
  };

  // Manejar cambio rápido de estado (PENDIENTE <-> EN_CURSO)
  const handleCambiarEstado = async (partidoId, nuevoEstado) => {
    setUpdatingPartidoId(partidoId);
    setError(null);
    try {
      await api.patch(`/partidos/${partidoId}/estado`, { estado: nuevoEstado });
      await fetchAndResetPolling();
    } catch (err) {
      setError(err.message || 'Error al actualizar el estado del partido');
    } finally {
      setUpdatingPartidoId(null);
    }
  };

  const horariosClub = data?.torneo?.horariosClub || null;
  const torneo = data?.torneo || null;
  const canchasClub = data?.canchasClub || 1;

  // Derivar jornadas disponibles (Viernes, Sábado, Domingo garantizados a partir de torneo.fecha + partidos)
  const jornadasDisponibles = useMemo(() => {
    if (!data) return [];
    const map = new Map();

    // 1. Siempre incluir los 3 días canónicos a partir de torneo.fecha
    if (data.torneo?.fecha) {
      const refFecha = new Date(data.torneo.fecha);
      if (!isNaN(refFecha.getTime())) {
        for (let i = 0; i < 3; i++) {
          const d = new Date(refFecha.getTime() + i * 24 * 3600 * 1000);
          const info = getDiaCalendarioConTrasnoche(d, horariosClub);
          if (info && !map.has(info.key)) {
            map.set(info.key, {
              key: info.key,
              label: info.label,
              diaNombre: info.diaNombre,
              diaNumero: info.diaNumero,
              totalPartidos: 0,
              enCursoCount: 0,
              proximosCount: 0,
              finalizadosCount: 0,
            });
          }
        }
      }
    }

    // 2. Registrar partidos en sus jornadas respectivas
    const registrar = (p, tipo) => {
      if (!p.fechaHora) return;
      const info = getDiaCalendarioConTrasnoche(p.fechaHora, horariosClub);
      if (!info) return;
      if (!map.has(info.key)) {
        map.set(info.key, {
          key: info.key,
          label: info.label,
          diaNombre: info.diaNombre,
          diaNumero: info.diaNumero,
          totalPartidos: 0,
          enCursoCount: 0,
          proximosCount: 0,
          finalizadosCount: 0,
        });
      }
      const entry = map.get(info.key);
      entry.totalPartidos++;
      if (tipo === 'EN_CURSO') entry.enCursoCount++;
      else if (tipo === 'PROXIMO') entry.proximosCount++;
      else if (tipo === 'FINALIZADO') entry.finalizadosCount++;
    };

    (data.partidosEnCurso || []).forEach((p) => registrar(p, 'EN_CURSO'));
    (data.proximosPartidos || []).forEach((p) => registrar(p, 'PROXIMO'));
    (data.partidosFinalizados || []).forEach((p) => registrar(p, 'FINALIZADO'));

    return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [data, horariosClub]);

  // Selección inteligente por defecto del tab
  useEffect(() => {
    if (jornadasDisponibles.length === 0) return;

    if (activeTabDay === 'TODO' || (activeTabDay && jornadasDisponibles.some((j) => j.key === activeTabDay))) {
      return;
    }

    // Prioridad 1: Día con partido en curso actualmente
    const primerEnCurso = (data?.partidosEnCurso || []).find((p) => p.fechaHora);
    if (primerEnCurso) {
      const info = getDiaCalendarioConTrasnoche(primerEnCurso.fechaHora, horariosClub);
      if (info && jornadasDisponibles.some((j) => j.key === info.key)) {
        setActiveTabDay(info.key);
        return;
      }
    }

    // Prioridad 2: Primer día con partidos pendientes
    const primerPendiente = (data?.proximosPartidos || []).find((p) => p.fechaHora);
    if (primerPendiente) {
      const info = getDiaCalendarioConTrasnoche(primerPendiente.fechaHora, horariosClub);
      if (info && jornadasDisponibles.some((j) => j.key === info.key)) {
        setActiveTabDay(info.key);
        return;
      }
    }

    // Prioridad 3: Primer día canónico del torneo
    setActiveTabDay(jornadasDisponibles[0].key);
  }, [jornadasDisponibles, activeTabDay, data, horariosClub]);

  const activeJornadaInfo = useMemo(() => {
    if (!activeTabDay || activeTabDay === 'TODO') return null;
    return jornadasDisponibles.find((j) => j.key === activeTabDay) || null;
  }, [activeTabDay, jornadasDisponibles]);

  const esModoTodo = activeTabDay === 'TODO';
  const esViernes = activeJornadaInfo?.diaNombre === 'Viernes';
  const esSabado = activeJornadaInfo?.diaNombre === 'Sábado';
  const esDomingo = activeJornadaInfo?.diaNombre === 'Domingo';

  // Partidos en curso filtrados
  const partidosEnCursoFiltrados = useMemo(() => {
    const list = data?.partidosEnCurso || [];
    if (esModoTodo) return list;
    return list.filter((p) => {
      if (!p.fechaHora) return true;
      const info = getDiaCalendarioConTrasnoche(p.fechaHora, horariosClub);
      return info?.key === activeTabDay;
    });
  }, [data?.partidosEnCurso, esModoTodo, activeTabDay, horariosClub]);

  // Partidos en curso en otra jornada
  const partidosEnCursoOtraJornada = useMemo(() => {
    if (esModoTodo) return [];
    const list = data?.partidosEnCurso || [];
    return list.filter((p) => {
      if (!p.fechaHora) return false;
      const info = getDiaCalendarioConTrasnoche(p.fechaHora, horariosClub);
      return info?.key !== activeTabDay;
    });
  }, [data?.partidosEnCurso, esModoTodo, activeTabDay, horariosClub]);

  // Próximos partidos filtrados
  const proximosFiltrados = useMemo(() => {
    const list = data?.proximosPartidos || [];
    if (esModoTodo) return list;
    return list.filter((p) => {
      if (!p.fechaHora) return false;
      const info = getDiaCalendarioConTrasnoche(p.fechaHora, horariosClub);
      return info?.key === activeTabDay;
    });
  }, [data?.proximosPartidos, esModoTodo, activeTabDay, horariosClub]);

  // Partidos finalizados filtrados
  const finalizadosFiltrados = useMemo(() => {
    const list = data?.partidosFinalizados || [];
    if (esModoTodo) return list;
    return list.filter((p) => {
      if (!p.fechaHora) return false;
      const info = getDiaCalendarioConTrasnoche(p.fechaHora, horariosClub);
      return info?.key === activeTabDay;
    });
  }, [data?.partidosFinalizados, esModoTodo, activeTabDay, horariosClub]);

  // Partidos por jugar que terminan después del cierre del club (Modo Lluvia).
  // La marca la calcula el backend en getEstadoEnVivo (solo admin; nunca en la vista pública).
  const fueraDeHorarioFiltrados = useMemo(
    () => [...partidosEnCursoFiltrados, ...proximosFiltrados].filter((p) => (p.minutosDespuesDelCierre || 0) > 0),
    [partidosEnCursoFiltrados, proximosFiltrados]
  );
  const cierreClubContextual = esViernes ? horariosClub?.viernesFin : esSabado ? horariosClub?.sabadoFin : null;

  // Resumen estadístico contextual
  const resumenContextual = useMemo(() => {
    if (esModoTodo || !data) return data?.resumenEstado || {};
    return {
      totalPartidos: partidosEnCursoFiltrados.length + proximosFiltrados.length + finalizadosFiltrados.length,
      enCurso: partidosEnCursoFiltrados.length,
      pendientesConHorario: proximosFiltrados.length,
      finalizados: finalizadosFiltrados.length,
      pendientesSinHorario: esSabado ? (data?.resumenEstado?.pendientesSinHorario || 0) : 0,
      enCanchaFantasma: (data?.partidosEnCanchaFantasma || []).filter((p) => {
        const info = getDiaCalendarioConTrasnoche(p.fechaHora, horariosClub);
        return info?.key === activeTabDay;
      }).length,
    };
  }, [esModoTodo, data, partidosEnCursoFiltrados, proximosFiltrados, finalizadosFiltrados, esSabado, horariosClub, activeTabDay]);

  // Modelo independiente por jornada: las canchas de cada día salen solo de canchasPorDia
  const diaInfoContextual = (activeTabDay && data?.canchasPorDia?.[activeTabDay]) || null;

  // Jornadas con lluvia (menos canchas que el club), en orden cronológico, para el resumen de la pestaña "TODO"
  const diasConLluvia = Object.entries(data?.canchasPorDia || {})
    .filter(([, d]) => d && d.canchas < canchasClub)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, d]) => ({
      key,
      canchas: d.canchas,
      nombre: jornadasDisponibles.find((j) => j.key === key)?.diaNombre || key,
    }));
  const anyDayHasLluvia = diasConLluvia.length > 0;

  // La solapa visible está bajo modo lluvia si su jornada tiene menos canchas que el club
  const isTabBajoOverride = diaInfoContextual ? diaInfoContextual.canchas < canchasClub : false;

  // Canchas activas de la solapa de día seleccionada
  const canchasActivasContextuales = diaInfoContextual ? diaInfoContextual.canchas : canchasClub;

  const diaLluviaNombre = activeJornadaInfo?.diaNombre
    || (diaInfoContextual?.activoDesde ? formatDiaNombre(diaInfoContextual.activoDesde) : null);

  // Canchas activas de la jornada de un partido (para el aviso de cancha fantasma)
  const canchasDeLaJornadaDe = (fechaHora) => {
    const key = fechaHora ? getDiaCalendarioConTrasnoche(fechaHora, horariosClub)?.key : null;
    return key ? data?.canchasPorDia?.[key]?.canchas ?? canchasClub : canchasClub;
  };

  const prevTabDayRef = useRef(activeTabDay);

  // Sincronizar el selector de canchas con la cantidad de canchas activas contextuales de la solapa seleccionada
  useEffect(() => {
    if (!data) return;
    const tabChanged = prevTabDayRef.current !== activeTabDay;
    prevTabDayRef.current = activeTabDay;

    // Solo resetear targetCanchas si cambió de solapa o si el usuario no está manipulando el selector
    if (tabChanged || !userTouchedTarget) {
      setTargetCanchas(canchasActivasContextuales);
      if (tabChanged) {
        setUserTouchedTarget(false);
      }
    }
  }, [activeTabDay, canchasActivasContextuales, data, userTouchedTarget]);

  if (loading && !data) {
    return (
      <div className="dt-screen dt-loading">
        <div className="dt-center">
          <RefreshCw size={36} className="dt-loading-icon dt-spin" />
          <p className="dt-muted">
            Cargando estado en vivo del torneo...
          </p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="dt-screen dt-error-page">
        <AlertTriangle size={48} className="dt-error-icon" />
        <h2 className="dt-error-title">No se pudo cargar el día de torneo</h2>
        <p className="dt-muted">
          {error}
        </p>
        <div className="dt-actions dt-centered">
          <button type="button" className="dt-button" onClick={() => navigate(`/admin/torneos/${id}`)}>
            Volver al torneo
          </button>
          <button type="button" className="dt-button dt-primary" onClick={() => fetchEnVivoData()}>
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  const { partidosEnCanchaFantasma, partidosFinalizados } = data;

  // Determinar el día lógico de los cambios en feedbackReprogramacion para no mostrarlo en otros tabs
  let feedbackDiaKey = null;
  if (feedbackReprogramacion) {
    if (feedbackReprogramacion.overrideDiaKey) {
      feedbackDiaKey = feedbackReprogramacion.overrideDiaKey;
    } else {
      const primerCambio = feedbackReprogramacion.cambios?.[0];
      const tsCambio = primerCambio?.despues?.fechaHora || primerCambio?.antes?.fechaHora;
      if (tsCambio) {
        feedbackDiaKey = getDiaCalendarioConTrasnoche(tsCambio, horariosClub)?.key || null;
      }
    }
  }

  let feedbackDiaNombre = null;
  if (feedbackReprogramacion) {
    if (feedbackReprogramacion.diaNombre) {
      feedbackDiaNombre = feedbackReprogramacion.diaNombre;
    } else if (feedbackDiaKey) {
      feedbackDiaNombre = jornadasDisponibles.find((d) => d.key === feedbackDiaKey)?.label || null;
    }
  }

  // Aviso de partidos que terminan después del cierre del club (en la tarjeta de canchas)
  const avisoFueraDeHorario = fueraDeHorarioFiltrados.length > 0 ? (
    <p
      className="dt-after-hours"
    >
      <Moon size={13} className="dt-icon" />
      <span>
        {fueraDeHorarioFiltrados.length}{' '}
        {fueraDeHorarioFiltrados.length === 1 ? 'partido termina' : 'partidos terminan'} después del cierre del club
        {cierreClubContextual ? ` (${cierreClubContextual})` : ''}
      </span>
    </p>
  ) : null;

  // La tarjeta de feedback solo es visible si coincide con el tab de la jornada afectada
  const isFeedbackVisible = Boolean(
    feedbackReprogramacion && (!activeTabDay || !feedbackDiaKey || activeTabDay === feedbackDiaKey)
  );

  // Construye el objeto partido que espera ResultadoModal a partir de los datos del en-vivo
  function buildPartidoParaModal(p) {
    return {
      id: p.id,
      estado: p.estado,
      pareja1: p.pareja1Obj,
      pareja2: p.pareja2Obj,
      sets: p.sets || [],
    };
  }


  return (
    <div className="dt-container">
      <div className="dt-screen">
      {/* ─── 1. Header de Navegación y En Vivo ─────────────────────── */}
      <div
        className="dt-heading"
      >
        <div className="dt-heading-main">
          <Link
            to={`/admin/torneos/${id}`}
            className="dt-button dt-icon-button"
            title="Volver al detalle del torneo"
          >
            <ArrowLeft size={18} />
          </Link>
          <div>
            <div className="dt-title-row">
              <h1 className="dt-title">Día de torneo</h1>
              <span
                className="dt-badge dt-blue"
              >
                <span
                  className="dt-dot dt-blue-dot"
                />
                En vivo
              </span>
            </div>
            <p className="dt-muted">
              {torneo.nombre}
            </p>
          </div>
        </div>

        <div className="dt-actions">
          {torneo.slug && (
            <Link
              to={`/torneo/${torneo.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="dt-button"
              title="Abrir vista pública del torneo en una pestaña nueva"
            >
              <ExternalLink size={14} />
              <span>Vista pública</span>
            </Link>
          )}

          <button
            type="button"
            onClick={() => fetchEnVivoData(true)}
            disabled={refreshing}
            className="dt-button dt-primary"
          >
            <RefreshCw size={14} className={refreshing ? 'dt-spin' : ''} />
            {refreshing ? 'Actualizando...' : 'Actualizar ahora'}
          </button>
        </div>
      </div>

      {/* ─── Selector Global de Jornada ─────────────────────────────── */}
      {jornadasDisponibles.length > 0 && (
        <div
          className="dt-days"
        >
          {jornadasDisponibles.map((jornada) => {
            const isActive = activeTabDay === jornada.key;
            const hasLive = jornada.enCursoCount > 0;

            return (
              <button
                key={jornada.key}
                type="button"
                onClick={() => {
                  setActiveTabDay(jornada.key);
                  setUserTouchedTarget(false);
                }}
                className={`dt-day${isActive ? ' is-active' : ''}`}
                aria-pressed={isActive}
              >
                {jornada.diaNombre === 'Domingo' ? (
                  <Trophy size={16} className="dt-icon" />
                ) : (
                  <Calendar size={16} />
                )}
                <span>{jornada.label}</span>

                {data?.canchasPorDia?.[jornada.key] && data.canchasPorDia[jornada.key].canchas < canchasClub && (
                  <CloudRain
                    size={14}
                    className="dt-rain-icon"
                    title={`Modo Lluvia activo (${data.canchasPorDia[jornada.key].canchas}/${canchasClub} canchas)`}
                  />
                )}

                {/* Indicador de partidos en juego */}
                {hasLive && (
                  <span
                    className="dt-dot dt-live-dot"
                    title={`${jornada.enCursoCount} partido(s) en juego`}
                  />
                )}

                {/* Badge de cantidad */}
                <span
                  className="dt-day-count"
                >
                  {jornada.totalPartidos}
                </span>
              </button>
            );
          })}

          {/* Solapa "Todo el Torneo" */}
          <button
            type="button"
            onClick={() => {
              setActiveTabDay('TODO');
              setUserTouchedTarget(false);
            }}
            className={`dt-day${activeTabDay === 'TODO' ? ' is-active' : ''}`}
            aria-pressed={activeTabDay === 'TODO'}
          >
            <Layers size={16} />
            <span>Todo el torneo</span>
            <span
              className="dt-day-count"
            >
              {data.resumenEstado.totalPartidos}
            </span>
          </button>
        </div>
      )}

      {/* Aviso si hay partidos en juego en otra jornada distinta a la activa */}
      {partidosEnCursoOtraJornada.length > 0 && (
        <div
          className="dt-notice dt-other-live"
        >
          <div className="dt-notice-main">
            <Flame size={14} className="dt-live-icon" />
            <span>
              Hay <strong>{partidosEnCursoOtraJornada.length} partido(s) en juego</strong> en otra jornada.
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              const primerOtraJornada = partidosEnCursoOtraJornada[0];
              const info = getDiaCalendarioConTrasnoche(primerOtraJornada.fechaHora, horariosClub);
              if (info) setActiveTabDay(info.key);
            }}
            className="dt-button"
          >
            Ir a jornada en juego →
          </button>
        </div>
      )}

      {error && (
        <div
          className="dt-notice dt-danger"
        >
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}

      {/* ─── 2. Barra de Control de Canchas ───────────────────────── */}
      {/* En "TODO" no se reduce ni se restaura: solo un resumen de las jornadas con lluvia */}
      {esModoTodo ? (
        (anyDayHasLluvia || avisoFueraDeHorario) && (
          <div
            className="dt-courts-card"
          >
            {anyDayHasLluvia && (
              <div className="dt-rain-summary">
                <span
                  className="dt-rain-label"
                >
                  <CloudRain size={14} />
                  Modo lluvia
                </span>
                {diasConLluvia.map((d) => (
                  <span key={d.key} className="dt-muted">
                    {d.nombre}: {d.canchas} de {canchasClub} canchas
                  </span>
                ))}
              </div>
            )}
            {avisoFueraDeHorario}
          </div>
        )
      ) : (
      <div
        className="dt-courts-card"
      >
        <div className="dt-courts-layout">
          {/* Info de canchas activas */}
          <div className="dt-courts-info">
            <div className="dt-courts-title">
              <span className="dt-strong">
                Canchas activas {activeJornadaInfo ? `(${activeJornadaInfo.diaNombre})` : ''}:
              </span>
              <span
                className="dt-courts-count"
              >
                {canchasActivasContextuales} / {canchasClub}
              </span>
              {isTabBajoOverride ? (
                <span
                  className="dt-badge dt-blue"
                >
                  <CloudRain size={13} />
                  Modo lluvia{diaLluviaNombre ? ` (${diaLluviaNombre})` : ''}
                </span>
              ) : anyDayHasLluvia ? (
                <span
                  className="dt-badge dt-neutral"
                >
                  <CloudRain size={13} />
                  Lluvia en otra jornada
                </span>
              ) : (
                <span
                  className="dt-badge dt-neutral"
                >
                  <Sun size={13} />
                  Normal
                </span>
              )}
            </div>
            {(isTabBajoOverride || anyDayHasLluvia) && (
              <p className="dt-muted">
                {isTabBajoOverride
                  ? 'Partidos de esta jornada reprogramados sobre las canchas disponibles.'
                  : 'Modo Lluvia activo en otra jornada. En esta jornada todas las canchas están habilitadas.'}
              </p>
            )}
            {avisoFueraDeHorario}
          </div>

          {/* Selector y Acciones */}
          <div className="dt-courts-actions">
            {/* Botón Restaurar todas: Solo visible si la solapa actual está bajo override */}
            {isTabBajoOverride && (
              <button
                type="button"
                onClick={() => setConfirmRestaurarOpen(true)}
                disabled={actionLoading}
                className="dt-button"
              >
                <Sun size={15} className="dt-icon" />
                Restaurar todas ({canchasClub})
              </button>
            )}

            {/* Botón Reducir: Se compara contra canchasActivasContextuales */}
            {targetCanchas < canchasActivasContextuales && (
              <button
                type="button"
                onClick={() => setConfirmReducirOpen(true)}
                disabled={actionLoading}
                className="dt-button dt-button-blue"
              >
                <CloudRain size={15} />
                Reducir a {targetCanchas} {targetCanchas === 1 ? 'cancha' : 'canchas'}
              </button>
            )}

            {/* Control +/- (anclado a la derecha para mantener posición estable del cursor) */}
            <div
              className="dt-stepper"
            >
              <button
                type="button"
                onClick={() => {
                  setTargetCanchas((prev) => Math.max(1, prev - 1));
                  setUserTouchedTarget(true);
                }}
                disabled={targetCanchas <= 1 || actionLoading}
                className="dt-step-button"
                aria-label="Reducir cantidad de canchas"
              >
                −
              </button>
              <span
                className="dt-step-value"
              >
                {targetCanchas}
              </span>
              <button
                type="button"
                onClick={() => {
                  setTargetCanchas((prev) => Math.min(canchasClub, prev + 1));
                  setUserTouchedTarget(true);
                }}
                disabled={targetCanchas >= canchasClub || actionLoading}
                className="dt-step-button"
                aria-label="Aumentar cantidad de canchas"
              >
                +
              </button>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* ─── 3. Banner de Feedback Post-Reprogramación ──────────────── */}
      {isFeedbackVisible && (
        <div
          className="dt-notice dt-feedback"
        >
          <button
            type="button"
            onClick={() => setFeedbackReprogramacion(null)}
            className="dt-button dt-icon-button dt-dismiss"
            title="Cerrar aviso"
            aria-label="Cerrar aviso"
          >
            <X size={18} />
          </button>

          <div className="dt-section-heading dt-feedback-heading">
            <CheckCircle2 size={22} className="dt-brand-icon" />
            <h3 className="dt-section-title">
              Reprogramación por modo lluvia completada
              {feedbackDiaNombre && ` — ${feedbackDiaNombre}`}
            </h3>
          </div>

          <p className="dt-feedback-copy">
            Se ajustaron los partidos pendientes respetando el orden relativo original.
            {' '}
            <strong className="dt-strong">
              {feedbackReprogramacion.partidosReprogramados} partido(s) modificaron su horario
            </strong>
            {feedbackReprogramacion.partidosSinCambio > 0 && `, ${feedbackReprogramacion.partidosSinCambio} mantuvieron su horario`}
            {feedbackReprogramacion.partidosSinHorarioNuevo > 0 && (
              <span className="dt-danger-text">
                {`, ${feedbackReprogramacion.partidosSinHorarioNuevo} quedaron sin horario disponible`}
              </span>
            )}
            .
          </p>

          {feedbackReprogramacion.cambios && feedbackReprogramacion.cambios.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setFeedbackExpanded((prev) => !prev)}
                className="dt-text-button"
              >
                {feedbackExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {feedbackExpanded ? 'Ocultar detalle de cambios' : `Ver detalle de ${feedbackReprogramacion.cambios.length} cambios de horario`}
              </button>

              {feedbackExpanded && (
                <div
                  className="dt-change-list"
                >
                  {feedbackReprogramacion.cambios.map((c, idx) => (
                    <div
                      key={c.partidoId || idx}
                      className="dt-change"
                    >
                      <div>
                        <strong>{c.pareja1}</strong> vs <strong>{c.pareja2}</strong>
                        <span className="dt-muted">
                          ({c.categoria})
                        </span>
                      </div>
                      <div className="dt-change-times">
                        <span className="dt-old-time">
                          C{c.antes.canchaNumero} • {formatDiaHorario(c.antes.fechaHora)}
                        </span>
                        <span>→</span>
                        {c.despues.canchaNumero ? (
                          <span className="dt-new-time">
                            C{c.despues.canchaNumero} • {formatDiaHorario(c.despues.fechaHora)}
                          </span>
                        ) : (
                          <span className="dt-danger-text">
                            Sin horario disponible
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ─── 4. Alerta de Partidos en Cancha Fantasma ─────────────────── */}
      {partidosEnCanchaFantasma && partidosEnCanchaFantasma.length > 0 && (
        <div
          className="dt-notice dt-danger"
        >
          <div
            className="dt-section-heading"
          >
            <div className="dt-notice-main">
              <AlertTriangle size={20} className="dt-icon" />
              <h3 className="dt-section-title">
                {partidosEnCanchaFantasma.length} partido(s) en canchas inhabilitadas requieren atención manual
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setFantasmaExpanded((prev) => !prev)}
              className="dt-text-button"
            >
              {fantasmaExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {fantasmaExpanded ? 'Ocultar lista' : 'Ver lista'}
            </button>
          </div>

          <p className="dt-notice-copy">
            Estos partidos tenían asignada una cancha que ahora está inhabilitada por la lluvia de su jornada y no pudieron ser reprogramados automáticamente. Revisá su asignación en cada categoría.
          </p>

          {fantasmaExpanded && (
            <div className="dt-match-list">
              {partidosEnCanchaFantasma.map((p) => (
                <div
                  key={p.id}
                  className="dt-ghost-match"
                >
                  <div>
                    <div className="dt-pair-names">
                      <span className="dt-pair-name">{p.pareja1}</span>
                      <span className="dt-versus">vs</span>
                      <span className="dt-pair-name">{p.pareja2}</span>
                    </div>
                    <div className="dt-muted">
                      {p.categoria} {p.zona ? `• ${p.zona}` : p.fase ? `• ${p.fase}` : ''} • Asignado a: Cancha {p.canchaNumero} ({formatDiaHorario(p.fechaHora)})
                      <span className="dt-block">
                        Inhabilitadas ese día: Cancha &gt; {canchasDeLaJornadaDe(p.fechaHora)}
                      </span>
                      {p.motivo && (
                        <span className="dt-block dt-danger-text">
                          Motivo: {p.motivo}
                        </span>
                      )}
                    </div>
                  </div>
                  <Link
                    to={`/admin/torneos/${id}/categorias/${p.categoriaId}`}
                    className="dt-button dt-button-blue"
                  >
                    Reasignar horario <ExternalLink size={12} />
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      )}



      {/* ─── Banner / Alerta de Acción de Cruces ───────────────────── */}
      {alertaEliminatoria && (
        <div
          className={`dt-notice dt-bracket-notice${alertaEliminatoria.tipo === 'error' || alertaEliminatoria.esDieciseisavos ? ' dt-danger' : ' dt-info'}`}
        >
          <div className="dt-notice-main">
            {alertaEliminatoria.tipo === 'error' ? (
              <AlertTriangle size={20} className="dt-icon" />
            ) : (alertaEliminatoria.esDieciseisavos ? (
              <AlertTriangle size={20} className="dt-icon" />
            ) : (
              <CheckCircle2 size={20} className="dt-icon" />
            ))}
            <div>
              <div className="dt-strong">
                {alertaEliminatoria.mensaje}
              </div>
              {alertaEliminatoria.esDieciseisavos && (
                <div className="dt-muted">
                  Los partidos de dieciseisavos se juegan el sábado a la noche y quedaron listos para asignación manual.{' '}
                  <a
                    href="#partidos-pendientes-section"
                    className="dt-inline-link"
                  >
                    Ir a partidos pendientes ↓
                  </a>
                </div>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setAlertaEliminatoria(null)}
            className="dt-button dt-icon-button"
            aria-label="Cerrar aviso de eliminatoria"
          >
            <X size={18} />
          </button>
        </div>
      )}

      {/* ─── 5. Cuadros Eliminatorios (Brackets) — Solo Domingo o Todo el Torneo ─── */}
      {!esViernes && !esSabado && ((data.categorias && data.categorias.length > 0) || (data.categoriasListasParaEliminatoria && data.categoriasListasParaEliminatoria.length > 0)) && (
        <div
          className="dt-brackets"
        >
          <div
            className="dt-section-heading"
          >
            <div className="dt-notice-main">
              <Trophy size={22} className="dt-trophy-icon" />
              <h3 className="dt-section-title">
                Eliminatoria
              </h3>
            </div>
          </div>

          {/* Aviso si alguna categoría completó sus zonas */}
          {data.categorias && data.categorias.some((c) => c.zonasFinalizadas) && (
            <div
              className="dt-notice dt-info"
            >
              <Zap size={16} className="dt-brand-icon" />
              <span>
                <strong>¡Fase de grupos completada!</strong> Los clasificados y horarios de domingo se asignan y programan automáticamente al cuadro eliminatorio.
              </span>
            </div>
          )}

          <div className="dt-bracket-grid">
            {(data.categorias || data.categoriasListasParaEliminatoria || []).map((cat) => {
              const isGenerating = generandoCrucesCatId === cat.id;
              const isReadyToAssign = cat.estadoEliminatoria === 'LISTA_PARA_ASIGNAR' || (!cat.estadoEliminatoria && data.categoriasListasParaEliminatoria?.some((c) => c.id === cat.id));
              const pctZonas = cat.totalPartidosZona > 0
                ? Math.round((cat.partidosZonaFinalizados / cat.totalPartidosZona) * 100)
                : 0;

              return (
                <div
                  key={cat.id}
                  className={`dt-bracket-card${cat.clasificadosAsignados ? ' is-assigned' : ''}`}
                >
                  <div>
                    {/* Header de Categoría + Badge */}
                    <div className="dt-category-heading">
                      <div className="dt-category-name">
                        {cat.nombre}
                      </div>

                      {/* Badge de Estado */}
                      {cat.clasificadosAsignados && cat.estadoEliminatoria !== 'FINALIZADA' ? (
                        <span
                          className="dt-badge dt-neutral"
                        >
                          <CheckCircle2 size={11} /> Clasificados listos
                        </span>
                      ) : isReadyToAssign ? (
                        <span
                          className="dt-badge dt-blue"
                        >
                          <Zap size={11} /> ¡Zonas listas!
                        </span>
                      ) : cat.estadoEliminatoria === 'ESPERANDO_ZONAS' ? null : cat.estadoEliminatoria === 'EN_CURSO' ? (
                        <span
                          className="dt-badge dt-neutral"
                        >
                          <Flame size={11} /> En disputa
                        </span>
                      ) : cat.estadoEliminatoria === 'FINALIZADA' ? (
                        <span
                          className="dt-badge dt-neutral"
                        >
                          <CheckCircle2 size={11} /> Definido
                        </span>
                      ) : (
                        <span
                          className="dt-muted"
                        >
                          {cat.tieneEliminatoria ? 'Cuadro listo' : 'Sin cuadro'}
                        </span>
                      )}
                    </div>


                    {/* Progreso de Zonas */}
                    {cat.totalPartidosZona > 0 && (
                      <div className="dt-progress">
                        <div className="dt-progress-label">
                          <span>Zonas</span>
                          <span>{cat.partidosZonaFinalizados}/{cat.totalPartidosZona} jugados ({pctZonas}%)</span>
                        </div>
                        <div className="dt-progress-track">
                          <div
                            className="dt-progress-fill" style={{ width: `${pctZonas}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Info de Eliminatoria */}
                    {cat.tieneEliminatoria && cat.estadoEliminatoria !== 'ESPERANDO_ZONAS' && cat.totalPartidosEliminatoria > 0 && (
                      <div className="dt-muted dt-block">
                        <span>{cat.primeraRondaNombre || 'Eliminatoria'}: {cat.partidosEliminatoriaFinalizados}/{cat.totalPartidosEliminatoria} jugados</span>
                      </div>
                    )}
                  </div>

                  {/* Acciones */}
                  <div className="dt-card-actions">
                    {cat.tieneEliminatoria && (
                      <Link
                        to={`/admin/torneos/${id}/categorias/${cat.id}/eliminatoria`}
                        className="dt-button dt-grow"
                        title={`Ver cuadro eliminatorio de ${cat.nombre}`}
                      >
                        <GitBranch size={14} /> Ver cuadro
                      </Link>
                    )}

                    {!cat.tieneEliminatoria && (
                      <button
                        type="button"
                        disabled={isGenerating}
                        onClick={() => handleGenerarCruces(cat.id, cat.nombre)}
                        className="dt-button dt-grow"
                      >
                        <GitBranch size={14} /> Generar cuadro
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── 6. Resumen Estadístico ───────────────────────────────── */}
      <div
        className="dt-stats"
      >
        <div
          className="dt-stat"
        >
          <div className="dt-stat-value">{resumenContextual.totalPartidos}</div>
          <div className="dt-muted">
            {esModoTodo ? 'Total Torneo' : `Partidos ${activeJornadaInfo?.diaNombre || ''}`}
          </div>
        </div>

        <div
          className="dt-stat dt-stat-live"
        >
          <div className="dt-stat-value">
            {resumenContextual.enCurso}
          </div>
          <div className="dt-muted">En juego</div>
        </div>

        <div
          className="dt-stat"
        >
          <div className="dt-stat-value">
            {resumenContextual.pendientesConHorario}
          </div>
          <div className="dt-muted">Programados</div>
        </div>

        <div
          className="dt-stat"
        >
          <div className="dt-stat-value">
            {resumenContextual.finalizados}
          </div>
          <div className="dt-muted">Finalizados</div>
        </div>

        {resumenContextual.pendientesSinHorario > 0 && (
          <div
            className="dt-stat dt-stat-danger"
          >
            <div className="dt-stat-value">
              {resumenContextual.pendientesSinHorario}
            </div>
            <div className="dt-muted">Sin horario</div>
          </div>
        )}
      </div>

      {/* ─── 7. Partidos en Curso y Próximos ──────────────────────── */}
      <div
        className={`dt-match-columns${partidosEnCursoFiltrados.length === 0 ? ' is-empty' : ''}`}
      >
        {/* Partidos en Juego */}
        <div>
          <h3
            className={`dt-section-title dt-live-title${partidosEnCursoFiltrados.length === 0 ? ' is-empty' : ''}`}
          >
            <Flame
              size={partidosEnCursoFiltrados.length === 0 ? 16 : 18}
              className={partidosEnCursoFiltrados.length === 0 ? 'dt-muted-icon' : 'dt-live-icon'}
            />
            Partidos en juego ({partidosEnCursoFiltrados.length})
          </h3>

          {partidosEnCursoFiltrados.length > 0 && (
            <div className="dt-match-list">
              {partidosEnCursoFiltrados.map((p) => {
                const sets = p.sets || [];
                const resultadoStr = sets.length > 0
                  ? sets.map((s) => `${s.gamesPareja1}-${s.gamesPareja2}`).join(' / ')
                  : null;

                return (
                  <div
                    key={p.id}
                    className="dt-match-card dt-current-match"
                  >
                    <div className="dt-match-top">
                      <div className="dt-match-badges">
                        <span
                          className="dt-badge dt-neutral"
                        >
                          Cancha {p.canchaNumero}
                        </span>
                        {resultadoStr && (
                          <span
                            className="dt-badge dt-neutral"
                          >
                            Parcial: {resultadoStr}
                          </span>
                        )}
                      </div>
                      <span className="dt-muted">
                        {p.categoria} {p.zona ? `• ${p.zona}` : p.fase ? `• ${p.fase}` : ''}
                      </span>
                    </div>

                    <div className="dt-pair-name">
                      {p.pareja1}
                    </div>
                    <div className="dt-versus">vs</div>
                    <div className="dt-pair-name">
                      {p.pareja2}
                    </div>

                    <div
                      className="dt-match-footer"
                    >
                      <span>
                        Inicio: {formatHora(p.horaInicio)}
                      </span>
                      <div className="dt-actions">
                        <button
                          type="button"
                          onClick={() => handleCambiarEstado(p.id, 'PENDIENTE')}
                          disabled={updatingPartidoId === p.id}
                          title="Revertir a Pendiente (sacar de la cancha)"
                          className="dt-button"
                        >
                          <RotateCcw size={13} />
                          Revertir
                        </button>
                        <button
                          type="button"
                          onClick={() => setPartidoParaResultado(buildPartidoParaModal(p))}
                          className="dt-button dt-button-blue"
                        >
                          <ClipboardList size={14} />
                          {sets.length > 0 ? 'Actualizar resultado' : 'Cargar resultado'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Próximos Partidos */}
        <div>
          <div className="dt-section-heading">
            <h3 className="dt-section-title">
              <Clock size={18} className="dt-brand-icon" />
              Próximos partidos ({proximosFiltrados.length})
            </h3>
          </div>

          {proximosFiltrados.length === 0 ? (
            <div
              className="dt-empty"
            >
              {esDomingo
                ? 'Los partidos del domingo se agendarán automáticamente cuando se completen las zonas y se asignen los clasificados.'
                : 'No hay partidos programados para esta jornada.'}
            </div>
          ) : (
            <div className="dt-match-list">
              {proximosFiltrados.map((p) => (
                <div key={p.id} className="dt-match-card dt-upcoming-match">
                  <div className="dt-upcoming-main">
                    <div className="dt-grow">
                      <div
                        className="dt-pair-names"
                      >
                        <span className="dt-pair-name">{p.pareja1}</span>
                        <span className="dt-versus">vs</span>
                        <span className="dt-pair-name">{p.pareja2}</span>
                      </div>
                      <div className="dt-muted">
                        {p.categoria} {p.zona ? `• ${p.zona}` : p.fase ? `• ${p.fase}` : ''}
                      </div>
                    </div>

                    <div className="dt-match-schedule">
                      <div
                        className="dt-badge dt-neutral"
                      >
                        Cancha {p.canchaNumero}
                      </div>
                      <div className="dt-match-time">
                        {formatDiaHorario(p.fechaHora)}
                      </div>
                      {(p.minutosDespuesDelCierre || 0) > 0 && (
                        <div
                          title="Agendado después del cierre del club por Modo Lluvia"
                          className="dt-badge dt-after-hours"
                        >
                          <Moon size={11} />
                          +{p.minutosDespuesDelCierre} min tras cierre
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="dt-card-actions">
                    {/* Botón iniciar partido (Marcar En Juego): solo con las dos parejas definidas */}
                    {p.pareja1Id && p.pareja2Id && (
                      <button
                        type="button"
                        onClick={() => handleCambiarEstado(p.id, 'EN_CURSO')}
                        disabled={updatingPartidoId === p.id}
                        title="Marcar como En Juego (ingresó a la cancha)"
                        className="dt-button dt-play-button"
                      >
                        <Play size={13} fill="currentColor" />
                        <span>En juego</span>
                      </button>
                    )}

                    {/* Botón cargar resultado inline */}
                    <button
                      type="button"
                      onClick={() => setPartidoParaResultado(buildPartidoParaModal(p))}
                      title="Cargar resultado"
                      className="dt-button"
                    >
                      <ClipboardList size={14} />
                      <span>Resultado</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ─── 8. Partidos Finalizados (acordeón, colapsado por default) ─── */}
      {finalizadosFiltrados && finalizadosFiltrados.length > 0 && (
        <div className="dt-finished">
          <button
            type="button"
            onClick={() => setFinalizadosExpanded((prev) => !prev)}
            className={`dt-finished-toggle${finalizadosExpanded ? ' is-expanded' : ''}`}
          >
            <span className="dt-section-title">
              <Trophy size={18} className="dt-muted-icon" />
              Partidos finalizados {activeJornadaInfo ? `(${activeJornadaInfo.diaNombre})` : ''} ({finalizadosFiltrados.length})
            </span>
            {finalizadosExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>

          {finalizadosExpanded && (
            <div
              className="dt-finished-list"
            >
              {finalizadosFiltrados.map((p, idx) => {
                const sets = p.sets || [];
                const resultadoStr = sets.length > 0
                  ? sets.map((s) => `${s.gamesPareja1}-${s.gamesPareja2}`).join(' / ')
                  : '—';

                const isP1Winner = p.ganadorId && p.pareja1Id && p.ganadorId === p.pareja1Id;
                const isP2Winner = p.ganadorId && p.pareja2Id && p.ganadorId === p.pareja2Id;

                return (
                  <div
                    key={p.id}
                    className={`dt-finished-match${idx % 2 === 0 ? ' is-even' : ''}${idx < partidosFinalizados.length - 1 ? ' is-divided' : ''}`}
                  >
                    <div className="dt-grow">
                      <div className="dt-pair-names dt-finished-names">
                        <span
                          className={`dt-pair-name${isP1Winner ? ' is-winner' : ' is-loser'}`}
                        >
                          {p.pareja1}
                        </span>
                        <span className="dt-versus">vs</span>
                        <span
                          className={`dt-pair-name${isP2Winner ? ' is-winner' : ' is-loser'}`}
                        >
                          {p.pareja2}
                        </span>
                      </div>
                      <div className="dt-muted">
                        {p.categoria}{p.zona ? ` • ${p.zona}` : p.fase ? ` • ${p.fase}` : ''}
                        {p.canchaNumero && ` • C${p.canchaNumero}`}
                        {p.fechaHora && ` • ${formatDiaHorario(p.fechaHora)}`}
                      </div>
                    </div>

                    <div className="dt-finished-actions">
                      <div
                        className="dt-score"
                      >
                        {resultadoStr}
                      </div>

                      {/* Editar resultado finalizado */}
                      <button
                        type="button"
                        onClick={() => setPartidoParaResultado(buildPartidoParaModal(p))}
                        title="Editar resultado"
                        className="dt-button dt-icon-button"
                      >
                        <ClipboardList size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      </div>

      {/* ─── Partidos Pendientes de Horario ─────────────────────────── */}
      <div id="partidos-pendientes-section" className="dt-pending-space">
        <PartidosPendientesSection
          torneoId={id}
          torneoEstado={data?.torneo?.estado}
          onPartidosActualizados={fetchAndResetPolling}
        />
      </div>

      {/* ─── Modal de Confirmación: Reducir Canchas (Modo Lluvia) ───── */}
      <ConfirmModal
        isOpen={confirmReducirOpen}
        title={`🌧️ ¿Reducir a ${targetCanchas} ${targetCanchas === 1 ? 'cancha activa' : 'canchas activas'}?`}
        message={`Se activará el Modo Lluvia y se reprogramarán automáticamente los partidos pendientes de la jornada en curso para ajustarse a ${targetCanchas} ${targetCanchas === 1 ? 'cancha' : 'canchas'}. Los partidos de otras jornadas, así como los en curso y finalizados, no se modificarán.`}
        confirmText={actionLoading ? 'Reprogramando...' : 'Reducir y Reprogramar'}
        onConfirm={handleReducir}
        onCancel={() => setConfirmReducirOpen(false)}
        isDanger={true}
      />

      {/* ─── Modal de Confirmación: Restaurar Canchas ───────────────── */}
      <ConfirmModal
        isOpen={confirmRestaurarOpen}
        title="☀️ ¿Restaurar todas las canchas del club?"
        message={`Se desactivará el Modo Lluvia y volverán a estar habilitadas las ${canchasClub} canchas del club. Los partidos pendientes de esta jornada se redistribuirán para aprovechar todas las canchas disponibles. Las demás jornadas no se modificarán.`}
        confirmText={actionLoading ? 'Restaurando...' : 'Restaurar Canchas'}
        onConfirm={handleRestaurar}
        onCancel={() => setConfirmRestaurarOpen(false)}
        isDanger={false}
      />

      {/* ─── ResultadoModal (Próximos y Finalizados) ─────────────────── */}
      {partidoParaResultado && (
        <ResultadoModal
          partido={partidoParaResultado}
          onClose={() => setPartidoParaResultado(null)}
          onSuccess={() => {
            setPartidoParaResultado(null);
            fetchAndResetPolling();
          }}
        />
      )}
    </div>
  );
}
