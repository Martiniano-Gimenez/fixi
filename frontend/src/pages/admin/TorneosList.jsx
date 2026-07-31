import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';

export default function TorneosList() {
  const [torneos, setTorneos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  if (loading) return <div className="loading">Cargando torneos...</div>;

  return (
    <div className="page">
      <div className="flex-header">
        <h1>Mis Torneos</h1>
        <Link to="/admin/torneos/nuevo" className="btn-primary" style={{ width: 'auto' }}>
          + Crear Torneo
        </Link>
      </div>

      {error && <div className="error-message">{error}</div>}

      {torneos.length === 0 && !error ? (
        <div className="empty-state">
          No tenés torneos creados. ¡Creá el primero!
        </div>
      ) : (
        <div className="torneos-grid">
          {torneos.map((torneo) => (
            <Link key={torneo.id} to={`/admin/torneos/${torneo.id}`} className="torneo-card">
              <h3>{torneo.nombre}</h3>
              <p>Fecha: {torneo.fecha ? new Date(torneo.fecha).toLocaleDateString() : 'Sin fecha'}</p>
              <span className={`badge badge-${torneo.estado.toLowerCase()}`}>{torneo.estado}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
