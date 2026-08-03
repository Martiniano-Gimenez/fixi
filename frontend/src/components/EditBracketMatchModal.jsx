import { useState, useEffect } from 'react';
import { api } from '../api/client';

export default function EditBracketMatchModal({ partido, zonas = [], onClose, onSaved }) {
  const [origen1, setOrigen1] = useState('');
  const [origen2, setOrigen2] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Sincronizar el estado inicial
  useEffect(() => {
    if (partido) {
      setOrigen1(partido.origenPareja1 || '');
      setOrigen2(partido.origenPareja2 || '');
    }
  }, [partido]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    // Si se seleccionó el mismo origen en ambos lados (y no es vacío), error
    if (origen1 && origen2 && origen1 === origen2) {
      setError('No podés asignar el mismo origen en ambos lados del partido.');
      return;
    }

    try {
      setLoading(true);
      await api.patch(`/partidos/${partido.id}/bracket`, {
        origenPareja1: origen1 || null,
        origenPareja2: origen2 || null
      });
      onSaved();
    } catch (err) {
      setError(err.message || 'Error al guardar los cruces');
      setLoading(false);
    }
  };

  if (!partido) return null;

  const originOptions = [];
  zonas.forEach(z => {
    for(let i = 1; i <= z.clasifican; i++) {
      originOptions.push(`${i}° ${z.nombre}`);
    }
  });

  return (
    <div 
      className="auth-card" 
      style={{ 
        width: '280px', 
        padding: '1.25rem', 
        background: '#111827', // Un azul muy oscuro para diferenciarlo del bracket
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.8), 0 0 15px rgba(239, 68, 68, 0.2)',
        border: '2px solid var(--color-primary)',
        borderRadius: 'var(--radius-md)'
      }}
      onClick={e => e.stopPropagation()}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
        <h2 style={{ fontSize: '1rem', margin: 0, color: 'var(--color-text)' }}>⚙️ Editar Cruce</h2>
        <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--color-text-secondary)', fontSize: '1.25rem', cursor: 'pointer', lineHeight: 1 }}>&times;</button>
      </div>

        <form onSubmit={handleSubmit} className="resultado-form">
          {error && <div className="error-message" style={{ marginBottom: '1rem' }}>{error}</div>}

          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.25rem', color: 'var(--color-text-secondary)', fontSize: '0.75rem' }}>
              Origen 1 (Arriba)
            </label>
            <select
              value={origen1}
              onChange={(e) => setOrigen1(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg-input)',
                color: 'var(--color-text)',
                fontSize: '0.875rem'
              }}
            >
              <option value="">-- Vacío (Bye) --</option>
              {originOptions.map(opt => (
                <option key={`p1-${opt}`} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>

          <div style={{ textAlign: 'center', margin: '0.5rem 0', color: 'var(--color-text-secondary)', fontSize: '0.75rem' }}>
            vs
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.25rem', color: 'var(--color-text-secondary)', fontSize: '0.75rem' }}>
              Origen 2 (Abajo)
            </label>
            <select
              value={origen2}
              onChange={(e) => setOrigen2(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg-input)',
                color: 'var(--color-text)',
                fontSize: '0.875rem'
              }}
            >
              <option value="">-- Vacío (Bye) --</option>
              {originOptions.map(opt => (
                <option key={`p2-${opt}`} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.5rem' }}>
            <button 
              type="button" 
              onClick={onClose} 
              className="btn-secondary" 
              style={{ flex: 1, padding: '0.5rem', fontSize: '0.875rem' }}
              disabled={loading}
            >
              Cancelar
            </button>
            <button 
              type="submit" 
              className="btn-primary" 
              style={{ flex: 1, padding: '0.5rem', fontSize: '0.875rem' }}
              disabled={loading}
            >
              {loading ? '...' : 'Guardar'}
            </button>
          </div>
        </form>
    </div>
  );
}
