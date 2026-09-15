import { useState, useEffect } from 'react';
import { X, Calendar, ListOrdered, Check, AlertCircle, Loader2 } from 'lucide-react';
import { api } from '../api/client';

export default function OrdenDomingoModal({ isOpen, torneoId, categorias: initialCategorias = null, onClose, onSaved }) {
  const [categorias, setCategorias] = useState([]);
  const [ordenMap, setOrdenMap] = useState({});
  const [loadingCats, setLoadingCats] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;

    setError('');
    const loadCategorias = async () => {
      if (initialCategorias && initialCategorias.length > 0) {
        setCategorias(initialCategorias);
        const map = {};
        initialCategorias.forEach((cat) => {
          map[cat.id] = cat.ordenDomingo !== null && cat.ordenDomingo !== undefined ? String(cat.ordenDomingo) : '';
        });
        setOrdenMap(map);
        return;
      }

      if (torneoId) {
        setLoadingCats(true);
        try {
          const cats = await api.get(`/torneos/${torneoId}/categorias`);
          setCategorias(cats || []);
          const map = {};
          (cats || []).forEach((cat) => {
            map[cat.id] = cat.ordenDomingo !== null && cat.ordenDomingo !== undefined ? String(cat.ordenDomingo) : '';
          });
          setOrdenMap(map);
        } catch (err) {
          setError(err.message || 'Error al cargar categorías del torneo.');
        } finally {
          setLoadingCats(false);
        }
      }
    };

    loadCategorias();
  }, [isOpen, torneoId, initialCategorias]);

  if (!isOpen) return null;

  const handleSelectChange = (catId, value) => {
    setOrdenMap((prev) => ({
      ...prev,
      [catId]: value,
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');

    const ordenes = Object.entries(ordenMap).map(([categoriaId, val]) => ({
      categoriaId,
      ordenDomingo: val === '' ? null : Number(val),
    }));

    try {
      const updated = await api.put(`/torneos/${torneoId}/orden-domingo`, { ordenes });
      if (onSaved) {
        onSaved(updated);
      }
      onClose();
    } catch (err) {
      setError(err.message || 'Error al guardar el orden del domingo.');
    } finally {
      setSaving(false);
    }
  };

  const totalCategorias = categorias.length;

  return (
    <div className="modal-overlay" style={{ zIndex: 1050 }}>
      <div
        className="modal-content"
        style={{
          maxWidth: '520px',
          width: '100%',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          padding: '1.5rem',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
              <ListOrdered size={20} style={{ color: 'var(--color-primary)' }} />
              <h2 style={{ margin: 0, fontSize: 'var(--font-size-lg)', fontWeight: 600 }}>
                Orden de Categorías del Domingo
              </h2>
            </div>
            <p style={{ margin: 0, fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
              Asigná la prioridad con la que las categorías arrancan a jugar el domingo.
              Las de menor número (ej. 1) ocuparán los primeros turnos y canchas disponibles (ej. 08:00 AM).
              Al iniciar el torneo, todos los cruces eliminatorios (Octavos a Final) se programarán automáticamente según este orden y quedarán fijados.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-icon"
            style={{ padding: '0.25rem', color: 'var(--color-text-secondary)' }}
          >
            <X size={20} />
          </button>
        </div>

        {error && (
          <div
            style={{
              padding: '0.75rem',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid var(--color-error)',
              color: 'var(--color-error)',
              fontSize: 'var(--font-size-xs)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              marginBottom: '1rem',
            }}
          >
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* Lista de Categorías */}
        <div style={{ flex: 1, overflowY: 'auto', marginBottom: '1.25rem' }}>
          {categorias.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--color-text-secondary)' }}>
              No hay categorías cargadas en este torneo.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {categorias.map((cat, idx) => {
                const currentVal = ordenMap[cat.id] || '';

                return (
                  <div
                    key={cat.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.75rem 1rem',
                      background: 'var(--color-bg-input)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>
                        {cat.nombre}
                      </div>
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                        {currentVal ? `Posición asignada: #${currentVal}` : 'Sin posición (al final)'}
                      </div>
                    </div>

                    <div style={{ width: '130px' }}>
                      <select
                        className="form-control"
                        value={currentVal}
                        onChange={(e) => handleSelectChange(cat.id, e.target.value)}
                        style={{ padding: '0.4rem 0.6rem', fontSize: 'var(--font-size-xs)' }}
                      >
                        <option value="">Sin asignar</option>
                        {Array.from({ length: totalCategorias }, (_, i) => i + 1).map((num) => (
                          <option key={num} value={String(num)}>
                            {num}° Turno ({num})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', borderTop: '1px solid var(--color-border)', paddingTop: '1rem' }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleSave}
            disabled={saving}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
          >
            {saving ? (
              <>
                <Loader2 size={16} className="spin" /> Guardando...
              </>
            ) : (
              <>
                <Check size={16} /> Guardar Orden
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
