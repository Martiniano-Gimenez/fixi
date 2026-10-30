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

  if (loading) return <div className="tl-loading">Cargando torneos…</div>;

  return (
    <div className="tl-screen">
      <div className="tl-header">
        <div>
          <h1 className="tl-title">
            <Trophy size={26} strokeWidth={2} className="tl-trophy" />
            Mis torneos
          </h1>
          <p className="tl-intro">
            Gestioná los eventos de tu club y sus respectivas categorías.
          </p>
        </div>
        <div className="tl-header-actions">
          <Link
            to="/admin/torneos/nuevo"
            className="tl-button tl-primary"
          >
            <Plus size={16} strokeWidth={2} />
            Nuevo torneo
          </Link>
        </div>
      </div>

      {error && <div className="tl-error">{error}</div>}

      {torneos.length === 0 && !error ? (
        <div className="tl-empty">
          <Trophy size={48} strokeWidth={1.5} className="tl-empty-icon" />
          <h3 className="tl-empty-title">No tenés torneos creados</h3>
          <p className="tl-empty-copy">
            Creá tu primer torneo (ej. "Pares Agosto") y comenzá a cargar sus categorías.
          </p>
          <Link to="/admin/torneos/nuevo" className="tl-button">
            <Plus size={16} /> Crear torneo
          </Link>
        </div>
      ) : (
        <div className="tl-grid">
          {torneos.map((torneo) => {
            const totalCategorias = torneo.categorias?.length || 0;
            const totalParejas = torneo.categorias?.reduce(
              (sum, c) => sum + (c.parejas?.length || 0),
              0
            ) || 0;

            return (
              <article key={torneo.id} className="tl-card">
                <Link
                  to={`/admin/torneos/${torneo.id}`}
                  className="tl-card-link"
                >
                  <div>
                    <div className="tl-card-heading">
                      <h3 className="tl-card-title">{torneo.nombre}</h3>
                      <span className={`tl-state tl-state-${(torneo.estado || 'borrador').toLowerCase()}`}>
                        {estadoLabel(torneo.estado)}
                      </span>
                    </div>

                    <div className="tl-date">
                      <Calendar size={14} />
                      <span>
                        {torneo.fecha ? formatFechaTorneo(torneo.fecha) : 'Fecha a confirmar'}
                      </span>
                    </div>
                  </div>

                  <div className="tl-card-footer">
                    <div className="tl-stats">
                      <span className="tl-stat">
                        <Layers size={14} className="tl-brand" />
                        <strong className="tl-strong">{totalCategorias}</strong>{' '}
                        {totalCategorias === 1 ? 'categoría' : 'categorías'}
                      </span>
                      <span className="tl-stat">
                        <Users size={14} className="tl-brand" />
                        <strong className="tl-strong">{totalParejas}</strong> parejas
                      </span>
                    </div>
                  </div>
                </Link>
                <button
                  type="button"
                  title="Eliminar torneo"
                  aria-label={`Eliminar torneo ${torneo.nombre}`}
                  onClick={(e) => handleDelete(e, torneo)}
                  className="tl-delete"
                >
                  <Trash2 size={16} strokeWidth={1.75} className="tl-icon" />
                </button>
              </article>
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
