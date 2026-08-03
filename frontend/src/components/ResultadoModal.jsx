import { useState, useEffect } from 'react';
import { api } from '../api/client';

export default function ResultadoModal({ partido, onClose, onSaved }) {
  const [setsInput, setSetsInput] = useState([
    { g1: '', g2: '' },
    { g1: '', g2: '' },
    { g1: '', g2: '' }
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isFinished = partido.estado === 'FINALIZADO';
  const isEnCurso = partido.estado === 'EN_CURSO';

  useEffect(() => {
    const initial = [
      { g1: '', g2: '' },
      { g1: '', g2: '' },
      { g1: '', g2: '' }
    ];
    if (partido.sets && partido.sets.length > 0) {
      const sorted = [...partido.sets].sort((a, b) => a.numero - b.numero);
      sorted.forEach((s, i) => {
        if (i < 3) {
          initial[i] = { g1: s.gamesPareja1.toString(), g2: s.gamesPareja2.toString() };
        }
      });
    }
    setSetsInput(initial);
    setError('');
  }, [partido.id, partido.sets]);

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

  const handleInputChange = (index, field, value) => {
    const newSets = [...setsInput];
    newSets[index][field] = value;
    setSetsInput(newSets);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const validSetsToSave = [];
    let expectedSet = true;

    for (let i = 0; i < 3; i++) {
      const g1Str = setsInput[i].g1;
      const g2Str = setsInput[i].g2;
      
      const isEmpty = g1Str === '' && g2Str === '';
      const isPartial = (g1Str !== '' && g2Str === '') || (g1Str === '' && g2Str !== '');

      if (isEmpty) {
        expectedSet = false;
        continue;
      }
      
      if (!expectedSet) {
        setError('No puedes dejar sets intermedios en blanco.');
        return;
      }

      if (isPartial) {
        setError(`El Set ${i + 1} está incompleto.`);
        return;
      }

      const err = validarSet(g1Str, g2Str, i + 1);
      if (err) { setError(err); return; }

      validSetsToSave.push({
        gamesPareja1: parseInt(g1Str, 10),
        gamesPareja2: parseInt(g2Str, 10)
      });
    }

    if (validSetsToSave.length === 0) {
      setError('Debes cargar al menos un set.');
      return;
    }

    if (validSetsToSave.length > 2) {
      const w1 = validSetsToSave[0].gamesPareja1 > validSetsToSave[0].gamesPareja2 ? 1 : 2;
      const w2 = validSetsToSave[1].gamesPareja1 > validSetsToSave[1].gamesPareja2 ? 1 : 2;
      if (w1 === w2) {
        setError(`La Pareja ${w1} ya ganó los 2 primeros sets. El Set 3 es innecesario.`);
        return;
      }
    }

    setLoading(true);
    try {
      await api.put(`/partidos/${partido.id}/resultado`, { sets: validSetsToSave });
      onSaved();
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    const msg = isEnCurso
      ? '¿Seguro que querés borrar el progreso? El partido volverá a estado Pendiente.'
      : '¿Seguro que querés borrar este resultado? El partido volverá a estado Pendiente.';
    if (!window.confirm(msg)) return;
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
  
  const p1Short = partido.pareja1 
    ? `${partido.pareja1.jugador1.split(' ')[0]} / ${partido.pareja1.jugador2.split(' ')[0]}` 
    : 'P1';
  const p2Short = partido.pareja2 
    ? `${partido.pareja2.jugador1.split(' ')[0]} / ${partido.pareja2.jugador2.split(' ')[0]}` 
    : 'P2';

  const getTitle = () => {
    if (isFinished) return 'Editar Resultado';
    if (isEnCurso) return 'Actualizar Partido';
    return 'Iniciar Partido';
  };

  const getSubtitle = () => {
    if (isFinished) return 'Modificá los sets y guardá para corregir el resultado.';
    if (isEnCurso) return 'Cargá los siguientes sets o corregí los anteriores.';
    return 'Ingresá el resultado de los sets jugados.';
  };

  const s1g1 = parseInt(setsInput[0].g1, 10);
  const s1g2 = parseInt(setsInput[0].g2, 10);
  const s2g1 = parseInt(setsInput[1].g1, 10);
  const s2g2 = parseInt(setsInput[1].g2, 10);

  let isSet3DisabledByWin = false;
  if (!isNaN(s1g1) && !isNaN(s1g2) && !isNaN(s2g1) && !isNaN(s2g2)) {
    const s1Winner = s1g1 > s1g2 ? 1 : (s1g2 > s1g1 ? 2 : null);
    const s2Winner = s2g1 > s2g2 ? 1 : (s2g2 > s2g1 ? 2 : null);
    if (s1Winner && s2Winner && s1Winner === s2Winner) {
      isSet3DisabledByWin = true;
    }
  }

  const isSetFilled = (idx) => setsInput[idx].g1 !== '' && setsInput[idx].g2 !== '';

  const getIsSetDisabled = (idx) => {
    if (idx === 0) return false; // Set 1 is always editable
    if (idx === 1) return !isSetFilled(0); // Set 2 requires Set 1
    if (idx === 2) return !isSetFilled(1) || isSet3DisabledByWin; // Set 3 requires Set 2 and no 2-0 win
    return false;
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      backdropFilter: 'blur(4px)'
    }}>
      <div className="auth-card" style={{ width: '90%', maxWidth: '480px', padding: '2rem' }}>
        <div className="flex-header" style={{ marginBottom: '1.5rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.75rem' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.25rem' }}>{getTitle()}</h2>
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>{getSubtitle()}</span>
          </div>
          <button type="button" onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--color-text-secondary)', fontSize: '1.5rem', cursor: 'pointer', lineHeight: 1 }}>
            &times;
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.25rem', gap: '0.5rem' }}>
          <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, flex: 1, textAlign: 'center' }}>{p1Name}</div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', alignSelf: 'center' }}>vs</div>
          <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, flex: 1, textAlign: 'center' }}>{p2Name}</div>
        </div>

        {error && <div className="error-message" style={{ marginBottom: '1rem' }}>{error}</div>}

        <form onSubmit={handleSubmit}>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
            {[1, 2, 3].map((setNum, idx) => {
              const isDisabled = getIsSetDisabled(idx);
              return (
              <div key={setNum} style={{ 
                background: 'rgba(255,255,255,0.02)', 
                border: '1px solid var(--color-border)', 
                borderRadius: 'var(--radius-md)',
                padding: '0.75rem',
                opacity: isDisabled ? 0.3 : 1,
                pointerEvents: isDisabled ? 'none' : 'auto'
              }}>
                <div style={{ fontWeight: 'bold', fontSize: 'var(--font-size-xs)', textTransform: 'uppercase', color: 'var(--color-text-secondary)', marginBottom: '0.5rem', textAlign: 'center' }}>
                  Set {setNum} {setNum === 3 && <span style={{fontWeight: 'normal'}}>(Desempate)</span>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '0.75rem', alignItems: 'center' }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '10px', color: 'var(--color-text-muted)', marginBottom: '0.2rem' }}>{p1Short}</div>
                    <input
                      type="number" inputMode="numeric" pattern="[0-9]*" min="0" max="7" placeholder="-"
                      value={setsInput[idx].g1} 
                      disabled={isDisabled}
                      onChange={(e) => handleInputChange(idx, 'g1', e.target.value)}
                      style={{ width: '100%', padding: '0.5rem 0.25rem', textAlign: 'center', background: 'var(--color-bg-input)', border: setsInput[idx].g1 !== '' ? '1px solid var(--color-primary)' : '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'white', fontSize: '1.25rem', fontWeight: 'bold' }}
                    />
                  </div>
                  <div style={{ fontSize: '1rem', color: 'var(--color-text-muted)', textAlign: 'center', paddingTop: '1rem' }}>-</div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '10px', color: 'var(--color-text-muted)', marginBottom: '0.2rem' }}>{p2Short}</div>
                    <input
                      type="number" inputMode="numeric" pattern="[0-9]*" min="0" max="7" placeholder="-"
                      value={setsInput[idx].g2} 
                      disabled={isDisabled}
                      onChange={(e) => handleInputChange(idx, 'g2', e.target.value)}
                      style={{ width: '100%', padding: '0.5rem 0.25rem', textAlign: 'center', background: 'var(--color-bg-input)', border: setsInput[idx].g2 !== '' ? '1px solid var(--color-primary)' : '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'white', fontSize: '1.25rem', fontWeight: 'bold' }}
                    />
                  </div>
                </div>
              </div>
            )})}
          </div>

          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              {(isEnCurso || isFinished) && (
                <button type="button" onClick={handleDelete} disabled={loading}
                  style={{ background: 'transparent', border: '1px solid var(--color-danger)', color: 'var(--color-danger)', padding: '0.6rem 1rem', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontWeight: 'bold' }}>
                  Borrar todo
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', flex: 1, justifyContent: 'flex-end' }}>
              <button type="button" onClick={onClose} className="btn-primary"
                style={{ background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', width: 'auto' }}>
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={loading}
                style={{ width: 'auto', paddingLeft: '1.5rem', paddingRight: '1.5rem' }}>
                {loading ? 'Guardando...' : 'Guardar Resultado'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
