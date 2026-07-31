import { useState, useEffect } from 'react';
import { api } from '../api/client';

export default function ResultadoModal({ partido, onClose, onSaved }) {
  const [sets, setSets] = useState([{ g1: '', g2: '' }, { g1: '', g2: '' }, { g1: '', g2: '' }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (partido?.sets?.length > 0) {
      const initialSets = [{ g1: '', g2: '' }, { g1: '', g2: '' }, { g1: '', g2: '' }];
      partido.sets.forEach((s, i) => {
        if (i < 3) {
          initialSets[i] = { g1: s.gamesPareja1.toString(), g2: s.gamesPareja2.toString() };
        }
      });
      setSets(initialSets);
    }
  }, [partido]);

  const updateSet = (index, field, value) => {
    const newSets = [...sets];
    newSets[index][field] = value;
    setSets(newSets);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    // Filtrar sets válidos cargados
    const validSets = sets.filter(s => s.g1 !== '' && s.g2 !== '').map(s => ({
      gamesPareja1: parseInt(s.g1, 10),
      gamesPareja2: parseInt(s.g2, 10)
    }));

    if (validSets.length === 0) {
      setError('Debes ingresar al menos un set.');
      return;
    }

    setLoading(true);
    try {
      await api.put(`/partidos/${partido.id}/resultado`, { sets: validSets });
      onSaved();
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const p1Name = `${partido.pareja1.jugador1} / ${partido.pareja1.jugador2}`;
  const p2Name = `${partido.pareja2.jugador1} / ${partido.pareja2.jugador2}`;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }}>
      <div className="auth-card" style={{ width: '90%', maxWidth: '500px', padding: '2rem' }}>
        <div className="flex-header" style={{ marginBottom: '1rem' }}>
          <h2 style={{ margin: 0 }}>Cargar Resultado</h2>
          <button onClick={onClose} style={{ fontSize: '1.5rem', lineHeight: 1 }}>&times;</button>
        </div>

        {error && <div className="error-message">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '1rem', marginBottom: '1rem', alignItems: 'center' }}>
            <div style={{ fontWeight: 'bold' }}>Parejas</div>
            <div style={{ textAlign: 'center', fontWeight: 'bold' }}>P1</div>
            <div style={{ textAlign: 'center', fontWeight: 'bold' }}>P2</div>

            {/* Fila Pareja 1 */}
            <div style={{ fontSize: 'var(--font-size-sm)' }}>{p1Name}</div>
            {sets.map((s, i) => (
              <input 
                key={`g1-${i}`}
                type="number" 
                min="0" 
                max="7"
                value={s.g1}
                onChange={(e) => updateSet(i, 'g1', e.target.value)}
                style={{ width: '100%', padding: '0.5rem', textAlign: 'center', background: 'var(--color-bg-input)', border: '1px solid var(--color-border)', borderRadius: '4px', color: 'white' }}
              />
            ))}

            {/* Fila Pareja 2 */}
            <div style={{ fontSize: 'var(--font-size-sm)' }}>{p2Name}</div>
            {sets.map((s, i) => (
              <input 
                key={`g2-${i}`}
                type="number" 
                min="0" 
                max="7"
                value={s.g2}
                onChange={(e) => updateSet(i, 'g2', e.target.value)}
                style={{ width: '100%', padding: '0.5rem', textAlign: 'center', background: 'var(--color-bg-input)', border: '1px solid var(--color-border)', borderRadius: '4px', color: 'white' }}
              />
            ))}
          </div>

          <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
            <button type="button" onClick={onClose} className="btn-primary" style={{ background: 'var(--color-bg-input)' }}>Cancelar</button>
            <button type="submit" className="btn-primary" disabled={loading}>{loading ? 'Guardando...' : 'Guardar Resultado'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
