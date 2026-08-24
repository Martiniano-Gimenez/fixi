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

export default function DisponibilidadEditor({ parejaId, torneoId, onChanged, onSlotsChanged, onClose }) {
  const [grilla, setGrilla] = useState({ viernes: [], sabado: [] });
  const [rangosViernes, setRangosViernes] = useState([]);
  const [rangosSabado, setRangosSabado] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedSuccess, setSavedSuccess] = useState(false);

  const initialLoadedRef = useRef(false);

  useEffect(() => {
    cargarDatos();
  }, [parejaId, torneoId]);

  const cargarDatos = async () => {
    setLoading(true);
    setError('');
    try {
      const [grillaData, slotsData] = await Promise.all([
        api.get('/organizador/slots'),
        api.get(`/parejas/${parejaId}/disponibilidad`),
      ]);

      const g = grillaData || { viernes: [], sabado: [] };
      setGrilla(g);

      const rv = reconstruirRangos(slotsData || [], g.viernes || [], 'Viernes');
      const rs = reconstruirRangos(slotsData || [], g.sabado || [], 'Sabado');

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
    return <div className="loading" style={{ padding: '1rem' }}>Cargando grilla de horarios...</div>;
  }

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
