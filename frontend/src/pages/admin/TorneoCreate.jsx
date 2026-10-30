import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { isViernes } from '../../utils/dateUtils';

export default function TorneoCreate() {
  const [nombre, setNombre] = useState('');
  const [fecha, setFecha] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!fecha) {
      setError('Por favor, seleccioná una fecha de inicio.');
      return;
    }

    if (!isViernes(fecha)) {
      setError('La fecha de inicio debe ser un viernes (el torneo se juega de viernes a domingo).');
      return;
    }

    setLoading(true);

    try {
      const data = { nombre: nombre.trim(), fecha };
      const torneo = await api.post('/torneos', data);
      navigate(`/admin/torneos/${torneo.id}`);
    } catch (err) {
      setError(err.message || 'Error al crear el torneo.');
      setLoading(false);
    }
  };

  return (
    <div className="tc-page">
      <div className="tc-card">
        <h1 className="tc-title">Crear torneo</h1>
        <p className="tc-intro">Elegí el nombre y la fecha de inicio para organizar el fin de semana.</p>
        {error && <div className="tc-error" role="alert">{error}</div>}

        <form onSubmit={handleSubmit} className="tc-form">
          <div className="tc-field">
            <label htmlFor="nombre">Nombre del torneo</label>
            <input
              className="tc-input"
              type="text"
              id="nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              required
              autoFocus
              placeholder="Ej.: Copa Verano 2026"
            />
          </div>
          <div className="tc-field">
            <label htmlFor="fecha">Fecha de inicio (viernes)</label>
            <input
              className="tc-input"
              type="date"
              id="fecha"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              required
            />
            <p className="tc-help">
              Seleccioná la fecha de inicio del torneo. Es requerida para calcular los horarios y programar los partidos del fin de semana.
            </p>
          </div>
          <div className="tc-actions">
            <button
              type="button"
              className="tc-button"
              onClick={() => navigate('/admin')}
              disabled={loading}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="tc-button tc-primary"
              disabled={loading}
            >
              {loading ? 'Creando…' : 'Crear torneo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
