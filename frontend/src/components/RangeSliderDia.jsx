import { useState, useEffect } from 'react';
import { Clock, Trash2 } from 'lucide-react';
import { horaFinPartido } from '../utils/disponibilidadUtils';

export default function RangeSliderDia({
  dia,
  slotsDisponibles = [],
  startIdx = 0,
  endIdx = 0,
  onChange,
  onRemove,
  disabled = false,
}) {
  const totalSlots = slotsDisponibles.length;
  const maxIdx = Math.max(0, totalSlots - 1);

  const [localStart, setLocalStart] = useState(Math.min(Math.max(0, startIdx), maxIdx));
  const [localEnd, setLocalEnd] = useState(Math.min(Math.max(localStart, endIdx), maxIdx));
  const [activeThumb, setActiveThumb] = useState(null);

  useEffect(() => {
    const s = Math.min(Math.max(0, startIdx), maxIdx);
    const e = Math.min(Math.max(s, endIdx), maxIdx);
    setLocalStart(s);
    setLocalEnd(e);
  }, [startIdx, endIdx, maxIdx]);

  if (totalSlots === 0) return null;

  const handleStartChange = (e) => {
    const val = Math.min(Number(e.target.value), localEnd);
    setLocalStart(val);
    setActiveThumb('start');
  };

  const handleEndChange = (e) => {
    const val = Math.max(Number(e.target.value), localStart);
    setLocalEnd(val);
    setActiveThumb('end');
  };

  const handleCommit = () => {
    setActiveThumb(null);
    if (onChange) {
      onChange(localStart, localEnd);
    }
  };

  const startSlotId = slotsDisponibles[localStart] || slotsDisponibles[0];
  const endSlotId = slotsDisponibles[localEnd] || slotsDisponibles[maxIdx];

  const startHora = startSlotId ? startSlotId.split('-')[1] : '--:--';
  const endHora = horaFinPartido(endSlotId?.split('-')[1]);

  const leftPercent = maxIdx > 0 ? (localStart / maxIdx) * 100 : 0;
  const rightPercent = maxIdx > 0 ? ((maxIdx - localEnd) / maxIdx) * 100 : 0;

  return (
    <div className="range-slider-item">
      <div className="range-slider-header">
        <div className="range-slider-time-badge">
          <Clock size={12} className="text-primary" />
          <span className="time-text">
            {startHora} a {endHora}
          </span>
        </div>

        {onRemove && (
          <button
            type="button"
            className="btn-icon btn-remove-range"
            onClick={onRemove}
            disabled={disabled}
            title="Eliminar este rango horario"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      <div className="dual-range-wrapper">
        <div className="dual-range-track" />
        <div
          className="dual-range-highlight"
          style={{
            left: `${leftPercent}%`,
            right: `${rightPercent}%`,
          }}
        />

        <input
          type="range"
          min={0}
          max={maxIdx}
          value={localStart}
          onChange={handleStartChange}
          onMouseUp={handleCommit}
          onTouchEnd={handleCommit}
          onKeyUp={handleCommit}
          disabled={disabled}
          className={`dual-range-input thumb-start ${activeThumb === 'start' ? 'active-thumb' : ''}`}
          aria-label={`Hora inicio ${dia}`}
          style={{
            zIndex: activeThumb === 'start' || localStart > maxIdx - 2 ? 5 : 3,
          }}
        />

        <input
          type="range"
          min={0}
          max={maxIdx}
          value={localEnd}
          onChange={handleEndChange}
          onMouseUp={handleCommit}
          onTouchEnd={handleCommit}
          onKeyUp={handleCommit}
          disabled={disabled}
          className={`dual-range-input thumb-end ${activeThumb === 'end' ? 'active-thumb' : ''}`}
          aria-label={`Hora fin ${dia}`}
          style={{
            zIndex: activeThumb === 'end' || localEnd < 2 ? 5 : 4,
          }}
        />
      </div>

      <div className="range-slider-ticks">
        <span>{slotsDisponibles[0]?.split('-')[1]}</span>
        <span>{horaFinPartido(slotsDisponibles[maxIdx]?.split('-')[1])}</span>
      </div>
    </div>
  );
}
