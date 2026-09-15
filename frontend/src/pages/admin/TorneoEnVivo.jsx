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
  Loader2,
  GitBranch,
  Calendar,
  Layers,
} from 'lucide-react';
import { api } from '../../api/client';
import ConfirmModal from '../../components/ConfirmModal';
import ResultadoModal from '../../components/ResultadoModal';
import PartidosPendientesSection from '../../components/PartidosPendientesSection';
import { formatDiaHorario, getDiaCalendarioConTrasnoche } from '../../utils/dateUtils';

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
      setUserTouchedTarget(false);
      setFeedbackReprogramacion(null);
      await fetchEnVivoData(true);
      startPolling(fetchEnVivoData);
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
  const canchasActivas = data?.canchasActivas || canchasClub;
  const isLluviaActive = torneo?.canchasDisponiblesOverride !== null && torneo?.canchasDisponiblesOverride !== undefined;

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
              label: info.diaNombre === 'Domingo' ? `${info.label} (Playoffs)` : info.label,
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
          label: info.diaNombre === 'Domingo' ? `${info.label} (Playoffs)` : info.label,
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

  // Datos contextuales del día activo en el modelo independiente por jornada
  const diaInfoContextual = (activeTabDay && data?.canchasPorDia?.[activeTabDay]) || null;
  const anyDayHasLluvia = Object.values(data?.canchasPorDia || {}).some((d) => d && d.isLluvia) || isLluviaActive;

  // Determinar si la solapa actualmente visible está bajo modo lluvia
  const isTabBajoOverride = diaInfoContextual
    ? Boolean(diaInfoContextual.isLluvia)
    : (isLluviaActive && (!torneo?.overrideDiaKey || esModoTodo || activeTabDay === torneo?.overrideDiaKey));

  // Canchas activas contextuales a la solapa de día seleccionada
  const canchasActivasContextuales = diaInfoContextual
    ? diaInfoContextual.canchas
    : (isTabBajoOverride ? canchasActivas : canchasClub);

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
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <div style={{ textAlign: 'center' }}>
          <RefreshCw size={36} className="animate-spin" style={{ color: 'var(--color-primary)', marginBottom: '1rem' }} />
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
            Cargando estado en vivo del torneo...
          </p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div style={{ maxWidth: '600px', margin: '3rem auto', padding: '1.5rem', textAlign: 'center' }}>
        <AlertTriangle size={48} style={{ color: 'var(--color-danger)', marginBottom: '1rem' }} />
        <h2 style={{ fontSize: '1.25rem', marginBottom: '0.75rem' }}>No se pudo cargar el Modo Día de Torneo</h2>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', marginBottom: '1.5rem' }}>
          {error}
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
          <button type="button" className="btn-secondary" onClick={() => navigate(`/admin/torneos/${id}`)}>
            Volver al torneo
          </button>
          <button type="button" className="btn-primary" onClick={() => fetchEnVivoData()}>
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  const { partidosEnCurso, partidosEnCanchaFantasma, proximosPartidos, partidosFinalizados, resumenEstado } = data;

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
      } else {
        feedbackDiaKey = torneo.overrideDiaKey || null;
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
    <div style={{ maxWidth: '1200px', margin: '0 auto', paddingBottom: '4rem' }}>
      {/* ─── 1. Header de Navegación y En Vivo ─────────────────────── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.75rem',
          marginBottom: '1.25rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Link
            to={`/admin/torneos/${id}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '38px',
              height: '38px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-card-start)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text)',
            }}
            title="Volver al detalle del torneo"
          >
            <ArrowLeft size={18} />
          </Link>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <h1 style={{ fontSize: '1.35rem', fontWeight: 700 }}>🏟️ Día de Torneo — En Vivo</h1>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  fontSize: 'var(--font-size-xs)',
                  padding: '0.2rem 0.55rem',
                  borderRadius: '999px',
                  background: 'rgba(0, 208, 132, 0.15)',
                  color: 'var(--color-primary)',
                  fontWeight: 600,
                  border: '1px solid rgba(0, 208, 132, 0.3)',
                }}
              >
                <span
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: 'var(--color-primary)',
                    display: 'inline-block',
                    animation: 'pulse 2s infinite',
                  }}
                />
                En vivo
              </span>
            </div>
            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
              {torneo.nombre} • Actualización automática cada 30s
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          {torneo.slug && (
            <Link
              to={`/torneo/${torneo.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                fontSize: 'var(--font-size-xs)',
                padding: '0.45rem 0.85rem',
                textDecoration: 'none',
              }}
              title="Abrir vista pública del torneo en una pestaña nueva"
            >
              <ExternalLink size={14} />
              <span>Vista Pública</span>
            </Link>
          )}

          <button
            type="button"
            className="btn-secondary"
            onClick={() => fetchEnVivoData(true)}
            disabled={refreshing}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              fontSize: 'var(--font-size-xs)',
              padding: '0.45rem 0.85rem',
            }}
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Actualizando...' : 'Actualizar ahora'}
          </button>
        </div>
      </div>

      {/* ─── Selector Global de Jornada ─────────────────────────────── */}
      {jornadasDisponibles.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            marginBottom: '1.25rem',
            overflowX: 'auto',
            paddingBottom: '0.4rem',
            scrollbarWidth: 'none',
          }}
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
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.55rem 1rem',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: isActive ? 700 : 500,
                  background: isActive
                    ? 'linear-gradient(135deg, rgba(0, 208, 132, 0.15), rgba(18, 21, 28, 0.95))'
                    : 'var(--bg-card-start)',
                  color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                  border: isActive
                    ? '1px solid var(--color-primary)'
                    : '1px solid var(--color-border)',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  whiteSpace: 'nowrap',
                  boxShadow: isActive ? '0 0 12px rgba(0, 208, 132, 0.15)' : 'none',
                }}
              >
                {jornada.diaNombre === 'Domingo' ? (
                  <Trophy size={16} style={{ color: isActive ? 'var(--color-primary)' : '#f59e0b' }} />
                ) : (
                  <Calendar size={16} />
                )}
                <span>{jornada.label}</span>

                {data?.canchasPorDia?.[jornada.key]?.isLluvia && (
                  <CloudRain
                    size={14}
                    style={{ color: '#60a5fa' }}
                    title={`Modo Lluvia activo (${data.canchasPorDia[jornada.key].canchas}/${canchasClub} canchas)`}
                  />
                )}

                {/* Indicador de partidos en juego */}
                {hasLive && (
                  <span
                    style={{
                      width: '7px',
                      height: '7px',
                      borderRadius: '50%',
                      background: 'var(--color-primary)',
                      display: 'inline-block',
                      animation: 'pulse 1.5s infinite',
                    }}
                    title={`${jornada.enCursoCount} partido(s) en juego`}
                  />
                )}

                {/* Badge de cantidad */}
                <span
                  style={{
                    fontSize: '11px',
                    padding: '0.1rem 0.45rem',
                    borderRadius: '999px',
                    background: isActive ? 'rgba(0, 208, 132, 0.25)' : 'rgba(255, 255, 255, 0.08)',
                    color: isActive ? 'var(--color-primary)' : 'var(--color-text-muted)',
                    fontWeight: 700,
                  }}
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
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.45rem',
              padding: '0.55rem 1rem',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--font-size-sm)',
              fontWeight: activeTabDay === 'TODO' ? 700 : 500,
              background: activeTabDay === 'TODO'
                ? 'linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(18, 21, 28, 0.95))'
                : 'var(--bg-card-start)',
              color: activeTabDay === 'TODO' ? '#60a5fa' : 'var(--color-text-secondary)',
              border: activeTabDay === 'TODO'
                ? '1px solid #60a5fa'
                : '1px solid var(--color-border)',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              whiteSpace: 'nowrap',
              boxShadow: activeTabDay === 'TODO' ? '0 0 12px rgba(59, 130, 246, 0.15)' : 'none',
            }}
          >
            <Layers size={16} />
            <span>Todo el Torneo</span>
            <span
              style={{
                fontSize: '11px',
                padding: '0.1rem 0.45rem',
                borderRadius: '999px',
                background: activeTabDay === 'TODO' ? 'rgba(59, 130, 246, 0.25)' : 'rgba(255, 255, 255, 0.08)',
                color: activeTabDay === 'TODO' ? '#60a5fa' : 'var(--color-text-muted)',
                fontWeight: 700,
              }}
            >
              {data.resumenEstado.totalPartidos}
            </span>
          </button>
        </div>
      )}

      {/* Aviso si hay partidos en juego en otra jornada distinta a la activa */}
      {partidosEnCursoOtraJornada.length > 0 && (
        <div
          style={{
            background: 'rgba(0, 208, 132, 0.08)',
            border: '1px solid rgba(0, 208, 132, 0.25)',
            borderRadius: 'var(--radius-md)',
            padding: '0.6rem 0.9rem',
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 'var(--font-size-xs)',
            gap: '0.5rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Flame size={14} style={{ color: 'var(--color-primary)' }} />
            <span>
              Hay <strong>{partidosEnCursoOtraJornada.length} partido(s) en juego</strong> en otra jornada.
            </span>
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              const primerOtraJornada = partidosEnCursoOtraJornada[0];
              const info = getDiaCalendarioConTrasnoche(primerOtraJornada.fechaHora, horariosClub);
              if (info) setActiveTabDay(info.key);
            }}
            style={{
              padding: '0.25rem 0.6rem',
              fontSize: '11px',
            }}
          >
            Ir a jornada en juego →
          </button>
        </div>
      )}

      {error && (
        <div
          style={{
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 'var(--radius-md)',
            padding: '0.75rem 1rem',
            marginBottom: '1rem',
            color: 'var(--color-danger)',
            fontSize: 'var(--font-size-sm)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}

      {/* ─── 2. Barra de Control de Canchas ───────────────────────── */}
      <div
        className="canchas-control-card"
        style={{
          border: isTabBajoOverride ? '1px solid rgba(59, 130, 246, 0.5)' : '1px solid var(--color-border)',
        }}
      >
        <div className="canchas-control-layout">
          {/* Info de canchas activas */}
          <div style={{ flex: '1 1 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text)' }}>
                Canchas activas {activeJornadaInfo ? `(${activeJornadaInfo.diaNombre})` : ''}:
              </span>
              <span
                style={{
                  fontSize: '1.25rem',
                  fontWeight: 800,
                  color: isTabBajoOverride ? '#60a5fa' : 'var(--color-primary)',
                }}
              >
                {canchasActivasContextuales} / {canchasClub}
              </span>
              {isTabBajoOverride ? (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                    fontSize: 'var(--font-size-xs)',
                    padding: '0.15rem 0.5rem',
                    borderRadius: '999px',
                    background: 'rgba(59, 130, 246, 0.2)',
                    color: '#60a5fa',
                    fontWeight: 600,
                    border: '1px solid rgba(59, 130, 246, 0.4)',
                  }}
                >
                  <CloudRain size={13} />
                  Modo Lluvia ({diaInfoContextual?.activoDesde ? formatDiaHorario(diaInfoContextual.activoDesde) : (torneo.overrideActivoDesde ? formatDiaHorario(torneo.overrideActivoDesde) : 'Activo')})
                </span>
              ) : anyDayHasLluvia ? (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                    fontSize: 'var(--font-size-xs)',
                    padding: '0.15rem 0.5rem',
                    borderRadius: '999px',
                    background: 'rgba(59, 130, 246, 0.1)',
                    color: '#93c5fd',
                    fontWeight: 600,
                    border: '1px solid rgba(59, 130, 246, 0.25)',
                  }}
                >
                  <CloudRain size={13} />
                  Lluvia en otra jornada
                </span>
              ) : (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                    fontSize: 'var(--font-size-xs)',
                    padding: '0.15rem 0.5rem',
                    borderRadius: '999px',
                    background: 'rgba(0, 208, 132, 0.1)',
                    color: 'var(--color-primary)',
                    fontWeight: 600,
                    border: '1px solid rgba(0, 208, 132, 0.25)',
                  }}
                >
                  <Sun size={13} />
                  Normal
                </span>
              )}
            </div>
            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', margin: 0 }}>
              {isTabBajoOverride
                ? 'Partidos de esta jornada reprogramados sobre las canchas disponibles.'
                : anyDayHasLluvia
                  ? 'Modo Lluvia activo en otra jornada. En esta jornada todas las canchas están habilitadas.'
                  : 'Todas las canchas del club habilitadas.'}
            </p>
          </div>

          {/* Selector y Acciones */}
          <div className="canchas-control-actions">
            {/* Botón Restaurar todas: Solo visible si la solapa actual está bajo override */}
            {isTabBajoOverride && (
              <button
                type="button"
                className="btn-secondary canchas-action-btn"
                onClick={() => setConfirmRestaurarOpen(true)}
                disabled={actionLoading}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  fontSize: 'var(--font-size-xs)',
                  padding: '0.5rem 0.85rem',
                  whiteSpace: 'nowrap',
                }}
              >
                <Sun size={15} style={{ color: '#f59e0b' }} />
                Restaurar todas ({canchasClub})
              </button>
            )}

            {/* Botón Reducir: Se compara contra canchasActivasContextuales */}
            {targetCanchas < canchasActivasContextuales && (
              <button
                type="button"
                className="btn-primary canchas-action-btn"
                onClick={() => setConfirmReducirOpen(true)}
                disabled={actionLoading}
                style={{
                  background: '#2563eb',
                  color: 'white',
                  border: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  fontSize: 'var(--font-size-xs)',
                  fontWeight: 600,
                  padding: '0.5rem 0.9rem',
                  borderRadius: 'var(--radius-md)',
                  whiteSpace: 'nowrap',
                }}
              >
                <CloudRain size={15} />
                Reducir a {targetCanchas} {targetCanchas === 1 ? 'cancha' : 'canchas'}
              </button>
            )}

            {/* Control +/- (anclado a la derecha para mantener posición estable del cursor) */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                background: 'var(--bg-body)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                overflow: 'hidden',
                flexShrink: 0,
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setTargetCanchas((prev) => Math.max(1, prev - 1));
                  setUserTouchedTarget(true);
                }}
                disabled={targetCanchas <= 1 || actionLoading}
                style={{
                  padding: '0.45rem 0.75rem',
                  background: 'transparent',
                  border: 'none',
                  color: targetCanchas <= 1 ? 'var(--color-text-muted)' : 'var(--color-text)',
                  cursor: targetCanchas <= 1 ? 'not-allowed' : 'pointer',
                  fontWeight: 700,
                  fontSize: '1rem',
                }}
              >
                −
              </button>
              <span
                style={{
                  padding: '0.45rem 0.75rem',
                  fontWeight: 700,
                  fontSize: '0.95rem',
                  minWidth: '2.2rem',
                  textAlign: 'center',
                  color: 'var(--color-text)',
                }}
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
                style={{
                  padding: '0.45rem 0.75rem',
                  background: 'transparent',
                  border: 'none',
                  color: targetCanchas >= canchasClub ? 'var(--color-text-muted)' : 'var(--color-text)',
                  cursor: targetCanchas >= canchasClub ? 'not-allowed' : 'pointer',
                  fontWeight: 700,
                  fontSize: '1rem',
                }}
              >
                +
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ─── 3. Banner de Feedback Post-Reprogramación ──────────────── */}
      {isFeedbackVisible && (
        <div
          style={{
            background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.15), rgba(18, 21, 28, 0.95))',
            border: '1px solid rgba(59, 130, 246, 0.4)',
            borderRadius: 'var(--radius-lg)',
            padding: '1.25rem',
            marginBottom: '1.25rem',
            position: 'relative',
          }}
        >
          <button
            type="button"
            onClick={() => setFeedbackReprogramacion(null)}
            style={{
              position: 'absolute',
              top: '0.75rem',
              right: '0.75rem',
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
            }}
            title="Cerrar aviso"
          >
            <X size={18} />
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.5rem' }}>
            <CheckCircle2 size={22} style={{ color: '#60a5fa' }} />
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>
              Reprogramación por Modo Lluvia completada
              {feedbackDiaNombre && ` — ${feedbackDiaNombre}`}
            </h3>
          </div>

          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: '0.75rem' }}>
            Se ajustaron los partidos pendientes respetando el orden relativo original.
            {' '}
            <strong style={{ color: 'var(--color-text)' }}>
              {feedbackReprogramacion.partidosReprogramados} partido(s) modificaron su horario
            </strong>
            {feedbackReprogramacion.partidosSinCambio > 0 && `, ${feedbackReprogramacion.partidosSinCambio} mantuvieron su horario`}
            {feedbackReprogramacion.partidosSinHorarioNuevo > 0 && (
              <span style={{ color: 'var(--color-danger)' }}>
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
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#60a5fa',
                  fontSize: 'var(--font-size-xs)',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  padding: 0,
                  marginBottom: '0.5rem',
                }}
              >
                {feedbackExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {feedbackExpanded ? 'Ocultar detalle de cambios' : `Ver detalle de ${feedbackReprogramacion.cambios.length} cambios de horario`}
              </button>

              {feedbackExpanded && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem',
                    maxHeight: '260px',
                    overflowY: 'auto',
                    marginTop: '0.25rem',
                  }}
                >
                  {feedbackReprogramacion.cambios.map((c, idx) => (
                    <div
                      key={c.partidoId || idx}
                      style={{
                        background: 'rgba(0, 0, 0, 0.3)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '0.6rem 0.85rem',
                        fontSize: 'var(--font-size-xs)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '0.5rem',
                      }}
                    >
                      <div>
                        <strong>{c.pareja1}</strong> vs <strong>{c.pareja2}</strong>
                        <span style={{ color: 'var(--color-text-secondary)', marginLeft: '0.4rem' }}>
                          ({c.categoria})
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ color: 'var(--color-text-muted)', textDecoration: 'line-through' }}>
                          C{c.antes.canchaNumero} • {formatDiaHorario(c.antes.fechaHora)}
                        </span>
                        <span>→</span>
                        {c.despues.canchaNumero ? (
                          <span style={{ color: '#60a5fa', fontWeight: 600 }}>
                            C{c.despues.canchaNumero} • {formatDiaHorario(c.despues.fechaHora)}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--color-danger)', fontWeight: 600 }}>
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
          style={{
            background: 'rgba(245, 158, 11, 0.1)',
            border: '1px solid rgba(245, 158, 11, 0.35)',
            borderRadius: 'var(--radius-lg)',
            padding: '1.25rem',
            marginBottom: '1.25rem',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              flexWrap: 'wrap',
              gap: '0.5rem',
              marginBottom: '0.5rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <AlertTriangle size={20} style={{ color: '#f59e0b' }} />
              <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, color: '#fbbf24' }}>
                ⚠️ {partidosEnCanchaFantasma.length} partido(s) en canchas inhabilitadas requieren atención manual
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setFantasmaExpanded((prev) => !prev)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#fbbf24',
                fontSize: 'var(--font-size-xs)',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.3rem',
                padding: 0,
              }}
            >
              {fantasmaExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {fantasmaExpanded ? 'Ocultar lista' : 'Ver lista'}
            </button>
          </div>

          <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginBottom: '0.75rem' }}>
            Estos partidos tenían asignada una cancha que ahora está inhabilitada (Cancha &gt; {canchasActivas}) y su horario programado era anterior a la activación del modo lluvia, por lo que no fueron reprogramados automáticamente.
          </p>

          {fantasmaExpanded && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {partidosEnCanchaFantasma.map((p) => (
                <div
                  key={p.id}
                  style={{
                    background: 'rgba(0, 0, 0, 0.35)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '0.75rem 1rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '0.5rem',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>
                      {p.pareja1} vs {p.pareja2}
                    </div>
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                      {p.categoria} {p.zona ? `• ${p.zona}` : p.fase ? `• ${p.fase}` : ''} • Asignado a: Cancha {p.canchaNumero} ({formatDiaHorario(p.fechaHora)})
                    </div>
                  </div>
                  <Link
                    to={`/admin/torneos/${id}/categorias/${p.categoriaId}`}
                    style={{
                      fontSize: 'var(--font-size-xs)',
                      color: 'var(--color-primary)',
                      fontWeight: 600,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                    }}
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
          style={{
            background: alertaEliminatoria.tipo === 'error'
              ? 'rgba(239, 68, 68, 0.1)'
              : (alertaEliminatoria.esDieciseisavos ? 'rgba(245, 158, 11, 0.12)' : 'rgba(16, 185, 129, 0.12)'),
            border: `1px solid ${alertaEliminatoria.tipo === 'error' ? 'var(--color-error)' : (alertaEliminatoria.esDieciseisavos ? '#f59e0b' : 'var(--color-success)')}`,
            borderRadius: 'var(--radius-lg)',
            padding: '1rem 1.25rem',
            marginBottom: '1.25rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            {alertaEliminatoria.tipo === 'error' ? (
              <AlertTriangle size={20} style={{ color: 'var(--color-error)' }} />
            ) : (alertaEliminatoria.esDieciseisavos ? (
              <AlertTriangle size={20} style={{ color: '#f59e0b' }} />
            ) : (
              <CheckCircle2 size={20} style={{ color: 'var(--color-success)' }} />
            ))}
            <div>
              <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>
                {alertaEliminatoria.mensaje}
              </div>
              {alertaEliminatoria.esDieciseisavos && (
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginTop: '0.2rem' }}>
                  Los partidos de dieciseisavos se juegan el sábado a la noche y quedaron listos para asignación manual.{' '}
                  <a
                    href="#partidos-pendientes-section"
                    style={{ color: '#60a5fa', fontWeight: 600, textDecoration: 'underline' }}
                  >
                    Ir a Partidos Pendientes ↓
                  </a>
                </div>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setAlertaEliminatoria(null)}
            className="btn-icon"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            <X size={18} />
          </button>
        </div>
      )}

      {/* ─── 5. Cuadros Eliminatorios (Brackets) — Solo Domingo o Todo el Torneo ─── */}
      {!esViernes && !esSabado && ((data.categorias && data.categorias.length > 0) || (data.categoriasListasParaEliminatoria && data.categoriasListasParaEliminatoria.length > 0)) && (
        <div
          style={{
            background: esDomingo
              ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.08), rgba(18, 21, 28, 0.98))'
              : 'var(--bg-card-start)',
            border: esDomingo ? '1px solid rgba(245, 158, 11, 0.35)' : '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)',
            padding: '1.25rem',
            marginBottom: '1.5rem',
            boxShadow: esDomingo ? '0 0 20px rgba(245, 158, 11, 0.08)' : 'none',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '0.75rem',
              marginBottom: '1rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <Trophy size={22} style={{ color: esDomingo ? '#f59e0b' : 'var(--color-primary)' }} />
              <div>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>
                  {esDomingo
                    ? 'Cuadros Eliminatorios — Definición del Domingo'
                    : 'Cuadros Eliminatorios (Brackets)'}
                </h3>
                <p style={{ margin: 0, fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                  {esDomingo
                    ? 'Seguimiento de cruces, avance de llaves y campeones del torneo.'
                    : 'Visualizá las llaves de cada categoría, el progreso de cruces y la asignación de clasificados.'}
                </p>
              </div>
            </div>
          </div>

          {/* Aviso si alguna categoría completó sus zonas */}
          {data.categorias && data.categorias.some((c) => c.zonasFinalizadas) && (
            <div
              style={{
                background: 'rgba(16, 185, 129, 0.12)',
                border: '1px solid var(--color-success)',
                borderRadius: 'var(--radius-md)',
                padding: '0.65rem 0.9rem',
                marginBottom: '1rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: 'var(--font-size-xs)',
                color: 'var(--color-text)',
              }}
            >
              <Zap size={16} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
              <span>
                <strong>¡Fase de grupos completada!</strong> Los clasificados y horarios de domingo se asignan y programan automáticamente al cuadro eliminatorio.
              </span>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: '0.85rem' }}>
            {(data.categorias || data.categoriasListasParaEliminatoria || []).map((cat) => {
              const isGenerating = generandoCrucesCatId === cat.id;
              const isReadyToAssign = cat.estadoEliminatoria === 'LISTA_PARA_ASIGNAR' || (!cat.estadoEliminatoria && data.categoriasListasParaEliminatoria?.some((c) => c.id === cat.id));
              const pctZonas = cat.totalPartidosZona > 0
                ? Math.round((cat.partidosZonaFinalizados / cat.totalPartidosZona) * 100)
                : 0;

              return (
                <div
                  key={cat.id}
                  style={{
                    background: cat.clasificadosAsignados
                      ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(20, 24, 33, 0.95))'
                      : 'rgba(0, 0, 0, 0.35)',
                    border: `1px solid ${cat.clasificadosAsignados ? 'rgba(16, 185, 129, 0.35)' : 'rgba(255, 255, 255, 0.08)'}`,
                    borderRadius: 'var(--radius-md)',
                    padding: '0.9rem 1rem',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                    boxShadow: cat.clasificadosAsignados ? '0 0 15px rgba(16, 185, 129, 0.08)' : 'none',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <div>
                    {/* Header de Categoría + Badge */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.35rem' }}>
                      <div style={{ fontWeight: 700, fontSize: 'var(--font-size-base)', color: 'var(--color-text)' }}>
                        {cat.nombre}
                      </div>

                      {/* Badge de Estado */}
                      {cat.clasificadosAsignados && cat.estadoEliminatoria !== 'FINALIZADA' ? (
                        <span
                          className="badge badge-success"
                          style={{ fontSize: '0.7rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.15rem 0.45rem' }}
                        >
                          <CheckCircle2 size={11} /> Clasificados listos
                        </span>
                      ) : isReadyToAssign ? (
                        <span
                          className="badge badge-success"
                          style={{ fontSize: '0.7rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.15rem 0.45rem' }}
                        >
                          <Zap size={11} /> ¡Zonas listas!
                        </span>
                      ) : cat.estadoEliminatoria === 'ESPERANDO_ZONAS' ? (
                        <span
                          className="badge badge-info"
                          style={{ fontSize: '0.7rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.15rem 0.45rem' }}
                        >
                          <Clock size={11} /> Cuadro armado
                        </span>
                      ) : cat.estadoEliminatoria === 'EN_CURSO' ? (
                        <span
                          className="badge badge-warning"
                          style={{
                            fontSize: '0.7rem',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                            padding: '0.15rem 0.45rem',
                            background: 'rgba(59, 130, 246, 0.15)',
                            color: '#60a5fa',
                            borderColor: 'rgba(59, 130, 246, 0.3)',
                          }}
                        >
                          <Flame size={11} /> En disputa
                        </span>
                      ) : cat.estadoEliminatoria === 'FINALIZADA' ? (
                        <span
                          className="badge badge-success"
                          style={{ fontSize: '0.7rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.15rem 0.45rem' }}
                        >
                          <CheckCircle2 size={11} /> 🏆 Definido
                        </span>
                      ) : (
                        <span
                          style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary)' }}
                        >
                          {cat.tieneEliminatoria ? 'Cuadro listo' : 'Sin cuadro'}
                        </span>
                      )}
                    </div>

                    {/* Prioridad Domingo */}
                    <div style={{ marginBottom: '0.5rem' }}>
                      {cat.ordenDomingo ? (
                        <span
                          className="badge badge-info"
                          style={{ fontSize: '0.68rem', padding: '0.1rem 0.4rem' }}
                        >
                          Domingo: #{cat.ordenDomingo} en arrancar
                        </span>
                      ) : (
                        <span style={{ fontSize: '0.68rem', color: 'var(--color-text-secondary)' }}>
                          Sin prioridad asignada para el domingo
                        </span>
                      )}
                    </div>

                    {/* Progreso de Zonas */}
                    {cat.totalPartidosZona > 0 && (
                      <div style={{ marginTop: '0.4rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--color-text-secondary)', marginBottom: '0.2rem' }}>
                          <span>Zonas</span>
                          <span>{cat.partidosZonaFinalizados}/{cat.totalPartidosZona} jugados ({pctZonas}%)</span>
                        </div>
                        <div style={{ width: '100%', height: '4px', background: 'rgba(255, 255, 255, 0.08)', borderRadius: '2px', overflow: 'hidden' }}>
                          <div
                            style={{
                              width: `${pctZonas}%`,
                              height: '100%',
                              background: pctZonas === 100 ? 'var(--color-success)' : 'var(--color-primary)',
                              borderRadius: '2px',
                              transition: 'width 0.3s ease',
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Info de Eliminatoria */}
                    {cat.tieneEliminatoria && (
                      <div style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', marginTop: '0.45rem' }}>
                        {cat.estadoEliminatoria === 'ESPERANDO_ZONAS' ? (
                          <span>Cruces iniciales definidos. Se completan automáticamente al finalizar zonas.</span>
                        ) : cat.totalPartidosEliminatoria > 0 ? (
                          <span>{cat.primeraRondaNombre || 'Eliminatoria'}: {cat.partidosEliminatoriaFinalizados}/{cat.totalPartidosEliminatoria} jugados</span>
                        ) : null}
                      </div>
                    )}
                  </div>

                  {/* Acciones */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', paddingTop: '0.6rem', borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
                    {cat.tieneEliminatoria && (
                      <Link
                        to={`/admin/torneos/${id}/categorias/${cat.id}/eliminatoria`}
                        className="btn-secondary"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          padding: '0.4rem 0.75rem',
                          fontSize: 'var(--font-size-xs)',
                          textDecoration: 'none',
                          flex: '1',
                          justifyContent: 'center',
                        }}
                        title={`Ver cuadro eliminatorio de ${cat.nombre}`}
                      >
                        <GitBranch size={14} /> Ver Bracket
                      </Link>
                    )}

                    {!cat.tieneEliminatoria && (
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={isGenerating}
                        onClick={() => handleGenerarCruces(cat.id, cat.nombre)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          padding: '0.4rem 0.75rem',
                          fontSize: 'var(--font-size-xs)',
                          flex: '1',
                          justifyContent: 'center',
                        }}
                      >
                        <GitBranch size={14} /> Generar Bracket
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
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: '0.75rem',
          marginBottom: '1.75rem',
        }}
      >
        <div
          style={{
            background: 'var(--bg-card-start)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: '0.75rem 1rem',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '1.25rem', fontWeight: 800 }}>{resumenContextual.totalPartidos}</div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
            {esModoTodo ? 'Total Torneo' : `Partidos ${activeJornadaInfo?.diaNombre || ''}`}
          </div>
        </div>

        <div
          style={{
            background: 'var(--bg-card-start)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: '0.75rem 1rem',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--color-primary)' }}>
            {resumenContextual.enCurso}
          </div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>En Juego</div>
        </div>

        <div
          style={{
            background: 'var(--bg-card-start)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: '0.75rem 1rem',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#60a5fa' }}>
            {resumenContextual.pendientesConHorario}
          </div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>Programados</div>
        </div>

        <div
          style={{
            background: 'var(--bg-card-start)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: '0.75rem 1rem',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--color-text-secondary)' }}>
            {resumenContextual.finalizados}
          </div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>Finalizados</div>
        </div>

        {resumenContextual.pendientesSinHorario > 0 && (
          <div
            style={{
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 'var(--radius-md)',
              padding: '0.75rem 1rem',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--color-danger)' }}>
              {resumenContextual.pendientesSinHorario}
            </div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-danger)' }}>Sin Horario</div>
          </div>
        )}
      </div>

      {/* ─── 7. Partidos en Curso y Próximos ──────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
        {/* Partidos en Juego */}
        <div>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Flame size={18} style={{ color: 'var(--color-primary)' }} />
            Partidos en Juego ({partidosEnCursoFiltrados.length})
          </h3>

          {partidosEnCursoFiltrados.length === 0 ? (
            <div
              style={{
                background: 'var(--bg-card-start)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: '2rem 1rem',
                textAlign: 'center',
                color: 'var(--color-text-muted)',
                fontSize: 'var(--font-size-sm)',
              }}
            >
              No hay partidos en juego para esta jornada.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {partidosEnCursoFiltrados.map((p) => {
                const sets = p.sets || [];
                const resultadoStr = sets.length > 0
                  ? sets.map((s) => `${s.gamesPareja1}-${s.gamesPareja2}`).join(' / ')
                  : null;

                return (
                  <div
                    key={p.id}
                    style={{
                      background: 'var(--bg-card-start)',
                      border: '1px solid rgba(0, 208, 132, 0.35)',
                      borderRadius: 'var(--radius-md)',
                      padding: '1rem',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span
                          style={{
                            fontSize: 'var(--font-size-xs)',
                            fontWeight: 700,
                            padding: '0.15rem 0.5rem',
                            borderRadius: 'var(--radius-sm)',
                            background: 'rgba(0, 208, 132, 0.15)',
                            color: 'var(--color-primary)',
                          }}
                        >
                          Cancha {p.canchaNumero}
                        </span>
                        {resultadoStr && (
                          <span
                            style={{
                              fontSize: 'var(--font-size-xs)',
                              fontWeight: 700,
                              padding: '0.15rem 0.5rem',
                              borderRadius: 'var(--radius-sm)',
                              background: 'rgba(0, 208, 132, 0.2)',
                              color: 'var(--color-primary)',
                              border: '1px solid rgba(0, 208, 132, 0.35)',
                            }}
                          >
                            Parcial: {resultadoStr}
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                        {p.categoria} {p.zona ? `• ${p.zona}` : p.fase ? `• ${p.fase}` : ''}
                      </span>
                    </div>

                    <div style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.2rem' }}>
                      {p.pareja1}
                    </div>
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>vs</div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                      {p.pareja2}
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: 'var(--font-size-xs)',
                        color: 'var(--color-text-secondary)',
                        paddingTop: '0.5rem',
                        borderTop: '1px solid rgba(255, 255, 255, 0.05)',
                      }}
                    >
                      <span>
                        Inicio: {new Date(p.horaInicio).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <button
                          type="button"
                          onClick={() => handleCambiarEstado(p.id, 'PENDIENTE')}
                          disabled={updatingPartidoId === p.id}
                          title="Revertir a Pendiente (sacar de la cancha)"
                          style={{
                            background: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid var(--color-border)',
                            borderRadius: 'var(--radius-sm)',
                            color: 'var(--color-text-secondary)',
                            cursor: updatingPartidoId === p.id ? 'not-allowed' : 'pointer',
                            padding: '0.35rem 0.6rem',
                            fontSize: 'var(--font-size-xs)',
                            fontWeight: 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.3rem',
                            transition: 'var(--transition-fast)',
                            opacity: updatingPartidoId === p.id ? 0.6 : 1,
                          }}
                        >
                          <RotateCcw size={13} />
                          Revertir
                        </button>
                        <button
                          type="button"
                          onClick={() => setPartidoParaResultado(buildPartidoParaModal(p))}
                          style={{
                            background: 'rgba(0, 208, 132, 0.15)',
                            border: '1px solid rgba(0, 208, 132, 0.35)',
                            borderRadius: 'var(--radius-sm)',
                            color: 'var(--color-primary)',
                            cursor: 'pointer',
                            padding: '0.35rem 0.75rem',
                            fontSize: 'var(--font-size-xs)',
                            fontWeight: 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.35rem',
                            transition: 'var(--transition-fast)',
                          }}
                        >
                          <ClipboardList size={14} />
                          {sets.length > 0 ? 'Actualizar Resultado' : 'Cargar Resultado'}
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Clock size={18} style={{ color: '#60a5fa' }} />
              Próximos Partidos ({proximosFiltrados.length})
            </h3>
          </div>

          {proximosFiltrados.length === 0 ? (
            <div
              style={{
                background: 'var(--bg-card-start)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: '2rem 1rem',
                textAlign: 'center',
                color: 'var(--color-text-muted)',
                fontSize: 'var(--font-size-sm)',
              }}
            >
              {esDomingo
                ? 'Los partidos del domingo se agendarán automáticamente cuando se completen las zonas y se asignen los clasificados.'
                : 'No hay partidos programados para esta jornada.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxHeight: '480px', overflowY: 'auto' }}>
              {proximosFiltrados.map((p) => (
                <div
                  key={p.id}
                  style={{
                    background: 'var(--bg-card-start)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '0.85rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.pareja1} <span style={{ color: 'var(--color-text-muted)' }}>vs</span> {p.pareja2}
                    </div>
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                      {p.categoria} {p.zona ? `• ${p.zona}` : p.fase ? `• ${p.fase}` : ''}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                    <div style={{ textAlign: 'right' }}>
                      <div
                        style={{
                          fontSize: 'var(--font-size-xs)',
                          fontWeight: 700,
                          padding: '0.15rem 0.45rem',
                          borderRadius: 'var(--radius-sm)',
                          background: 'rgba(255, 255, 255, 0.08)',
                          color: 'var(--color-text)',
                          display: 'inline-block',
                          marginBottom: '0.2rem',
                        }}
                      >
                        Cancha {p.canchaNumero}
                      </div>
                      <div style={{ fontSize: 'var(--font-size-xs)', color: '#60a5fa', fontWeight: 600 }}>
                        {formatDiaHorario(p.fechaHora)}
                      </div>
                    </div>

                    {/* Botón iniciar partido (Marcar En Juego) */}
                    <button
                      type="button"
                      onClick={() => handleCambiarEstado(p.id, 'EN_CURSO')}
                      disabled={updatingPartidoId === p.id}
                      title="Marcar como En Juego (ingresó a la cancha)"
                      style={{
                        background: 'rgba(0, 208, 132, 0.15)',
                        border: '1px solid rgba(0, 208, 132, 0.4)',
                        borderRadius: 'var(--radius-sm)',
                        color: 'var(--color-primary)',
                        cursor: updatingPartidoId === p.id ? 'not-allowed' : 'pointer',
                        padding: '0.4rem 0.55rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.25rem',
                        fontSize: 'var(--font-size-xs)',
                        fontWeight: 700,
                        transition: 'var(--transition-fast)',
                        opacity: updatingPartidoId === p.id ? 0.6 : 1,
                      }}
                    >
                      <Play size={14} fill="currentColor" />
                    </button>

                    {/* Botón cargar resultado inline */}
                    <button
                      type="button"
                      onClick={() => setPartidoParaResultado(buildPartidoParaModal(p))}
                      title="Cargar resultado"
                      style={{
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-sm)',
                        color: 'var(--color-text-secondary)',
                        cursor: 'pointer',
                        padding: '0.4rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'var(--transition-fast)',
                      }}
                    >
                      <ClipboardList size={16} />
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
        <div style={{ marginTop: '1.75rem' }}>
          <button
            type="button"
            onClick={() => setFinalizadosExpanded((prev) => !prev)}
            style={{
              width: '100%',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'var(--bg-card-start)',
              border: '1px solid var(--color-border)',
              borderRadius: finalizadosExpanded ? 'var(--radius-md) var(--radius-md) 0 0' : 'var(--radius-md)',
              padding: '0.85rem 1rem',
              cursor: 'pointer',
              color: 'var(--color-text)',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, fontSize: '1.05rem' }}>
              <Trophy size={18} style={{ color: 'var(--color-text-secondary)' }} />
              Partidos Finalizados {activeJornadaInfo ? `(${activeJornadaInfo.diaNombre})` : ''} ({finalizadosFiltrados.length})
            </span>
            {finalizadosExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>

          {finalizadosExpanded && (
            <div
              style={{
                border: '1px solid var(--color-border)',
                borderTop: 'none',
                borderRadius: '0 0 var(--radius-md) var(--radius-md)',
                overflow: 'hidden',
                maxHeight: '420px',
                overflowY: 'auto',
              }}
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
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.75rem 1rem',
                      background: idx % 2 === 0 ? 'var(--bg-card-start)' : 'rgba(255,255,255,0.02)',
                      borderBottom: idx < partidosFinalizados.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 'var(--font-size-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <span
                          style={{
                            color: isP1Winner ? 'var(--color-primary)' : 'var(--color-text)',
                            fontWeight: isP1Winner ? 700 : 500,
                          }}
                        >
                          {p.pareja1}
                        </span>
                        <span style={{ color: 'var(--color-text-muted)', fontWeight: 400, margin: '0 0.35rem' }}>vs</span>
                        <span
                          style={{
                            color: isP2Winner ? 'var(--color-primary)' : 'var(--color-text)',
                            fontWeight: isP2Winner ? 700 : 500,
                          }}
                        >
                          {p.pareja2}
                        </span>
                      </div>
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                        {p.categoria}{p.zona ? ` • ${p.zona}` : p.fase ? ` • ${p.fase}` : ''}
                        {p.canchaNumero && ` • C${p.canchaNumero}`}
                        {p.fechaHora && ` • ${formatDiaHorario(p.fechaHora)}`}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexShrink: 0 }}>
                      <div
                        style={{
                          fontSize: 'var(--font-size-xs)',
                          fontWeight: 700,
                          color: 'var(--color-primary)',
                          background: 'rgba(0, 208, 132, 0.1)',
                          border: '1px solid rgba(0, 208, 132, 0.2)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '0.15rem 0.5rem',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {resultadoStr}
                      </div>

                      {/* Editar resultado finalizado */}
                      <button
                        type="button"
                        onClick={() => setPartidoParaResultado(buildPartidoParaModal(p))}
                        title="Editar resultado"
                        style={{
                          background: 'transparent',
                          border: '1px solid var(--color-border)',
                          borderRadius: 'var(--radius-sm)',
                          color: 'var(--color-text-secondary)',
                          cursor: 'pointer',
                          padding: '0.3rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
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

      {/* ─── Partidos Pendientes de Horario ─────────────────────────── */}
      <div id="partidos-pendientes-section" style={{ marginTop: '2.5rem' }}>
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
