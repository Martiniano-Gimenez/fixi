import { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';
import { formatDiaHorario } from '../utils/dateUtils';

export default function DateTimeInput({ value, onUpdate, onChange, style, title }) {
  const handleUpdate = onUpdate || onChange;
  const [localValue, setLocalValue] = useState(value);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const getInputValue = (val) => {
    if (!val) return '';
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return '';
      return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    } catch {
      return '';
    }
  };

  if (!isEditing) {
    if (!value) {
      return (
        <button
          type="button"
          title={title || 'Asignar horario'}
          onClick={(e) => {
            e.stopPropagation();
            setIsEditing(true);
          }}
          style={{
            background: 'transparent',
            border: '1px dashed var(--color-border)',
            color: 'var(--color-text-secondary)',
            fontSize: '11px',
            padding: '2px 6px',
            borderRadius: '4px',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            ...style,
          }}
        >
          <Clock size={11} /> + Horario
        </button>
      );
    }

    return (
      <span
        title={title || 'Click para editar horario'}
        onClick={(e) => {
          e.stopPropagation();
          setIsEditing(true);
        }}
        style={{
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          fontSize: '11px',
          color: 'var(--color-text-secondary)',
          fontWeight: 600,
          background: 'var(--color-bg-input)',
          padding: '2px 6px',
          borderRadius: '4px',
          border: '1px solid var(--color-border)',
          ...style,
        }}
      >
        <Clock size={11} style={{ color: 'var(--color-primary)' }} />
        {formatDiaHorario(value)}
      </span>
    );
  }

  return (
    <input
      type="datetime-local"
      value={getInputValue(localValue)}
      autoFocus
      onChange={(e) => {
        const val = e.target.value ? new Date(e.target.value).toISOString() : null;
        setLocalValue(val);
      }}
      onBlur={() => {
        setIsEditing(false);
        if (localValue !== value && handleUpdate) {
          handleUpdate(localValue);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          setIsEditing(false);
          if (localValue !== value && handleUpdate) {
            handleUpdate(localValue);
          }
        } else if (e.key === 'Escape') {
          setIsEditing(false);
          setLocalValue(value);
        }
      }}
      title={title}
      style={{
        fontSize: '11px',
        padding: '2px 6px',
        background: 'var(--color-bg-input)',
        border: '1px solid var(--color-primary)',
        color: 'var(--color-text)',
        borderRadius: '4px',
        ...style,
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
