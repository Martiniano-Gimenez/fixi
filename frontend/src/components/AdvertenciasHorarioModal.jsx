import { X } from 'lucide-react';

export default function AdvertenciasHorarioModal({ isOpen, advertencias, onClose }) {
  if (!isOpen || !Array.isArray(advertencias) || advertencias.length === 0) return null;

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-content"
        style={{
          maxWidth: '420px',
          width: '90%',
          boxSizing: 'border-box',
          padding: '1.25rem',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--color-text)' }}>
            Advertencias de horario
          </h3>
          <button
            type="button"
            className="btn-link-action"
            onClick={onClose}
            style={{ color: 'var(--color-text-secondary)', padding: '0.25rem' }}
          >
            <X size={18} />
          </button>
        </div>

        <ul style={{ margin: '0.5rem 0 1rem 0', paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {advertencias.map((adv, idx) => (
            <li key={idx} style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text)', lineHeight: 1.4 }}>
              {adv.mensaje}
            </li>
          ))}
        </ul>

        <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--color-border)', paddingTop: '0.75rem' }}>
          <button type="button" className="btn-secondary" onClick={onClose} style={{ minWidth: '80px' }}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
