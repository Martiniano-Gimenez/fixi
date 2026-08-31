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
  Activity,
  Flame,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  ClipboardList,
  Trophy,
  Play,
  RotateCcw,
} from 'lucide-react';
import { api } from '../../api/client';
import ConfirmModal from '../../components/ConfirmModal';
import ResultadoModal from '../../components/ResultadoModal';
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
        if (!userTouchedTarget) {
          setTargetCanchas(res.canchasActivas || res.canchasClub || 1);
        }
      } catch (err) {
        setError(err.message || 'Error al cargar el estado en vivo del torneo');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [id, userTouchedTarget]
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


  // Manejar reducción de canchas
  const handleReducir = async () => {
    setActionLoading(true);
    setError(null);
    try {
      const res = await api.post(`/torneos/${id}/canchas-override`, {
        canchasDisponiblesOverride: targetCanchas,
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

  const proximosPartidosList = data?.proximosPartidos || [];
  const horariosClub = data?.torneo?.horariosClub || null;

  // Derivar días únicos disponibles para los tabs respetando la lógica de trasnoche
  const diasDisponibles = useMemo(() => {
    if (!proximosPartidosList || proximosPartidosList.length === 0) return [];
    const map = new Map();
    for (const p of proximosPartidosList) {
      if (!p.fechaHora) continue;
      const info = getDiaCalendarioConTrasnoche(p.fechaHora, horariosClub);
      if (!info) continue;
      if (!map.has(info.key)) {
        map.set(info.key, {
          key: info.key,
          label: info.label,
          count: 0,
        });
      }
      map.get(info.key).count++;
    }
    return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [proximosPartidosList, horariosClub]);

  // Selección por defecto del tab (hoy o primer día con partidos pendientes)
  useEffect(() => {
    if (diasDisponibles.length === 0) {
      if (activeTabDay) setActiveTabDay(null);
      return;
    }

    if (activeTabDay && diasDisponibles.some((d) => d.key === activeTabDay)) {
      return;
    }

    const hoyInfo = getDiaCalendarioConTrasnoche(new Date(), horariosClub);
    const matchHoy = hoyInfo ? diasDisponibles.find((d) => d.key === hoyInfo.key) : null;

    if (matchHoy) {
      setActiveTabDay(matchHoy.key);
    } else {
      setActiveTabDay(diasDisponibles[0].key);
    }
  }, [diasDisponibles, activeTabDay, horariosClub]);

  // Partidos filtrados por el tab de día seleccionado
  const proximosFiltrados = useMemo(() => {
    if (!activeTabDay) return proximosPartidosList;
    return proximosPartidosList.filter((p) => {
      if (!p.fechaHora) return false;
      const info = getDiaCalendarioConTrasnoche(p.fechaHora, horariosClub);
      return info?.key === activeTabDay;
    });
  }, [proximosPartidosList, activeTabDay, horariosClub]);

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

  const { torneo, canchasActivas, canchasClub, canchas, partidosEnCurso, partidosEnCanchaFantasma, proximosPartidos, partidosFinalizados, resumenEstado } = data;
  const isLluviaActive = torneo.canchasDisponiblesOverride !== null && torneo.canchasDisponiblesOverride !== undefined;

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

      {/* ─── 2. Barra de Control de Canchas (Sticky) ──────────────── */}
      <div
        style={{
          position: 'sticky',
          top: '0.5rem',
          zIndex: 100,
          background: 'rgba(18, 21, 28, 0.95)',
          backdropFilter: 'blur(10px)',
          border: isLluviaActive ? '1px solid rgba(59, 130, 246, 0.5)' : '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          padding: '1rem 1.25rem',
          marginBottom: '1.25rem',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '1rem',
          }}
        >
          {/* Info de canchas activas */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
              <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text)' }}>
                Canchas activas:
              </span>
              <span
                style={{
                  fontSize: '1.25rem',
                  fontWeight: 800,
                  color: isLluviaActive ? '#60a5fa' : 'var(--color-primary)',
                }}
              >
                {canchasActivas} / {canchasClub}
              </span>
              {isLluviaActive ? (
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
                  Modo Lluvia ({torneo.overrideActivoDesde ? formatDiaHorario(torneo.overrideActivoDesde) : 'Activo'})
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
              {isLluviaActive
                ? 'Partidos pendientes reprogramados sobre las canchas techadas/disponibles.'
                : 'Todas las canchas del club habilitadas.'}
            </p>
          </div>

          {/* Selector y Acciones */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            {/* Control +/- */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                background: 'var(--bg-body)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                overflow: 'hidden',
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

            {/* Botón Reducir */}
            {targetCanchas < canchasActivas && (
              <button
                type="button"
                className="btn-primary"
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
                }}
              >
                <CloudRain size={15} />
                Reducir a {targetCanchas} {targetCanchas === 1 ? 'cancha' : 'canchas'}
              </button>
            )}

            {/* Botón Restaurar todas */}
            {isLluviaActive && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setConfirmRestaurarOpen(true)}
                disabled={actionLoading}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  fontSize: 'var(--font-size-xs)',
                  padding: '0.5rem 0.85rem',
                }}
              >
                <Sun size={15} style={{ color: '#f59e0b' }} />
                Restaurar todas ({canchasClub})
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ─── 3. Banner de Feedback Post-Reprogramación ──────────────── */}
      {feedbackReprogramacion && (
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
            </h3>
          </div>

          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: '0.75rem' }}>
            Se ajustaron los partidos pendientes respetando el orden relativo original.
            {' '}
            <strong style={{ color: 'var(--color-text)' }}>
              {feedbackReprogramacion.partidosReprogramados} partido(s) modificaron su horario/cancha
            </strong>
            {feedbackReprogramacion.partidosSinCambio > 0 && `, ${feedbackReprogramacion.partidosSinCambio} mantuvieron su slot`}
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
                {feedbackExpanded ? 'Ocultar detalle de cambios' : `Ver detalle de ${feedbackReprogramacion.cambios.length} cambios`}
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

      {/* ─── 5. Grilla de Canchas ─────────────────────────────────── */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '0.85rem' }}>
          Estado de Canchas
        </h2>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: '1rem',
          }}
        >
          {canchas.map((c) => {
            const isEnCurso = c.estado === 'EN_CURSO';
            const isInhabilitada = c.estado === 'INHABILITADA';
            const isLibre = c.estado === 'LIBRE';

            return (
              <div
                key={c.numero}
                style={{
                  background: isInhabilitada
                    ? 'rgba(239, 68, 68, 0.05)'
                    : isEnCurso
                    ? 'linear-gradient(145deg, rgba(0, 208, 132, 0.1), var(--bg-card-end))'
                    : 'var(--bg-card-start)',
                  border: isInhabilitada
                    ? '1px dashed rgba(239, 68, 68, 0.3)'
                    : isEnCurso
                    ? '1px solid rgba(0, 208, 132, 0.4)'
                    : '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-lg)',
                  padding: '1.15rem',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  minHeight: '170px',
                  opacity: isInhabilitada ? 0.65 : 1,
                  transition: 'var(--transition-base)',
                }}
              >
                {/* Header Cancha */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '0.75rem',
                  }}
                >
                  <span style={{ fontSize: '1.1rem', fontWeight: 800 }}>Cancha {c.numero}</span>
                  {isEnCurso && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                        fontSize: 'var(--font-size-xs)',
                        padding: '0.2rem 0.5rem',
                        borderRadius: '999px',
                        background: 'rgba(0, 208, 132, 0.2)',
                        color: 'var(--color-primary)',
                        fontWeight: 700,
                      }}
                    >
                      <Flame size={13} />
                      EN JUEGO
                    </span>
                  )}
                  {isLibre && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                        fontSize: 'var(--font-size-xs)',
                        padding: '0.2rem 0.5rem',
                        borderRadius: '999px',
                        background: 'rgba(255, 255, 255, 0.08)',
                        color: 'var(--color-text-secondary)',
                        fontWeight: 600,
                      }}
                    >
                      LIBRE
                    </span>
                  )}
                  {isInhabilitada && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                        fontSize: 'var(--font-size-xs)',
                        padding: '0.2rem 0.5rem',
                        borderRadius: '999px',
                        background: 'rgba(239, 68, 68, 0.2)',
                        color: 'var(--color-danger)',
                        fontWeight: 600,
                      }}
                    >
                      <CloudRain size={13} />
                      INHABILITADA
                    </span>
                  )}
                </div>

                {/* Contenido Cancha */}
                <div>
                  {isEnCurso && c.partidoActual && (
                    <div>
                      <div style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.2rem' }}>
                        {c.partidoActual.pareja1}
                      </div>
                      <div
                        style={{
                          fontSize: 'var(--font-size-xs)',
                          color: 'var(--color-text-muted)',
                          margin: '0.1rem 0',
                        }}
                      >
                        vs
                      </div>
                      <div style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                        {c.partidoActual.pareja2}
                      </div>
                      <div
                        style={{
                          fontSize: 'var(--font-size-xs)',
                          color: 'var(--color-text-secondary)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                        }}
                      >
                        <span>{c.partidoActual.categoria}</span>
                        {c.partidoActual.zona && <span>• {c.partidoActual.zona}</span>}
                        {c.partidoActual.fase && <span>• {c.partidoActual.fase}</span>}
                      </div>
                      {c.partidoActual.sets && c.partidoActual.sets.length > 0 && (
                        <div
                          style={{
                            fontSize: 'var(--font-size-xs)',
                            fontWeight: 700,
                            color: 'var(--color-primary)',
                            marginTop: '0.4rem',
                            display: 'inline-block',
                            background: 'rgba(0, 208, 132, 0.15)',
                            padding: '0.15rem 0.5rem',
                            borderRadius: 'var(--radius-sm)',
                            border: '1px solid rgba(0, 208, 132, 0.3)',
                          }}
                        >
                          Parcial: {c.partidoActual.sets.map((s) => `${s.gamesPareja1}-${s.gamesPareja2}`).join(' / ')}
                        </div>
                      )}
                    </div>
                  )}

                  {isLibre && (
                    <div style={{ textAlign: 'center', padding: '1rem 0', color: 'var(--color-text-muted)' }}>
                      <Activity size={24} style={{ opacity: 0.4, marginBottom: '0.3rem' }} />
                      <p style={{ fontSize: 'var(--font-size-xs)', margin: 0 }}>Cancha disponible</p>
                    </div>
                  )}

                  {isInhabilitada && (
                    <div style={{ textAlign: 'center', padding: '1rem 0', color: 'var(--color-text-muted)' }}>
                      <CloudRain size={24} style={{ opacity: 0.4, color: 'var(--color-danger)', marginBottom: '0.3rem' }} />
                      <p style={{ fontSize: 'var(--font-size-xs)', margin: 0, color: 'rgba(239, 68, 68, 0.8)' }}>
                        Inhabilitada por reducción de canchas
                      </p>
                    </div>
                  )}
                </div>

                {/* Footer Cancha */}
                {isEnCurso && c.partidoActual && (
                  <div
                    style={{
                      borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                      paddingTop: '0.5rem',
                      marginTop: '0.5rem',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: 'var(--font-size-xs)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                      <Clock size={12} />
                      Inicio: {new Date(c.partidoActual.horaInicio).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span>
                      Est. fin: {new Date(c.partidoActual.horaEstimadaFin).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

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
          <div style={{ fontSize: '1.25rem', fontWeight: 800 }}>{resumenEstado.totalPartidos}</div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>Total Partidos</div>
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
            {resumenEstado.enCurso}
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
            {resumenEstado.pendientesConHorario}
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
            {resumenEstado.finalizados}
          </div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>Finalizados</div>
        </div>

        {resumenEstado.pendientesSinHorario > 0 && (
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
              {resumenEstado.pendientesSinHorario}
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
            Partidos en Juego ({partidosEnCurso.length})
          </h3>

          {partidosEnCurso.length === 0 ? (
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
              No hay partidos en juego en este momento.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {partidosEnCurso.map((p) => {
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
              Próximos Partidos ({proximosPartidos.length})
            </h3>
          </div>

          {/* Tabs por Día */}
          {diasDisponibles.length > 1 && (
            <div
              style={{
                display: 'flex',
                gap: '0.4rem',
                marginBottom: '0.85rem',
                overflowX: 'auto',
                paddingBottom: '0.2rem',
                scrollbarWidth: 'none',
              }}
            >
              {diasDisponibles.map((dia) => {
                const isActive = dia.key === activeTabDay;
                return (
                  <button
                    key={dia.key}
                    type="button"
                    onClick={() => setActiveTabDay(dia.key)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.45rem',
                      padding: '0.35rem 0.8rem',
                      borderRadius: '999px',
                      fontSize: 'var(--font-size-xs)',
                      fontWeight: isActive ? 700 : 500,
                      background: isActive ? 'var(--color-primary)' : 'var(--bg-card-start)',
                      color: isActive ? '#0d1117' : 'var(--color-text-secondary)',
                      border: isActive ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                      cursor: 'pointer',
                      transition: 'var(--transition-fast)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <span>{dia.label}</span>
                    <span
                      style={{
                        fontSize: '11px',
                        padding: '0.1rem 0.4rem',
                        borderRadius: '999px',
                        background: isActive ? 'rgba(0, 0, 0, 0.25)' : 'rgba(255, 255, 255, 0.08)',
                        color: isActive ? '#0d1117' : 'var(--color-text-muted)',
                        fontWeight: 700,
                      }}
                    >
                      {dia.count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {proximosPartidos.length === 0 ? (
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
              No hay partidos pendientes con horario asignado.
            </div>
          ) : proximosFiltrados.length === 0 ? (
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
              No hay partidos pendientes para el día seleccionado.
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
      {partidosFinalizados && partidosFinalizados.length > 0 && (
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
              Partidos Finalizados ({partidosFinalizados.length})
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
              {partidosFinalizados.map((p, idx) => {
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

      {/* ─── Modal de Confirmación: Reducir Canchas (Modo Lluvia) ───── */}
      <ConfirmModal
        isOpen={confirmReducirOpen}
        title={`🌧️ ¿Reducir a ${targetCanchas} ${targetCanchas === 1 ? 'cancha activa' : 'canchas activas'}?`}
        message={`Se activará el Modo Lluvia y se reprogramarán automáticamente todos los partidos pendientes a partir de este momento para ajustarse a ${targetCanchas} ${targetCanchas === 1 ? 'cancha' : 'canchas'}. Los partidos en curso y finalizados no se modificarán.`}
        confirmText={actionLoading ? 'Reprogramando...' : 'Reducir y Reprogramar'}
        onConfirm={handleReducir}
        onCancel={() => setConfirmReducirOpen(false)}
        isDanger={true}
      />

      {/* ─── Modal de Confirmación: Restaurar Canchas ───────────────── */}
      <ConfirmModal
        isOpen={confirmRestaurarOpen}
        title="☀️ ¿Restaurar todas las canchas del club?"
        message={`Se desactivará el Modo Lluvia y volverán a estar habilitadas las ${canchasClub} canchas del club. Los partidos ya reprogramados mantendrán su horario actual (no se mueven automáticamente).`}
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
