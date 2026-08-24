import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import ConfirmModal from '../../components/ConfirmModal';
import {
  ChevronLeft,
  Plus,
  Play,
  Calendar,
  RotateCcw,
  Copy,
  Check,
  CheckCircle,
  Trash2,
  Layers,
  Users,
  AlertTriangle,
  RefreshCw,
  Eye,
  Settings,
} from 'lucide-react';
import InlineDisponibilidadEditor from '../../components/InlineDisponibilidadEditor';
import PartidosPendientesSection from '../../components/PartidosPendientesSection';

export default function TorneoDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [torneo, setTorneo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Modales y estados
  const [copiado, setCopiado] = useState(false);
  const [nuevaCatModalOpen, setNuevaCatModalOpen] = useState(false);
  const [nombreNuevaCat, setNombreNuevaCat] = useState('');
  const [creandoCat, setCreandoCat] = useState(false);

  const [categoriaAEliminar, setCategoriaAEliminar] = useState(null);
  const [eliminandoCat, setEliminandoCat] = useState(false);

  const [reiniciarModalOpen, setReiniciarModalOpen] = useState(false);
  const [reiniciando, setReiniciando] = useState(false);

  // Iniciar Torneo Multi-categoría
  const [verificandoInicio, setVerificandoInicio] = useState(false);
  const [iniciarModalOpen, setIniciarModalOpen] = useState(false);
  const [iniciandoTorneo, setIniciandoTorneo] = useState(false);
  const [planId, setPlanId] = useState(null);
  const [planEmergenciaId, setPlanEmergenciaId] = useState(null);
  const [permiteInicioEmergencia, setPermiteInicioEmergencia] = useState(false);
  const [conteoInicialConflictos, setConteoInicialConflictos] = useState(null);
  const [confirmarEmergenciaModalOpen, setConfirmarEmergenciaModalOpen] = useState(false);
  const [conflictosBloqueo, setConflictosBloqueo] = useState(null);
  const [grillaOrganizador, setGrillaOrganizador] = useState({ viernes: [], sabado: [] });
  const [preCheckAprobado, setPreCheckAprobado] = useState(false);
  const [hayCambiosGuardados, setHayCambiosGuardados] = useState(false);
  const [resultadoInicio, setResultadoInicio] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const data = await api.get(`/torneos/${id}`);
      setTorneo(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCopyLink = () => {
    if (!torneo?.slug) return;
    const url = `${window.location.origin}/torneo/${torneo.slug}`;
    navigator.clipboard.writeText(url);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  const handleCrearCategoria = async (e) => {
    e.preventDefault();
    if (!nombreNuevaCat.trim()) return;
    setCreandoCat(true);
    try {
      await api.post(`/torneos/${id}/categorias`, { nombre: nombreNuevaCat.trim() });
      setNombreNuevaCat('');
      setNuevaCatModalOpen(false);
      fetchData();
    } catch (err) {
      alert(err.message || 'Error al crear la categoría.');
    } finally {
      setCreandoCat(false);
    }
  };

  const executeEliminarCategoria = async () => {
    if (!categoriaAEliminar) return;
    setEliminandoCat(true);
    try {
      await api.delete(`/categorias/${categoriaAEliminar.id}`);
      setCategoriaAEliminar(null);
      fetchData();
    } catch (err) {
      alert(err.message || 'Error al eliminar categoría.');
    } finally {
      setEliminandoCat(false);
    }
  };

  const handlePreCheckInicio = async (isReCheck = false) => {
    setVerificandoInicio(true);
    setHayCambiosGuardados(false);
    try {
      const res = await api.post(`/torneos/${id}/pre-check-inicio`);
      if (res.grillaOrganizador) {
        setGrillaOrganizador(res.grillaOrganizador);
      }
      if (res.bloqueado) {
        const conflictos = res.conflictos || [];
        const total = conflictos.reduce((acc, c) => acc + (c.partidosSinHorario?.length || 0), 0);
        setConflictosBloqueo(conflictos);
        setPermiteInicioEmergencia(Boolean(res.permiteInicioEmergencia));
        setPlanEmergenciaId(res.planEmergenciaId || null);
        setPreCheckAprobado(false);
        setPlanId(null);
        if (conteoInicialConflictos === null || !isReCheck) {
          setConteoInicialConflictos(total);
        }
      } else {
        setPlanId(res.planId);
        setPlanEmergenciaId(null);
        if (conflictosBloqueo !== null || isReCheck) {
          setConflictosBloqueo([]);
          setPreCheckAprobado(true);
        } else {
          setConflictosBloqueo(null);
          setPreCheckAprobado(false);
          setIniciarModalOpen(true);
        }
      }
    } catch (err) {
      alert(err.message || 'Error al verificar la disponibilidad de las categorías.');
    } finally {
      setVerificandoInicio(false);
    }
  };

  const handleSlotSaved = async (categoriaId, partidoId, parejaId, newSlots) => {
    setHayCambiosGuardados(true);
    setConflictosBloqueo((prev) => {
      if (!prev) return prev;
      return prev.map((cat) => {
        if (cat.categoriaId !== categoriaId) return cat;
        return {
          ...cat,
          partidosSinHorario: cat.partidosSinHorario.map((p) => {
            if (p.partidoId !== partidoId) return p;
            return {
              ...p,
              parejaMasRestringidaSlotIds: newSlots,
              parejaMasRestringidaSlots: newSlots.length,
            };
          }),
        };
      });
    });

    // Re-verificación reactiva automática en background
    await handlePreCheckInicio(true);
  };

  const executeIniciarTorneo = async () => {
    setIniciandoTorneo(true);
    try {
      const res = await api.post(`/torneos/${id}/iniciar`, { planId });
      setIniciarModalOpen(false);
      setConflictosBloqueo(null);
      setPreCheckAprobado(false);
      setPlanId(null);
      setPlanEmergenciaId(null);
      setConteoInicialConflictos(null);
      setResultadoInicio(res);
      fetchData();
    } catch (err) {
      alert(err.message || 'Error al iniciar el torneo.');
      setIniciarModalOpen(false);
      setConflictosBloqueo(null);
      setPreCheckAprobado(false);
      setPlanId(null);
      fetchData();
    } finally {
      setIniciandoTorneo(false);
    }
  };

  const executeIniciarTorneoEmergencia = async () => {
    if (!planEmergenciaId) return;
    setIniciandoTorneo(true);
    try {
      const res = await api.post(`/torneos/${id}/iniciar`, { planId: planEmergenciaId });
      setConfirmarEmergenciaModalOpen(false);
      setConflictosBloqueo(null);
      setPreCheckAprobado(false);
      setPlanId(null);
      setPlanEmergenciaId(null);
      setConteoInicialConflictos(null);
      setResultadoInicio(res);
      fetchData();
    } catch (err) {
      alert(err.message || 'Error al iniciar el torneo con partidos pendientes.');
      setConfirmarEmergenciaModalOpen(false);
      fetchData();
    } finally {
      setIniciandoTorneo(false);
    }
  };

  const executeReiniciarTorneo = async () => {
    setReiniciando(true);
    try {
      await api.post(`/torneos/${id}/reiniciar`);
      setReiniciarModalOpen(false);
      fetchData();
    } catch (err) {
      alert(err.message || 'Error al reiniciar el torneo.');
    } finally {
      setReiniciando(false);
    }
  };

  if (loading) return <div className="loading">Cargando torneo...</div>;
  if (error || !torneo) return <div className="error-message">{error || 'Torneo no encontrado'}</div>;

  const categoriasBorrador = (torneo.categorias || []).filter((c) => c.estado === 'BORRADOR');
  const puedeIniciar = categoriasBorrador.length > 0 && categoriasBorrador.some((c) => c.parejas?.length >= 2);

  return (
    <div className="page">
      {/* Volver */}
      <div style={{ marginBottom: '1rem' }}>
        <Link
          to="/admin"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            color: 'var(--color-text-secondary)',
            textDecoration: 'none',
            fontSize: 'var(--font-size-sm)',
          }}
        >
          <ChevronLeft size={16} /> Volver a Mis Torneos
        </Link>
      </div>

      {/* Header del Torneo */}
      <div className="card" style={{ marginBottom: '1.5rem', background: 'var(--color-surface-elevated)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <h1 style={{ margin: 0, fontSize: 'var(--font-size-2xl)' }}>{torneo.nombre}</h1>
              <span className={`badge badge-${torneo.estado.toLowerCase()}`}>{torneo.estado}</span>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '1.25rem',
                color: 'var(--color-text-secondary)',
                fontSize: 'var(--font-size-sm)',
                marginTop: '0.6rem',
                flexWrap: 'wrap',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <Calendar size={15} />
                {torneo.fecha
                  ? new Date(torneo.fecha).toLocaleDateString('es-AR', {
                      day: '2-digit',
                      month: 'long',
                      year: 'numeric',
                    })
                  : 'Fecha a confirmar'}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <Layers size={15} />
                {torneo.categorias?.length || 0} {(torneo.categorias?.length === 1) ? 'categoría' : 'categorías'}
              </span>
            </div>
          </div>

          {/* Acciones principales */}
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={handleCopyLink}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', width: 'auto' }}
              title="Copiar link público para compartir con jugadores"
            >
              {copiado ? <Check size={16} style={{ color: 'var(--color-primary)' }} /> : <Copy size={16} />}
              {copiado ? 'Link Copiado!' : 'Copiar Link Público'}
            </button>

            <a
              href={`/torneo/${torneo.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', width: 'auto', textDecoration: 'none' }}
              title="Abrir vista pública en nueva pestaña"
            >
              <Eye size={16} /> Ver Público
            </a>

            {puedeIniciar && (
              <button
                type="button"
                className="btn-primary"
                onClick={handlePreCheckInicio}
                disabled={verificandoInicio}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', width: 'auto' }}
              >
                {verificandoInicio ? (
                  <>
                    <RefreshCw size={16} className="spin" /> Verificando turnos...
                  </>
                ) : (
                  <>
                    <Play size={16} /> Iniciar Torneo y Asignar Horarios
                  </>
                )}
              </button>
            )}

            {torneo.estado !== 'BORRADOR' && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setReiniciarModalOpen(true)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  width: 'auto',
                  borderColor: 'rgba(239, 68, 68, 0.4)',
                  color: 'var(--color-danger)',
                }}
              >
                <RotateCcw size={16} /> Reiniciar Torneo
              </button>
            )}
          </div>
        </div>
      </div>


      {/* Sección de partidos pendientes de horario si el torneo está en curso */}
      {torneo.estado === 'EN_CURSO' && (
        <PartidosPendientesSection
          torneoId={torneo.id}
          torneoEstado={torneo.estado}
          onPartidosActualizados={fetchData}
        />
      )}

      {/* Listado de Categorías */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 'var(--font-size-xl)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Layers size={22} style={{ color: 'var(--color-primary)' }} />
            Categorías del Torneo
          </h2>
        </div>

        <button
          type="button"
          className="btn-primary"
          onClick={() => setNuevaCatModalOpen(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', width: 'auto' }}
        >
          <Plus size={16} /> Nueva Categoría
        </button>
      </div>

      {(!torneo.categorias || torneo.categorias.length === 0) ? (
        <div className="empty-state" style={{ padding: '3rem 1rem', textAlign: 'center' }}>
          <Layers size={44} style={{ color: 'var(--color-text-secondary)', marginBottom: '0.75rem', opacity: 0.5 }} />
          <h3 style={{ margin: '0 0 0.4rem 0' }}>No hay categorías cargadas</h3>
          <p style={{ margin: '0 0 1.25rem 0', color: 'var(--color-text-secondary)' }}>
            Comenzá agregando las categorías que participarán en este torneo (ej. 4ta, 6ta, 8va, Damas 5ta).
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={() => setNuevaCatModalOpen(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', width: 'auto' }}
          >
            <Plus size={16} /> Agregar Categoría
          </button>
        </div>
      ) : (
        <div className="torneos-grid">
          {torneo.categorias.map((cat) => {
            const totalParejas = cat.parejas?.length || 0;
            const totalZonas = cat.zonas?.length || 0;
            const totalPartidos = cat.partidos?.length || 0;
            const partidosFinalizados = (cat.partidos || []).filter((p) => p.estado === 'FINALIZADO').length;

            return (
              <div
                key={cat.id}
                className="torneo-card"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '1rem',
                  cursor: 'default',
                }}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                    <h3 style={{ margin: 0, fontSize: 'var(--font-size-xl)' }}>{cat.nombre}</h3>
                    <span className={`badge badge-${cat.estado.toLowerCase()}`}>{cat.estado}</span>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '1rem',
                      color: 'var(--color-text-secondary)',
                      fontSize: 'var(--font-size-sm)',
                      marginTop: '0.75rem',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <Users size={15} style={{ color: 'var(--color-primary)' }} />
                      <strong style={{ color: 'var(--color-text)' }}>{totalParejas}</strong> parejas
                    </span>
                    {totalZonas > 0 && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <Layers size={15} />
                        <strong style={{ color: 'var(--color-text)' }}>{totalZonas}</strong> zonas
                      </span>
                    )}
                    {totalPartidos > 0 && (
                      <span style={{ fontSize: 'var(--font-size-xs)' }}>
                        {partidosFinalizados}/{totalPartidos} jugados
                      </span>
                    )}
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingTop: '0.75rem',
                    borderTop: '1px solid var(--color-border)',
                    gap: '0.5rem',
                  }}
                >
                  <Link
                    to={`/admin/torneos/${torneo.id}/categorias/${cat.id}`}
                    className="btn-primary"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      flex: 1,
                      justifyContent: 'center',
                      padding: '0.45rem 0.75rem',
                      fontSize: 'var(--font-size-sm)',
                      textDecoration: 'none',
                    }}
                  >
                    <Settings size={15} /> Administrar Categoría
                  </Link>

                  <button
                    type="button"
                    className="btn-danger"
                    title="Eliminar categoría"
                    onClick={() => setCategoriaAEliminar(cat)}
                    style={{
                      padding: '0.45rem 0.6rem',
                      background: 'transparent',
                      borderColor: 'transparent',
                    }}
                  >
                    <Trash2 size={16} style={{ color: 'var(--color-danger)' }} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal para crear categoría */}
      {nuevaCatModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '420px' }}>
            <h3 style={{ margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Plus size={20} style={{ color: 'var(--color-primary)' }} /> Nueva Categoría
            </h3>

            <form onSubmit={handleCrearCategoria}>
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: 'var(--font-size-sm)' }}>
                  Nombre de la categoría:
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej: 4ta, 6ta, 8va, Damas 5ta..."
                  value={nombreNuevaCat}
                  onChange={(e) => setNombreNuevaCat(e.target.value)}
                  autoFocus
                  style={{ width: '100%' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setNuevaCatModalOpen(false);
                    setNombreNuevaCat('');
                  }}
                  disabled={creandoCat}
                >
                  Cancelar
                </button>
                <button type="submit" className="btn-primary" disabled={creandoCat || !nombreNuevaCat.trim()}>
                  {creandoCat ? 'Creando...' : 'Crear Categoría'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de confirmación para eliminar categoría */}
      <ConfirmModal
        isOpen={Boolean(categoriaAEliminar)}
        title="Eliminar Categoría"
        message={
          <>
            ¿Estás seguro de que querés eliminar la categoría{' '}
            <strong>"{categoriaAEliminar?.nombre}"</strong>?
            <br />
            <br />
            Se eliminarán sus parejas inscriptas, zonas y partidos.
          </>
        }
        confirmText="Eliminar Categoría"
        isDanger={true}
        isLoading={eliminandoCat}
        onConfirm={executeEliminarCategoria}
        onCancel={() => setCategoriaAEliminar(null)}
      />

      {/* Modal de confirmación para reiniciar torneo */}
      <ConfirmModal
        isOpen={reiniciarModalOpen}
        title="Reiniciar Torneo a Borrador"
        message={
          <>
            ¿Estás seguro de que querés reiniciar el torneo a <strong>BORRADOR</strong>?
            <br />
            <br />
            Se resetearán todas las zonas, partidos, llaves eliminatorias y horarios de todas las categorías. Las parejas y sus disponibilidades se mantendrán intactas.
          </>
        }
        confirmText="Sí, reiniciar torneo"
        isDanger={true}
        isLoading={reiniciando}
        onConfirm={executeReiniciarTorneo}
        onCancel={() => setReiniciarModalOpen(false)}
      />

      {/* Modal de confirmación para Iniciar Torneo Multi-categoría */}
      <ConfirmModal
        isOpen={iniciarModalOpen}
        title="Iniciar Torneo y Asignar Horarios"
        message={
          <>
            Se generarán las zonas para todas las categorías en borrador y se asignarán los turnos y canchas optimizados sin solapamientos.
            <br />
            <br />
            ¿Deseas continuar?
          </>
        }
        confirmText="Confirmar e Iniciar"
        isLoading={iniciandoTorneo}
        onConfirm={executeIniciarTorneo}
        onCancel={() => {
          setIniciarModalOpen(false);
          setPlanId(null);
        }}
      />

      {/* Modal de conflictos de bloqueo o éxito en pre-check */}
      {(conflictosBloqueo !== null || preCheckAprobado) && (
        <div className="modal-overlay">
          {preCheckAprobado ? (
            <div className="modal-content" style={{ maxWidth: '560px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                <CheckCircle size={28} color="var(--color-success)" style={{ flexShrink: 0 }} />
                <div>
                  <h3 style={{ margin: 0, color: 'var(--color-success)', fontSize: '1.25rem' }}>
                    ¡Listo para iniciar! 0 conflictos
                  </h3>
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                    Todos los cruces y horarios son 100% compatibles
                  </span>
                </div>
              </div>

              <div
                style={{
                  padding: '0.85rem 1rem',
                  background: 'rgba(34, 197, 94, 0.08)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid rgba(34, 197, 94, 0.2)',
                  marginBottom: '1.25rem',
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--color-text)',
                }}
              >
                Se verificó la asignación global de todas las categorías en borrador. No existen colisiones de cancha ni incompatibilidades horarias.
              </div>

              <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: '1.5rem', lineHeight: 1.5 }}>
                Al confirmar, se guardarán las zonas y los horarios de cada partido de forma definitiva en el torneo.
              </p>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setConflictosBloqueo(null);
                    setPreCheckAprobado(false);
                    setPlanId(null);
                  }}
                  disabled={iniciandoTorneo}
                >
                  Cerrar
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={executeIniciarTorneo}
                  disabled={iniciandoTorneo}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
                >
                  <Play size={16} />
                  {iniciandoTorneo ? 'Iniciando torneo...' : 'Iniciar Torneo'}
                </button>
              </div>
            </div>
          ) : (
            <div className="modal-content" style={{ maxWidth: '680px', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                <div>
                  <h3 style={{ margin: 0, color: 'var(--color-danger)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.2rem' }}>
                    <AlertTriangle size={22} /> Incompatibilidades detectadas
                  </h3>
                  {conteoInicialConflictos !== null &&
                    conflictosBloqueo.reduce((acc, c) => acc + (c.partidosSinHorario?.length || 0), 0) < conteoInicialConflictos && (
                      <span style={{ fontSize: '11.5px', color: 'var(--color-success)', fontWeight: 600, marginTop: '2px', display: 'block' }}>
                        ✓ ¡Resolviste {conteoInicialConflictos - conflictosBloqueo.reduce((acc, c) => acc + (c.partidosSinHorario?.length || 0), 0)} {conteoInicialConflictos - conflictosBloqueo.reduce((acc, c) => acc + (c.partidosSinHorario?.length || 0), 0) === 1 ? 'conflicto' : 'conflictos'}!
                      </span>
                    )}
                </div>
                <span className="badge badge-danger" style={{ fontSize: 'var(--font-size-xs)' }}>
                  {conflictosBloqueo.reduce((acc, c) => acc + (c.partidosSinHorario?.length || 0), 0)}{' '}
                  {conflictosBloqueo.reduce((acc, c) => acc + (c.partidosSinHorario?.length || 0), 0) === 1 ? 'pendiente' : 'pendientes'}
                </span>
              </div>


              <div style={{ flex: 1, overflowY: 'auto', marginBottom: '1.25rem', paddingRight: '0.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {conflictosBloqueo.map((c) => (
                  <div
                    key={c.categoriaId}
                    style={{
                      padding: '0.85rem',
                      background: 'var(--color-surface-elevated)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.4rem' }}>
                      <strong style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text)' }}>{c.nombreCategoria}</strong>
                      <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                        {c.partidosSinHorario.length} {c.partidosSinHorario.length === 1 ? 'conflicto' : 'conflictos'}
                      </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                      {c.partidosSinHorario.map((p, idx) => (
                        <div
                          key={idx}
                          style={{
                            padding: '0.65rem 0.75rem',
                            background: 'var(--color-bg-input)',
                            borderRadius: 'var(--radius-sm)',
                            borderLeft: `3px solid ${
                              p.motivo === 'SIN_FRANJA_COMUN'
                                ? '#ef4444'
                                : p.motivo === 'ZONA_MANUAL_INCOMPLETA'
                                ? '#eab308'
                                : '#f59e0b'
                            }`,
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.3rem' }}>
                            <span style={{ fontWeight: 600, fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                              {p.zona}
                            </span>
                            <span
                              className="badge"
                              style={{
                                fontSize: '11px',
                                padding: '2px 6px',
                                background:
                                  p.motivo === 'SIN_FRANJA_COMUN'
                                    ? 'rgba(239, 68, 68, 0.15)'
                                    : p.motivo === 'ZONA_MANUAL_INCOMPLETA'
                                    ? 'rgba(234, 179, 8, 0.15)'
                                    : 'rgba(245, 158, 11, 0.15)',
                                color:
                                  p.motivo === 'SIN_FRANJA_COMUN'
                                    ? '#ef4444'
                                    : p.motivo === 'ZONA_MANUAL_INCOMPLETA'
                                    ? '#eab308'
                                    : '#f59e0b',
                              }}
                            >
                              {p.motivo === 'SIN_FRANJA_COMUN'
                                ? 'Sin franja común'
                                : p.motivo === 'ZONA_MANUAL_INCOMPLETA'
                                ? 'Armado manual requerido'
                                : 'Canchas saturadas'}
                            </span>
                          </div>

                          {p.motivo === 'ZONA_MANUAL_INCOMPLETA' ? (
                            <div>
                              <div style={{ fontSize: 'var(--font-size-sm)', marginBottom: '0.35rem', color: 'var(--color-text)' }}>
                                <strong>Incompatibilidad para formar grupo:</strong> Las parejas de la zona no tienen horarios comunes para completar el fixture.
                              </div>

                              {p.crucesIncompatibles && p.crucesIncompatibles.length > 0 && (
                                <div style={{ marginBottom: '0.5rem', padding: '0.4rem 0.6rem', background: 'rgba(234, 179, 8, 0.08)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(234, 179, 8, 0.2)' }}>
                                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#eab308', marginBottom: '0.2rem' }}>
                                    Incompatibilidad directa en el grupo:
                                  </div>
                                  {p.crucesIncompatibles.map((ci, idx) => (
                                    <div key={idx} style={{ fontSize: '11.5px', color: 'var(--color-text)', marginBottom: '0.15rem' }}>
                                      • <strong>{ci.p1}</strong> no coincide en ningún turno con <strong>{ci.p2}</strong>.
                                    </div>
                                  ))}
                                </div>
                              )}

                              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginBottom: '0.5rem' }}>
                                Podés ampliar la disponibilidad de alguna de estas parejas con turnos libres o reestructurar la zona:
                              </div>

                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '0.6rem' }}>
                                {(p.parejasManuales || []).map((pm) => (
                                  <div
                                    key={pm.id}
                                    style={{
                                      padding: '0.35rem 0.5rem',
                                      background: 'var(--color-surface)',
                                      borderRadius: 'var(--radius-sm)',
                                      border: '1px solid var(--color-border)',
                                    }}
                                  >
                                    <div style={{ fontSize: 'var(--font-size-xs)', marginBottom: '0.2rem' }}>
                                      <strong>{pm.nombre}</strong> ({pm.slotsCount} {pm.slotsCount === 1 ? 'turno cargado' : 'turnos cargados'})
                                    </div>
                                    <InlineDisponibilidadEditor
                                      parejaId={pm.id}
                                      parejaNombre={pm.nombre}
                                      initialSlotIds={pm.slotIds || []}
                                      slotsViables={pm.slotsViables || []}
                                      slotsQueDestraban={pm.slotsQueDestraban || []}
                                      esZonaManual={true}
                                      grilla={grillaOrganizador}
                                      onSaved={async () => {
                                        setHayCambiosGuardados(true);
                                        await handlePreCheckInicio(true);
                                      }}
                                    />
                                  </div>
                                ))}
                              </div>

                              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                <Link
                                  to={`/admin/torneos/${id}/categorias/${c.categoriaId}/parejas`}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.3rem',
                                    fontSize: 'var(--font-size-xs)',
                                    color: 'var(--color-primary)',
                                    textDecoration: 'none',
                                    fontWeight: 600,
                                  }}
                                >
                                  Ir a Gestionar Parejas de {c.nombreCategoria} →
                                </Link>
                              </div>
                            </div>
                          ) : (
                            <div>
                              <div style={{ fontSize: 'var(--font-size-sm)', marginBottom: '0.25rem' }}>
                                <strong>{p.pareja1}</strong> vs <strong>{p.pareja2}</strong>
                              </div>

                              <div style={{ marginTop: '0.25rem', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                                {p.motivo === 'SIN_FRANJA_COMUN' ? (
                                  'Ambas parejas no tienen ninguna ventana horaria en común.'
                                ) : (
                                  'Coinciden en disponibilidad pero las canchas están 100% ocupadas en esa franja.'
                                )}
                              </div>

                              {p.parejaMasRestringidaNombre && (
                                <div style={{ marginTop: '0.35rem', fontSize: 'var(--font-size-xs)' }}>
                                  <span style={{ color: 'var(--color-text-secondary)' }}>Pareja más restringida a contactar: </span>
                                  <strong style={{ color: 'var(--color-text)' }}>{p.parejaMasRestringidaNombre}</strong>{' '}
                                  <span style={{ color: 'var(--color-text-secondary)' }}>
                                    ({p.parejaMasRestringidaSlots} turnos, {p.parejaMasRestringidaOpciones} {p.parejaMasRestringidaOpciones === 1 ? 'franja' : 'franjas'})
                                  </span>
                                </div>
                              )}

                              {/* Editor compacto de disponibilidad inline */}
                              {p.parejaMasRestringidaId && (
                                <InlineDisponibilidadEditor
                                  parejaId={p.parejaMasRestringidaId}
                                  parejaNombre={p.parejaMasRestringidaNombre}
                                  initialSlotIds={p.parejaMasRestringidaSlotIds || []}
                                  slotsViables={p.slotsViables || []}
                                  slotsQueDestraban={p.slotsQueDestraban || []}
                                  grilla={grillaOrganizador}
                                  onSaved={(pId, newSlots) => handleSlotSaved(c.categoriaId, p.partidoId, pId, newSlots)}
                                />
                              )}

                              {p.parejaMasRestringidaId && (
                                <div style={{ marginTop: '0.35rem' }}>
                                  <Link
                                    to={`/admin/torneos/${id}/categorias/${c.categoriaId}/parejas?parejaId=${p.parejaMasRestringidaId}`}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '0.25rem',
                                      fontSize: '11px',
                                      color: 'var(--color-text-secondary)',
                                      textDecoration: 'none',
                                    }}
                                  >
                                    Ver disponibilidad completa en Gestionar Parejas →
                                  </Link>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--color-border)' }}>
                <div>
                  {hayCambiosGuardados && (
                    <span
                      style={{
                        color: 'var(--color-warning)',
                        fontSize: '11px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                        fontWeight: 600,
                      }}
                    >
                      <AlertTriangle size={13} />
                      Hay cambios guardados. Hacé clic en "Volver a verificar".
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  {/* Botón de salida de emergencia (disponible siempre que haya plan de emergencia y no haya zonas manuales) */}
                  {!conflictosBloqueo.some((c) => c.partidosSinHorario.some((p) => p.motivo === 'ZONA_MANUAL_INCOMPLETA')) &&
                    Boolean(planEmergenciaId) && (
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{
                          color: 'var(--color-warning)',
                          borderColor: 'rgba(245, 158, 11, 0.5)',
                          fontSize: 'var(--font-size-xs)',
                          fontWeight: 600,
                        }}
                        onClick={() => setConfirmarEmergenciaModalOpen(true)}
                        disabled={verificandoInicio || iniciandoTorneo}
                      >
                        Iniciar dejando {conflictosBloqueo.reduce((acc, c) => acc + (c.partidosSinHorario?.length || 0), 0)} pendientes
                      </button>
                    )}

                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      setConflictosBloqueo(null);
                      setPreCheckAprobado(false);
                    }}
                    disabled={verificandoInicio || iniciandoTorneo}
                  >
                    Cerrar
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => handlePreCheckInicio(true)}
                    disabled={verificandoInicio || iniciandoTorneo}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
                  >
                    <RefreshCw size={15} className={verificandoInicio ? 'animate-spin' : ''} />
                    {verificandoInicio ? 'Verificando...' : 'Volver a verificar'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal de confirmación de Inicio de Emergencia */}
      {confirmarEmergenciaModalOpen && conflictosBloqueo && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '540px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.75rem', color: 'var(--color-warning)' }}>
              <AlertTriangle size={24} />
              <h3 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--color-text)' }}>
                ¿Iniciar torneo con partidos pendientes?
              </h3>
            </div>

            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: '0.85rem', lineHeight: 1.4 }}>
              Estás por iniciar el torneo dejando{' '}
              <strong style={{ color: 'var(--color-warning)' }}>
                {conflictosBloqueo.reduce((acc, c) => acc + (c.partidosSinHorario?.length || 0), 0)}{' '}
                {conflictosBloqueo.reduce((acc, c) => acc + (c.partidosSinHorario?.length || 0), 0) === 1
                  ? 'partido sin cancha ni horario asignado'
                  : 'partidos sin cancha ni horario asignado'}
              </strong>{' '}
              en las siguientes categorías:
            </p>

            <div
              style={{
                padding: '0.75rem 1rem',
                background: 'var(--color-surface)',
                borderRadius: 'var(--radius-sm)',
                marginBottom: '1rem',
                fontSize: 'var(--font-size-sm)',
                border: '1px solid var(--color-border)',
              }}
            >
              <ul style={{ margin: 0, paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                {conflictosBloqueo
                  .filter((c) => c.partidosSinHorario?.length > 0)
                  .map((c) => (
                    <li key={c.categoriaId}>
                      <strong>{c.nombreCategoria}:</strong> {c.partidosSinHorario.length}{' '}
                      {c.partidosSinHorario.length === 1 ? 'partido' : 'partidos'}
                    </li>
                  ))}
              </ul>
            </div>

            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginBottom: '1.5rem', lineHeight: 1.4 }}>
              Las zonas y cuadros se generarán normalmente y el torneo pasará a estado <strong>EN CURSO</strong>. Podrás asignarles cancha y horario a estos partidos en cualquier momento desde el panel de administración en tiempo real.
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setConfirmarEmergenciaModalOpen(false)}
                disabled={iniciandoTorneo}
              >
                Volver a intentar resolver
              </button>
              <button
                type="button"
                className="btn-primary"
                style={{ background: 'var(--color-warning)', color: '#000', fontWeight: 600 }}
                onClick={executeIniciarTorneoEmergencia}
                disabled={iniciandoTorneo}
              >
                {iniciandoTorneo ? 'Iniciando torneo...' : 'Iniciar de todas formas'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
