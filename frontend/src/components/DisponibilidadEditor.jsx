import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { AlertTriangle, Check, Loader2, Info } from 'lucide-react';
import RangeSliderGroup from './RangeSliderGroup';

function reconstruirRangos(slotsGuardados, slotsDisponiblesDia, dia) {
  if (!slotsDisponiblesDia || slotsDisponiblesDia.length === 0) return [];
  const guardadosDia = (slotsGuardados || []).filter((s) => s.startsWith(dia + '-'));
  if (guardadosDia.length === 0) return [];

  const slotsMap = new Map();
  slotsDisponiblesDia.forEach((s, idx) => slotsMap.set(s, idx));

  // Expandir slots guardados a su ventana real de 75 min (hasta 5 slots de 15 min: el propio + 4 siguientes)
  const indicesExpandidos = new Set();
  for (const sId of guardadosDia) {
    const idx = slotsMap.get(sId);
    if (idx !== undefined) {
      for (let offset = 0; offset <= 4; offset++) {
        const targetIdx = idx + offset;
        if (targetIdx < slotsDisponiblesDia.length) {
          indicesExpandidos.add(targetIdx);
        }
      }
    }
  }

  if (indicesExpandidos.size === 0) return [];

  const sorted = Array.from(indicesExpandidos).sort((a, b) => a - b);
  const result = [];
  let curStart = sorted[0];
  let curEnd = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    if (next === curEnd + 1) {
      curEnd = next;
    } else {
      result.push({
        id: `rango-${curStart}-${curEnd}-${Math.random().toString(36).substr(2, 5)}`,
        startIdx: curStart,
        endIdx: curEnd,
      });
      curStart = next;
      curEnd = next;
    }
  }
  result.push({
    id: `rango-${curStart}-${curEnd}-${Math.random().toString(36).substr(2, 5)}`,
    startIdx: curStart,
    endIdx: curEnd,
  });

  return result;
}

function rangosASlots(rangosViernes, grillaViernes, rangosSabado, grillaSabado) {
  const result = new Set();
  (rangosViernes || []).forEach((r) => {
    for (let i = r.startIdx; i <= r.endIdx; i++) {
      if (grillaViernes && grillaViernes[i]) result.add(grillaViernes[i]);
    }
  });
  (rangosSabado || []).forEach((r) => {
    for (let i = r.startIdx; i <= r.endIdx; i++) {
      if (grillaSabado && grillaSabado[i]) result.add(grillaSabado[i]);
    }
  });
  return Array.from(result);
}

function agruparSlotsEnRangos(slotIdsDelDia, grillaDelDia = []) {
  if (!slotIdsDelDia || slotIdsDelDia.length === 0) {
    return 'sin horarios';
  }

  const slotsSet = new Set(slotIdsDelDia);
  let sortedSlots = [];

  if (grillaDelDia.length > 0) {
    sortedSlots = grillaDelDia.filter((s) => slotsSet.has(s));
    const enGrillaSet = new Set(sortedSlots);
    for (const s of slotIdsDelDia) {
      if (!enGrillaSet.has(s)) sortedSlots.push(s);
    }
  } else {
    sortedSlots = [...slotIdsDelDia].sort((a, b) => {
      const hA = a.split('-')[1] || '';
      const hB = b.split('-')[1] || '';
      return hA.localeCompare(hB);
    });
  }

  if (sortedSlots.length === 0) return 'sin horarios';

  const parseMin = (slotId) => {
    const hora = slotId.split('-')[1] || '';
    const [h, m] = hora.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };

  const rangos = [];
  let rangoStart = sortedSlots[0];
  let rangoEnd = sortedSlots[0];

  for (let i = 1; i < sortedSlots.length; i++) {
    const prev = sortedSlots[i - 1];
    const curr = sortedSlots[i];

    let esConsecutivo = false;
    if (grillaDelDia.length > 0) {
      const idxPrev = grillaDelDia.indexOf(prev);
      const idxCurr = grillaDelDia.indexOf(curr);
      if (idxPrev !== -1 && idxCurr === idxPrev + 1) {
        esConsecutivo = true;
      }
    } else {
      const minPrev = parseMin(prev);
      const minCurr = parseMin(curr);
      if (minCurr === minPrev + 15) {
        esConsecutivo = true;
      }
    }

    if (esConsecutivo) {
      rangoEnd = curr;
    } else {
      rangos.push({ start: rangoStart, end: rangoEnd });
      rangoStart = curr;
      rangoEnd = curr;
    }
  }
  rangos.push({ start: rangoStart, end: rangoEnd });

  return rangos
    .map((r) => {
      const hStart = r.start.split('-')[1] || '';
      const hEnd = r.end.split('-')[1] || '';
      return hStart === hEnd ? hStart : `${hStart} a ${hEnd}`;
    })
    .join(', ');
}

export default function DisponibilidadEditor({
  parejaId,
  torneoId,
  categoriaEstado,
  onChanged,
  onSlotsChanged,
  onClose,
  value,
  onChange,
  grillaProp,
}) {
  const isControlled = Boolean(onChange && !parejaId);
  const [grilla, setGrilla] = useState(grillaProp || { viernes: [], sabado: [] });
  const [rawSlots, setRawSlots] = useState(isControlled ? (value || []) : []);
  const [rangosViernes, setRangosViernes] = useState([]);
  const [rangosSabado, setRangosSabado] = useState([]);
  const [loading, setLoading] = useState(!grillaProp);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    const cargarDatos = async () => {
      setLoading(true);
      setError('');
      try {
        if (isControlled) {
          let g = grillaProp;
          if (!g) {
            const grillaData = await api.get('/organizador/slots');
            g = grillaData || { viernes: [], sabado: [] };
            if (!isCancelled) setGrilla(g);
          }
          const s = value || [];
          if (!isCancelled) {
            setRawSlots(s);
            setRangosViernes(reconstruirRangos(s, g?.viernes || [], 'Viernes'));
            setRangosSabado(reconstruirRangos(s, g?.sabado || [], 'Sabado'));
          }
        } else if (parejaId) {
          const [grillaData, slotsData] = await Promise.all([
            api.get('/organizador/slots'),
            api.get(`/parejas/${parejaId}/disponibilidad`),
          ]);

          const g = grillaData || { viernes: [], sabado: [] };
          const s = slotsData || [];
          if (!isCancelled) {
            setGrilla(g);
            setRawSlots(s);
            setRangosViernes(reconstruirRangos(s, g.viernes || [], 'Viernes'));
            setRangosSabado(reconstruirRangos(s, g.sabado || [], 'Sabado'));
          }
        }
      } catch (err) {
        if (!isCancelled) setError(err.message || 'Error al cargar disponibilidad.');
      } finally {
        if (!isCancelled) setLoading(false);
      }
    };

    cargarDatos();

    return () => {
      isCancelled = true;
    };
  }, [parejaId, torneoId, categoriaEstado, isControlled, grillaProp, value]);

  // Sincronización en modo controlado cuando cambia `value` externo
  useEffect(() => {
    if (isControlled && Array.isArray(value)) {
      setRawSlots(value);
      if (grilla) {
        setRangosViernes(reconstruirRangos(value, grilla.viernes || [], 'Viernes'));
        setRangosSabado(reconstruirRangos(value, grilla.sabado || [], 'Sabado'));
      }
    }
  }, [value, isControlled, grilla]);

  const guardarCambios = async (newRangosViernes, newRangosSabado) => {
    setSaving(true);
    setError('');
    setSavedSuccess(false);
    try {
      const slotList = rangosASlots(
        newRangosViernes,
        grilla.viernes,
        newRangosSabado,
        grilla.sabado
      );
      const saved = await api.put(`/parejas/${parejaId}/disponibilidad`, {
        slots: slotList,
      });
      setRawSlots(saved || []);
      setSavedSuccess(true);
      if (onChanged) onChanged(saved.length);
      if (onSlotsChanged) onSlotsChanged(saved.length);
    } catch (err) {
      setError(err.message || 'Error al guardar disponibilidad.');
    } finally {
      setSaving(false);
    }
  };

  const handleRangosViernesChange = (newRangos) => {
    setRangosViernes(newRangos);
    if (isControlled) {
      const slotList = rangosASlots(newRangos, grilla.viernes, rangosSabado, grilla.sabado);
      setRawSlots(slotList);
      onChange(slotList);
    } else {
      guardarCambios(newRangos, rangosSabado);
    }
  };

  const handleRangosSabadoChange = (newRangos) => {
    setRangosSabado(newRangos);
    if (isControlled) {
      const slotList = rangosASlots(rangosViernes, grilla.viernes, newRangos, grilla.sabado);
      setRawSlots(slotList);
      onChange(slotList);
    } else {
      guardarCambios(rangosViernes, newRangos);
    }
  };

  const handleLimpiarTodoControlled = () => {
    setRangosViernes([]);
    setRangosSabado([]);
    setRawSlots([]);
    if (onChange) onChange([]);
  };

  if (loading) {
    return <div className="loading" style={{ padding: '1rem', fontSize: 'var(--font-size-xs)' }}>Cargando disponibilidad...</div>;
  }

  // Vista de SOLO LECTURA cuando la categoría ya inició (EN_CURSO) o finalizó (FINALIZADO), sólo en modo legado con parejaId
  if (!isControlled && categoriaEstado !== 'BORRADOR') {
    const diasAConfigurar = [
      { key: 'Viernes', label: 'Viernes', grillaSlots: grilla.viernes || [] },
      { key: 'Sabado', label: 'Sábado', grillaSlots: grilla.sabado || [] },
    ];

    return (
      <div className="disponibilidad-editor" style={{ padding: '0.25rem 0' }}>
        {error && <div className="error-message" style={{ marginBottom: '0.75rem' }}>{error}</div>}

        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.5rem',
            padding: '0.65rem 0.85rem',
            background: 'var(--color-surface)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--color-border)',
            fontSize: 'var(--font-size-xs)',
            color: 'var(--color-text-secondary)',
            lineHeight: 1.4,
          }}
        >
          <Info size={15} strokeWidth={2} style={{ flexShrink: 0, marginTop: '2px', color: 'var(--color-text-secondary)' }} />
          <span>
            La disponibilidad se define en la inscripción y no se modifica una vez iniciado el torneo. Si la pareja necesita otro horario, reprogramá el partido.
          </span>
        </div>

        {rawSlots.length === 0 ? (
          <div
            style={{
              margin: '0.75rem 0',
              padding: '0.75rem 0.85rem',
              background: 'var(--color-bg)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-border)',
              fontSize: 'var(--font-size-xs)',
              color: 'var(--color-text-secondary)',
              fontStyle: 'italic',
              textAlign: 'center',
            }}
          >
            Sin disponibilidad declarada (se puede programar en cualquier horario)
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', margin: '0.75rem 0' }}>
            {diasAConfigurar.map((d) => {
              const slotsDia = rawSlots.filter((s) => s.startsWith(d.key + '-'));
              const texto = agruparSlotsEnRangos(slotsDia, d.grillaSlots);
              const tieneHorarios = slotsDia.length > 0;
              return (
                <div
                  key={d.key}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.55rem 0.85rem',
                    background: 'var(--color-bg)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-border)',
                    fontSize: 'var(--font-size-xs)',
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{d.label}:</span>
                  <span
                    style={{
                      color: tieneHorarios ? 'var(--color-text)' : 'var(--color-text-secondary)',
                      fontStyle: tieneHorarios ? 'normal' : 'italic',
                      wordBreak: 'break-word',
                    }}
                  >
                    {texto}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: '0.5rem',
            borderTop: '1px solid var(--color-border)',
            fontSize: 'var(--font-size-xs)',
            color: 'var(--color-text-secondary)',
            flexWrap: 'wrap',
            gap: '0.5rem',
          }}
        >
          <span>
            {rawSlots.length === 0
              ? 'Disponibilidad libre (0 restricciones)'
              : `Total: ${rawSlots.length} ${rawSlots.length === 1 ? 'turno de 15 min' : 'turnos de 15 min'}`}
          </span>
          {onClose && (
            <button
              type="button"
              className="btn-secondary"
              style={{ padding: '0.25rem 0.65rem', fontSize: 'var(--font-size-xs)' }}
              onClick={onClose}
            >
              Cerrar
            </button>
          )}
        </div>
      </div>
    );
  }

  // Vista interactiva de edición (en BORRADOR o en modo controlado)
  const sinSlotsConfigurados =
    (!grilla.viernes || grilla.viernes.length === 0) &&
    (!grilla.sabado || grilla.sabado.length === 0);

  const totalSlotsSeleccionados = rawSlots.length;

  return (
    <div className="disponibilidad-editor">
      {error && <div className="error-message" style={{ marginBottom: '0.75rem' }}>{error}</div>}

      {sinSlotsConfigurados ? (
        <div className="alert-warning" style={{ margin: '0.5rem 0', display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
          <AlertTriangle size={16} strokeWidth={2} style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            No hay horarios configurados para este torneo. El organizador debe definir la hora de inicio y fin de Viernes/Sábado en la configuración del club.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {isControlled ? (
            <div>
              {totalSlotsSeleccionados === 0 ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.65rem 0.85rem',
                    background: 'rgba(0, 208, 132, 0.08)',
                    border: '1px solid rgba(0, 208, 132, 0.25)',
                    borderRadius: 'var(--border-radius-sm)',
                    color: 'var(--color-text)',
                    fontSize: 'var(--font-size-xs)',
                    lineHeight: 1.4,
                  }}
                >
                  <Info size={16} strokeWidth={2} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
                  <span>
                    <strong>Sin restricciones:</strong> la pareja se considerará disponible en cualquier horario.
                  </span>
                </div>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.55rem 0.85rem',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--border-radius-sm)',
                    color: 'var(--color-text)',
                    fontSize: 'var(--font-size-xs)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Check size={14} style={{ color: 'var(--color-primary)' }} />
                    <span>Restricción horaria: <strong>{totalSlotsSeleccionados} turnos</strong> seleccionados</span>
                  </div>
                  <button
                    type="button"
                    className="btn-link-action text-danger"
                    onClick={handleLimpiarTodoControlled}
                    style={{ fontSize: '11px', cursor: 'pointer', background: 'none', border: 'none' }}
                  >
                    Quitar restricciones
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
              <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-xs)', margin: 0 }}>
                Arrastrá los extremos de la barra para definir las franjas horarias en las que esta pareja puede jugar:
              </p>
              {saving ? (
                <span style={{ fontSize: '11px', color: 'var(--color-primary)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                  <Loader2 size={11} className="spin" /> Guardando...
                </span>
              ) : savedSuccess ? (
                <span style={{ fontSize: '11px', color: 'var(--color-success)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontWeight: 600 }}>
                  <Check size={12} /> Guardado
                </span>
              ) : null}
            </div>
          )}

          {/* Grilla Viernes */}
          {grilla.viernes && grilla.viernes.length > 0 && (
            <RangeSliderGroup
              dia="Viernes"
              slotsDisponibles={grilla.viernes}
              rangos={rangosViernes}
              onRangosChange={handleRangosViernesChange}
              disabled={saving}
            />
          )}

          {/* Grilla Sábado */}
          {grilla.sabado && grilla.sabado.length > 0 && (
            <RangeSliderGroup
              dia="Sabado"
              slotsDisponibles={grilla.sabado}
              rangos={rangosSabado}
              onRangosChange={handleRangosSabadoChange}
              disabled={saving}
            />
          )}

          {!isControlled && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.25rem', borderTop: '1px solid var(--color-border)', paddingTop: '0.6rem' }}>
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                Total: {totalSlotsSeleccionados} {totalSlotsSeleccionados === 1 ? 'turno de 15 min' : 'turnos de 15 min'} seleccionados
              </span>
              {onClose && (
                <button
                  type="button"
                  className="btn-primary"
                  style={{ padding: '0.35rem 0.85rem', fontSize: 'var(--font-size-xs)' }}
                  onClick={onClose}
                >
                  Listo / Cerrar
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
