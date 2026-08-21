import { useState, useEffect } from 'react';
import { api } from '../api/client';

export default function EditBracketMatchModal({ partido, zonas = [], onClose, onSuccess, onSaved }) {
  const [origen1, setOrigen1] = useState('');
  const [origen2, setOrigen2] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (partido) {
      setOrigen1(partido.origenPareja1 || '');
      setOrigen2(partido.origenPareja2 || '');
    }
  }, [partido]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (origen1 && origen2 && origen1 === origen2) {
      setError('No podés asignar el mismo origen en ambos lados del partido.');
      return;
    }

    try {
      setLoading(true);
      await api.patch(`/partidos/${partido.id}/bracket`, {
        origenPareja1: origen1 || null,
        origenPareja2: origen2 || null,
      });
      if (typeof onSuccess === 'function') onSuccess();
      if (typeof onSaved === 'function') onSaved();
      if (typeof onClose === 'function') onClose();
    } catch (err) {
      setError(err.message || 'Error al guardar los cruces');
      setLoading(false);
    }
  };

  if (!partido) return null;

  const originOptions = [];
  zonas.forEach((z) => {
    for (let i = 1; i <= z.clasifican; i++) {
      originOptions.push(`${i}° ${z.nombre}`);
    }
  });

  return (
    <div
      className="auth-card"
      style={{
        width: '280px',
        padding: '1.25rem',
        background: '#111827',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.8), 0 0 15px rgba(34, 197, 94, 0.2)',
        border: '2px solid var(--color-primary)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--color-primary)', textTransform: 'uppercase' }}>
          Editar Cruce
        </h4>
        <button
          type="button"
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }}
        >
          &times;
        </button>
      </div>

      {error && <div className="error-message" style={{ padding: '0.4rem', fontSize: '0.75rem', marginBottom: '0.5rem' }}>{error}</div>}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', color: '#9ca3af', marginBottom: '0.25rem' }}>
            Posición 1 (Arriba)
          </label>
          <select
            value={origen1}
            onChange={(e) => setOrigen1(e.target.value)}
            style={{ width: '100%', padding: '0.35rem', fontSize: '0.8rem', background: '#1f2937', color: 'white', border: '1px solid #374151', borderRadius: '4px' }}
          >
            <option value="">-- Sin Definir / Vacío --</option>
            {originOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', color: '#9ca3af', marginBottom: '0.25rem' }}>
            Posición 2 (Abajo)
          </label>
          <select
            value={origen2}
            onChange={(e) => setOrigen2(e.target.value)}
            style={{ width: '100%', padding: '0.35rem', fontSize: '0.8rem', background: '#1f2937', color: 'white', border: '1px solid #374151', borderRadius: '4px' }}
          >
            <option value="">-- Sin Definir / Vacío --</option>
            {originOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            style={{ flex: 1, padding: '0.35rem', fontSize: '0.75rem' }}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={loading}
            style={{ flex: 1, padding: '0.35rem', fontSize: '0.75rem' }}
          >
            {loading ? '...' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  );
}
