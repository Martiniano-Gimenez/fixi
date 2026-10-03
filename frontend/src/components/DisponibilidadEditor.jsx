import { useState, useEffect, useRef } from 'react';
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
      if (grillaViernes[i]) result.add(grillaViernes[i]);
    }
  });
  (rangosSabado || []).forEach((r) => {
    for (let i = r.startIdx; i <= r.endIdx; i++) {
      if (grillaSabado[i]) result.add(grillaSabado[i]);
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

export default function DisponibilidadEditor({ parejaId, torneoId, categoriaEstado, onChanged, onSlotsChanged, onClose }) {
  const [grilla, setGrilla] = useState({ viernes: [], sabado: [] });
  const [rawSlots, setRawSlots] = useState([]);
  const [rangosViernes, setRangosViernes] = useState([]);
  const [rangosSabado, setRangosSabado] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedSuccess, setSavedSuccess] = useState(false);

  const initialLoadedRef = useRef(false);

  useEffect(() => {
    cargarDatos();
  }, [parejaId, torneoId, categoriaEstado]);

  const cargarDatos = async () => {
    setLoading(true);
    setError('');
    try {
      const [grillaData, slotsData] = await Promise.all([
        api.get('/organizador/slots'),
        api.get(`/parejas/${parejaId}/disponibilidad`),
      ]);

      const g = grillaData || { viernes: [], sabado: [] };
      const s = slotsData || [];
      setGrilla(g);
      setRawSlots(s);

      const rv = reconstruirRangos(s, g.viernes || [], 'Viernes');
      const rs = reconstruirRangos(s, g.sabado || [], 'Sabado');

      setRangosViernes(rv);
      setRangosSabado(rs);
      initialLoadedRef.current = true;
    } catch (err) {
      setError(err.message || 'Error al cargar disponibilidad.');
    } finally {
      setLoading(false);
    }
  };

  const guardarCambios = async (newRangosViernes, newRangosSabado) => {
    setSaving(true);
    setError('');
    setSavedSuccess(false);
    try {
      const slotList = rangosASlots(newRangosViernes, grilla.viernes, newRangosSabado, grilla.sabado);
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
    guardarCambios(newRangos, rangosSabado);
  };

  const handleRangosSabadoChange = (newRangos) => {
    setRangosSabado(newRangos);
    guardarCambios(rangosViernes, newRangos);
  };

  if (loading) {
    return <div className="loading" style={{ padding: '1rem', fontSize: 'var(--font-size-xs)' }}>Cargando disponibilidad...</div>;
  }

  // Vista de SOLO LECTURA cuando la categoría ya inició (EN_CURSO) o finalizó (FINALIZADO)
  if (categoriaEstado !== 'BORRADOR') {
    const diasAConfigurar = [
      { key: 'Viernes', label: 'Viernes', grillaSlots: grilla.viernes || [] },
      { key: 'Sabado', label: 'Sábado', grillaSlots: grilla.sabado || [] },
    ];
    if (grilla.domingo?.length > 0 || rawSlots.some((s) => s.startsWith('Domingo-'))) {
      diasAConfigurar.push({ key: 'Domingo', label: 'Domingo', grillaSlots: grilla.domingo || [] });
    }

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

  // Vista interactiva de edición (exclusiva de BORRADOR)
  const sinSlotsConfigurados = grilla.viernes.length === 0 && grilla.sabado.length === 0;
  const currentSlots = rangosASlots(rangosViernes, grilla.viernes, rangosSabado, grilla.sabado);
  const totalSlotsSeleccionados = currentSlots.length;

  return (
    <div className="disponibilidad-editor">
      {error && <div className="error-message" style={{ marginBottom: '0.75rem' }}>{error}</div>}

      {sinSlotsConfigurados ? (
        <div className="alert-warning" style={{ margin: '0.5rem 0', display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
          <AlertTriangle size={16} strokeWidth={2} style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            No hay horarios configurados para este torneo. El organizador debe definir la hora de inicio y fin de
            Viernes/Sábado en la configuración del club.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
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

          {/* Grilla Viernes */}
          {grilla.viernes.length > 0 && (
            <RangeSliderGroup
              dia="Viernes"
              slotsDisponibles={grilla.viernes}
              rangos={rangosViernes}
              onRangosChange={handleRangosViernesChange}
              disabled={saving}
            />
          )}

          {/* Grilla Sábado */}
          {grilla.sabado.length > 0 && (
            <RangeSliderGroup
              dia="Sabado"
              slotsDisponibles={grilla.sabado}
              rangos={rangosSabado}
              onRangosChange={handleRangosSabadoChange}
              disabled={saving}
            />
          )}

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
        </div>
      )}
    </div>
  );
}
