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
  Trash2,
  Layers,
  Users,
  AlertTriangle,
  RefreshCw,
  Eye,
  Settings,
} from 'lucide-react';

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
  const [conflictosBloqueo, setConflictosBloqueo] = useState(null);
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

  const handlePreCheckInicio = async () => {
    setVerificandoInicio(true);
    setConflictosBloqueo(null);
    try {
      const res = await api.post(`/torneos/${id}/pre-check-inicio`);
      if (res.bloqueado) {
        setConflictosBloqueo(res.conflictos || []);
      } else {
        setPlanId(res.planId);
        setIniciarModalOpen(true);
      }
    } catch (err) {
      alert(err.message || 'Error al verificar la disponibilidad de las categorías.');
    } finally {
      setVerificandoInicio(false);
    }
  };

  const executeIniciarTorneo = async () => {
    setIniciandoTorneo(true);
    try {
      const res = await api.post(`/torneos/${id}/iniciar`, { planId });
      setIniciarModalOpen(false);
      setPlanId(null);
      setResultadoInicio(res);
      fetchData();
    } catch (err) {
      alert(err.message || 'Error al iniciar el torneo.');
      setIniciarModalOpen(false);
      setPlanId(null);
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

      {/* Banner de resultado tras iniciar */}
      {resultadoInicio && (
        <div
          className="card"
          style={{
            marginBottom: '1.5rem',
            background: 'rgba(34, 197, 94, 0.1)',
            borderColor: 'rgba(34, 197, 94, 0.3)',
          }}
        >
          <h3 style={{ margin: '0 0 0.5rem 0', color: 'var(--color-primary)' }}>
            🎉 ¡Torneo iniciado exitosamente!
          </h3>
          <p style={{ margin: 0, color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
            Se crearon las zonas y se asignaron automáticamente los turnos y canchas para todas las categorías.
          </p>
        </div>
      )}

      {/* Listado de Categorías */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 'var(--font-size-xl)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Layers size={22} style={{ color: 'var(--color-primary)' }} />
            Categorías del Torneo
          </h2>
          <p style={{ margin: '0.2rem 0 0 0', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
            Cada categoría cuenta con su propio cuadro de parejas, zonas, fixture y eliminatorias.
          </p>
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

      {/* Modal de conflictos de bloqueo */}
      {conflictosBloqueo && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '550px' }}>
            <h3 style={{ margin: '0 0 1rem 0', color: 'var(--color-danger)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <AlertTriangle size={22} /> No se puede iniciar el torneo
            </h3>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: '1rem' }}>
              Existen incompatibilidades de horarios entre parejas o no hay franjas libres suficientes en las canchas configuradas:
            </p>

            <div style={{ maxHeight: '300px', overflowY: 'auto', marginBottom: '1.25rem' }}>
              {conflictosBloqueo.map((c) => (
                <div
                  key={c.categoriaId}
                  style={{
                    padding: '0.75rem',
                    background: 'rgba(239, 68, 68, 0.08)',
                    borderRadius: 'var(--radius-sm)',
                    marginBottom: '0.5rem',
                    border: '1px solid rgba(239, 68, 68, 0.2)',
                  }}
                >
                  <strong style={{ color: 'var(--color-danger)' }}>{c.nombreCategoria}</strong>
                  <ul style={{ margin: '0.4rem 0 0 1.25rem', fontSize: 'var(--font-size-sm)', padding: 0 }}>
                    {c.partidosSinHorario.map((p, idx) => (
                      <li key={idx} style={{ marginBottom: '0.25rem' }}>
                        {p.zona}: {p.pareja1} vs {p.pareja2}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="btn-secondary" onClick={() => setConflictosBloqueo(null)}>
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
