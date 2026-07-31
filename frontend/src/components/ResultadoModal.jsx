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

  const getWinnerOfSet = (g1Str, g2Str) => {
    const g1 = parseInt(g1Str, 10);
    const g2 = parseInt(g2Str, 10);
    if (isNaN(g1) || isNaN(g2) || g1 === g2) return null;

    const max = Math.max(g1, g2);
    const min = Math.min(g1, g2);
    if (max < 6) return null;
    if (max === 6 && max - min < 2) return null;
    if (max === 7 && min !== 5 && min !== 6) return null;
    if (max > 7) return null;

    return g1 > g2 ? 1 : 2;
  };

  const updateSet = (index, field, value) => {
    const newSets = [...sets];
    let finalValue = value;

    // Si estaba vacío y se presiona la flecha arriba (el navegador pasa de "" a "1"), empezamos en "0"
    if (sets[index][field] === '' && value === '1') {
      finalValue = '0';
    }

    newSets[index][field] = finalValue;

    // Si el Set 1 y el Set 2 ya están definidos y los gana la misma pareja, vaciamos el Set 3
    const w1 = getWinnerOfSet(newSets[0].g1, newSets[0].g2);
    const w2 = getWinnerOfSet(newSets[1].g1, newSets[1].g2);
    if (w1 !== null && w2 !== null && w1 === w2) {
      newSets[2] = { g1: '', g2: '' };
    }

    setSets(newSets);
  };

  const validarSet = (g1Str, g2Str, setNum) => {
    const g1 = parseInt(g1Str, 10);
    const g2 = parseInt(g2Str, 10);

    if (isNaN(g1) || isNaN(g2)) return `Los games del Set ${setNum} deben ser números válidos.`;
    if (g1 < 0 || g2 < 0) return `Los games del Set ${setNum} no pueden ser negativos.`;
    if (g1 === g2) return `El Set ${setNum} no puede terminar en empate (${g1}-${g2}).`;

    const max = Math.max(g1, g2);
    const min = Math.min(g1, g2);

    if (max < 6) return `El Set ${setNum} (${g1}-${g2}) está incompleto. Se gana con al menos 6 games.`;
    if (max === 6 && max - min < 2) return `El Set ${setNum} (${g1}-${g2}) es inválido. Si van 6-5 debe jugarse hasta 7-5 o 7-6.`;
    if (max === 7 && min !== 5 && min !== 6) return `El Set ${setNum} (${g1}-${g2}) es inválido. Quien gana 7 games debe ser por 7-5 o 7-6.`;
    if (max > 7) return `El Set ${setNum} (${g1}-${g2}) es inválido. En pádel un set no puede tener más de 7 games.`;

    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    // Filtrar y validar sets ingresados
    const validSets = [];
    let setsGanadosP1 = 0;
    let setsGanadosP2 = 0;

    for (let i = 0; i < sets.length; i++) {
      const s = sets[i];
      if (s.g1 !== '' || s.g2 !== '') {
        const err = validarSet(s.g1, s.g2, i + 1);
        if (err) {
          setError(err);
          return;
        }
        const g1 = parseInt(s.g1, 10);
        const g2 = parseInt(s.g2, 10);
        validSets.push({ gamesPareja1: g1, gamesPareja2: g2 });

        if (g1 > g2) setsGanadosP1++;
        else setsGanadosP2++;
      }
    }

    if (validSets.length === 0) {
      setError('Debes ingresar al menos un set.');
      return;
    }

    // Validación extra: no se puede jugar set 3 si ya se ganó 2-0
    const w1 = getWinnerOfSet(sets[0].g1, sets[0].g2);
    const w2 = getWinnerOfSet(sets[1].g1, sets[1].g2);
    if (w1 !== null && w2 !== null && w1 === w2 && validSets.length === 3) {
      setError('No se puede registrar un tercer set si una pareja ya ganó los primeros 2 sets.');
      return;
    }

    if (setsGanadosP1 < 2 && setsGanadosP2 < 2) {
      setError('Para finalizar el partido, una pareja debe ganar al menos 2 sets (ej. 2-0 o 2-1).');
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

  const handleDelete = async () => {
    if (!window.confirm('¿Seguro que querés borrar este resultado? El partido volverá a estado Pendiente.')) {
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.delete(`/partidos/${partido.id}/resultado`);
      onSaved();
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const p1Name = partido.pareja1 ? `${partido.pareja1.jugador1} / ${partido.pareja1.jugador2}` : 'Pareja 1';
  const p2Name = partido.pareja2 ? `${partido.pareja2.jugador1} / ${partido.pareja2.jugador2}` : 'Pareja 2';

  const w1 = getWinnerOfSet(sets[0].g1, sets[0].g2);
  const w2 = getWinnerOfSet(sets[1].g1, sets[1].g2);
  const isSet3Disabled = w1 !== null && w2 !== null && w1 === w2;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      backdropFilter: 'blur(4px)'
    }}>
      <div className="auth-card" style={{ width: '90%', maxWidth: '550px', padding: '2rem' }}>
        <div className="flex-header" style={{ marginBottom: '1.5rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.75rem' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Cargar Resultado de Partido</h2>
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>Ingresá los games por set</span>
          </div>
          <button 
            type="button" 
            onClick={onClose} 
            style={{ background: 'none', border: 'none', color: 'var(--color-text-secondary)', fontSize: '1.5rem', cursor: 'pointer', lineHeight: 1 }}
          >
            &times;
          </button>
        </div>

        {error && <div className="error-message" style={{ marginBottom: '1rem' }}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '2fr 1fr 1fr 1fr',
            gap: '0.75rem',
            alignItems: 'center',
            marginBottom: '1.5rem',
            background: 'rgba(255, 255, 255, 0.02)',
            padding: '1rem',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)'
          }}>
            {/* Header Columns */}
            <div style={{ fontWeight: 'bold', fontSize: 'var(--font-size-xs)', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>
              Pareja
            </div>
            <div style={{ textAlign: 'center', fontWeight: 'bold', fontSize: 'var(--font-size-xs)', textTransform: 'uppercase', color: 'var(--color-primary)' }}>
              Set 1
            </div>
            <div style={{ textAlign: 'center', fontWeight: 'bold', fontSize: 'var(--font-size-xs)', textTransform: 'uppercase', color: 'var(--color-primary)' }}>
              Set 2
            </div>
            <div style={{ textAlign: 'center', fontWeight: 'bold', fontSize: 'var(--font-size-xs)', textTransform: 'uppercase', color: 'var(--color-primary)' }} title="Solo si empatan 1-1 en sets">
              Set 3 {isSet3Disabled && '✖'}
            </div>

            {/* Fila Pareja 1 */}
            <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p1Name}>
              {p1Name}
            </div>
            {sets.map((s, i) => {
              const disabled = i === 2 && isSet3Disabled;
              return (
                <input 
                  key={`g1-${i}`}
                  type="number" 
                  min="0" 
                  max="7"
                  placeholder="-"
                  value={s.g1}
                  disabled={disabled}
                  onChange={(e) => updateSet(i, 'g1', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.6rem 0.25rem',
                    textAlign: 'center',
                    background: disabled ? 'rgba(255,255,255,0.02)' : 'var(--color-bg-input)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    color: disabled ? 'var(--color-text-secondary)' : 'white',
                    fontSize: '1rem',
                    fontWeight: 'bold',
                    opacity: disabled ? 0.3 : 1,
                    cursor: disabled ? 'not-allowed' : 'text'
                  }}
                />
              );
            })}

            {/* Fila Pareja 2 */}
            <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p2Name}>
              {p2Name}
            </div>
            {sets.map((s, i) => {
              const disabled = i === 2 && isSet3Disabled;
              return (
                <input 
                  key={`g2-${i}`}
                  type="number" 
                  min="0" 
                  max="7"
                  placeholder="-"
                  value={s.g2}
                  disabled={disabled}
                  onChange={(e) => updateSet(i, 'g2', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.6rem 0.25rem',
                    textAlign: 'center',
                    background: disabled ? 'rgba(255,255,255,0.02)' : 'var(--color-bg-input)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    color: disabled ? 'var(--color-text-secondary)' : 'white',
                    fontSize: '1rem',
                    fontWeight: 'bold',
                    opacity: disabled ? 0.3 : 1,
                    cursor: disabled ? 'not-allowed' : 'text'
                  }}
                />
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              {partido.estado === 'FINALIZADO' && (
                <button 
                  type="button" 
                  onClick={handleDelete} 
                  disabled={loading}
                  style={{ background: 'transparent', border: '1px solid var(--color-danger)', color: 'var(--color-danger)', padding: '0.6rem 1rem', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontWeight: 'bold' }}
                >
                  🗑️ Borrar Resultado
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button 
                type="button" 
                onClick={onClose} 
                className="btn-primary" 
                style={{ background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', width: 'auto' }}
              >
                Cancelar
              </button>
            <button 
              type="submit" 
              className="btn-primary" 
              disabled={loading}
              style={{ width: 'auto', paddingLeft: '1.5rem', paddingRight: '1.5rem' }}
            >
              {loading ? 'Guardando...' : 'Guardar Resultado'}
            </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

