import { useState, useEffect } from 'react';
import { api } from '../api/client';
import ConfirmModal from './ConfirmModal';

export default function ZoneEditorModal({ torneoId, zonasOriginales, parejas, onClose, onSaved }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  
  // Estado local para mapear parejaId -> zonaId
  const [asignaciones, setAsignaciones] = useState({});

  useEffect(() => {
    const initialAsignaciones = {};
    // Mapear asignaciones iniciales
    zonasOriginales.forEach(zona => {
      zona.zonaParejas?.forEach(zp => {
        initialAsignaciones[zp.parejaId] = zona.id;
      });
    });
    setAsignaciones(initialAsignaciones);
  }, [zonasOriginales]);

  const handleChangeZona = (parejaId, zonaId) => {
    setAsignaciones(prev => ({
      ...prev,
      [parejaId]: zonaId
    }));
  };

  // Calcular la cantidad actual de parejas por zona según las asignaciones locales
  const parejasPorZona = {};
  Object.values(asignaciones).forEach(zonaId => {
    if (zonaId) {
      parejasPorZona[zonaId] = (parejasPorZona[zonaId] || 0) + 1;
    }
  });

  const handleSaveClick = () => {
    setConfirmOpen(true);
  };

  const executeSave = async () => {
    setConfirmOpen(false);

    try {
      setLoading(true);
      setError('');

      // Agrupar parejas por zona
      const zonasMap = {};
      zonasOriginales.forEach(z => {
        zonasMap[z.id] = { id: z.id, parejas: [] };
      });

      Object.entries(asignaciones).forEach(([parejaId, zonaId]) => {
        if (zonaId && zonasMap[zonaId]) {
          zonasMap[zonaId].parejas.push(parejaId);
        }
      });

      const payload = {
        zonas: Object.values(zonasMap)
      };

      await api.put(`/torneos/${torneoId}/zonas/reestructurar`, payload);
      onSaved();
    } catch (err) {
      setError(err.message || 'Error al reestructurar zonas');
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100,
      backdropFilter: 'blur(4px)'
    }}>
      <div className="auth-card" style={{ width: '90%', maxWidth: '600px', padding: '2rem', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '1rem' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--color-text)' }}>⚙️ Editor Manual de Zonas</h2>
            <p style={{ margin: '0.5rem 0 0 0', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
              Asigná cada pareja a una zona. Parejas sin asignar no participarán.
            </p>
          </div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--color-text-secondary)', fontSize: '1.5rem', cursor: 'pointer', lineHeight: 1 }}>&times;</button>
        </div>

        {error && <div className="error-message" style={{ marginBottom: '1rem' }}>{error}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '2rem' }}>
          {parejas.map(pareja => {
            const currentZonaId = asignaciones[pareja.id] || '';
            return (
              <div key={pareja.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem', background: 'var(--color-bg-input)', borderRadius: 'var(--radius-md)' }}>
                <span style={{ fontWeight: 'bold' }}>{pareja.jugador1} / {pareja.jugador2}</span>
                <select
                  value={currentZonaId}
                  onChange={(e) => handleChangeZona(pareja.id, e.target.value)}
                  style={{
                    padding: '0.5rem',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg-card)',
                    color: 'var(--color-text)',
                    fontSize: '0.875rem',
                    width: 'auto',
                    minWidth: '180px'
                  }}
                >
                  <option value="">-- Sin asignar --</option>
                  {zonasOriginales.map(z => {
                    const count = parejasPorZona[z.id] || 0;
                    // Mostramos la cantidad en todas las zonas EXCEPTO en la que ya está seleccionada.
                    // Esto permite que el select cerrado se vea limpio, pero al abrirlo veas el espacio en las demás zonas.
                    const showCount = currentZonaId !== z.id;
                    return (
                      <option key={z.id} value={z.id}>
                        {z.nombre}{showCount ? ` (${count} pareja${count !== 1 ? 's' : ''})` : ''}
                      </option>
                    );
                  })}
                </select>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} className="btn-secondary" disabled={loading} style={{ width: 'auto' }}>
            Cancelar
          </button>
          <button type="button" onClick={handleSaveClick} className="btn-primary" disabled={loading} style={{ width: 'auto' }}>
            {loading ? 'Guardando...' : 'Guardar y Recalcular'}
          </button>
        </div>
      </div>

      {confirmOpen && (
        <ConfirmModal 
          isOpen={true}
          title="⚠️ Guardar Cambios en Zonas"
          message="ATENCIÓN: Guardar estos cambios recalculará los cruces y BORRARÁ TODOS LOS RESULTADOS CARGADOS en las zonas que hayan cambiado de tamaño o integrantes. ¿Estás seguro de continuar?"
          onConfirm={executeSave}
          onCancel={() => setConfirmOpen(false)}
          confirmText="Sí, guardar y recalcular"
          isDanger={true}
        />
      )}
    </div>
  );
}
