import { Calendar, Plus } from 'lucide-react';
import RangeSliderDia from './RangeSliderDia';

export default function RangeSliderGroup({
  dia,
  slotsDisponibles = [],
  rangos = [],
  onRangosChange,
  disabled = false,
}) {
  const totalSlots = slotsDisponibles.length;
  if (totalSlots === 0) return null;

  const handleAddRange = () => {
    if (disabled) return;
    const maxIdx = totalSlots - 1;

    let newStart = 0;
    let newEnd = maxIdx;

    if (rangos.length > 0) {
      // Intentar encontrar un espacio libre después del último rango
      const lastRango = rangos[rangos.length - 1];
      if (lastRango.endIdx + 4 <= maxIdx) {
        newStart = Math.min(lastRango.endIdx + 2, maxIdx);
        newEnd = maxIdx;
      } else if (rangos[0].startIdx >= 4) {
        newStart = 0;
        newEnd = Math.max(0, rangos[0].startIdx - 2);
      } else {
        // Rango por defecto en la mitad
        newStart = Math.floor(maxIdx / 2);
        newEnd = maxIdx;
      }
    }

    const newRango = {
      id: `rango-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      startIdx: newStart,
      endIdx: newEnd,
    };

    onRangosChange([...rangos, newRango]);
  };

  const handleUpdateRange = (index, newStart, newEnd) => {
    if (disabled) return;
    const updated = rangos.map((r, i) => {
      if (i === index) {
        return { ...r, startIdx: newStart, endIdx: newEnd };
      }
      return r;
    });
    onRangosChange(updated);
  };

  const handleRemoveRange = (index) => {
    if (disabled) return;
    const updated = rangos.filter((_, i) => i !== index);
    onRangosChange(updated);
  };

  const handleSelectFullDay = () => {
    if (disabled) return;
    onRangosChange([
      {
        id: `rango-${Date.now()}-full`,
        startIdx: 0,
        endIdx: totalSlots - 1,
      },
    ]);
  };

  const handleClearDay = () => {
    if (disabled) return;
    onRangosChange([]);
  };

  // Calcular total de slots seleccionados en este día sumando los rangos (sin duplicados)
  const slotSet = new Set();
  rangos.forEach((r) => {
    for (let i = r.startIdx; i <= r.endIdx; i++) {
      if (slotsDisponibles[i]) slotSet.add(slotsDisponibles[i]);
    }
  });

  const slotsCount = slotSet.size;

  return (
    <div className="dia-slots-group">
      <div className="dia-slots-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span className="dia-titulo" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
            <Calendar size={14} strokeWidth={2} className="text-primary" />
            {dia}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {rangos.length > 0 ? (
            <>
              {slotsCount < totalSlots && (
                <button
                  type="button"
                  className="btn-link-action"
                  onClick={handleSelectFullDay}
                  disabled={disabled}
                >
                  Día completo
                </button>
              )}
              <button
                type="button"
                className="btn-link-action text-danger"
                onClick={handleClearDay}
                disabled={disabled}
              >
                Limpiar día
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn-link-action"
              onClick={handleSelectFullDay}
              disabled={disabled}
            >
              Seleccionar día completo
            </button>
          )}
        </div>
      </div>

      {rangos.length === 0 ? (
        <div className="dia-empty-ranges">
          <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>
            No tiene horarios seleccionados para el {dia.toLowerCase()}.
          </span>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={handleAddRange}
            disabled={disabled}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', alignSelf: 'flex-start' }}
          >
            <Plus size={12} /> Agregar rango horario en {dia.toLowerCase()}
          </button>
        </div>
      ) : (
        <div className="ranges-list">
          {rangos.map((rango, idx) => (
            <RangeSliderDia
              key={rango.id || `rango-${idx}`}
              dia={dia}
              slotsDisponibles={slotsDisponibles}
              startIdx={rango.startIdx}
              endIdx={rango.endIdx}
              onChange={(start, end) => handleUpdateRange(idx, start, end)}
              onRemove={() => handleRemoveRange(idx)}
              disabled={disabled}
            />
          ))}

          <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '0.25rem' }}>
            <button
              type="button"
              className="btn-link-action"
              onClick={handleAddRange}
              disabled={disabled}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.3rem',
                fontSize: '11.5px',
                color: 'var(--color-primary)',
              }}
            >
              <Plus size={12} /> Agregar otro rango horario ({dia.toLowerCase()})
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
