import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { isViernes } from '../../utils/dateUtils';
import './TorneoCreate.css';

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
    <div className="page">
      <div className="auth-card torneo-create-card">
        <h2>Crear Torneo</h2>
        {error && <div className="error-message">{error}</div>}
        
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="nombre">Nombre del torneo</label>
            <input 
              type="text" 
              id="nombre" 
              value={nombre} 
              onChange={(e) => setNombre(e.target.value)} 
              required 
              autoFocus
              placeholder="Ej: Copa Verano 2026"
            />
          </div>
          <div className="form-group">
            <label htmlFor="fecha">Fecha de inicio (viernes)</label>
            <input 
              type="date" 
              id="fecha" 
              value={fecha} 
              onChange={(e) => setFecha(e.target.value)} 
              required
            />
            <p className="form-help">
              Seleccioná la fecha de inicio del torneo. Es requerida para calcular los horarios y programar los partidos del fin de semana.
            </p>
          </div>
          <div className="torneo-create-actions">
            <button 
              type="button" 
              className="btn-secondary" 
              onClick={() => navigate('/admin')}
              disabled={loading}
            >
              Cancelar
            </button>
            <button 
              type="submit" 
              className="btn-primary" 
              disabled={loading}
            >
              {loading ? 'Creando...' : 'Crear torneo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
