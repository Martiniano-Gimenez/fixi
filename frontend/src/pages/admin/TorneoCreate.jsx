import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';

export default function TorneoCreate() {
  const [nombre, setNombre] = useState('');
  const [fecha, setFecha] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = { nombre, fecha: fecha || null };
      const torneo = await api.post('/torneos', data);
      navigate(`/admin/torneos/${torneo.id}`);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <div className="auth-card" style={{ margin: '0 auto', marginTop: '2rem' }}>
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
              placeholder="Ej: Copa Verano 2026"
            />
          </div>
          <div className="form-group">
            <label htmlFor="fecha">Fecha (Opcional)</label>
            <input 
              type="date" 
              id="fecha" 
              value={fecha} 
              onChange={(e) => setFecha(e.target.value)} 
            />
          </div>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Creando...' : 'Crear'}
          </button>
        </form>
      </div>
    </div>
  );
}
