import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../../api/client';
import ConfirmModal from '../../components/ConfirmModal';
import DisponibilidadEditor from '../../components/DisponibilidadEditor';

export default function ParejasManager() {
  const { id } = useParams();
  const [torneo, setTorneo] = useState(null);
  const [parejas, setParejas] = useState([]);
  const [jugador1, setJugador1] = useState('');
  const [jugador2, setJugador2] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [parejaToDelete, setParejaToDelete] = useState(null);
  const [expandedParejaId, setExpandedParejaId] = useState(null);

  useEffect(() => {
    fetchData();
  }, [id]);

  const fetchData = async () => {
    try {
      const [torneoData, parejasData] = await Promise.all([
        api.get(`/torneos/${id}`),
        api.get(`/torneos/${id}/parejas`),
      ]);
      setTorneo(torneoData);

      // Cargar disponibilidades de cada pareja para mostrar el badge
      const parejasConDisp = await Promise.all(
        parejasData.map(async (p) => {
          try {
            const disps = await api.get(`/parejas/${p.id}/disponibilidades`);
            return { ...p, _cantFranjas: disps.length };
          } catch {
            return { ...p, _cantFranjas: 0 };
          }
        })
      );
      setParejas(parejasConDisp);
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
      fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDelete = (parejaId) => {
    setParejaToDelete(parejaId);
  };

  const executeDelete = async () => {
    if (!parejaToDelete) return;
    try {
      await api.delete(`/parejas/${parejaToDelete}`);
      setParejaToDelete(null);
      fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

  const toggleDisponibilidad = (parejaId) => {
    setExpandedParejaId((prev) => (prev === parejaId ? null : parejaId));
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
                  <li key={p.id} style={{ background: 'var(--color-bg-input)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                    {/* Fila principal */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                        <span>{p.jugador1} / {p.jugador2}</span>
                        {p._cantFranjas > 0 && (
                          <span className="disponibilidad-badge">
                            ⏰ {p._cantFranjas} franja{p._cantFranjas > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <button
                          onClick={() => toggleDisponibilidad(p.id)}
                          className={`btn-chip${expandedParejaId === p.id ? ' active' : ''}`}
                          title="Gestionar disponibilidad horaria"
                        >
                          ⏰ Horarios
                        </button>
                        <button
                          onClick={() => handleDelete(p.id)}
                          style={{ color: 'var(--color-danger)', fontSize: 'var(--font-size-sm)' }}
                        >
                          Eliminar
                        </button>
                      </div>
                    </div>

                    {/* Panel de disponibilidad expandible */}
                    {expandedParejaId === p.id && (
                      <div style={{
                        borderTop: '1px solid var(--color-border)',
                        padding: '1rem',
                        background: 'var(--color-bg-card)',
                        animation: 'fadeIn 0.15s ease',
                      }}>
                        <h4 style={{ marginBottom: '0.75rem', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
                          Disponibilidad horaria
                        </h4>
                        <DisponibilidadEditor
                          parejaId={p.id}
                          onClose={() => {
                            setExpandedParejaId(null);
                            fetchData(); // actualizar badge
                          }}
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

      </div>

      {parejaToDelete && (
        <ConfirmModal
          isOpen={true}
          title="🗑️ Eliminar Pareja"
          message="¿Estás seguro de que querés eliminar esta pareja? Esta acción no se puede deshacer."
          onConfirm={executeDelete}
          onCancel={() => setParejaToDelete(null)}
          confirmText="Sí, eliminar"
          isDanger={true}
        />
      )}
    </div>
  );
}
