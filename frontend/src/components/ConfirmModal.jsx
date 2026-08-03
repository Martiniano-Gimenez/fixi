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
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100,
      backdropFilter: 'blur(4px)'
    }}>
      <div className="auth-card" style={{ width: '90%', maxWidth: '400px', padding: '2rem', textAlign: 'center' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem', color: isDanger ? 'var(--color-danger)' : 'var(--color-text)' }}>
          {title}
        </h2>
        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: '2rem', lineHeight: '1.5' }}>
          {message}
        </p>
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          {!isAlert && (
            <button 
              ref={cancelRef}
              type="button" 
              onClick={onCancel} 
              className="btn-primary"
              style={{ flex: 1, background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
            >
              Cancelar
            </button>
          )}
          <button 
            type="button" 
            onClick={onConfirm} 
            className="btn-primary"
            style={{ 
              flex: 1, 
              background: isDanger ? 'var(--color-danger)' : 'var(--color-primary)', 
              color: 'white',
              border: 'none'
            }}
          >
            {confirmText || 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
}
