import { useState, useEffect, useRef } from 'react';
import { api } from '../api/client';
import ConfirmModal from './ConfirmModal';

export default function ResultadoModal({ partido, onClose, onSuccess, onSaved }) {
  const [setsInput, setSetsInput] = useState([
    { g1: '', g2: '' },
    { g1: '', g2: '' },
    { g1: '', g2: '' }
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const inputRefs = useRef({});

  const isFinished = partido?.estado === 'FINALIZADO';
  const isEnCurso = partido?.estado === 'EN_CURSO';

  useEffect(() => {
    if (!partido) return;
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
  }, [partido]);

  if (!partido) return null;

  const handleFinish = () => {
    if (typeof onSuccess === 'function') onSuccess();
    if (typeof onSaved === 'function') onSaved();
    if (typeof onClose === 'function') onClose();
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

  const handleInputChange = (index, field, value) => {
    const cleaned = value.replace(/\D/g, '');
    const newSets = [...setsInput];
    const finalVal = cleaned.length > 1 ? cleaned.slice(-1) : cleaned;
    newSets[index][field] = finalVal;
    setSetsInput(newSets);

    const esSetValido = validarSet(newSets[index].g1, newSets[index].g2, index + 1) === null;

    // Foco automático: solo salta cuando el segundo campo recién completado deja el set con un marcador válido por validarSet
    if (field === 'g2' && esSetValido) {
      if (index === 0) {
        setTimeout(() => {
          const nextInput = inputRefs.current['1-g1'];
          if (nextInput && !nextInput.disabled) {
            nextInput.focus();
            nextInput.select();
          }
        }, 30);
      } else if (index === 1) {
        const s1Valido = validarSet(newSets[0].g1, newSets[0].g2, 1) === null;
        if (s1Valido) {
          const s1g1 = parseInt(newSets[0].g1, 10);
          const s1g2 = parseInt(newSets[0].g2, 10);
          const s2g1 = parseInt(newSets[1].g1, 10);
          const s2g2 = parseInt(newSets[1].g2, 10);
          const w1 = s1g1 > s1g2 ? 1 : (s1g2 > s1g1 ? 2 : null);
          const w2 = s2g1 > s2g2 ? 1 : (s2g2 > s2g1 ? 2 : null);
          const isSet3Bloqueado = Boolean(w1 && w2 && w1 === w2);

          if (!isSet3Bloqueado) {
            setTimeout(() => {
              const nextInput = inputRefs.current['2-g1'];
              if (nextInput && !nextInput.disabled) {
                nextInput.focus();
                nextInput.select();
              }
            }, 30);
          }
        }
      }
    }
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
      handleFinish();
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const executeDelete = async () => {
    setConfirmDeleteOpen(false);
    setLoading(true);
    setError('');
    try {
      await api.delete(`/partidos/${partido.id}/resultado`);
      handleFinish();
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const p1Name = partido.pareja1 ? `${partido.pareja1.jugador1} / ${partido.pareja1.jugador2}` : 'Pareja 1';
  const p2Name = partido.pareja2 ? `${partido.pareja2.jugador1} / ${partido.pareja2.jugador2}` : 'Pareja 2';

  const getTitle = () => {
    if (isFinished) return 'Editar Resultado';
    if (isEnCurso) return 'Actualizar Partido';
    return 'Cargar Resultado';
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
    if (idx === 0) return false;
    if (idx === 1) return !isSetFilled(0);
    if (idx === 2) return !isSetFilled(1) || isSet3DisabledByWin;
    return false;
  };

  const getResumenResultado = () => {
    let p1Sets = 0;
    let p2Sets = 0;
    let setsValidos = 0;

    for (let i = 0; i < 3; i++) {
      const g1Str = setsInput[i].g1;
      const g2Str = setsInput[i].g2;
      if (g1Str === '' || g2Str === '') continue;
      if (validarSet(g1Str, g2Str, i + 1) !== null) continue;

      const g1 = parseInt(g1Str, 10);
      const g2 = parseInt(g2Str, 10);
      if (g1 > g2) {
        p1Sets++;
        setsValidos++;
      } else if (g2 > g1) {
        p2Sets++;
        setsValidos++;
      }
    }

    if (setsValidos === 0) return null;

    if (p1Sets === 2) {
      return { texto: `Gana ${p1Name} (${p1Sets}-${p2Sets})`, esDefinido: true };
    }
    if (p2Sets === 2) {
      return { texto: `Gana ${p2Name} (${p2Sets}-${p1Sets})`, esDefinido: true };
    }
    if (p1Sets === 1 && p2Sets === 1) {
      return { texto: 'Sets: 1-1 (falta el tercer set)', esDefinido: false };
    }
    if (p1Sets === 1 && p2Sets === 0) {
      return { texto: `Gana ${p1Name} (1-0)`, esDefinido: false };
    }
    if (p2Sets === 1 && p1Sets === 0) {
      return { texto: `Gana ${p2Name} (1-0)`, esDefinido: false };
    }

    return null;
  };

  const resumen = getResumenResultado();

  return (
    <>
      <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose && onClose()}>
        <div className="modal-content" style={{ maxWidth: '440px', textAlign: 'left' }}>
          {/* Cabecera del modal */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: '1.25rem',
            borderBottom: '1px solid var(--color-border)',
            paddingBottom: '0.75rem',
            textAlign: 'left',
          }}>
            <div style={{ textAlign: 'left', flex: 1, minWidth: 0 }}>
              <h2 style={{
                margin: 0,
                fontSize: '1.25rem',
                fontWeight: 700,
                color: 'var(--color-text)',
                fontFamily: 'var(--font-display)',
                textAlign: 'left',
                lineHeight: 1.2
              }}>
                {getTitle()}
              </h2>
              <p style={{
                margin: '0.25rem 0 0',
                fontSize: 'var(--font-size-xs)',
                color: 'var(--color-text-secondary)',
                textAlign: 'left',
                lineHeight: 1.4
              }}>
                {getSubtitle()}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar modal"
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--color-text-secondary)',
                fontSize: '1.5rem',
                cursor: 'pointer',
                lineHeight: 1,
                padding: '0 0.25rem',
                marginLeft: '0.75rem',
                flexShrink: 0
              }}
            >
              &times;
            </button>
          </div>

          {/* Encabezado con nombres de las dos parejas una sola vez (columnas alineadas con los inputs) */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            marginBottom: '0.85rem',
            padding: '0 calc(1rem + 1px)',
          }}>
            <div style={{
              flex: 1,
              minWidth: 0,
              textAlign: 'center',
              fontSize: 'var(--font-size-sm)',
              fontWeight: 600,
              color: 'var(--color-text)',
              lineHeight: 1.3,
              wordBreak: 'break-word',
              overflowWrap: 'break-word',
            }}>
              {p1Name}
            </div>

            <span style={{
              width: '20px',
              textAlign: 'center',
              fontSize: 'var(--font-size-xs)',
              color: 'var(--color-text-muted)',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              userSelect: 'none',
              flexShrink: 0
            }}>
              vs
            </span>

            <div style={{
              flex: 1,
              minWidth: 0,
              textAlign: 'center',
              fontSize: 'var(--font-size-sm)',
              fontWeight: 600,
              color: 'var(--color-text)',
              lineHeight: 1.3,
              wordBreak: 'break-word',
              overflowWrap: 'break-word',
            }}>
              {p2Name}
            </div>
          </div>

          {error && <div className="error-message" style={{ marginBottom: '1rem' }}>{error}</div>}

          <form onSubmit={handleSubmit}>
            {[0, 1, 2].map((idx) => {
              const isDisabled = getIsSetDisabled(idx);
              return (
                <div key={idx} style={{ 
                  marginBottom: '0.75rem', 
                  padding: '0.75rem 1rem', 
                  background: isDisabled ? 'transparent' : 'rgba(255, 255, 255, 0.02)', 
                  border: '1px solid var(--color-border)', 
                  borderRadius: 'var(--radius-md)',
                  opacity: isDisabled ? 0.35 : 1,
                  transition: 'opacity var(--transition-fast)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <span style={{
                      fontSize: 'var(--font-size-xs)',
                      fontWeight: 700,
                      color: isDisabled ? 'var(--color-text-muted)' : 'var(--color-text-secondary)',
                      letterSpacing: '0.05em'
                    }}>
                      SET {idx + 1} {idx === 2 && isSet3DisabledByWin && '(No necesario)'}
                    </span>
                  </div>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <input
                        ref={(el) => { inputRefs.current[`${idx}-g1`] = el; }}
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        className="resultado-set-input"
                        value={setsInput[idx].g1}
                        onChange={(e) => handleInputChange(idx, 'g1', e.target.value)}
                        onFocus={(e) => e.target.select()}
                        onClick={(e) => e.target.select()}
                        placeholder="0"
                        disabled={isDisabled}
                        aria-label={`Set ${idx + 1} - ${p1Name}`}
                      />
                    </div>

                    <span style={{
                      width: '20px',
                      textAlign: 'center',
                      fontWeight: 700,
                      color: 'var(--color-text-secondary)',
                      fontSize: '1.25rem',
                      userSelect: 'none',
                      lineHeight: 1,
                      flexShrink: 0
                    }}>
                      -
                    </span>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <input
                        ref={(el) => { inputRefs.current[`${idx}-g2`] = el; }}
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        className="resultado-set-input"
                        value={setsInput[idx].g2}
                        onChange={(e) => handleInputChange(idx, 'g2', e.target.value)}
                        onFocus={(e) => e.target.select()}
                        onClick={(e) => e.target.select()}
                        placeholder="0"
                        disabled={isDisabled}
                        aria-label={`Set ${idx + 1} - ${p2Name}`}
                      />
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Resumen calculado sobre los botones de acción */}
            {resumen && (
              <div
                style={{
                  marginTop: '1rem',
                  marginBottom: '0.25rem',
                  padding: '0.55rem 0.85rem',
                  background: resumen.esDefinido ? 'rgba(0, 208, 132, 0.08)' : 'rgba(255, 255, 255, 0.04)',
                  border: `1px solid ${resumen.esDefinido ? 'rgba(0, 208, 132, 0.25)' : 'var(--color-border)'}`,
                  borderRadius: 'var(--radius-md)',
                  color: resumen.esDefinido ? 'var(--color-primary)' : 'var(--color-text)',
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: 600,
                  textAlign: 'center',
                  lineHeight: 1.4
                }}
              >
                {resumen.texto}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.25rem', gap: '0.75rem', flexWrap: 'wrap' }}>
              {(isFinished || isEnCurso) ? (
                <button 
                  type="button" 
                  className="btn-danger" 
                  onClick={() => setConfirmDeleteOpen(true)} 
                  disabled={loading}
                  style={{ width: 'auto', padding: '0.5rem 1rem' }}
                >
                  Borrar Resultado
                </button>
              ) : <div />}

              <div style={{ display: 'flex', gap: '0.75rem', marginLeft: 'auto' }}>
                <button type="button" className="btn-secondary" onClick={onClose} disabled={loading} style={{ width: 'auto' }}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary" disabled={loading} style={{ width: 'auto' }}>
                  {loading ? 'Guardando...' : 'Guardar Resultado'}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      {/* Modal de confirmación para borrar resultado */}
      <ConfirmModal
        isOpen={confirmDeleteOpen}
        title={isEnCurso ? "Borrar Progreso del Partido" : "Borrar Resultado"}
        message={
          isEnCurso
            ? "¿Estás seguro de que querés borrar los sets cargados? El partido volverá a estado Pendiente."
            : "¿Estás seguro de que querés borrar este resultado? El partido volverá a estado Pendiente y se recalcularán las posiciones de la zona."
        }
        confirmText="Sí, borrar resultado"
        isDanger={true}
        onConfirm={executeDelete}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </>
  );
}

