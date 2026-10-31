import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Trophy, Users } from 'lucide-react';
import Recorrido from './Recorrido';
import Segmentado from './Segmentado';
import TarjetaPartido from './TarjetaPartido';
import TablaZona from './TablaZona';
import ListaAnimada from './ListaAnimada';
import LlaveEscritorio from './LlaveEscritorio';
import {
  clasificadosPorOrigen,
  diaDe,
  diaDeHoy,
  diasDelTorneo,
  estadoDe,
  etapaCorta,
  etiquetaRonda,
  fraseFase,
  ladoDe,
  nombreJornada,
  partidosDeCategoria,
  porHorario,
  sinResultado,
} from './utilidades';

const SECCIONES = [
  { key: 'zonas', label: 'Zonas' },
  { key: 'cuadro', label: 'Cuadro' },
  { key: 'horarios', label: 'Horarios' },
];
const claveTarjeta = (p) => p.id;
const reducido = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const MAX_PROXIMOS = 4;

// Índice de chips: lleva a cada parte y marca en cuál estás
function Indice({ activa, onIr, className, style }) {
  return (
    <nav className={className} style={style} aria-label="Partes de la categoría">
      <div className="pv-envolver pv-indice-items">
        {SECCIONES.map((s) => (
          <a key={s.key} href={`#${s.key}`} aria-current={activa === s.key ? 'true' : undefined} onClick={(e) => onIr(s.key, e)}>
            {s.label}
          </a>
        ))}
      </div>
    </nav>
  );
}

// La sección activa es la última cuyo título ya pasó la línea de abajo del índice; al final de la página, la última
function useSeccionActiva(indiceRef, activo) {
  const [activa, setActiva] = useState(SECCIONES[0].key);
  useEffect(() => {
    if (!activo) return undefined;
    let pendiente = false;
    const revisar = () => {
      pendiente = false;
      const indice = indiceRef.current?.querySelector('.pv-indice');
      if (!indice) return;
      const tope = indice.getBoundingClientRect().bottom + 24;
      let actual = SECCIONES[0].key;
      SECCIONES.forEach((s) => {
        const el = document.getElementById(s.key);
        if (el && el.getBoundingClientRect().top <= tope) actual = s.key;
      });
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) actual = SECCIONES[SECCIONES.length - 1].key;
      setActiva(actual);
    };
    const alScroll = () => {
      if (!pendiente) { pendiente = true; requestAnimationFrame(revisar); }
    };
    window.addEventListener('scroll', alScroll, { passive: true });
    window.addEventListener('resize', alScroll);
    revisar();
    return () => {
      window.removeEventListener('scroll', alScroll);
      window.removeEventListener('resize', alScroll);
    };
  }, [indiceRef, activo]);
  return activa;
}

export default function Categoria({ categoria: cat, seguidaId, isMobile, rondaId, onCambiarRonda, animar, actualizacion, seccionInicial }) {
  const raiz = useRef(null);
  const ahora = Date.now();
  const e = estadoDe(cat, ahora);
  const origenes = useMemo(() => clasificadosPorOrigen(cat), [cat]);
  const partidos = useMemo(() => partidosDeCategoria(cat), [cat]);
  const zonas = cat.zonas || [];
  const eliminatoria = cat.eliminatoria || [];
  const activa = useSeccionActiva(raiz, !e.preparacion);
  const [zonasAbiertas, setZonasAbiertas] = useState(() => new Set());
  const dias = useMemo(() => diasDelTorneo([cat]), [cat]);
  const hoy = diaDeHoy(dias);
  const [diasAbiertos, setDiasAbiertos] = useState(() => new Set(hoy ? [hoy.key] : []));

  const c = (clase, i) => ({ className: `${clase}${animar ? ' pv-cascada' : ''}`, style: { '--i': i } });
  const tarjeta = (conDia) => (p) => (
    <TarjetaPartido partido={p} etiqueta={p.etiqueta} conDia={conDia} seguidaId={seguidaId} origenes={origenes} atrasado={sinResultado(p, ahora)} />
  );

  const ir = (key, ev) => {
    ev?.preventDefault();
    const el = document.getElementById(key);
    if (!el) return;
    el.scrollIntoView({ behavior: reducido() ? 'auto' : 'smooth', block: 'start' });
    el.querySelector('h2')?.focus({ preventScroll: true });
  };

  // Links viejos con ?sec=zonas|cuadro|horarios: llevar a esa parte
  useEffect(() => {
    if (seccionInicial && SECCIONES.some((s) => s.key === seccionInicial)) {
      requestAnimationFrame(() => document.getElementById(seccionInicial)?.scrollIntoView({ block: 'start' }));
    }
  }, [seccionInicial]);

  const alternar = (setter, key) =>
    setter((prev) => {
      const sig = new Set(prev);
      if (sig.has(key)) sig.delete(key); else sig.add(key);
      return sig;
    });

  // ─── Encabezado ───
  const encabezado = (
    <div className="pv-envolver pv-cat-cab">
      <h1 {...c('', 0)}>{cat.nombre}</h1>
      {!e.preparacion && (
        <>
          <p {...c('pv-cab-estado', 1)}>
            {e.terminada && <span className="pv-fase terminada">Terminada</span>}
            <span><b className="num">{e.jugados}</b> de {e.total} partidos jugados</span>
            {e.vivos > 0 && (
              <span className="pv-en-vivo">
                <span className="pv-punto-vivo" aria-hidden="true" />
                {e.vivos} en juego
              </span>
            )}
          </p>
          <div {...c('pv-cat-recorrido', 1)}>
            <Recorrido categoria={cat} />
          </div>
        </>
      )}
      {actualizacion}
      {e.podio && (
        <section {...c('pv-podio', 2)} aria-labelledby="t-campeones">
          <h2 id="t-campeones" className="pv-sr">Campeones</h2>
          <div className="pv-podio-campeon">
            <span className="pv-trofeo"><Trophy size={24} aria-hidden="true" /></span>
            <div>
              <span>Campeones de {cat.nombre}</span>
              <b translate="no">{e.podio.campeones}</b>
            </div>
          </div>
          {e.podio.subcampeones && (
            <div className="pv-podio-sub">
              <span>Subcampeones</span>
              <b translate="no">{e.podio.subcampeones}</b>
            </div>
          )}
        </section>
      )}
    </div>
  );

  if (e.preparacion) {
    return (
      <div ref={raiz}>
        {encabezado}
        <div className="pv-envolver">
          <div className="pv-preparacion">
            <Users size={36} aria-hidden="true" />
            <h2>En preparación</h2>
            <p>El organizador está cargando las parejas y armando las zonas. El fixture aparece acá cuando arranque.</p>
          </div>
        </div>
      </div>
    );
  }

  // ─── En juego y próximos ───
  const vivos = partidos.filter((p) => p.estado === 'EN_CURSO').sort(porHorario);
  const proximos = partidos
    .filter((p) => p.estado === 'PENDIENTE' && p.fechaHora && new Date(p.fechaHora).getTime() >= ahora)
    .sort(porHorario)
    .slice(0, MAX_PROXIMOS);
  const enJuego = [...vivos, ...proximos];

  // ─── Zonas ───
  const vistaZonas = zonas.length ? (
    <div className="pv-zonas">
      {zonas.map((z) => {
        const abierta = zonasAbiertas.has(z.id);
        const ps = (z.partidos || [])
          .map((p) => ({ ...p, etiqueta: etiquetaRonda(z, p) }))
          .sort((a, b) => (a.fechaHora && b.fechaHora ? porHorario(a, b) : (a.posicionEnRonda || 0) - (b.posicionEnRonda || 0)));
        return (
          <TablaZona key={z.id} zona={z} seguidaId={seguidaId}>
            {ps.length > 0 && (
              <>
                <button
                  type="button"
                  className="pv-zona-abrir"
                  aria-expanded={abierta}
                  aria-controls={`zp-${z.id}`}
                  onClick={() => alternar(setZonasAbiertas, z.id)}
                >
                  {abierta ? 'Ocultar partidos' : `Ver partidos (${ps.length})`}
                  <ChevronDown size={18} aria-hidden="true" />
                </button>
                <div className="pv-zona-partidos" id={`zp-${z.id}`} hidden={!abierta}>
                  {abierta && ps.map((p) => <div key={p.id}>{tarjeta(true)(p)}</div>)}
                </div>
              </>
            )}
          </TablaZona>
        );
      })}
    </div>
  ) : (
    <p className="pv-vacio">Esta categoría no tiene zonas.</p>
  );

  // ─── Cuadro ───
  // Ronda por defecto en el celular: la más avanzada con al menos un cruce definido
  let vistaCuadro = <p className="pv-vacio">El cuadro se arma cuando terminan las zonas.</p>;
  if (eliminatoria.length) {
    if (!isMobile) {
      vistaCuadro = <LlaveEscritorio fases={eliminatoria} seguidaId={seguidaId} origenes={origenes} />;
    } else {
      let porDefecto = eliminatoria[0];
      for (let i = eliminatoria.length - 1; i >= 0; i--) {
        if (eliminatoria[i].partidos.some((p) => Boolean(p.pareja1 && p.pareja2) || p.estado === 'FINALIZADO')) {
          porDefecto = eliminatoria[i];
          break;
        }
      }
      const fase = eliminatoria.find((f) => f.id === rondaId) || porDefecto;
      const idx = Math.max(0, eliminatoria.indexOf(fase));
      const reales = fase.partidos.filter((p) => !p.esBye);
      const byes = fase.partidos.filter((p) => p.esBye);
      const siguiente = eliminatoria[idx + 1];
      vistaCuadro = (
        <>
          <Segmentado
            items={eliminatoria.map((f) => ({ key: f.id, label: etapaCorta(f), aria: fraseFase(f.nombre) }))}
            activo={idx}
            etiqueta="Rondas del cuadro"
            onCambiar={(i) => onCambiarRonda(eliminatoria[i].id)}
          />
          <div key={fase.id} className="pv-entra">
            <h3 className="pv-titulo-dia">
              {fraseFase(fase.nombre)} <small>{reales.length} {reales.length === 1 ? 'partido' : 'partidos'}</small>
            </h3>
            {reales.length > 0 ? (
              <ListaAnimada items={reales} clave={claveTarjeta} render={tarjeta(true)} />
            ) : (
              <p className="pv-vacio">Sin partidos en esta ronda.</p>
            )}
            {byes.length > 0 && (
              <div className="pv-directo">
                <p>Pasan directo a {siguiente ? fraseFase(siguiente.nombre).toLowerCase() : 'la ronda siguiente'}:</p>
                <div className="pv-chips">
                  {byes.map((p) => {
                    const lado = ladoDe(p, p.pareja2 && !p.pareja1 ? 2 : 1, origenes);
                    const seguida = seguidaId && lado.parejaId === seguidaId;
                    return (
                      <span key={p.id} className={`pv-chip ${seguida ? 'seguida' : ''}`} translate="no">
                        {lado.nombre}
                        {lado.origen && <small>{lado.origen}</small>}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </>
      );
    }
  }

  // ─── Horarios por jornada ───
  const sinHora = partidos.filter((p) => !p.fechaHora).length;
  const vistaHorarios = dias.length ? (
    <div className="pv-jornadas">
      {dias.map((d) => {
        const delDia = partidos.filter((p) => diaDe(p) === d.key).sort(porHorario);
        const abierta = diasAbiertos.has(d.key);
        const esHoy = hoy?.momento === 'durante' && hoy.key === d.key;
        return (
          <div key={d.key} className="pv-jornada">
            <button
              type="button"
              className="pv-jornada-btn"
              aria-expanded={abierta}
              aria-controls={`j-${d.key}`}
              onClick={() => alternar(setDiasAbiertos, d.key)}
            >
              <span>
                {nombreJornada(d)}
                {esHoy && <em>hoy</em>}
              </span>
              <small>{delDia.length} {delDia.length === 1 ? 'partido' : 'partidos'}</small>
              <ChevronDown size={18} aria-hidden="true" />
            </button>
            <div className="pv-jornada-partidos" id={`j-${d.key}`} hidden={!abierta}>
              {abierta && <ListaAnimada items={delDia} clave={claveTarjeta} className="pv-lista grilla" render={tarjeta(false)} />}
            </div>
          </div>
        );
      })}
    </div>
  ) : (
    <p className="pv-vacio">Todavía no hay horarios.</p>
  );

  return (
    <div ref={raiz}>
      {encabezado}
      <Indice activa={activa} onIr={ir} {...c('pv-indice', 2)} />
      <div className="pv-envolver pv-cat-cuerpo">
        {enJuego.length > 0 && (
          <section className="pv-seccion" aria-labelledby="t-en-juego">
            <h2 id="t-en-juego">{vivos.length ? 'En juego y próximos' : 'Próximos partidos'}</h2>
            <ListaAnimada items={enJuego} clave={claveTarjeta} className="pv-lista grilla" render={tarjeta(true)} />
          </section>
        )}
        <section {...c('pv-seccion', 3)} id="zonas" aria-labelledby="t-zonas">
          <h2 id="t-zonas" tabIndex={-1}>
            Zonas{' '}
            {zonas.length > 0 && (
              <small>
                {zonas.length} {zonas.length === 1 ? 'zona' : 'zonas'}
                {cat.totalParejas ? `, ${cat.totalParejas} parejas` : ''}
              </small>
            )}
          </h2>
          {vistaZonas}
        </section>
        <section className="pv-seccion" id="cuadro" aria-labelledby="t-cuadro">
          <h2 id="t-cuadro" tabIndex={-1}>Cuadro</h2>
          {vistaCuadro}
        </section>
        <section className="pv-seccion" id="horarios" aria-labelledby="t-horarios">
          <h2 id="t-horarios" tabIndex={-1}>Horarios</h2>
          {vistaHorarios}
          {sinHora > 0 && (
            <p className="pv-nota">
              {sinHora} {sinHora === 1 ? 'partido del cuadro todavía no tiene' : 'partidos del cuadro todavía no tienen'} horario: se programan cuando terminan las zonas.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
