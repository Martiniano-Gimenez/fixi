import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../../api/client';

export default function ParejasManager() {
  const { id } = useParams();
  const [torneo, setTorneo] = useState(null);
  const [parejas, setParejas] = useState([]);
  const [jugador1, setJugador1] = useState('');
  const [jugador2, setJugador2] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchData();
  }, [id]);

  const fetchData = async () => {
    try {
      const [torneoData, parejasData] = await Promise.all([
        api.get(`/torneos/${id}`),
        api.get(`/torneos/${id}/parejas`)
      ]);
      setTorneo(torneoData);
      setParejas(parejasData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    
    try {
      await api.post(`/torneos/${id}/parejas`, { jugador1, jugador2 });
      setJugador1('');
      setJugador2('');
      fetchData(); // recargar
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDelete = async (parejaId) => {
    if (!window.confirm('¿Seguro que querés eliminar esta pareja?')) return;
    try {
      await api.delete(`/parejas/${parejaId}`);
      fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

  if (loading) return <div className="loading">Cargando...</div>;
  if (error) return <div className="error-message">{error}</div>;

  return (
    <div className="page">
      <div className="flex-header">
        <div>
          <Link to={`/admin/torneos/${id}`} style={{ fontSize: 'var(--font-size-sm)' }}>← Volver al torneo</Link>
          <h1 style={{ marginTop: '0.5rem' }}>Gestionar Parejas</h1>
        </div>
      </div>

      <div className="manager-grid">
        
        {/* Formulario (solo en BORRADOR) */}
        <div>
          <div className="torneo-card">
            <h3>Agregar Pareja</h3>
            <form onSubmit={handleAdd} style={{ marginTop: '1rem' }}>
              <div className="form-group">
                <label>Jugador 1</label>
                <input type="text" value={jugador1} onChange={e => setJugador1(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>Jugador 2</label>
                <input type="text" value={jugador2} onChange={e => setJugador2(e.target.value)} required />
              </div>
              <button type="submit" className="btn-primary">Añadir</button>
            </form>
          </div>
        </div>

        {/* Listado */}
        <div>
          <div className="torneo-card">
            <h3>Parejas Inscritas ({parejas.length})</h3>
            {parejas.length === 0 ? (
              <p style={{ marginTop: '1rem', color: 'var(--color-text-secondary)' }}>No hay parejas todavía.</p>
            ) : (
              <ul style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {parejas.map(p => (
                  <li key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', background: 'var(--color-bg-input)', borderRadius: 'var(--radius-md)' }}>
                    <span>{p.jugador1} / {p.jugador2}</span>
                    <button 
                      onClick={() => handleDelete(p.id)}
                      style={{ color: 'var(--color-danger)', fontSize: 'var(--font-size-sm)' }}
                    >
                      Eliminar
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
