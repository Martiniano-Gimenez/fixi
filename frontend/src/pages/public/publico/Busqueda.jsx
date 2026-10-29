import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import TarjetaPartido, { Estrella } from './TarjetaPartido';
import {
  agruparPartidosPorJornada,
  clasificadosPorOrigen,
  diasDelTorneo,
  nombreJornada,
  parejasQueCoinciden,
  partidosDePareja,
  sinResultado,
} from './utilidades';

function ParejaResultado({
  pareja,
  idx,
  diasTorneo,
  esSeguida,
  onToggleSeguir,
  hrefCategoria,
  onAbrirCategoria,
  ahora,
}) {
  const { cat } = pareja;
  const origenes = useMemo(() => clasificadosPorOrigen(cat), [cat]);
  const partidos = useMemo(
    () => partidosDePareja(cat, pareja.parejaId, pareja.nombre),
    [cat, pareja.parejaId, pareja.nombre]
  );
  const { jornadas, sinHora } = useMemo(
    () => agruparPartidosPorJornada(partidos, diasTorneo),
    [partidos, diasTorneo]
  );

  const hayPartidos = jornadas.length > 0 || sinHora.length > 0;

  return (
    <article
      className="pv-busqueda-pareja pv-cascada"
      style={{ '--i': idx }}
      aria-label={`Pareja ${pareja.nombre} en ${cat.nombre}`}
    >
      <header className="pv-busqueda-pareja-arriba">
        <div className="pv-busqueda-pareja-titulos">
          <h3 className="pv-busqueda-pareja-nombre" translate="no">
            <span>{pareja.nombre}</span>
            {esSeguida && <Estrella />}
          </h3>
          <span className="pv-busqueda-pareja-cat">{cat.nombre}</span>
        </div>
        <div className="pv-busqueda-pareja-acciones">
          {pareja.parejaId && (
            <button
              type="button"
              className={`pv-btn pv-btn-secundario pv-btn-seguir ${esSeguida ? 'siguiendo' : ''}`}
              onClick={() => onToggleSeguir(cat.id, pareja.parejaId)}
              aria-pressed={esSeguida}
              aria-label={esSeguida ? `Dejar de seguir a ${pareja.nombre}` : `Seguir a ${pareja.nombre}`}
            >
              <Estrella contorno={!esSeguida} aria-hidden="true" />
              <span>{esSeguida ? 'Siguiendo' : 'Seguir'}</span>
            </button>
          )}
          <a
            href={hrefCategoria(cat)}
            className="pv-btn pv-btn-secundario pv-btn-ver-cat"
            onClick={(e) => onAbrirCategoria(cat, e)}
          >
            Ver su categoría
          </a>
        </div>
      </header>

      {hayPartidos ? (
        <div className="pv-busqueda-partidos">
          {jornadas.map(({ dia, partidos: ps }) => (
            <section key={dia.key} className="pv-busqueda-jornada" aria-label={nombreJornada(dia)}>
              <h4 className="pv-titulo-dia">
                {nombreJornada(dia)} <small>{ps.length} {ps.length === 1 ? 'partido' : 'partidos'}</small>
              </h4>
              <div className="pv-lista">
                {ps.map((p) => (
                  <TarjetaPartido
                    key={p.id}
                    partido={p}
                    etiqueta={p.etiqueta}
                    conDia={false}
                    seguidaId={esSeguida ? pareja.parejaId : null}
                    origenes={origenes}
                    atrasado={sinResultado(p, ahora)}
                  />
                ))}
              </div>
            </section>
          ))}
          {sinHora.length > 0 && (
            <section className="pv-busqueda-jornada" aria-label="A definir">
              <h4 className="pv-titulo-dia">
                A definir <small>{sinHora.length} {sinHora.length === 1 ? 'partido' : 'partidos'}</small>
              </h4>
              <div className="pv-lista">
                {sinHora.map((p) => (
                  <TarjetaPartido
                    key={p.id}
                    partido={p}
                    etiqueta={p.etiqueta}
                    conDia={false}
                    seguidaId={esSeguida ? pareja.parejaId : null}
                    origenes={origenes}
                    atrasado={false}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      ) : (
        <p className="pv-busqueda-sin-partidos">Todavía no tiene partidos programados.</p>
      )}
    </article>
  );
}

export default function Busqueda({
  categorias,
  queryInicial = '',
  onCerrar,
  onCambiarQuery,
  favs,
  onToggleSeguir,
  hrefCategoria,
  onAbrirCategoria,
}) {
  const [query, setQuery] = useState(queryInicial);
  const inputRef = useRef(null);
  const overlayRef = useRef(null);
  const ahora = Date.now();

  // Foco automático en el input
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Sincronizar si cambia desde afuera (ej. atrás en el navegador)
  useEffect(() => {
    setQuery(queryInicial);
  }, [queryInicial]);

  // Tecla Escape cierra
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCerrar();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCerrar]);

  // Evitar scroll del fondo mientras el panel está abierto
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const handleInputChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    onCambiarQuery(val);
  };

  const handleLimpiar = () => {
    setQuery('');
    onCambiarQuery('');
    inputRef.current?.focus();
  };

  const handleOverlayClick = (e) => {
    if (e.target === overlayRef.current) {
      onCerrar();
    }
  };

  const diasTorneo = useMemo(() => diasDelTorneo(categorias), [categorias]);
  const resultados = useMemo(() => parejasQueCoinciden(categorias, query), [categorias, query]);

  const textoLimpio = query.trim();
  const hayBusqueda = textoLimpio.length > 0;
  const sinResultados = hayBusqueda && resultados.length === 0;

  return (
    <div
      ref={overlayRef}
      className="pv-busqueda-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Buscar pareja o jugador"
      onClick={handleOverlayClick}
    >
      <div className="pv-busqueda-panel">
        <header className="pv-busqueda-cab">
          <div className="pv-busqueda-cab-fila">
            <div className="pv-busqueda-input-wrap">
              <Search size={18} className="pv-busqueda-icono" aria-hidden="true" />
              <input
                ref={inputRef}
                type="search"
                className="pv-input pv-busqueda-input"
                value={query}
                onChange={handleInputChange}
                placeholder="Buscar pareja o jugador…"
                autoComplete="off"
                autoCorrect="off"
                spellCheck="false"
                enterKeyHint="search"
              />
              {query && (
                <button
                  type="button"
                  className="pv-busqueda-limpiar"
                  aria-label="Borrar texto"
                  onClick={handleLimpiar}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              )}
            </div>
            <button
              type="button"
              className="pv-btn pv-btn-secundario pv-busqueda-cerrar"
              onClick={onCerrar}
            >
              Cerrar
            </button>
          </div>
        </header>

        <div className="pv-busqueda-cuerpo">
          {!hayBusqueda && (
            <p className="pv-busqueda-guia">
              Escribí el apellido o nombre de un jugador para ver sus partidos.
            </p>
          )}

          {sinResultados && (
            <div className="pv-busqueda-vacio" role="status">
              <p>
                No hay partidos con “{textoLimpio}” en el torneo. Revisá cómo está escrito el apellido.
              </p>
            </div>
          )}

          {hayBusqueda && resultados.length > 0 && (
            <div className="pv-busqueda-resultados">
              {resultados.map((pareja, idx) => (
                <ParejaResultado
                  key={`${pareja.cat.id}:${pareja.parejaId || pareja.nombre}`}
                  pareja={pareja}
                  idx={idx}
                  diasTorneo={diasTorneo}
                  esSeguida={Boolean(pareja.parejaId && favs[pareja.cat.id] === pareja.parejaId)}
                  onToggleSeguir={onToggleSeguir}
                  hrefCategoria={hrefCategoria}
                  onAbrirCategoria={onAbrirCategoria}
                  ahora={ahora}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
