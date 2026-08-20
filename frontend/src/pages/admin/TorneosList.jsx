import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import ConfirmModal from '../../components/ConfirmModal';
import { Plus, Play, Trash2, Info, CheckCircle2, AlertTriangle } from 'lucide-react';

export default function TorneosList() {
  const [torneos, setTorneos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [torneoAEliminar, setTorneoAEliminar] = useState(null);
  const [eliminando, setEliminando] = useState(false);

  const [iniciarTodosModal, setIniciarTodosModal] = useState(false);
  const [iniciandoTodos, setIniciandoTodos] = useState(false);
  const [resultadoIniciarTodos, setResultadoIniciarTodos] = useState(null);

  useEffect(() => {
    fetchTorneos();
  }, []);

  const fetchTorneos = async () => {
    try {
      const data = await api.get('/torneos');
      setTorneos(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (e, torneo) => {
    e.preventDefault();
    e.stopPropagation();
    setTorneoAEliminar(torneo);
  };

  const executeDelete = async () => {
    if (!torneoAEliminar) return;
    setEliminando(true);
    try {
      await api.delete(`/torneos/${torneoAEliminar.id}`);
      setTorneoAEliminar(null);
      fetchTorneos();
    } catch (err) {
      alert(err.message || 'Error al eliminar torneo.');
    } finally {
      setEliminando(false);
    }
  };

  const executeIniciarTodos = async () => {
    setIniciandoTodos(true);
    try {
      const res = await api.post('/organizador/iniciar-todos');
      setIniciarTodosModal(false);
      setResultadoIniciarTodos(res);
      fetchTorneos();
    } catch (err) {
      alert(err.message || 'Error al iniciar los torneos.');
    } finally {
      setIniciandoTodos(false);
    }
  };

  if (loading) return <div className="loading">Cargando torneos...</div>;

  const torneosBorrador = torneos.filter((t) => t.estado === 'BORRADOR');

  return (
    <div className="page">
      <div className="flex-header">
        <h1>Mis Torneos</h1>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {torneosBorrador.length >= 2 && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setIniciarTodosModal(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', width: 'auto' }}
            >
              <Play size={14} strokeWidth={2} />
              Iniciar todos los torneos ({torneosBorrador.length})
            </button>
          )}
          <Link
            to="/admin/torneos/nuevo"
            className="btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', width: 'auto' }}
          >
            <Plus size={16} strokeWidth={2} />
            Crear Torneo
          </Link>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      {torneos.length === 0 && !error ? (
        <div className="empty-state">
          No tenés torneos creados. ¡Creá el primero!
        </div>
      ) : (
        <div className="torneos-grid">
          {torneos.map((torneo) => (
            <Link
              key={torneo.id}
              to={`/admin/torneos/${torneo.id}`}
              className="torneo-card"
              style={{ position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                  <h3 style={{ margin: 0 }}>{torneo.nombre}</h3>
                  <button
                    type="button"
                    onClick={(e) => handleDelete(e, torneo)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--color-text-muted)',
                      cursor: 'pointer',
                      padding: '0.25rem',
                      borderRadius: 'var(--radius-sm)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = 'var(--color-danger)';
                      e.currentTarget.style.background = 'var(--color-danger-bg)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = 'var(--color-text-muted)';
                      e.currentTarget.style.background = 'none';
                    }}
                    title="Eliminar torneo"
                  >
                    <Trash2 size={16} strokeWidth={2} />
                  </button>
                </div>
                <p style={{ marginTop: '0.5rem' }}>
                  Fecha: {torneo.fecha ? new Date(torneo.fecha).toLocaleDateString() : 'Sin fecha'}
                </p>
              </div>

              <div style={{ marginTop: '1rem' }}>
                <span className={`badge badge-${torneo.estado.toLowerCase()}`}>{torneo.estado}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {torneoAEliminar && (
        <ConfirmModal
          isOpen={true}
          title="Eliminar Torneo"
          message={`¿Estás seguro de que querés eliminar el torneo "${torneoAEliminar.nombre}"? Esta acción borrará todas sus parejas, zonas, partidos y resultados permanentemente.`}
          onConfirm={executeDelete}
          onCancel={() => setTorneoAEliminar(null)}
          confirmText={eliminando ? 'Eliminando...' : 'Sí, eliminar torneo'}
          isDanger={true}
        />
      )}

      {/* Modal de Confirmación para Iniciar Todos */}
      {iniciarTodosModal && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && !iniciandoTodos && setIniciarTodosModal(false)}>
          <div className="modal-content" style={{ maxWidth: '520px' }}>
            <h2 style={{ marginBottom: '1rem' }}>Iniciar todos los torneos</h2>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', marginBottom: '1.25rem', lineHeight: 1.5 }}>
              Se iniciarán los siguientes <strong>{torneosBorrador.length} torneos en borrador</strong> armando sus zonas por disponibilidad y asignando sus horarios en simultáneo:
            </p>

            <ul style={{ background: 'var(--color-bg-input)', padding: '0.75rem 1.25rem', borderRadius: 'var(--radius-md)', marginBottom: '1.25rem', fontSize: 'var(--font-size-sm)' }}>
              {torneosBorrador.map((t) => (
                <li key={t.id} style={{ margin: '0.35rem 0' }}>
                  <strong>{t.nombre}</strong>
                </li>
              ))}
            </ul>

            <div className="alert-warning" style={{ marginBottom: '1.5rem', fontSize: 'var(--font-size-xs)', display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
              <Info size={16} strokeWidth={2} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong>Prioridad inteligente:</strong> El sistema priorizará a los torneos y parejas con menor disponibilidad horaria para acomodarlos primero en las canchas del club, minimizando ajustes manuales.
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <button
                type="button"
                className="btn-primary"
                onClick={executeIniciarTodos}
                disabled={iniciandoTodos}
              >
                {iniciandoTodos ? 'Iniciando y programando torneos...' : 'Confirmar e iniciar todos'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setIniciarTodosModal(false)}
                disabled={iniciandoTodos}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Resultados tras Iniciar Todos */}
      {resultadoIniciarTodos && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setResultadoIniciarTodos(null)}>
          <div className="modal-content" style={{ maxWidth: '540px' }}>
            <h2 style={{ marginBottom: '1rem' }}>Torneos iniciados con éxito</h2>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', marginBottom: '1.25rem' }}>
              Resumen de asignación de partidos por categoría:
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
              {resultadoIniciarTodos.iniciados?.map((item) => (
                <div
                  key={item.torneoId}
                  style={{
                    background: 'var(--color-bg-input)',
                    padding: '0.75rem 1rem',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                    <strong>{item.nombre}</strong>
                    <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                      Avg. {item.promedioSlots} turnos/pareja
                    </span>
                  </div>
                  <div style={{ fontSize: 'var(--font-size-xs)', display: 'flex', gap: '1rem' }}>
                    <span style={{ color: 'var(--color-success)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                      <CheckCircle2 size={13} strokeWidth={2} /> {item.asignados} con horario
                    </span>
                    {item.sinHorario > 0 ? (
                      <span style={{ color: 'var(--color-warning)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                        <AlertTriangle size={13} strokeWidth={2} /> {item.sinHorario} sin horario
                      </span>
                    ) : (
                      <span style={{ color: 'var(--color-text-muted)' }}>
                        0 sin horario
                      </span>
                    )}
                  </div>
                </div>
              ))}

              {resultadoIniciarTodos.omitidos?.length > 0 && (
                <div className="alert-warning" style={{ fontSize: 'var(--font-size-xs)' }}>
                  <strong>Torneos no iniciados:</strong>
                  <ul style={{ marginTop: '0.25rem', paddingLeft: '1.2rem' }}>
                    {resultadoIniciarTodos.omitidos.map((o) => (
                      <li key={o.id}>{o.nombre}: {o.motivo}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <button
              type="button"
              className="btn-primary"
              onClick={() => setResultadoIniciarTodos(null)}
              style={{ width: '100%' }}
            >
              Aceptar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
