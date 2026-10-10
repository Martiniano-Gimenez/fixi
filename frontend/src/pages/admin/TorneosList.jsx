import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import ConfirmModal from '../../components/ConfirmModal';
import { Plus, Trash2, Calendar, Layers, Users, Trophy } from 'lucide-react';
import { formatFechaTorneo } from '../../utils/dateUtils';
import { estadoLabel } from '../../utils/estadoLabels';

export default function TorneosList() {
  const [torneos, setTorneos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [torneoAEliminar, setTorneoAEliminar] = useState(null);
  const [eliminando, setEliminando] = useState(false);

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

  if (loading) return <div className="loading">Cargando torneos...</div>;

  return (
    <div className="page">
      <div className="flex-header">
        <div>
          <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Trophy size={26} strokeWidth={2} style={{ color: 'var(--color-primary)' }} />
            Mis Torneos
          </h1>
          <p style={{ margin: '0.25rem 0 0 0', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
            Gestioná los eventos de tu club y sus respectivas categorías.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <Link
            to="/admin/torneos/nuevo"
            className="btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', width: 'auto' }}
          >
            <Plus size={16} strokeWidth={2} />
            Nuevo Torneo
          </Link>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      {torneos.length === 0 && !error ? (
        <div className="empty-state" style={{ padding: '3rem 1rem', textAlign: 'center' }}>
          <Trophy size={48} strokeWidth={1.5} style={{ color: 'var(--color-text-secondary)', marginBottom: '1rem', opacity: 0.5 }} />
          <h3 style={{ margin: '0 0 0.5rem 0' }}>No tenés torneos creados</h3>
          <p style={{ margin: '0 0 1.5rem 0', color: 'var(--color-text-secondary)' }}>
            Creá tu primer torneo (ej. "Pares Agosto") y comenzá a cargar sus categorías.
          </p>
          <Link to="/admin/torneos/nuevo" className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', width: 'auto' }}>
            <Plus size={16} /> Crear Torneo
          </Link>
        </div>
      ) : (
        <div className="torneos-grid">
          {torneos.map((torneo) => {
            const totalCategorias = torneo.categorias?.length || 0;
            const totalParejas = torneo.categorias?.reduce(
              (sum, c) => sum + (c.parejas?.length || 0),
              0
            ) || 0;

            return (
              <Link
                key={torneo.id}
                to={`/admin/torneos/${torneo.id}`}
                className="torneo-card"
                style={{
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '1rem',
                }}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                    <h3 style={{ margin: 0, fontSize: 'var(--font-size-lg)' }}>{torneo.nombre}</h3>
                    <span className={`badge badge-${(torneo.estado || 'borrador').toLowerCase()}`}>
                      {estadoLabel(torneo.estado)}
                    </span>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      color: 'var(--color-text-secondary)',
                      fontSize: 'var(--font-size-sm)',
                      marginTop: '0.5rem',
                    }}
                  >
                    <Calendar size={14} />
                    <span>
                      {torneo.fecha ? formatFechaTorneo(torneo.fecha) : 'Fecha a confirmar'}
                    </span>
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingTop: '0.75rem',
                    borderTop: '1px solid var(--color-border)',
                    fontSize: 'var(--font-size-sm)',
                  }}
                >
                  <div style={{ display: 'flex', gap: '1rem', color: 'var(--color-text-secondary)' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <Layers size={14} style={{ color: 'var(--color-primary)' }} />
                      <strong style={{ color: 'var(--color-text)' }}>{totalCategorias}</strong>{' '}
                      {totalCategorias === 1 ? 'categoría' : 'categorías'}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <Users size={14} style={{ color: 'var(--color-accent)' }} />
                      <strong style={{ color: 'var(--color-text)' }}>{totalParejas}</strong> parejas
                    </span>
                  </div>

                  <button
                    type="button"
                    className="btn-danger"
                    title="Eliminar torneo"
                    onClick={(e) => handleDelete(e, torneo)}
                    style={{
                      padding: '0.35rem 0.5rem',
                      fontSize: '0.8rem',
                      display: 'inline-flex',
                      alignItems: 'center',
                      background: 'transparent',
                      borderColor: 'transparent',
                    }}
                  >
                    <Trash2 size={16} strokeWidth={1.75} style={{ color: 'var(--color-danger)' }} />
                  </button>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Modal de confirmación para eliminar torneo */}
      <ConfirmModal
        isOpen={Boolean(torneoAEliminar)}
        title="Eliminar Torneo"
        message={
          <>
            ¿Estás seguro de que querés eliminar el torneo{' '}
            <strong>"{torneoAEliminar?.nombre}"</strong>?
            <br />
            <br />
            Se eliminarán permanentemente todas sus categorías, parejas, zonas y partidos.
          </>
        }
        confirmText="Eliminar Torneo"
        isDanger={true}
        isLoading={eliminando}
        onConfirm={executeDelete}
        onCancel={() => setTorneoAEliminar(null)}
      />
    </div>
  );
}
