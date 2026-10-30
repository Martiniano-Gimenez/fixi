import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical } from 'lucide-react';

export default function ActionsMenu({ children, title = 'Más opciones' }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);
  const btnRef = useRef(null);
  const panelRef = useRef(null);

  const updatePosition = () => {
    if (!btnRef.current || !panelRef.current) return;

    const btnRect = btnRef.current.getBoundingClientRect();
    const panelRect = panelRef.current.getBoundingClientRect();
    const panelWidth = panelRect.width || 195;
    const panelHeight = panelRect.height || 180;
    const PADDING = 8; // Margen de seguridad respecto a los bordes del viewport

    // 1. Cálculo horizontal:
    // Por defecto, intentar alinear el borde derecho del panel con el borde derecho del botón
    let left = btnRect.right - panelWidth;

    // Si desborda hacia la izquierda del viewport (ej. botón envuelto en fila nueva pegado al margen izquierdo):
    if (left < PADDING) {
      // Intentar alinear con el borde izquierdo del botón
      left = Math.max(PADDING, btnRect.left);
    }

    // Asegurar que nunca desborde hacia el borde derecho del viewport
    if (left + panelWidth > window.innerWidth - PADDING) {
      left = Math.max(PADDING, window.innerWidth - panelWidth - PADDING);
    }

    // 2. Cálculo vertical:
    let top = btnRect.bottom + 6;
    // Si desborda por abajo y hay espacio suficiente arriba, abrir hacia arriba
    if (
      top + panelHeight > window.innerHeight - PADDING &&
      btnRect.top - panelHeight - 6 > PADDING
    ) {
      top = btnRect.top - panelHeight - 6;
    }

    panelRef.current.style.top = `${top}px`;
    panelRef.current.style.left = `${left}px`;
    panelRef.current.style.opacity = '1';
    panelRef.current.style.pointerEvents = 'auto';
  };

  useLayoutEffect(() => {
    if (!isOpen) return;
    updatePosition();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleOutsideClick = (e) => {
      if (
        containerRef.current && !containerRef.current.contains(e.target) &&
        panelRef.current && !panelRef.current.contains(e.target)
      ) {
        setIsOpen(false);
      }
    };

    const handleScrollOrResize = () => {
      setIsOpen(false);
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    window.addEventListener('scroll', handleScrollOrResize, { passive: true });
    window.addEventListener('resize', handleScrollOrResize);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
      window.removeEventListener('scroll', handleScrollOrResize);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [isOpen]);

  const handlePanelClick = (e) => {
    if (e.target.closest('.actions-menu-item')) {
      setIsOpen(false);
    }
  };

  return (
    <div className="actions-menu cd-menu" ref={containerRef}>
      <button
        type="button"
        ref={btnRef}
        className={`cd-menu-trigger ${isOpen ? 'active' : ''}`}
        onClick={() => setIsOpen((prev) => !prev)}
        title={title}
        aria-label={title}
        aria-expanded={isOpen}
      >
        <MoreVertical size={16} />
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={panelRef}

            role="menu"
            onClick={handlePanelClick}
            className="panel actions-menu-panel cd-menu-panel"
          >
            {children}
          </div>,
          document.body
        )}
    </div>
  );
}
