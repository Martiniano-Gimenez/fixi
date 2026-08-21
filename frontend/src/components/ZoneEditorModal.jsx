import { useState, useEffect } from 'react';
import { api } from '../api/client';
import ConfirmModal from './ConfirmModal';

export default function ZoneEditorModal({ torneoId, categoriaId, zonas: zonasOriginales = [], parejas = [], onClose, onSuccess, onSaved }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const targetId = categoriaId || torneoId;
  
  // Estado local para mapear parejaId -> zonaId
  const [asignaciones, setAsignaciones] = useState({});

  // Si parejas no vino como prop, extraerlas de las zonas originales
  const todasLasParejas = parejas.length > 0
    ? parejas
    : zonasOriginales.flatMap((z) => (z.zonaParejas || []).map((zp) => zp.pareja)).filter(Boolean);

  useEffect(() => {
    const initialAsignaciones = {};
    zonasOriginales.forEach((zona) => {
      zona.zonaParejas?.forEach((zp) => {
        initialAsignaciones[zp.parejaId] = zona.id;
      });
    });
    setAsignaciones(initialAsignaciones);
  }, [zonasOriginales]);

  const handleChangeZona = (parejaId, zonaId) => {
    setAsignaciones((prev) => ({
      ...prev,
      [parejaId]: zonaId,
    }));
  };

  const handleSaveClick = () => {
    setConfirmOpen(true);
  };

  const executeSave = async () => {
    setConfirmOpen(false);

    try {
      setLoading(true);
      setError('');

      const zonasMap = {};
      zonasOriginales.forEach((z) => {
        zonasMap[z.id] = { id: z.id, parejas: [] };
      });

      Object.entries(asignaciones).forEach(([parejaId, zonaId]) => {
        if (zonaId && zonasMap[zonaId]) {
          zonasMap[zonaId].parejas.push(parejaId);
        }
      });

      const payload = {
        zonas: Object.values(zonasMap),
      };

      await api.put(`/categorias/${targetId}/zonas/reestructurar`, payload);
      if (onSuccess) onSuccess();
      if (onSaved) onSaved();
    } catch (err) {
      setError(err.message || 'Error al reestructurar zonas');
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
        backdropFilter: 'blur(4px)',
      }}
    >
      <div className="auth-card" style={{ width: '90%', maxWidth: '600px', padding: '2rem', maxHeight: '90vh', overflowY: 'auto' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1.5rem',
            borderBottom: '1px solid var(--color-border)',
            paddingBottom: '1rem',
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--color-text)' }}>⚙️ Editor Manual de Zonas</h2>
            <p style={{ margin: '0.5rem 0 0 0', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
              Asigná cada pareja a una zona. Parejas sin asignar no participarán.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-text-secondary)',
              fontSize: '1.5rem',
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>

        {error && <div className="error-message" style={{ marginBottom: '1rem' }}>{error}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '2rem' }}>
          {todasLasParejas.map((pareja) => {
            const currentZonaId = asignaciones[pareja.id] || '';
            return (
              <div
                key={pareja.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '0.75rem',
                  background: 'var(--color-bg-input)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <span style={{ fontWeight: 'bold' }}>
                  {pareja.jugador1} / {pareja.jugador2}
                </span>
                <select
                  value={currentZonaId}
                  onChange={(e) => handleChangeZona(pareja.id, e.target.value)}
                  style={{ width: 'auto', padding: '0.25rem 0.5rem' }}
                >
                  <option value="">-- Sin Zona --</option>
                  {zonasOriginales.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.nombre}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>
            Cancelar
          </button>
          <button type="button" className="btn-primary" onClick={handleSaveClick} disabled={loading}>
            {loading ? 'Guardando...' : 'Guardar y Regenerar Partidos'}
          </button>
        </div>
      </div>

      <ConfirmModal
        isOpen={confirmOpen}
        title="¿Reestructurar Zonas?"
        message="Se recalcularán los partidos y se resetearán los resultados de las zonas modificadas. Las eliminatorias existentes se borrarán."
        confirmText="Confirmar Reestructuración"
        isDanger={true}
        onConfirm={executeSave}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
