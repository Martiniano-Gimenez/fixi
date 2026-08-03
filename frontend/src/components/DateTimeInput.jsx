import { useState, useEffect } from 'react';

export default function DateTimeInput({ value, onUpdate, style, title }) {
  const [localValue, setLocalValue] = useState(value);

  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  if (!localValue && !isEditing) {
    return (
      <button 
        type="button"
        title={title}
        onClick={(e) => {
          e.stopPropagation();
          setIsEditing(true);
        }}
        style={{ ...style, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
      >
        📅
      </button>
    );
  }

  return (
    <input
      type="datetime-local"
      value={localValue || ''}
      autoFocus={isEditing}
      onChange={(e) => setLocalValue(e.target.value)}
      onBlur={() => {
        setIsEditing(false);
        if (localValue !== value) {
          onUpdate(localValue);
        }
      }}
      title={title}
      style={style}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
