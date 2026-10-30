import { X } from 'lucide-react';

export default function AdvertenciasHorarioModal({ isOpen, advertencias, onClose }) {
  if (!isOpen || !Array.isArray(advertencias) || advertencias.length === 0) return null;

  return (
    <div
      className="pm-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div

        className="pm-modal pm-warnings"
        role="dialog"
        aria-modal="true"
        aria-label="Advertencias de horario"
      >
        <div className="pm-header">
          <h3 className="pm-title">
            Advertencias de horario
          </h3>
          <button
            type="button"

            onClick={onClose}
            className="pm-button pm-close"
            aria-label="Cerrar advertencias de horario"
          >
            <X size={18} />
          </button>
        </div>

        <div className="pm-body">
        <ul className="pm-warning-list cb-warning-list">
          {advertencias.map((adv, idx) => (
            <li key={idx} className="pm-alert">
              {adv.mensaje}
            </li>
          ))}
        </ul>
        </div>

        <div className="pm-footer">
          <button type="button" onClick={onClose} className="pm-button">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
