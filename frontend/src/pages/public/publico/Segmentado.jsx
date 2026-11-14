import { useEffect, useRef } from 'react';

const reducido = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Selector segmentado con indicador que se desliza (patrón de pestañas).
 * Con más de 6 opciones se desplaza de costado y cada opción mide al menos 44px.
 * items: [{ key, label, aria? }]
 */
export default function Segmentado({ items, activo, onCambiar, etiqueta, idBase }) {
  const scrollRef = useRef(null);
  const tabsRef = useRef([]);
  const muchos = items.length > 6;
  const i = Math.max(0, activo);

  // Mantener visible la opción activa cuando el selector se desplaza
  useEffect(() => {
    const sc = scrollRef.current;
    const tab = tabsRef.current[i];
    if (!sc || !tab) return;
    const destino = tab.offsetLeft - (sc.clientWidth - tab.offsetWidth) / 2;
    sc.scrollTo({ left: destino, behavior: reducido() ? 'auto' : 'smooth' });
  }, [i]);

  const onKeyDown = (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const n = items.length;
    const sig = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n;
    onCambiar(sig);
    tabsRef.current[sig]?.focus();
  };

  const seg = (
    <div className="pv-seg" role="tablist" aria-label={etiqueta} onKeyDown={onKeyDown}>
      <span
        className="pv-seg-ind"
        aria-hidden="true"
        style={{ width: `calc((100% - 8px) / ${items.length})`, transform: `translateX(${i * 100}%)` }}
      />
      {items.map((it, j) => (
        <button
          key={it.key}
          ref={(el) => { tabsRef.current[j] = el; }}
          type="button"
          role="tab"
          id={idBase ? `${idBase}-tab-${it.key}` : undefined}
          aria-controls={idBase ? `${idBase}-panel-${it.key}` : undefined}
          aria-selected={j === i}
          aria-label={it.aria}
          tabIndex={j === i ? 0 : -1}
          onClick={() => j !== i && onCambiar(j)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );

  return muchos ? <div className="pv-seg-scroll" ref={scrollRef}>{seg}</div> : seg;
}
