import { useState, useEffect, useRef } from 'react';
import { api } from '../api/client';
import { AlertTriangle, Check, Loader2, Info } from 'lucide-react';
import RangeSliderGroup from './RangeSliderGroup';
import {
  reconstruirRangos,
  rangosASlots,
  areSlotArraysEqual,
  agruparSlotsEnRangos,
} from '../utils/disponibilidadUtils';

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
  // Deshabilita los sliders (por ejemplo, con "Puedo en cualquier horario" marcado).
  // Con grillaProp no se pide la grilla a /organizador/slots (que requiere login); en modo
  // controlado conviene memoizarla: un objeto nuevo en cada render vuelve a cargar el editor.
  disabled = false,
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

  // Rastrea la última lista de slots emitida internamente por este editor
  const lastEmittedSlotsRef = useRef(isControlled && Array.isArray(value) ? value : null);
  const initialValueRef = useRef(value);

  useEffect(() => {
    let isCancelled = false;

    const cargarDatos = async () => {
      setError('');
      try {
        if (isControlled) {
          let g = grillaProp;
          if (!g) {
            setLoading(true);
            const grillaData = await api.get('/organizador/slots');
            g = grillaData || { viernes: [], sabado: [] };
            if (!isCancelled) setGrilla(g);
          }
          const s = initialValueRef.current || [];
          if (!isCancelled) {
            lastEmittedSlotsRef.current = s;
            setRawSlots(s);
            setRangosViernes(reconstruirRangos(s, g?.viernes || [], 'Viernes'));
            setRangosSabado(reconstruirRangos(s, g?.sabado || [], 'Sabado'));
          }
        } else if (parejaId) {
          setLoading(true);
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
  }, [parejaId, torneoId, categoriaEstado, isControlled, grillaProp]);

  // Sincronización en modo controlado cuando cambia `value` externo (ej. reset a [])
  useEffect(() => {
    if (!isControlled || !Array.isArray(value)) return;

    // Si el nuevo `value` coincide con lo último emitido por este editor, no pisar lo editado
    if (areSlotArraysEqual(value, lastEmittedSlotsRef.current)) {
      setRawSlots(value);
      return;
    }

    // Cambio genuino proveniente de afuera: actualizar ref y reconstruir rangos locales
    lastEmittedSlotsRef.current = value;
    setRawSlots(value);
    if (grilla) {
      setRangosViernes(reconstruirRangos(value, grilla.viernes || [], 'Viernes'));
      setRangosSabado(reconstruirRangos(value, grilla.sabado || [], 'Sabado'));
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
      lastEmittedSlotsRef.current = slotList;
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
      lastEmittedSlotsRef.current = slotList;
      setRawSlots(slotList);
      onChange(slotList);
    } else {
      guardarCambios(rangosViernes, newRangos);
    }
  };

  const handleLimpiarTodoControlled = () => {
    lastEmittedSlotsRef.current = [];
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
            Sin restricciones: disponible en todo el horario del club
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

        {onClose && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              paddingTop: '0.5rem',
              borderTop: '1px solid var(--color-border)',
            }}
          >
            <button
              type="button"
              className="btn-secondary"
              style={{ padding: '0.25rem 0.65rem', fontSize: 'var(--font-size-xs)' }}
              onClick={onClose}
            >
              Cerrar
            </button>
          </div>
        )}
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
            totalSlotsSeleccionados > 0 && !disabled ? (
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
                  Limpiar horarios
                </button>
              </div>
            ) : null
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
              disabled={saving || disabled}
            />
          )}

          {/* Grilla Sábado */}
          {grilla.sabado && grilla.sabado.length > 0 && (
            <RangeSliderGroup
              dia="Sábado"
              slotsDisponibles={grilla.sabado}
              rangos={rangosSabado}
              onRangosChange={handleRangosSabadoChange}
              disabled={saving || disabled}
            />
          )}

          {!isControlled && onClose && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginTop: '0.25rem', borderTop: '1px solid var(--color-border)', paddingTop: '0.6rem' }}>
              <button
                type="button"
                className="btn-primary"
                style={{ padding: '0.35rem 0.85rem', fontSize: 'var(--font-size-xs)' }}
                onClick={onClose}
              >
                Listo / Cerrar
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
