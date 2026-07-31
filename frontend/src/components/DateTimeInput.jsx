import { useState, useEffect } from 'react';

export default function DateTimeInput({ value, onUpdate, style, title }) {
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  return (
    <input
      type="datetime-local"
      value={localValue || ''}
      onChange={(e) => setLocalValue(e.target.value)}
      onBlur={() => {
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
