import { useEffect, useRef } from 'react';

export default function ConfirmModal({ isOpen, title, message, onConfirm, onCancel, confirmText, isDanger, isAlert }) {
  const cancelRef = useRef(null);

  useEffect(() => {
    if (isOpen && cancelRef.current) {
      cancelRef.current.focus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="pm-overlay pm-confirm-overlay">
      <div className="pm-modal pm-confirm" role="dialog" aria-modal="true" aria-label={title}>
        <h2 className={`pm-header pm-title${isDanger ? ' pm-danger-text' : ''}`}>
          {title}
        </h2>
        <p className="pm-confirm-message">
          {message}
        </p>
        <div className="pm-footer">
          {!isAlert && (
            <button
              ref={cancelRef}
              type="button"
              onClick={onCancel}

              className="pm-button pm-grow"
            >
              Cancelar
            </button>
          )}
          <button
            type="button"
            onClick={onConfirm}

            className={`pm-button pm-grow pm-primary${isDanger ? ' pm-destructive' : ''}`}
          >
            {confirmText || 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
}
