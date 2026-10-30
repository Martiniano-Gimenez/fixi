import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export default function ZonaDropdownFilter({ zonas = [], selectedZonaId = 'todas', onSelectZona }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleOutsideClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    };
  }, [isOpen]);

  const selectedZona = zonas.find((z) => z.id === selectedZonaId);
  const label = selectedZonaId === 'todas' || !selectedZonaId
    ? 'Todas las zonas'
    : selectedZona?.nombre || 'Todas las zonas';

  const isFiltered = Boolean(selectedZonaId && selectedZonaId !== 'todas');

  return (
    <div ref={containerRef} className="pa-zone-filter">
      <button
        type="button"
        className={`pa-zone-trigger ${isFiltered ? 'active' : ''}`}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span>{label}</span>
        <ChevronDown size={14} className={`pa-zone-chevron ${isOpen ? 'open' : ''}`} />
      </button>

      {isOpen && (
        <div className="pa-zone-menu" role="listbox">
          <button
            type="button"
            className={`pa-zone-option ${selectedZonaId === 'todas' || !selectedZonaId ? 'selected' : ''}`}
            onClick={() => {
              onSelectZona('todas');
              setIsOpen(false);
            }}
            role="option"
            aria-selected={selectedZonaId === 'todas'}
          >
            <span>Todas las zonas</span>
            {(selectedZonaId === 'todas' || !selectedZonaId) && (
              <Check size={14} className="pa-zone-check" />
            )}
          </button>
          {zonas.map((z) => {
            const isSelected = selectedZonaId === z.id;
            return (
              <button
                key={z.id}
                type="button"
                className={`pa-zone-option ${isSelected ? 'selected' : ''}`}
                onClick={() => {
                  onSelectZona(z.id);
                  setIsOpen(false);
                }}
                role="option"
                aria-selected={isSelected}
              >
                <span>{z.nombre}</span>
                {isSelected && <Check size={14} className="pa-zone-check" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
