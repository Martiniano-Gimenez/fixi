const ICONOS = {
  hoy: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
      <circle cx="12" cy="15" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  zonas: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  cuadro: <path d="M3 5h5v5M3 19h5v-5M8 7.5h5M8 16.5h5M13 7.5v9M13 12h8" />,
  horarios: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
};

/**
 * Secciones de la vista pública: barra fija abajo en celular, pestañas arriba en escritorio.
 * Son enlaces (se pueden abrir en otra pestaña); el clic normal cambia de sección sin recargar.
 */
export default function NavSecciones({ secciones, activa, onCambiar, href }) {
  const i = Math.max(0, secciones.findIndex((s) => s.key === activa));
  return (
    <nav className="pv-nav" aria-label="Secciones">
      <div className="pv-nav-items" style={{ '--n': secciones.length }}>
        <span className="pv-nav-ind" aria-hidden="true" style={{ transform: `translateX(${i * 100}%)` }} />
        {secciones.map((s) => (
          <a
            key={s.key}
            className="pv-nav-btn"
            href={href(s.key)}
            aria-current={s.key === activa ? 'page' : undefined}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              onCambiar(s.key);
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {ICONOS[s.key]}
            </svg>
            {s.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
